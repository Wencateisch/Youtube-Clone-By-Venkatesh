// Backend: Google login, user preferences, watch history, subscriptions,
// and a dynamic home feed served from the app's config.json homeUrl.
//
// Pure Node 26 (no npm installs needed):
//   - node:sqlite for the user database
//   - node:crypto for JWT verification and session tokens
//   - node:http for this server

import crypto from "node:crypto";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, "data", "ytclone.db");
const CONFIG_PATH = path.join(ROOT, "config.json");

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

console.log(`[server] Starting backend on ${BASE_URL}`);

mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    avatar TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS prefs (
    user_id TEXT PRIMARY KEY,
    preferred TEXT NOT NULL DEFAULT '[]',
    blocked TEXT NOT NULL DEFAULT '[]',
    home_query TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS subscriptions (
    user_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    channel_title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, channel_id)
  );
  CREATE TABLE IF NOT EXISTS watch_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    video_id TEXT NOT NULL,
    title TEXT NOT NULL,
    channel TEXT NOT NULL,
    thumb TEXT,
    watched_at INTEGER NOT NULL
  );
`);

/* -------------------------- helpers -------------------------- */

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

function sendError(res, msg, status = 500) {
  json(res, { error: msg }, status);
}

function getSession(req) {
  const cookie = req.headers["cookie"] || "";
  for (const part of cookie.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === "session_token" && v) {
      const row = db.prepare("SELECT user_id, expires_at FROM sessions WHERE token = ?").get(v);
      if (row && row.expires_at > Date.now()) return row.user_id;
    }
  }
  return null;
}

/* -------------------------- config -------------------------- */

let CONFIG = null;
async function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return null;
  const raw = await readFile(CONFIG_PATH, "utf8");
  return JSON.parse(raw);
}

/* ---------------------- youtube quota broker ---------------------- */

// search.list costs 100 units and is capped at 100 calls per project per day.
// Every search that reaches YouTube is therefore cached, shared by all users,
// and answered from the cache whenever possible. A key pool spreads the load
// over separate projects.

const YOUTUBE_API = (process.env.YOUTUBE_API_BASE || "https://youtube.googleapis.com/youtube/v3").replace(/\/$/, "");
const SEARCH_TTL_MS = Number(process.env.SEARCH_TTL_MS || 24 * 60 * 60 * 1000);
const POPULAR_TTL_MS = Number(process.env.POPULAR_TTL_MS || 30 * 60 * 1000);
const CACHE_KEEP_MS = Number(process.env.CACHE_KEEP_MS || 30 * 24 * 60 * 60 * 1000);
const SEARCH_DAILY_CAP = Number(process.env.SEARCH_DAILY_CAP || 100);

db.exec(`
  CREATE TABLE IF NOT EXISTS feed_cache (
    cache_key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS key_usage (
    day TEXT NOT NULL,
    key_id TEXT NOT NULL,
    searches INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, key_id)
  );
