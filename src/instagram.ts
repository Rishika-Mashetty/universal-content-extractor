/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Step 1️⃣ - Load Instagram embed in Puppeteer and extract metadata
 */
async function fetchInstagramMetadata(url: string) {
  console.log("🚀 Launching browser...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  const embedUrl = url.endsWith("/") ? `${url}embed/` : `${url}/embed/`;

  console.log("🌐 Opening:", embedUrl);
  await page.goto(embedUrl, { waitUntil: "networkidle2", timeout: 60000 });

  // Wait for video or image
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
 * Step 2️⃣ - Download video
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
 * Step 3️⃣ - Transcribe video via Gemini
 */
async function transcribeVideoWithGemini(videoPath: string): Promise<string> {
  console.log("🧠 Transcribing via Gemini...");
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const fileData = {
    inlineData: {
      data: fs.readFileSync(videoPath).toString("base64"),
      mimeType: "video/mp4",
    },
  };

  const prompt = "Transcribe all spoken audio from this Instagram video clearly and accurately.";
  const result = await model.generateContent([fileData, { text: prompt }]);
  return result.response.text();
}

/**
 * Step 4️⃣ - Combine steps
 */
(async () => {
  const postUrl = "https://www.instagram.com/reel/DQwOrvZEjip/"; // replace with any public post or reel

  console.log("🔍 Fetching Instagram metadata...");
  const info = await fetchInstagramMetadata(postUrl);
  console.log("✅ Extracted Metadata:", info);

  if (!info.videoUrl) {
    console.log("⚠️ No video found — skipping transcription.");
    console.log({
      author: info.author,
      title: info.title,
      caption: info.caption,
      transcript: "No audio content found.",
    });
    return;
  }

  const videoPath = path.join(__dirname, "instagram_video.mp4");
  await downloadVideo(info.videoUrl, videoPath);
  console.log("✅ Video saved locally:", videoPath);

  const transcript = await transcribeVideoWithGemini(videoPath);

  console.log("\n🧠 Final Output:");
  console.log({
    author: info.author,
    title: info.title,
    caption: info.caption,
    videoUrl: info.videoUrl,
    transcript,
  });
})();
