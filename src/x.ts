/* eslint-disable @typescript-eslint/no-var-requires */
const axios = require("axios");

type TweetData = {
  url: string;
  author_name?: string;
  author_url?: string;
  html?: string;
  text?: string;
  created_at?: string;
};

async function fetchTweetData(url: string): Promise<TweetData> {
  try {
    console.log("🔍 Fetching tweet:", url);

    // Use the public oEmbed API
    const endpoint = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}`;
    const { data } = await axios.get(endpoint, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    // Extract author and HTML from oEmbed
    const author_name = data.author_name;
    const author_url = data.author_url;
    const html = data.html;

    // Extract visible tweet text from embedded HTML
    const textMatch = html.match(/<p[^>]*>(.*?)<\/p>/);
    const text = textMatch
      ? textMatch[1]
          .replace(/<[^>]+>/g, "") // strip HTML tags
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
      : undefined;

    const tweet: TweetData = {
      url,
      author_name,
      author_url,
      html,
      text,
    };

    console.log("\n✅ Tweet Extracted:\n", tweet);
    return tweet;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("❌ Failed to fetch tweet:", message);
    return { url, text: "Error extracting tweet." };
  }
}

// Example run
(async () => {
  const url = "https://x.com/elonmusk/status/1986836508092080197?s=20";
  const result = await fetchTweetData(url);
  console.log("\n🧠 Extracted Tweet Data:\n", result);
})();