`);

function pacificDay(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

function keyFingerprint(key) {
  return crypto.createHash("sha256").update(String(key)).digest("hex").slice(0, 16);
}

// YOUTUBE_KEYS=k1,k2,k3 wins over config.json. Keeping the keys in the host's
// environment means they never ship inside the APK.
async function keyPool() {
  const fromEnv = String(process.env.YOUTUBE_KEYS || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  if (fromEnv.length) return [...new Set(fromEnv)];
  const cfg = await loadConfig();
  const list = [cfg && cfg.apiKey, ...(cfg && Array.isArray(cfg.apiKeys) ? cfg.apiKeys : [])].filter(
    (k) => typeof k === "string" && k.trim()
  );
  return [...new Set(list)];
}

function searchesToday(key) {
  const row = db
    .prepare("SELECT searches FROM key_usage WHERE day = ? AND key_id = ?")
    .get(pacificDay(), keyFingerprint(key));
  return row ? Number(row.searches) : 0;
}

function addSearches(key, count) {
  db.prepare(
    `INSERT INTO key_usage (day, key_id, searches) VALUES (?, ?, ?)
     ON CONFLICT(day, key_id) DO UPDATE SET searches = searches + excluded.searches`
  ).run(pacificDay(), keyFingerprint(key), count);
}

let keyCursor = 0;

// A fresh TLS connection to YouTube occasionally dies with ECONNRESET before
// any response. Retrying a refused connection costs no quota, so it is safe.
const RETRYABLE = new Set(["ECONNRESET", "ECONNREFUSED", "EPIPE", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_SOCKET"]);

async function fetchUpstream(url) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetch(url, { signal: AbortSignal.timeout(15000) });
    } catch (error) {
      lastError = error;
      const code = error && error.cause && error.cause.code;
      if (!RETRYABLE.has(code)) break;
    }
  }
  throw lastError;
}

// One upstream call, tried across every configured key. A key that is out of
// searches is skipped without spending an HTTP request, and a key that answers
// "quotaExceeded" is marked spent for the rest of the Pacific day.
async function youtube(endpoint, params) {
  const keys = await keyPool();
  if (!keys.length) return { ok: false, reason: "noKey", status: 503 };
  const spent = endpoint === "search" ? new Set(keys.filter((k) => searchesToday(k) >= SEARCH_DAILY_CAP)) : new Set();
  let last = { ok: false, reason: "noKey", status: 503 };
  for (let attempt = 0; attempt < keys.length; attempt += 1) {
    const index = (keyCursor + attempt) % keys.length;
    const key = keys[index];
    if (spent.has(key)) {
      last = { ok: false, reason: "quotaExceeded", status: 403 };
      continue;
    }
    let response;
    let data;
    try {
      response = await fetchUpstream(
        `${YOUTUBE_API}/${endpoint}?${new URLSearchParams({ ...params, key }).toString()}`
      );
      data = await response.json().catch(() => ({}));
    } catch (error) {
      console.warn(`[youtube] ${endpoint} unreachable: ${error && error.message}`);
      return { ok: false, reason: "network", status: 504 };
    }
    if (response.ok) {
      keyCursor = index;
      if (endpoint === "search") addSearches(key, 1);
      return { ok: true, data };
    }
    const reason = String(data?.error?.errors?.[0]?.reason || data?.error?.status || "");
    last = { ok: false, reason, status: response.status };
    if (reason !== "quotaExceeded" && reason !== "dailyLimitExceeded") {
      console.warn(`[youtube] ${endpoint} refused: ${reason || response.status}`);
      return last;
    }
    if (endpoint === "search") addSearches(key, SEARCH_DAILY_CAP);
  }
  console.warn(`[youtube] ${endpoint} has no key left: ${last.reason || last.status}`);
  return last;
}

/* ---------------------------- feed cache ---------------------------- */

function cacheGet(cacheKey) {
  const row = db
    .prepare("SELECT payload, fetched_at, expires_at FROM feed_cache WHERE cache_key = ?")
    .get(cacheKey);
  if (!row) return null;
  try {
    return {
      payload: JSON.parse(row.payload),
      at: Number(row.fetched_at),
      fresh: Number(row.expires_at) > Date.now(),
    };
  } catch (_) {
    return null;
  }
}

function cachePut(cacheKey, payload, ttl) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO feed_cache (cache_key, payload, fetched_at, expires_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       payload = excluded.payload,
       fetched_at = excluded.fetched_at,
       expires_at = excluded.expires_at`
  ).run(cacheKey, JSON.stringify(payload), now, now + ttl);
  db.prepare("DELETE FROM feed_cache WHERE fetched_at < ?").run(now - CACHE_KEEP_MS);
}

function cacheKey(parts) {
  return parts.map((p) => String(p == null ? "" : p).toLowerCase().trim()).join("|");
}

// Both endpoints answer in the shape the client already renders for search
// results, so the app needs no second code path.
function toSearchShape(items, idOf) {
  return items
    .map((item) => {
      const videoId = idOf(item);
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
    })
    .filter(Boolean);
}

const searchItems = (data) =>
  toSearchShape(Array.isArray(data?.items) ? data.items : [], (item) => item?.id?.videoId);

const popularItems = (data) =>
  toSearchShape(
    Array.isArray(data?.items) ? data.items : [],
    (video) => (typeof video?.id === "string" ? video.id : video?.id?.videoId)
  );

const revalidating = new Set();

async function searchUpstream(cacheKeyValue, q, maxResults, region) {
  const params = { part: "snippet", type: "video", maxResults, q };
  if (region) params.regionCode = region;
  const out = await youtube("search", params);
  if (!out.ok) return { items: null, reason: out.reason };
  const items = searchItems(out.data);
  if (items.length) cachePut(cacheKeyValue, { items }, SEARCH_TTL_MS);
  return { items, reason: null };
}

// Popular videos cost 1 unit instead of 100, so they are the fallback for a
// search that cannot run, and they are cached for everyone.
async function popularFeed(maxResults, region) {
  const key = cacheKey(["popular", region, maxResults]);
  const hit = cacheGet(key);
  if (hit && hit.fresh) return hit.payload.items || [];
  const params = { part: "snippet", chart: "mostPopular", maxResults };
  if (region) params.regionCode = region;
  const out = await youtube("videos", params);
  if (out.ok) {
    const items = popularItems(out.data).slice(0, maxResults);
    if (items.length) cachePut(key, { items }, POPULAR_TTL_MS);
    return items;
  }
  return hit ? hit.payload.items || [] : [];
}

