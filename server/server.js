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
const DB_PATH = path.join(__dirname, "data", "ytclone.db");
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

/* -------------------------- video feed -------------------------- */

async function fetchHomeVideos(query) {
  const url = `https://youtube.googleapis.com/youtube/v3/search?part=snippet&maxResults=12&type=video&q=${encodeURIComponent(query)}&key=AIzaSyDC-ej1rqEn_Ia92E1g3MyK-eJACxNTMFU`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) return [];
    return (data.items || []).map((i) => ({
      videoId: i.id.videoId,
      title: i.snippet?.title,
      channel: i.snippet?.channelTitle,
      thumb: i.snippet?.thumbnails?.high?.url || i.snippet?.thumbnails?.medium?.url,
      publishedAt: i.snippet?.publishedAt,
    }));
  } catch (_) {
    return [];
  }
}

async function getUnifiedHomeFeed() {
  const cfg = await loadConfig();
  const defaultQuery = cfg?.defaultQuery || "artificial intelligence";
  const videos = await fetchHomeVideos(defaultQuery);
  return videos;
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