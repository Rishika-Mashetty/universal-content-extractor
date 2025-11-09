/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { parseStringPromise } = require("xml2js");
const youtubedl = require("youtube-dl-exec");
const dotenv = require("dotenv");
const { GoogleGenerativeAI } = require("@google/generative-ai");

dotenv.config();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 🎯 Put your video link here
const VIDEO_URL: string = "https://www.youtube.com/watch?v=viU_64adkEo";

// ---------------- Helpers ----------------
const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&#39;": "'",
  "&quot;": '"'
};
function decodeEntities(s: string): string {
  return s.replace(/&amp;|&lt;|&gt;|&#39;|&quot;/g, (m) => HTML_ENTITIES[m] || m);
}

function extractVideoId(url: string): string | null {
  const patterns = [
    /v=([0-9A-Za-z_-]{11})/,
    /youtu\.be\/([0-9A-Za-z_-]{11})/,
    /shorts\/([0-9A-Za-z_-]{11})/,
    /embed\/([0-9A-Za-z_-]{11})/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m && m[1]) return m[1];
  }
  return null;
}

// ---------------- Title & Description ----------------
async function fetchTitleAndDescription(videoId: string) {
  try {
    const { data: html } = await axios.get(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
    if (match) {
      const json = JSON.parse(match[1]);
      return {
        title: decodeEntities(json?.videoDetails?.title || ""),
        description: decodeEntities(json?.videoDetails?.shortDescription || "")
      };
    }
    return { title: "Unknown", description: "Unavailable" };
  } catch {
    return { title: "Unknown", description: "Unavailable" };
  }
}

// ---------------- Try captions ----------------
async function fetchTranscriptViaTimedText(videoId: string): Promise<string | undefined> {
  try {
    const listUrl = `https://video.google.com/timedtext?type=list&v=${videoId}&hl=en`;
    const { data: xml } = await axios.get(listUrl);
    const parsed = await parseStringPromise(xml);
    const tracks = parsed?.transcript_list?.track ?? [];

    if (!tracks.length) return undefined;
    const track =
      tracks.find((t: any) => t.$.lang_code.startsWith("en")) ||
      tracks.find((t: any) => t.$.kind === "asr") ||
      tracks[0];

    const lang = track.$.lang_code;
    const resp = await axios.get(`https://video.google.com/timedtext?lang=${lang}&v=${videoId}`);
    const parsedTrack = await parseStringPromise(resp.data);
    const lines = parsedTrack?.transcript?.text ?? [];
    const text = lines.map((t: any) => t._ || "").join(" ").trim();
    return text || undefined;
  } catch {
    return undefined;
  }
}

// ---------------- Download audio (.webm) ----------------
async function downloadAudio(videoId: string): Promise<string> {
  const outPath = path.resolve(`audio_${videoId}.webm`);
  console.log("🎧 Downloading .webm audio (no FFmpeg)...");

  await youtubedl(`https://www.youtube.com/watch?v=${videoId}`, {
    format: "bestaudio[ext=webm]",
    output: outPath,
    noCheckCertificates: true,
    noWarnings: true,
    addHeader: ["referer:youtube.com", "user-agent:Mozilla/5.0"]
  });

  console.log("✅ Audio downloaded:", outPath);
  return outPath;
}

// ---------------- Gemini transcription ----------------
async function transcribeWithGemini(audioPath: string, meta: any): Promise<string> {
  console.log("🧠 Sending .webm audio to Gemini...");
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
  const fileBuffer = fs.readFileSync(audioPath);

  const prompt = `
You are an AI transcriber and summarizer.
1. Transcribe the spoken content.
2. Provide a detailed summary.
3. Extract key points and tone.

Video Info:
Title: ${meta.title}
Description: ${meta.description}
`;

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: "audio/webm",
        data: fileBuffer.toString("base64")
      }
    },
    { text: prompt }
  ]);

  return result.response.text();
}

// ---------------- Save output ----------------
function saveOutput(videoId: string, meta: any, transcript: string) {
  const file = path.resolve(`output_${videoId}.txt`);
  const content = `
🎬 Title: ${meta.title}
📝 Description: ${meta.description}

=============================
🎧 TRANSCRIPT / SUMMARY
=============================

${transcript}
  `;
  fs.writeFileSync(file, content, "utf8");
  console.log(`💾 Transcript saved to ${file}`);
}

// ---------------- MAIN ----------------
(async () => {
  const videoId = extractVideoId(VIDEO_URL);
  if (!videoId) {
    console.error("❌ Invalid YouTube URL");
    return;
  }

  console.log("🎬 Fetching metadata...");
  const meta = await fetchTitleAndDescription(videoId);
  console.log("Title:", meta.title);
  console.log("Description:", meta.description.slice(0, 200) + "...");

  console.log("🔍 Checking for captions...");
  const captions = await fetchTranscriptViaTimedText(videoId);

  let transcriptText: string;
  if (captions) {
    console.log("✅ Using captions.");
    transcriptText = captions;
  } else {
    console.log("⚠️ No captions found. Downloading .webm audio...");
    const audioPath = await downloadAudio(videoId);
    transcriptText = await transcribeWithGemini(audioPath, meta);
  }

  console.log("\n===============================");
  console.log("🎧 TRANSCRIPT / SUMMARY");
  console.log("===============================\n");
  console.log(transcriptText);

  saveOutput(videoId, meta, transcriptText);
})();