async function getUnifiedHomeFeed() {
  const cfg = await loadConfig();
  const maxResults = Math.min(Math.max(Number(cfg?.maxResults) || 24, 1), 50);
  const region = String(process.env.REGION_CODE || cfg?.regionCode || "").toUpperCase().slice(0, 2);
  const items = await popularFeed(maxResults, region);
  return items.map((item) => ({
    videoId: item.id.videoId,
    title: item.snippet.title,
    channel: item.snippet.channelTitle,
    thumb: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url || "",
    publishedAt: item.snippet.publishedAt,
  }));
}

function nextResetIso(now = Date.now()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(now))
      .map((part) => [part.type, part.value])
  );
  const elapsed = ((Number(parts.hour) % 24) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000;
  return new Date(now - elapsed + 24 * 3600 * 1000).toISOString();
}

async function handleSearch(url, res) {
  const q = String(url.searchParams.get("q") || "").trim().slice(0, 120);
  if (!q) return sendError(res, "Missing q", 400);
  const cfg = await loadConfig();
  const maxResults = Math.min(Math.max(Number(url.searchParams.get("maxResults")) || 24, 1), 50);
  const region = String(url.searchParams.get("regionCode") || cfg?.regionCode || "")
    .toUpperCase()
    .slice(0, 2);
  const key = cacheKey(["search", region, maxResults, q]);
  const hit = cacheGet(key);

  if (hit && hit.fresh) {
    console.log(`[search] "${q}" cache hit`);
    return json(res, { items: hit.payload.items || [], cached: true, degraded: false, fetchedAt: hit.at });
  }
  if (hit) {
    // Serve the stale copy at once and refresh behind the request, so a slow or
    // refused upstream never makes the user wait or see an error.
    if (!revalidating.has(key)) {
      revalidating.add(key);
      searchUpstream(key, q, maxResults, region)
        .catch(() => {})
        .finally(() => revalidating.delete(key));
    }
    console.log(`[search] "${q}" stale hit`);
    return json(res, { items: hit.payload.items || [], cached: true, stale: true, degraded: false, fetchedAt: hit.at });
  }

  const out = await searchUpstream(key, q, maxResults, region);
  if (out.items && out.items.length) {
    console.log(`[search] "${q}" upstream ${out.items.length} items`);
    return json(res, { items: out.items, cached: false, degraded: false });
  }
  const fallback = await popularFeed(maxResults, region);
  console.log(`[search] "${q}" degraded (${out.reason}) with ${fallback.length} popular items`);
  return json(res, {
    items: fallback,
    cached: false,
    degraded: true,
    reason: out.reason === "quotaExceeded" || out.reason === "dailyLimitExceeded" ? "quota" : out.reason,
    retryAfter: nextResetIso(),
  });
}

/* -------------------------- API -------------------------- */

async function handleRequest(req, res) {
  const { pathname } = new URL(req.url, "http://localhost");

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*" });
    res.end();
    return;
  }

  // Config endpoint
  if (pathname === "/api/config") {
    const cfg = await loadConfig();
    return json(res, { config: cfg || {} });
  }

  // Home feed - unified endpoint for both authenticated and anonymous users
  if (pathname === "/api/feed/home") {
    const userId = getSession(req);
    if (!userId) {
      const videos = await getUnifiedHomeFeed();
      return json(res, { videos, user: null });
    }
    const videos = await getUnifiedHomeFeed();
    return json(res, { videos, user: userId });
  }

  // Cached, key-pooled search. Answers 200 with degraded:true instead of a 403,
  // so the app can show popular videos rather than an API error.
  if (pathname === "/api/search") {
    return handleSearch(new URL(req.url, "http://localhost"), res);
  }

  if (pathname === "/api/health") {
    const keys = await keyPool();
    return json(res, {
      ok: true,
      keys: keys.length,
      searchesLeftToday: keys.map((key) => Math.max(0, SEARCH_DAILY_CAP - searchesToday(key))),
    });
  }

  // OAuth login URL
  if (pathname === "/api/auth/google") {
    if (!GOOGLE_CLIENT_ID) return sendError(res, "Google OAuth not configured", 503);
    const redirectUri = `${BASE_URL}/api/auth/google/callback`;
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid%20email%20profile&access_type=offline&prompt=consent`;
    return json(res, { url });
  }

  return sendError(res, "Not found", 404);
}

/* -------------------------- server -------------------------- */

const server = http.createServer((req, res) => {
  handleRequest(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`[server] Listening on ${BASE_URL}`);
});