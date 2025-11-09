/* eslint-disable @typescript-eslint/no-var-requires */
const puppeteer = require("puppeteer");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Delay helper
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Step 1️⃣ — Extract LinkedIn post (visible text)
 */
async function fetchLinkedInPostData(url: string): Promise<{
  author: string;
  title: string;
  description: string;
  hashtags: string;
}> {
  console.log("🚀 Launching headless browser...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  console.log("🌐 Opening LinkedIn post:", url);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });

  // Scroll to load all text
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await delay(2000);
  }

  // Extract text content
  const post = await page.evaluate(() => {
    const clean = (t: string | null | undefined): string =>
      t?.replace(/\s+/g, " ").replace(/See more|...more/gi, "").trim() || "";

    const author =
      document.querySelector("span.feed-shared-actor__name")?.textContent?.trim() ||
      document.querySelector("div.update-components-actor__title span")?.textContent?.trim() ||
      "Unknown";

    const title =
      document.querySelector("meta[property='og:title']")?.getAttribute("content") ||
      document.querySelector("title")?.textContent?.trim() ||
      "LinkedIn Post";

    const postContainer =
      document.querySelector("div.update-components-text") ||
      document.querySelector("div.feed-shared-update-v2__description-wrapper") ||
      document.body;

    let description = "";
    if (postContainer) {
      const walker = document.createTreeWalker(postContainer, NodeFilter.SHOW_TEXT, null);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = (node.textContent || "").trim();
        if (text && text.length > 2) description += text + " ";
      }
    }

    const hashtags = Array.from(document.querySelectorAll("a[href*='/feed/hashtag/']"))
      .map((a) => a.textContent?.trim())
      .filter(Boolean)
      .join(" ");

    return { author, title: clean(title), description: clean(description), hashtags };
  });

  await browser.close();
  return post;
}

/**
 * Step 2️⃣ — Summarize via Gemini
 */
async function summarizeWithGemini(fullText: string): Promise<string> {
  console.log("🧠 Summarizing with Gemini...");
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const prompt = `
You are a professional summarizer. Summarize the following LinkedIn post 
Make it 2–3 sentences, concise, and engaging but dont miss any imp details.  
Post Content:
${fullText}
`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}

/**
 * Step 3️⃣ — Combine everything
 */
(async () => {
  const postUrl =
    "https://www.linkedin.com/posts/avi-chawla_rag-vs-cag-explained-visually-for-ai-engineers-activity-7391440368627585024-hikl";

  console.log("🔍 Extracting LinkedIn post data...");
  const post = await fetchLinkedInPostData(postUrl);

  console.log("\n✅ Extracted LinkedIn Data:");
  console.log(post);

  if (!post.description || post.description.length < 20) {
    console.log("⚠️ No description found — cannot summarize.");
    return;
  }

  const combinedText = `
Author: ${post.author}
Title: ${post.title}
Content: ${post.description}
Hashtags: ${post.hashtags}
  `;

  const summary = await summarizeWithGemini(combinedText);

  console.log("\n🧾 Final Summaries:");
  console.log(summary);
})();
