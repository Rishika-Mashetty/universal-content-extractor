/* eslint-disable @typescript-eslint/no-var-requires */
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require("dotenv");
dotenv.config();

/* ---------------- CONFIG ---------------- */
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const repoUrl = "https://github.com/Rishika-Mashetty/universal-content-extractor/"; // Change as needed

/* ---------------- HELPERS ---------------- */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function clampText(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "\n...[truncated]..." : s;
}

function parseOwnerRepo(url: string): { owner: string; repo: string } {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)(?:$|\/|\?)/i);
  if (!m || !m[1] || !m[2]) throw new Error("Invalid GitHub repo URL");
  return { owner: m[1], repo: m[2].replace(/\.git$/, "") };
}

function asTree(tree: any[]): string {
  const lines: string[] = [];
  const sorted = tree.map((t: any) => t.path).sort((a: string, b: string) => a.localeCompare(b));
  for (const p of sorted) {
    const depth = (p.match(/\//g) || []).length;
    const isDir = tree.some((t: any) => t.path === p && t.type === "tree");
    const bullet = isDir ? "📁" : "📄";
    lines.push(`${"  ".repeat(depth)}${bullet} ${p}`);
  }
  return lines.join("\n");
}

/* ---------------- AXIOS CLIENT ---------------- */
const http = axios.create({
  headers: {
    "User-Agent": "Universal-Content-Extractor",
    ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
    Accept: "application/vnd.github+json",
  },
  timeout: 30000,
});

/* ---------------- FETCH FUNCTIONS ---------------- */
async function fetchRepoMeta(owner: string, repo: string): Promise<any> {
  const { data } = await http.get(`https://api.github.com/repos/${owner}/${repo}`);
  return data;
}

async function fetchReadme(owner: string, repo: string, branch: string): Promise<string> {
  const candidates = [
    `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`,
    `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README`,
  ];
  for (const url of candidates) {
    try {
      const { data } = await axios.get(url, { timeout: 20000 });
      if (typeof data === "string" && data.trim()) return data;
    } catch {}
  }
  return "";
}

async function fetchTree(owner: string, repo: string, branch: string): Promise<any[]> {
  const ref = await http.get(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`);
  const sha = ref.data?.object?.sha;
  if (!sha) throw new Error("Failed to resolve branch SHA");

  const commit = await http.get(`https://api.github.com/repos/${owner}/${repo}/git/commits/${sha}`);
  const treeSha = commit.data?.tree?.sha;
  if (!treeSha) throw new Error("Failed to resolve tree SHA");

  const { data } = await http.get(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`
  );
  return data.tree;
}

async function fetchFileRaw(owner: string, repo: string, branch: string, filePath: string): Promise<string> {
  try {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
    const { data } = await axios.get(rawUrl, { timeout: 20000 });
    return typeof data === "string" ? data : JSON.stringify(data);
  } catch {
    return "";
  }
}

/* ---------------- GEMINI ANALYSIS ---------------- */
async function analyzeWithGemini(payload: {
  meta: any;
  fileTreeText: string;
  readme: string;
  sampledFiles: { path: string; snippet: string }[];
}): Promise<string> {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const snippets = payload.sampledFiles
    .map((f) => `---\n# ${f.path}\n${f.snippet}`)
    .join("\n\n");

  const prompt = `
You are a senior developer summarizing a GitHub repository.

Summarize this repository as:
1️⃣ Short summary (2–3 lines)
2️⃣ Detailed breakdown (5–8 bullet points)
3️⃣ Key files/modules and their roles
4️⃣ Probable tech stack and architecture
5️⃣ Risks or missing aspects

=== Metadata ===
Name: ${payload.meta.full_name}
Description: ${payload.meta.description}
Stars: ${payload.meta.stargazers_count}
Forks: ${payload.meta.forks_count}

=== File Tree (truncated) ===
${clampText(payload.fileTreeText, 20000)}

=== README (truncated) ===
${clampText(payload.readme, 20000)}

=== Sample Files (truncated) ===
${clampText(snippets, 30000)}
`;

  const res = await model.generateContent(prompt);
  return res.response.text();
}

/* ---------------- MAIN EXECUTION ---------------- */
(async () => {
  try {
    const { owner, repo } = parseOwnerRepo(repoUrl);

    console.log("📦 Fetching repository metadata...");
    const meta = await fetchRepoMeta(owner, repo);

    console.log("🌲 Fetching file tree...");
    const tree = await fetchTree(owner, repo, meta.default_branch);
    const fileTreeText = asTree(tree);

    console.log("📖 Fetching README...");
    const readme = await fetchReadme(owner, repo, meta.default_branch);

    console.log("🧩 Sampling representative files...");
    const sampleFiles = tree
      .filter((t: any) => t.type === "blob" && /\.(js|ts|py|md)$/.test(t.path))
      .slice(0, 5);

    const sampledFiles: { path: string; snippet: string }[] = [];
    for (const f of sampleFiles) {
      const snippet = await fetchFileRaw(owner, repo, meta.default_branch, f.path);
      sampledFiles.push({ path: f.path, snippet: clampText(snippet, 8000) });
      await sleep(200);
    }

    console.log("🧠 Sending to Gemini for analysis...");
    const summary = await analyzeWithGemini({ meta, fileTreeText, readme, sampledFiles });

    const out = {
      repoUrl,
      owner: meta.owner.login,
      repo: meta.name,
      description: meta.description,
      stars: meta.stargazers_count,
      forks: meta.forks_count,
      summary,
    };

    const outDir = path.join(process.cwd(), "summaries");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${owner}__${repo}.json`);
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");

    console.log("\n✅ Summary saved to:", outPath);
    console.log("\n🧾 Gemini Summary:\n");
    console.log(summary);
  } catch (err) {
    console.error("❌ Error:", err instanceof Error ? err.message : String(err));
  }
})();
