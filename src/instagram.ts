/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * STEP 1️⃣ — Extract visible Instagram data (caption, hashtags, username)
 */
async function fetchVisibleInstagramData(url: string) {
  console.log("🚀 Launching headless browser...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  console.log("🌐 Opening main page:", url);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await delay(7000);

  const visible = await page.evaluate(() => {
    const author =
      document.querySelector("header a")?.textContent?.trim() ||
      document.querySelector("h2 a")?.textContent?.trim() ||
      document.querySelector("span[dir='auto']")?.textContent?.trim() ||
      "Unknown";

    const allTexts = Array.from(document.querySelectorAll("span, div"))
      .map((el) => el.textContent?.trim())
      .filter(Boolean);

    const captionParts = allTexts.filter(
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
 * STEP 2️⃣ — Fetch video URL + title + meta data
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
      document
        .querySelector("meta[property='og:description']")
        ?.getAttribute("content") ||
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
 * STEP 3️⃣ — Download video locally
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
 * STEP 4️⃣ — Transcribe video with Gemini
 */
async function transcribeVideoWithGemini(videoPath: string): Promise<string> {
  console.log("🎧 Transcribing audio with Gemini...");
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const fileData = {
    inlineData: {
      data: fs.readFileSync(videoPath).toString("base64"),
      mimeType: "video/mp4",
    },
  };

  const prompt = "Transcribe the spoken words from this Instagram video accurately.";
  const result = await model.generateContent([fileData, { text: prompt }]);
  return result.response.text();
}

/**
 * STEP 5️⃣ — Generate short summary using Gemini
 */
async function summarizeWithGemini(data: any): Promise<string> {
  console.log("🧠 Generating short summary via Gemini...");
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const prompt = `
Create a short, clean, and human-friendly summary of this Instagram reel/post.
Focus on what it’s about (topic, mood, content).
Make it 2–3 sentences, concise, and engaging and dont miss any imp details.

DATA:
Author: ${data.author}
Title: ${data.title}
Caption: ${data.caption}
Hashtags: ${data.hashtags}
Transcript: ${data.transcript}
`;

  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

/**
 * STEP 6️⃣ — Combine everything
 */
(async () => {
  const postUrl = "https://www.instagram.com/p/DQ1WRy-Ev4g/?utm_source=ig_web_copy_link";

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

  let transcript = "No audio content found.";
  if (combined.videoUrl) {
    const videoPath = path.join(__dirname, "instagram_video.mp4");
    await downloadVideo(combined.videoUrl, videoPath);
    console.log("✅ Video saved locally:", videoPath);
    transcript = await transcribeVideoWithGemini(videoPath);
  }

  const fullData = { ...combined, transcript };

  console.log("\n🧠 Final Combined Data:");
  console.log(fullData);

  const summary = await summarizeWithGemini(fullData);
  console.log("\n✨ Clean Short Summary:");
  console.log(summary);
})();
