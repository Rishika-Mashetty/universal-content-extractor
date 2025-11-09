/* eslint-disable @typescript-eslint/no-var-requires */
const puppeteer = require("puppeteer");

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchLinkedInPostData(url: string) {
  console.log("🚀 Launching headless browser...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  console.log("🌐 Opening LinkedIn post:", url);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });

  // scroll slowly to force React hydration
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await delay(2500);
  }

  // wait for post container (feed content)
  await page.waitForSelector("div.feed-shared-update-v2", { timeout: 15000 }).catch(() => {});
  await delay(4000);

  const post = await page.evaluate(() => {
    //@ts-ignore
    const clean = (t) => t?.replace(/\s+/g, " ").replace(/See more|...more/gi, "").trim() || "";

    // Find author name
    const author =
      document.querySelector("span.feed-shared-actor__name")?.textContent?.trim() ||
      document.querySelector("div.update-components-actor__title span")?.textContent?.trim() ||
      "Unknown";

    // Capture all visible text under post body
    const postContainer =
      document.querySelector("div.update-components-text") ||
      document.querySelector("div.feed-shared-update-v2__description-wrapper") ||
      document.body;

    let description = "";
    if (postContainer) {
      const walker = document.createTreeWalker(postContainer, NodeFilter.SHOW_TEXT, null);
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent?.trim();
        if (text && text.length > 2) description += text + " ";
      }
    }

    const title =
      document.querySelector("meta[property='og:title']")?.getAttribute("content") ||
      document.querySelector("title")?.textContent?.trim() ||
      "LinkedIn Post";

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
 * Run example
 */
(async () => {
  const postUrl =
    "https://www.linkedin.com/posts/avi-chawla_rag-vs-cag-explained-visually-for-ai-engineers-activity-7391440368627585024-hikl";

  console.log("🔍 Extracting LinkedIn post data...");
  const post = await fetchLinkedInPostData(postUrl);

  console.log("\n✅ Final Extracted LinkedIn Data:");
  console.log(post);
})();
