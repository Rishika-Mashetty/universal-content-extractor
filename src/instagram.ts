/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Helper sleep function for older Puppeteer
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Step 1️⃣ — Extract visible caption, hashtags, and username from Instagram reel/post
 */
async function fetchVisibleInstagramData(url: string) {
  console.log("🚀 Launching headless browser...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  console.log("🌐 Opening main reel/post:", url);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await delay(7000); // Allow dynamic content to render

  const visible = await page.evaluate(() => {
    const author =
      document.querySelector("header a")?.textContent?.trim() ||
      document.querySelector("h2 a")?.textContent?.trim() ||
      document.querySelector("span[dir='auto']")?.textContent?.trim() ||
      "Unknown";

    const possibleTexts = Array.from(document.querySelectorAll("span, div"))
      .map((el) => el.textContent?.trim())
      .filter(Boolean);

    const captionParts = possibleTexts.filter(
      (t) =>
        (t.includes("₹") ||
          t.includes("#") ||
          t.toLowerCase().includes("follow") ||
          t.length > 10) &&
        !t.match(/Instagram|Reels|Followed|Suggested/i)
    );

    let caption = captionParts.join(" ").trim();
    caption = caption
      .replace(/\s+/g, " ")
      .replace(/Follow\s*@\w+/gi, "")
      .replace(/Add comment|Suggested for you/gi, "")
      .trim();

    const hashtags = (caption.match(/#[\w]+/g) || []).join(" ");
    return { author, caption, hashtags };
  });

  await browser.close();
  return visible;
}

/**
 * Step 2️⃣ — Fetch video, title, and meta info from Instagram embed
 */
async function fetchInstagramMetadata(url: string) {
  console.log("🌐 Opening embed view...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  const embedUrl = url.endsWith("/") ? `${url}embed/` : `${url}/embed/`;
  await page.goto(embedUrl, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForSelector("article", { timeout: 25000 }).catch(() => {});

  const info = await page.evaluate(() => {
    const video = document.querySelector("video");
    const author =
      document.querySelector("a[href*='/']")?.textContent?.trim() ||
      document.querySelector("header span")?.textContent?.trim() ||
      "Unknown";

    const caption =
      document.querySelector("h1")?.textContent?.trim() ||
      document.querySelector("meta[property='og:description']")?.getAttribute("content") ||
      "No caption found";

    const title =
      document.querySelector("title")?.textContent?.trim() || "Instagram Post";

    const videoUrl = video?.getAttribute("src") || null;

    return { author, caption, title, videoUrl };
  });

  await browser.close();
  return info;
}

/**
 * Step 3️⃣ — Download video
 */
async function downloadVideo(videoUrl: string, outputPath: string): Promise<void> {
  console.log("⬇️ Downloading video...");
  const writer = fs.createWriteStream(outputPath);
  const response = await axios.get(videoUrl, { responseType: "stream" });
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

/**
 * Step 4️⃣ — Transcribe with Gemini
 */
async function transcribeVideoWithGemini(videoPath: string): Promise<string> {
  console.log("🧠 Transcribing audio via Gemini...");
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const fileData = {
    inlineData: {
      data: fs.readFileSync(videoPath).toString("base64"),
      mimeType: "video/mp4",
    },
  };

  const prompt = "Transcribe the spoken words from this Instagram video clearly and accurately.";
  const result = await model.generateContent([fileData, { text: prompt }]);
  return result.response.text();
}

/**
 * Step 5️⃣ — Combine it all
 */
(async () => {
  const postUrl = "https://www.instagram.com/reel/DQwOrvZEjip/";

  console.log("🔍 Extracting visible Instagram data...");
  const visible = await fetchVisibleInstagramData(postUrl);
  console.log("✅ Visible Data:", visible);

  console.log("\n📦 Fetching embed metadata...");
  const info = await fetchInstagramMetadata(postUrl);
  console.log("✅ Embed Metadata:", info);

  const combined = {
    author: visible.author || info.author,
    title: info.title,
    caption: visible.caption || info.caption,
    hashtags: visible.hashtags,
    videoUrl: info.videoUrl,
  };

  if (!combined.videoUrl) {
    console.log("⚠️ No video found — skipping transcription.");
    console.log({
      ...combined,
      transcript: "No audio content found.",
    });
    return;
  }

  const videoPath = path.join(__dirname, "instagram_video.mp4");
  await downloadVideo(combined.videoUrl, videoPath);
  console.log("✅ Video saved locally:", videoPath);

  const transcript = await transcribeVideoWithGemini(videoPath);

  console.log("\n🧠 Final Output:");
  console.log({
    ...combined,
    transcript,
  });
})();
