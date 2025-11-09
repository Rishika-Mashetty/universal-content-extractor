/* eslint-disable @typescript-eslint/no-var-requires */
const puppeteer = require("puppeteer");

/**
 * Extracts the full visible text from a tweet — including long Note Tweets.
 * Works without API keys using headless browser rendering.
 */
async function getFullTweetText(url: string): Promise<string> {
  console.log("🚀 Launching headless browser...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  console.log("🌐 Navigating to:", url);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

  try {
    console.log("⏳ Waiting for tweet to render...");
    await page.waitForSelector("article div[lang]", { timeout: 15000 });

    const text = await page.$$eval("article div[lang]", (els: Element[]) =>
      els.map((e) => (e.textContent || "").trim()).join("\n\n")
    );

    console.log("✅ Tweet captured successfully!");
    await browser.close();
    return text;
  } catch (err) {
    console.error("❌ Failed to extract tweet:", err);
    await browser.close();
    return "Could not extract tweet content.";
  }
}

// Example run
(async () => {
  const url = "https://x.com/elonmusk/status/1986836508092080197?s=20";
  const text = await getFullTweetText(url);
  console.log("\n🧠 Full Tweet Text:\n", text);
})();
