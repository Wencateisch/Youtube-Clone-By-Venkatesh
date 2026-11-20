// Refreshes www/catalog.json: the snapshot the app falls back to when YouTube,
// the API key, or the network is unavailable.
//
// Cost per run: 1 unit for the popular chart, 100 units per search query.
// Run it from a scheduled workflow, not on every deploy.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = path.join(ROOT, "config.json");
const OUT_PATH = path.join(ROOT, "www", "catalog.json");

const DEFAULT_QUERIES = "trending music,movie trailers,breaking news,cricket highlights";
const QUERIES = String(process.env.CATALOG_QUERIES ?? DEFAULT_QUERIES)
  .split(",")
  .map((q) => q.trim())
  .filter(Boolean);
const POPULAR_MAX = Math.min(Math.max(Number(process.env.CATALOG_POPULAR || 50), 1), 50);

const cfg = JSON.parse(await readFile(CONFIG_PATH, "utf8").catch(() => "{}"));
const API = String(process.env.YOUTUBE_API_BASE || cfg.apiBase || "https://youtube.googleapis.com/youtube/v3").replace(/\/$/, "");
const KEYS = [
  process.env.YOUTUBE_KEY,
  cfg.apiKey,
  ...(Array.isArray(cfg.apiKeys) ? cfg.apiKeys : []),
].filter((k) => typeof k === "string" && k.trim());
const REGION = String(process.env.REGION_CODE || cfg.regionCode || "").toUpperCase().slice(0, 2);

if (!KEYS.length) {
  console.error("No API key found in YOUTUBE_KEY or config.json.");
  process.exit(1);
}

function trim(item) {
  const videoId = typeof item?.id === "string" ? item.id : item?.id?.videoId;
  if (!videoId) return null;
  const snippet = item.snippet || {};
  return {
    id: { videoId },
    snippet: {
      title: snippet.title || "",
      channelId: snippet.channelId || "",
      channelTitle: snippet.channelTitle || "",
      publishedAt: snippet.publishedAt || "",
      thumbnails: snippet.thumbnails || {},
    },
  };
}

// A fresh connection to YouTube sometimes dies with ECONNRESET before any
// response; a refused connection costs no quota, so retry it once.
const RETRYABLE = new Set(["ECONNRESET", "ECONNREFUSED", "EPIPE", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_SOCKET"]);

async function fetchWithRetry(url) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetch(url, { signal: AbortSignal.timeout(20000) });
    } catch (error) {
      lastError = error;
      const code = error && error.cause && error.cause.code;
      if (!RETRYABLE.has(code)) break;
    }
  }
  throw lastError;
}

async function api(endpoint, params) {
  let last = "";
  for (const key of KEYS) {
    const url = `${API}/${endpoint}?${new URLSearchParams({ ...params, key }).toString()}`;
    try {
      const res = await fetchWithRetry(url);
      const data = await res.json().catch(() => ({}));
      if (res.ok) return data;
      last = data?.error?.errors?.[0]?.reason || `HTTP ${res.status}`;
    } catch (error) {
      last = error && error.message ? error.message : "network error";
    }
    if (last !== "quotaExceeded" && last !== "dailyLimitExceeded") break;
  }
  throw new Error(`${endpoint} failed: ${last}`);
}

const previous = JSON.parse(await readFile(OUT_PATH, "utf8").catch(() => "{}"));
const catalog = {
  updatedAt: new Date().toISOString(),
  source: "youtube-data-api",
  popular: [],
  queries: {},
};

let failures = 0;

try {
  const params = { part: "snippet", chart: "mostPopular", maxResults: POPULAR_MAX };
  if (REGION) params.regionCode = REGION;
  catalog.popular = (await api("videos", params)).items.map(trim).filter(Boolean);
  console.log(`popular: ${catalog.popular.length} videos`);
} catch (error) {
  failures += 1;
  console.warn(`popular kept from the previous snapshot: ${error.message}`);
  catalog.popular = Array.isArray(previous.popular) ? previous.popular : [];
}

for (const query of QUERIES) {
  const params = { part: "snippet", type: "video", maxResults: 24, q: query };
  if (REGION) params.regionCode = REGION;
  try {
    catalog.queries[query.toLowerCase()] = (await api("search", params)).items.map(trim).filter(Boolean);
    console.log(`"${query}": ${catalog.queries[query.toLowerCase()].length} videos`);
  } catch (error) {
    failures += 1;
    const old = previous.queries && previous.queries[query.toLowerCase()];
    if (Array.isArray(old)) catalog.queries[query.toLowerCase()] = old;
    console.warn(`"${query}" kept from the previous snapshot: ${error.message}`);
  }
}

if (!catalog.popular.length && !Object.keys(catalog.queries).length) {
  console.error("Nothing could be fetched, leaving the existing snapshot alone.");
  process.exit(1);
}

await writeFile(OUT_PATH, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
console.log(
  `Wrote ${path.relative(ROOT, OUT_PATH)}: ${catalog.popular.length} popular, ${Object.keys(catalog.queries).length} queries, ${failures} kept from before.`
);
