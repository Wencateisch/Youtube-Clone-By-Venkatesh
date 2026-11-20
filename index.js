// Runtime configuration. Every URL and the API key come from ./config.json so
// nothing about the app's home or feed endpoint is hardcoded here.
const DEFAULT_CONFIG = {
  apiBase: "https://youtube.googleapis.com/youtube/v3",
  apiKey: "AIzaSyDC-ej1rqEn_Ia92E1g3MyK-eJACxNTMFU",
  // Extra keys from separate Google Cloud projects. Search quota is per
  // project, so a second key doubles the daily allowance without code changes.
  apiKeys: [],
  // Empty means "infer from the device language" (e.g. en-IN -> IN).
  regionCode: "",
  defaultQuery: "artificial intelligence",
  maxResults: 24,
  appName: "YouTube Clone",
  homeUrl: "./",
  backendUrl: "",
  releasesApi:
    "https://api.github.com/repos/Wencateisch/Youtube-Clone-By-Venkatesh/releases/latest",
};
let CONFIG = { ...DEFAULT_CONFIG };
let homeQuery = DEFAULT_CONFIG.defaultQuery;

const grid = document.getElementById("videodiv");
const statusEl = document.getElementById("status");
const searchInput = document.getElementById("video");
const clearBtn = document.getElementById("clear-search");
const chipsEl = document.getElementById("chips");
const playerEl = document.getElementById("player");
const playerVideoWrap = document.querySelector(".player-video-wrap");
const playerInfo = document.querySelector(".player-info");
const playerFrameHolder = document.getElementById("player-frame-holder");
const playerFrame = document.getElementById("player-frame");
const playerTitle = document.getElementById("player-title");
const playerChannel = document.getElementById("player-channel");
const playerCollapse = document.getElementById("player-collapse");
const playerSuggest = document.getElementById("player-suggest");
const zoomToggle = document.getElementById("zoom-toggle");
const audioToggle = document.getElementById("audio-toggle");
const audioPanel = document.getElementById("audio-panel");
const audioPlay = document.getElementById("audio-play");
const audioTitle = document.getElementById("audio-title");
const audioChannel = document.getElementById("audio-channel");
const audioArt = document.getElementById("audio-art");
const miniEl = document.getElementById("mini-player");
const miniSlot = document.getElementById("mini-slot");
const miniTitle = document.getElementById("mini-title");
const miniPlay = document.getElementById("mini-play");
const miniToggle = document.getElementById("mini-toggle");
const miniExpand = document.getElementById("mini-expand");
const miniClose = document.getElementById("mini-close");
const profilePanel = document.getElementById("profile-panel");
const googleLoginBtn = document.getElementById("google-login-btn");
const profileNameInput = document.getElementById("profile-name");
const apiKeyInput = document.getElementById("api-key-input");
const apiKeySave = document.getElementById("api-key-save");
const apiKeyStatus = document.getElementById("api-key-status");
const brandText = document.getElementById("brand-text");
const profileBtn = document.getElementById("profile-btn");
const homeLink = document.getElementById("home-link");
const updatesInfo = document.getElementById("updates-info");
const historyList = document.getElementById("history-list");
const fillGrab = document.getElementById("fill-grab");
const railQueue = document.getElementById("rail-queue");

const queueSheet = document.getElementById("queue-sheet");
const queueDialog = document.getElementById("queue-dialog");
const queueClose = document.getElementById("queue-close");
const queuePanel = document.getElementById("queue-panel");
const playlistsPanel = document.getElementById("playlists-panel");
const queueList = document.getElementById("queue-list");
const queueEmpty = document.getElementById("queue-empty");
const queueCount = document.getElementById("queue-count");
const queuePlay = document.getElementById("queue-play");
const queueSave = document.getElementById("queue-save");
const queueClear = document.getElementById("queue-clear");
const queueHeaderBtn = document.getElementById("queue-header-btn");
const queueHeaderBadge = document.getElementById("queue-header-badge");
const queueBadge = document.getElementById("queue-badge");
const queueTabQueue = document.getElementById("tab-queue");
const queueTabPlaylists = document.getElementById("tab-playlists");
const playlistList = document.getElementById("playlist-list");
const playlistsEmpty = document.getElementById("playlists-empty");
const playlistCount = document.getElementById("playlist-count");
const playlistForm = document.getElementById("playlist-form");
const playlistName = document.getElementById("playlist-name");
const toastRegion = document.getElementById("toast-region");

let lastQuery = homeQuery;
let lastController = null;
let currentResults = [];
let currentSuggestions = [];
let fillMode = false;
let audioMode = false;
let miniActive = false;
let mediaPlaying = false;
let currentTileWidth = 0;
let playerScrollY = 0;
let resizeObserver = null;
let frameReadyTimer = 0;
let sheetReturnFocus = null;
let sheetLockedScroll = null;
let endedFor = "";
let playerOpenedAt = 0;
let listeningTimer = 0;

// The Android shell exposes a one-method bridge so it knows whether audio is
// actually playing. It only keeps the WebView alive in the background while
// this is true, instead of burning battery whenever the app is minimised.
function notifyPlaybackActive(active) {
  try {
    const bridge = window.AndroidPlayback;
    if (bridge && typeof bridge.setPlaybackActive === "function") {
      bridge.setPlaybackActive(Boolean(active));
    }
  } catch (_) { /* web build: no bridge */ }
}

/* ------------------------- small utilities ------------------------- */

// The YouTube API returns titles with HTML entities ("HTML &amp; CSS"). We
// render text nodes, so the entity would otherwise show up verbatim.
function decodeEntities(text) {
  const value = text == null ? "" : String(text);
  if (value.indexOf("&") === -1) return value;
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, code) => {
    if (code.charAt(0) === "#") {
      const n = code.charAt(1).toLowerCase() === "x"
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    const key = code.toLowerCase();
    return Object.prototype.hasOwnProperty.call(named, key) ? named[key] : match;
  });
}

function storeGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function storeSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {
    /* storage may be unavailable */
  }
}

function uid() {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// A key saved in this browser wins over the shipped one. Search quota is per
// Google Cloud project, so a personal key cannot be used up by anyone else.
function customApiKey() {
  const raw = storeGet("ytclone.apiKey", "");
  return typeof raw === "string" ? raw.trim() : "";
}

function apiKeys() {
  const list = [customApiKey(), CONFIG.apiKey, ...(Array.isArray(CONFIG.apiKeys) ? CONFIG.apiKeys : [])]
    .filter((k) => typeof k === "string" && k.trim());
  return [...new Set(list)];
}

let apiKeyIndex = 0;

function apiUrl(endpoint, params, key) {
  const base = String(CONFIG.apiBase || DEFAULT_CONFIG.apiBase).replace(/\/$/, "");
  const keys = apiKeys();
  const search = new URLSearchParams({ ...params, key: key || keys[apiKeyIndex] || CONFIG.apiKey });
  return `${base}/${endpoint}?${search.toString()}`;
}

function regionCode() {
  if (CONFIG.regionCode) return String(CONFIG.regionCode).toUpperCase();
  const m = String(navigator.language || "").match(/-([A-Za-z]{2})$/);
  return m ? m[1].toUpperCase() : "";
}

// Google puts the machine reason in error.errors[0].reason and the raw message
// carries the project number. That message must never reach the screen, so
// every failure becomes one plain sentence here.
function apiErrorText(reason, status) {
  switch (reason) {
    case "quotaExceeded":
    case "dailyLimitExceeded":
      return "YouTube's search limit is used up for today.";
    case "keyInvalid":
    case "badRequest":
      return "The video feed is misconfigured (invalid API key).";
    case "accessNotConfigured":
      return "The YouTube Data API is not enabled for this key.";
    case "ipRefererBlocked":
      return "This API key does not allow this app or domain.";
    case "rateLimitExceeded":
    case "userRateLimitExceeded":
      return "YouTube is rate limiting requests. Try again in a moment.";
    case "forbidden":
      return "YouTube refused this request.";
    default:
      if (status === 404) return "The video feed was not found.";
      if (status >= 500) return "YouTube is having trouble right now.";
      if (status === 403) return "YouTube refused this request.";
      return "Couldn't load videos. Check your connection and try again.";
  }
}

function isQuotaReason(reason) {
  return reason === "quotaExceeded" || reason === "dailyLimitExceeded";
}

/* ------------------------- backend proxy ------------------------- */

// When a backend is configured, searches go through it first: it caches each
// query for every user and spends the key pool there instead of in the app.
// Any failure simply falls through to the direct API below.
function backendBase() {
  const raw = String(CONFIG.backendUrl || "").trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(raw) ? raw : "";
}

async function fetchBackendSearch(q, signal) {
  const base = backendBase();
  if (!base) return null;
  const params = new URLSearchParams({ q, maxResults: String(CONFIG.maxResults || 24) });
  const region = regionCode();
  if (region) params.set("regionCode", region);
  try {
    const res = await fetch(`${base}/api/search?${params.toString()}`, { signal });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !Array.isArray(data.items)) return null;
    return { items: data.items, degraded: Boolean(data.degraded), cached: Boolean(data.cached) };
  } catch (err) {
    if (err && err.name === "AbortError") throw err;
    return null;
  }
}

// Every API call goes through here. A quota failure moves to the next
// configured key and retries; any other failure stops at once, so one broken
// key cannot burn through the rest of the list.
async function fetchApi(endpoint, params, signal) {
  const keys = apiKeys();
  if (!keys.length) throw new Error("No API key is configured.");
  const start = apiKeyIndex;
  let lastError = null;
  for (let attempt = 0; attempt < keys.length; attempt += 1) {
    const index = (start + attempt) % keys.length;
    const res = await fetch(apiUrl(endpoint, params, keys[index]), { signal });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      apiKeyIndex = index;
      return data;
    }
    const reason = String(data?.error?.errors?.[0]?.reason || data?.error?.status || "");
    lastError = new Error(apiErrorText(reason, res.status));
    lastError.code = reason;
    lastError.status = res.status;
    if (!isQuotaReason(reason)) throw lastError;
  }
  throw lastError;
}

/* ------------------------- search cache ------------------------- */

// Search is the expensive endpoint (100 quota units per call), so a query
// answered once is reused for six hours and still serves as an offline rescue
// after it expires.
const SEARCH_CACHE_TTL = 6 * 60 * 60 * 1000;
const SEARCH_CACHE_MAX = 12;

function searchCacheKey(q) {
  return String(q || "").trim().toLowerCase();
}

function searchCacheAll() {
  const raw = storeGet("ytclone.searchCache", {});
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

function readSearchCache(q, { allowStale = false } = {}) {
  const entry = searchCacheAll()[searchCacheKey(q)];
  if (!entry || !Array.isArray(entry.items) || !entry.items.length) return null;
  const age = Date.now() - Number(entry.at || 0);
  if (!allowStale && age > SEARCH_CACHE_TTL) return null;
  return { items: entry.items, at: Number(entry.at || 0), stale: age > SEARCH_CACHE_TTL };
}

function writeSearchCache(q, items) {
  if (!items || !items.length) return;
  const all = searchCacheAll();
  all[searchCacheKey(q)] = { at: Date.now(), items: items.slice(0, CONFIG.maxResults || 24) };
  const kept = Object.entries(all)
    .sort((a, b) => Number(b[1].at || 0) - Number(a[1].at || 0))
    .slice(0, SEARCH_CACHE_MAX);
  storeSet("ytclone.searchCache", Object.fromEntries(kept));
}

/* ---------------------- last-resort content ---------------------- */

// Whatever happens upstream, the grid must show something: the last feed this
// device rendered, then the catalog snapshot that ships with the app.
const LAST_FEED_KEY = "ytclone.lastFeed";
let catalogPromise = null;

function rememberFeed(items, label) {
  if (!Array.isArray(items) || !items.length) return;
  storeSet(LAST_FEED_KEY, {
    at: Date.now(),
    label: String(label || ""),
    items: items.slice(0, CONFIG.maxResults || 24),
  });
}

function readLastFeed() {
  const saved = storeGet(LAST_FEED_KEY, null);
  if (!saved || !Array.isArray(saved.items) || !saved.items.length) return null;
  return saved;
}

function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetch("./catalog.json", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
  }
  return catalogPromise;
}

function queryWords(text) {
  return String(text || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

// Words from the query that appear in a title or a channel name.
function matching(items, query) {
  const words = queryWords(query);
  if (!words.length) return [];
  return items.filter((item) => {
    const snippet = (item && item.snippet) || {};
    const text = `${snippet.title || ""} ${snippet.channelTitle || ""}`.toLowerCase();
    return words.some((word) => text.includes(word));
  });
}

// A handful of matching videos must still fill the grid, otherwise a query with
// one lucky match would render a single huge card and look broken.
function padMatches(matches, items, limit) {
  if (!matches.length) return items.slice(0, limit);
  const seen = new Set(matches.map((item) => item && item.id && item.id.videoId));
  const rest = items.filter((item) => !seen.has(item && item.id && item.id.videoId));
  return [...matches, ...rest].slice(0, limit);
}

async function catalogItems(query) {
  const catalog = await loadCatalog();
  if (!catalog) return [];
  const limit = CONFIG.maxResults || 24;
  const popular = Array.isArray(catalog.popular) ? catalog.popular : [];
  const saved = catalog.queries && typeof catalog.queries === "object" ? catalog.queries : {};
  const exact = saved[String(query || "").trim().toLowerCase()];
  if (Array.isArray(exact) && exact.length) return exact.slice(0, limit);
  return padMatches(matching(popular, query), popular, limit);
}

function setStatus(message, isError = false, showRetry = false, action = null) {
  if (!statusEl) return;
  statusEl.classList.toggle("error", Boolean(isError));
  statusEl.innerHTML = "";
  const span = document.createElement("span");
  span.textContent = message || "";
  statusEl.appendChild(span);
  if (showRetry) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "retry-btn";
    btn.textContent = "Retry";
    btn.addEventListener("click", () => fetchVideos(lastQuery));
    statusEl.appendChild(btn);
  }
  if (action && typeof action.onClick === "function") {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "retry-btn";
    btn.textContent = action.label;
    btn.addEventListener("click", action.onClick);
    statusEl.appendChild(btn);
  }
}

// A keyed toast is reused: adding five videos in a row updates one message
// instead of stacking five bars over the video.
function showToast(message, icon = "fa-check", key = "") {
  if (!toastRegion) return;
  let el = key ? toastRegion.querySelector(`.toast[data-key="${key}"]`) : null;
  if (el) {
    const span = el.querySelector("span");
    const glyph = el.querySelector("i");
    if (span) span.textContent = message;
    if (glyph) glyph.className = `fas ${icon}`;
    el.classList.remove("is-leaving");
  } else {
    const live = toastRegion.querySelectorAll(".toast:not(.is-leaving)");
    if (live.length >= 2) live[0].remove();
    el = document.createElement("div");
    el.className = "toast";
    if (key) el.dataset.key = key;
    el.innerHTML = `<i class="fas ${icon}" aria-hidden="true"></i><span></span>`;
    el.querySelector("span").textContent = message;
    toastRegion.appendChild(el);
  }
  clearTimeout(el._timer);
  el._timer = setTimeout(() => {
    el.classList.add("is-leaving");
    el._timer = setTimeout(() => el.remove(), 280);
  }, 2200);
}

function updateClearBtn() {
  if (!clearBtn || !searchInput) return;
  clearBtn.hidden = !searchInput.value;
}

function timeAgo(iso) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  const units = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [name, sec] of units) {
    if (s >= sec) {
      const v = Math.floor(s / sec);
      return `${v} ${name}${v > 1 ? "s" : ""} ago`;
    }
  }
  return "Just now";
}

function parseISODuration(iso) {
  if (!iso || typeof iso !== "string") return "";
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return "";
  const h = parseInt(m[1] || "0", 10);
  const min = parseInt(m[2] || "0", 10);
  const sec = parseInt(m[3] || "0", 10);
  if (h > 0) return `${h}:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Y";
  return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}

function thumbFor(sn, videoId) {
  return (
    sn.thumbnails?.high?.url ||
    sn.thumbnails?.medium?.url ||
    sn.thumbnails?.default?.url ||
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
  );
}

/* ------------------------- profile + history ------------------------- */

function getProfile() {
  const p = storeGet("ytclone.profile", {});
  return p && typeof p === "object" ? p : {};
}

function getHistory() {
  const h = storeGet("ytclone.history", []);
  return Array.isArray(h) ? h : [];
}

function recordHistory(video) {
  if (!video || !video.videoId) return;
  const h = getHistory().filter((v) => v.videoId !== video.videoId);
  h.unshift({
    videoId: video.videoId,
    title: video.title || "YouTube video",
    channel: video.channel || "Unknown channel",
    thumb: video.thumb || "",
    at: new Date().toISOString(),
  });
  storeSet("ytclone.history", h.slice(0, 50));
  homeQuery = buildHomeQuery();
  storeSet("ytclone.homeQuery", homeQuery);
  renderHistory();
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "how", "what", "why", "are", "from", "this", "that",
  "your", "you", "will", "can", "does", "have", "into", "about", "more", "new",
  "best", "full", "course", "video", "tutorial", "explained", "using", "make",
]);

function buildHomeQuery() {
  const h = getHistory();
  if (!h.length) return CONFIG.defaultQuery;
  const counts = new Map();
  for (const item of h) {
    const words = String(item.title || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
    for (const w of words) counts.set(w, (counts.get(w) || 0) + 1);
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([w]) => w);
  return top.length ? top.join(" ") : CONFIG.defaultQuery;
}

function renderHistory() {
  if (!historyList) return;
  const h = getHistory().slice(0, 8);
  historyList.innerHTML = "";
  if (!h.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "Nothing watched yet. Open a video and it will appear here.";
    historyList.appendChild(empty);
    return;
  }
  for (const item of h) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "history-item";
    btn.innerHTML = item.thumb
      ? `<img class="thumb" src="${item.thumb}" alt="" /><span></span>`
      : `<span></span>`;
    btn.querySelector("span").textContent = item.title;
    btn.addEventListener("click", () => {
      closeProfile();
      openPlayer(item.videoId, item.title, item.channel, item.thumb);
    });
    historyList.appendChild(btn);
  }
}

function openProfile() {
  if (!profilePanel) return;
  const p = getProfile();
  if (profileNameInput) profileNameInput.value = p.name || "";
  if (apiKeyInput) apiKeyInput.value = customApiKey();
  updateApiKeyHint();
  renderHistory();
  profilePanel.hidden = false;
}

function closeProfile() {
  if (profilePanel) profilePanel.hidden = true;
}

function updateApiKeyHint() {
  if (!apiKeyStatus) return;
  apiKeyStatus.textContent = customApiKey()
    ? "Using your own key on this device. It is tried before the shared key."
    : "Using the app's shared key. Its daily search limit is shared by everyone.";
}

// A wrong key is worse than no key: it would replace a working shared key with
// a broken one, so the key is checked against YouTube before it is stored.
async function saveApiKey() {
  const raw = (apiKeyInput && apiKeyInput.value.trim()) || "";
  if (raw && !/^[A-Za-z0-9_-]{20,}$/.test(raw)) {
    if (apiKeyStatus) apiKeyStatus.textContent = "That doesn't look like an API key. Keys are long and start with AIza.";
    showToast("That doesn't look like an API key.", "fa-keyboard", "settings");
    if (apiKeyInput) apiKeyInput.focus();
    return;
  }
  if (raw) {
    if (apiKeyStatus) apiKeyStatus.textContent = "Checking the key with YouTube…";
    if (apiKeySave) apiKeySave.disabled = true;
    try {
      const res = await fetch(apiUrl("videos", { part: "snippet", chart: "mostPopular", maxResults: 1 }, raw));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const reason = String(data?.error?.errors?.[0]?.reason || data?.error?.status || "");
        const message = apiErrorText(reason, res.status);
        if (apiKeyStatus) apiKeyStatus.textContent = message;
        showToast(message, "fa-exclamation-triangle", "settings");
        return;
      }
    } catch (_) {
      if (apiKeyStatus) apiKeyStatus.textContent = "Couldn't reach YouTube to check the key. Try again in a moment.";
      return;
    } finally {
      if (apiKeySave) apiKeySave.disabled = false;
    }
    storeSet("ytclone.apiKey", raw);
  } else {
    try { localStorage.removeItem("ytclone.apiKey"); } catch (_) { /* storage may be unavailable */ }
  }
  // Cached answers were fetched with the old key; drop them so the new key is
  // actually used on the next search.
  try { localStorage.removeItem("ytclone.searchCache"); } catch (_) { /* storage may be unavailable */ }
  apiKeyIndex = 0;
  updateApiKeyHint();
  showToast(raw ? "Your key is saved and is tried first." : "Back to the shared key.", "fa-check", "settings");
  closeProfile();
  fetchHome();
}

function saveProfile() {
  const name = (profileNameInput && profileNameInput.value.trim()) || "";
  storeSet("ytclone.profile", name ? { name } : {});
  if (profileBtn) {
    profileBtn.classList.toggle("profile-initials", Boolean(name));
    profileBtn.innerHTML = "";
    profileBtn.textContent = name ? initials(name) : "?";
    profileBtn.setAttribute("aria-label", name ? `Profile: ${name}` : "Open local profile");
  }
  setStatus(name ? `Local profile saved for ${name}.` : "Local profile cleared.");
  closeProfile();
}

function resetProfile() {
  storeSet("ytclone.history", []);
  homeQuery = CONFIG.defaultQuery;
  storeSet("ytclone.homeQuery", homeQuery);
  renderHistory();
  setStatus("Watch history cleared. Home feed reset.");
}

/* ------------------------- dynamic links ------------------------- */

async function openExternal(url) {
  if (!url) return;
  try {
    const browser = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser;
    if (browser && browser.open) {
      await browser.open({ url });
      return;
    }
  } catch (_) { /* fall through */ }
  window.open(url, "_blank", "noopener");
}

async function checkForUpdates() {
  if (!updatesInfo) return;
  updatesInfo.textContent = "Checking for the latest build…";
  try {
    const res = await fetch(CONFIG.releasesApi, { cache: "no-store" });
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    const data = await res.json();
    const apk = (data.assets || []).find((a) => a.name && a.name.endsWith(".apk"));
    updatesInfo.innerHTML = "";
    const label = document.createElement("span");
    label.textContent = `Latest: ${data.tag_name || "unknown"} `;
    updatesInfo.appendChild(label);
    if (data.html_url) {
      const a = document.createElement("a");
      a.href = data.html_url;
      a.textContent = "release page";
      a.addEventListener("click", (e) => { e.preventDefault(); openExternal(data.html_url); });
      updatesInfo.appendChild(a);
    }
    if (apk && apk.browser_download_url) {
      const b = document.createElement("a");
      b.href = apk.browser_download_url;
      b.textContent = " · download APK";
      b.addEventListener("click", (e) => { e.preventDefault(); openExternal(apk.browser_download_url); });
      updatesInfo.appendChild(b);
    }
  } catch (err) {
    updatesInfo.textContent = `Could not check for updates: ${err.message || "offline"}`;
  }
}

/* ------------------------- config + feed ------------------------- */

async function loadConfig() {
  try {
    const res = await fetch("./config.json", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      CONFIG = { ...DEFAULT_CONFIG, ...(data && typeof data === "object" ? data : {}) };
    }
  } catch (_) {
    CONFIG = { ...DEFAULT_CONFIG };
  }
  if (brandText) brandText.textContent = CONFIG.appName || "YouTube Clone";
  if (homeLink) {
    homeLink.href = CONFIG.homeUrl || DEFAULT_CONFIG.homeUrl;
    homeLink.textContent = CONFIG.homeUrl || DEFAULT_CONFIG.homeUrl;
    homeLink.addEventListener("click", (e) => {
      e.preventDefault();
      openExternal(CONFIG.homeUrl);
    });
  }
  const stored = storeGet("ytclone.homeQuery", null);
  homeQuery = stored && typeof stored === "string" && stored.trim() ? stored : buildHomeQuery();
  return display();
}

/* ------------------------- grid rendering ------------------------- */

function showSkeletons(count = 8) {
  if (!grid) return;
  grid.innerHTML = "";
  for (let i = 0; i < count; i += 1) {
    const card = document.createElement("div");
    card.className = "skeleton-card";
    card.innerHTML = `
      <div class="skeleton-thumb shimmer"></div>
      <div class="skeleton-meta">
        <div class="skeleton-avatar shimmer"></div>
        <div class="skeleton-lines">
          <div class="skeleton-line shimmer"></div>
          <div class="skeleton-line short shimmer"></div>
        </div>
      </div>
    `;
    grid.appendChild(card);
  }
}

function renderEmpty(title, text) {
  if (!grid) return;
  grid.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon"><i class="fas fa-film" aria-hidden="true"></i></div>
      <h2>${title}</h2>
      <p>${text}</p>
    </div>
  `;
}

function renderVideos(items = []) {
  if (!grid) return;
  grid.innerHTML = "";
  const videos = items.filter((item) => item?.id?.videoId);

  if (!videos.length) {
    renderEmpty("No videos found", "Try a different keyword or pick another category.");
    setStatus("No results. Try different keywords.");
    return;
  }

  const fragment = document.createDocumentFragment();
  videos.forEach((item, index) => {
    const videoId = item.id.videoId;
    const sn = item.snippet || {};
    const title = decodeEntities(sn.title) || "YouTube video";
    const channel = decodeEntities(sn.channelTitle) || "Unknown channel";
    const when = timeAgo(sn.publishedAt);
    const duration = item._duration || "";
    const sub = [when].filter(Boolean).join(" · ") || "Tap to play";
    const thumb = thumbFor(sn, videoId);

    const card = document.createElement("div");
    card.className = "video-item";
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-label", `Play ${title}`);
    card.style.setProperty("--i", String(Math.min(index, 9)));
    card.innerHTML = `
      <div class="thumb-wrap">
        <img class="thumb" src="${thumb}" alt="" loading="lazy" decoding="async" />
        <span class="duration-badge">${duration ? "" : '<i class="fas fa-play" aria-hidden="true"></i>'}</span>
        <button class="queue-add" type="button" aria-label="Add to queue">
          <i class="fas fa-plus" aria-hidden="true"></i>
        </button>
      </div>
      <div class="meta">
        <div class="avatar-dot"></div>
        <div class="meta-text">
          <h3 class="title"></h3>
          <p class="channel"></p>
          <p class="subline"></p>
        </div>
      </div>
    `;
    card.querySelector(".title").textContent = title;
    card.querySelector(".channel").textContent = channel;
    card.querySelector(".subline").textContent = sub;
    const badge = card.querySelector(".duration-badge");
    if (duration) badge.textContent = duration;
    const av = card.querySelector(".avatar-dot");
    av.textContent = initials(channel);
    av.setAttribute("aria-hidden", "true");
    const payload = { videoId, title, channel, thumb, duration };
    card.addEventListener("click", () => openPlayer(videoId, title, channel, thumb));
    card.addEventListener("keydown", (event) => {
      if (event.target !== card) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openPlayer(videoId, title, channel, thumb);
      }
    });
    const add = card.querySelector(".queue-add");
    add.setAttribute("aria-label", `Add ${title} to queue`);
    add.addEventListener("click", (event) => {
      event.stopPropagation();
      addToQueue(payload);
    });
    fragment.appendChild(card);
  });
  grid.appendChild(fragment);
}

async function enrichDurations(items) {
  const ids = items.map((i) => i?.id?.videoId).filter(Boolean);
  if (!ids.length) return items;
  try {
    const data = await fetchApi("videos", { part: "contentDetails", id: ids.join(",") });
    const map = new Map((data.items || []).map((v) => [v.id, parseISODuration(v.contentDetails?.duration)]));
    items.forEach((i) => {
      const id = i?.id?.videoId;
      if (id && map.get(id)) i._duration = map.get(id);
    });
  } catch (_) {
    /* ignore enrichment failures */
  }
  return items;
}

async function fetchPopularItems(max = 24) {
  // A different quota bucket from search: 1 unit per call instead of 100, and
  // it is not part of the "Search Queries" daily limit at all.
  const params = { part: "snippet,contentDetails", chart: "mostPopular", maxResults: max };
  const region = regionCode();
  if (region) params.regionCode = region;
  const data = await fetchApi("videos", params);
  return (Array.isArray(data.items) ? data.items : [])
    .map((v) => {
      const videoId = typeof v.id === "string" ? v.id : v.id && v.id.videoId;
      if (!videoId) return null;
      return {
        id: { videoId },
        snippet: v.snippet || {},
        _duration: parseISODuration(v.contentDetails && v.contentDetails.duration),
      };
    })
    .filter(Boolean);
}

function friendlyFetchError(err) {
  const raw = err && err.message ? String(err.message) : "";
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(raw)) {
    return "Couldn't reach YouTube. Check your connection and try again.";
  }
  return raw || "Couldn't load videos. Check your connection and try again.";
}

function showFeed(items, message, { error = false, retry = false, action = null } = {}) {
  currentResults = items;
  renderVideos(items);
  if (items.length && playerEl && !playerEl.hidden) {
    renderSuggestions(items, currentPlayerVideoId());
  }
  if (message) setStatus(message, error, retry, action);
}

// When a search is refused for quota, offer the one fix that removes the shared
// limit: the user's own key. Hidden once a key is already saved.
function addKeyAction() {
  if (customApiKey()) return null;
  return { label: "Add your key", onClick: focusApiKeyField };
}

function searchLimitedMessage(detail) {
  if (customApiKey()) {
    return "Search is limited today — your key used up its YouTube quota. Keys reset at midnight Pacific Time.";
  }
  return `Search is limited today — ${detail}`;
}

function focusApiKeyField() {
  openProfile();
  setTimeout(() => {
    if (!apiKeyInput) return;
    apiKeyInput.scrollIntoView({ behavior: "smooth", block: "center" });
    apiKeyInput.focus();
  }, 140);
}

// Home is a browse view, not a search: it reads the popular feed, which costs
// 1 quota unit per call. That leaves the whole daily search allowance for the
// queries the user actually types.
async function fetchHome() {
  if (lastController) lastController.abort();
  lastController = new AbortController();
  window.scrollTo(0, 0);
  setStatus("Loading videos...");
  showSkeletons(8);
  try {
    const items = await fetchPopularItems(CONFIG.maxResults);
    if (!items.length) throw new Error("The popular feed came back empty.");
    showFeed(items, "Popular right now");
    rememberFeed(items, "Popular right now");
  } catch (err) {
    if (err && err.name === "AbortError") return;
    const saved = readSearchCache(homeQuery, { allowStale: true });
    if (saved) {
      showFeed(saved.items, "Showing saved videos. Check your connection to refresh.");
      return;
    }
    const last = readLastFeed();
    if (last) {
      showFeed(last.items, "Showing the videos saved on this device.");
      return;
    }
    const catalog = await catalogItems(homeQuery);
    if (catalog.length) {
      showFeed(catalog, "Showing the built-in catalog. Check your connection to refresh.");
      return;
    }
    if (grid) renderEmpty("Couldn't load videos", "Check your connection and try again.");
    setStatus(friendlyFetchError(err), true, true);
    console.error("Failed to load the home feed:", err);
  }
}

async function fetchVideos(query) {
  const q = (query || "").trim() || CONFIG.defaultQuery;
  lastQuery = q;
  if (lastController) lastController.abort();
  lastController = new AbortController();
  window.scrollTo(0, 0);

  const cached = readSearchCache(q);
  if (cached) {
    showFeed(cached.items, `Results for "${q}"`);
    return;
  }

  setStatus("Loading videos...");
  showSkeletons(8);

  try {
    // A personal key means the user's own quota, so it goes straight to Google.
    const proxied = customApiKey() ? null : await fetchBackendSearch(q, lastController.signal);
    if (proxied && proxied.items.length) {
      if (proxied.degraded) {
        showFeed(proxied.items, searchLimitedMessage("showing popular videos."), {
          action: addKeyAction(),
        });
        return;
      }
      const proxiedItems = proxied.items;
      currentResults = proxiedItems;
      await enrichDurations(proxiedItems);
      writeSearchCache(q, proxiedItems);
      showFeed(proxiedItems, `Results for "${q}"`);
      rememberFeed(proxiedItems, q);
      return;
    }
    const data = await fetchApi(
      "search",
      { part: "snippet", type: "video", maxResults: CONFIG.maxResults, q },
      lastController.signal
    );
    const items = Array.isArray(data.items) ? data.items : [];
    currentResults = items;
    await enrichDurations(items);
    writeSearchCache(q, items);
    showFeed(items, items.length ? `Results for "${q}"` : "");
    rememberFeed(items, q);
  } catch (err) {
    if (err && err.name === "AbortError") return;
    // Rescue order: this query's saved results, then popular videos whose
    // title/channel matches the words, then popular videos with an honest
    // label. The user never sees Google's raw quota text.
    const saved = readSearchCache(q, { allowStale: true });
    if (saved) {
      showFeed(saved.items, searchLimitedMessage(`showing saved results for "${q}".`), {
        action: addKeyAction(),
      });
      return;
    }
    try {
      const popular = await fetchPopularItems(50);
      const matches = matching(popular, q);
      const items = padMatches(matches, popular, CONFIG.maxResults || 24);
      if (items.length) {
        showFeed(
          items,
          searchLimitedMessage(
            matches.length >= 3
              ? `popular matches for "${q}".`
              : "showing popular videos."
          ),
          { action: addKeyAction() }
        );
        return;
      }
    } catch (_) { /* fall through to the offline content */ }

    // Offline, or YouTube refused everything: the catalog snapshot and the last
    // feed still give the user something to watch.
    const quota = Boolean(err && isQuotaReason(err.code));
    const catalog = await catalogItems(q);
    if (catalog.length) {
      showFeed(
        catalog,
        quota
          ? searchLimitedMessage("showing the built-in catalog.")
          : "Showing the built-in catalog. Check your connection to refresh.",
        { action: quota ? addKeyAction() : null }
      );
      return;
    }
    const last = readLastFeed();
    if (last) {
      showFeed(last.items, "Showing the videos saved on this device.");
      return;
    }
    if (grid) renderEmpty("Couldn't load videos", "Check your connection and try again.");
    setStatus(friendlyFetchError(err), true, true);
    console.error("Failed to load videos:", err);
  }
}

function setActiveChip(query) {
  if (!chipsEl) return;
  const q = (query || "").toLowerCase();
  chipsEl.querySelectorAll(".chip").forEach((chip) => {
    const chipQ = (chip.dataset.q || "").toLowerCase();
    chip.classList.toggle("active", chipQ === q || (q === CONFIG.defaultQuery && chipQ === CONFIG.defaultQuery));
  });
}

function display() {
  return fetchHome();
}

async function searchVideos() {
  const query = searchInput ? searchInput.value : "";
  if (!String(query).trim()) {
    if (searchInput) searchInput.focus();
    return;
  }
  setActiveChip("");
  await fetchVideos(query);
}

async function HomeButton() {
  if (searchInput) searchInput.value = "";
  updateClearBtn();
  setActiveChip(CONFIG.defaultQuery);
  await fetchHome();
  window.scrollTo(0, 0);
}

function focusSearch() {
  if (searchInput) {
    searchInput.focus();
    searchInput.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

async function searchByChip(query) {
  const q = (query || "").trim();
  // "All" is the browse view; only a real query spends search quota.
  if (!q || q === CONFIG.defaultQuery) {
    await HomeButton();
    return;
  }
  if (searchInput) searchInput.value = q;
  updateClearBtn();
  setActiveChip(q);
  await fetchVideos(q);
  window.scrollTo(0, 0);
}

/* ------------------------- suggestions ------------------------- */

function toVideoId(item) {
  if (!item) return null;
  const id = item.id;
  if (id && typeof id === "object" && id.videoId) return id.videoId;
  if (typeof id === "string") return id;
  return null;
}

function suggestionFromItem(item, currentVideoId) {
  const videoId = toVideoId(item);
  if (!videoId || videoId === currentVideoId) return null;
  const sn = item.snippet || {};
  return {
    videoId,
    title: decodeEntities(sn.title) || "YouTube video",
    channel: decodeEntities(sn.channelTitle) || "Unknown channel",
    thumb: thumbFor(sn, videoId),
    duration: item._duration || "",
    publishedAt: sn.publishedAt,
  };
}

function buildSuggestionElement(s) {
  const btn = document.createElement("div");
  btn.className = "ps-item";
  btn.setAttribute("role", "button");
  btn.setAttribute("tabindex", "0");
  btn.setAttribute("aria-label", `Play ${s.title}`);
  btn.innerHTML = `
    <div class="thumb-wrap">
      <img class="thumb" src="${s.thumb}" alt="" loading="lazy" decoding="async" />
      <span class="duration-badge">${s.duration ? s.duration : '<i class="fas fa-play" aria-hidden="true"></i>'}</span>
      <button class="queue-add" type="button" aria-label="Add to queue">
        <i class="fas fa-plus" aria-hidden="true"></i>
      </button>
    </div>
    <div class="meta">
      <div class="meta-text">
        <h3 class="title"></h3>
        <p class="channel"></p>
      </div>
    </div>`;
  btn.querySelector(".title").textContent = s.title;
  const channelEl = btn.querySelector(".channel");
  if (channelEl) channelEl.textContent = s.channel;
  btn.addEventListener("click", () => openPlayer(s.videoId, s.title, s.channel, s.thumb));
  btn.addEventListener("keydown", (event) => {
    if (event.target !== btn) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPlayer(s.videoId, s.title, s.channel, s.thumb);
    }
  });
  const add = btn.querySelector(".queue-add");
  add.setAttribute("aria-label", `Add ${s.title} to queue`);
  add.addEventListener("click", (event) => {
    event.stopPropagation();
    addToQueue(s);
  });
  return btn;
}

async function loadFallbackSuggestions(videoId) {
  try {
    const params = { part: "snippet", chart: "mostPopular", maxResults: 20 };
    const region = regionCode();
    if (region) params.regionCode = region;
    const data = await fetchApi("videos", params);
    const items = (Array.isArray(data.items) ? data.items : []).map((v) => ({
      id: v.id,
      snippet: v.snippet,
      _duration: "",
    }));
    const list = [];
    for (const item of items) {
      const s = suggestionFromItem(item, videoId);
      if (s) list.push(s);
      if (list.length >= 20) break;
    }
    return list;
  } catch (_) {
    return [];
  }
}

function currentPlayerVideoId() {
  try {
    const m = playerFrame && playerFrame.src ? playerFrame.src.match(/\/embed\/([^?&/]+)/) : null;
    return m ? m[1] : "";
  } catch (_) {
    return "";
  }
}

async function renderSuggestions(items, currentVideoId) {
  const container = playerSuggest;
  if (!container) return;
  if (railQueue) railQueue.hidden = true;
  const list = [];
  for (const item of items || []) {
    const s = suggestionFromItem(item, currentVideoId);
    if (s) list.push(s);
    if (list.length >= 20) break;
  }
  if (!list.length) {
    const fallback = await loadFallbackSuggestions(currentVideoId);
    if (!fallback.length) return;
    return renderSuggestions(fallback, currentVideoId);
  }
  currentSuggestions = list;
  container.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (const s of list) fragment.appendChild(buildSuggestionElement(s));
  container.appendChild(fragment);
  if (railQueue) railQueue.hidden = false;
}

/* ------------------------- queue ------------------------- */

// The queue is the list of videos that will play after the current one. It is
// local to the device and survives a reload; nothing about it depends on the
// YouTube account.
function normalizeQueueItem(raw) {
  if (!raw || !raw.videoId) return null;
  return {
    videoId: String(raw.videoId),
    title: decodeEntities(raw.title) || "YouTube video",
    channel: decodeEntities(raw.channel) || "YouTube",
    thumb: raw.thumb || `https://i.ytimg.com/vi/${raw.videoId}/hqdefault.jpg`,
    duration: raw.duration || "",
  };
}

let videoQueue = (() => {
  const raw = storeGet("ytclone.queue", []);
  return Array.isArray(raw) ? raw.map(normalizeQueueItem).filter(Boolean) : [];
})();

let playlists = (() => {
  const raw = storeGet("ytclone.playlists", []);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => ({
      id: p && p.id ? String(p.id) : uid(),
      name: String((p && p.name) || "Playlist"),
      createdAt: (p && p.createdAt) || Date.now(),
      items: Array.isArray(p && p.items) ? p.items.map(normalizeQueueItem).filter(Boolean) : [],
    }))
    .filter((p) => p.name);
})();

function persistQueue() {
  storeSet("ytclone.queue", videoQueue);
}

function persistPlaylists() {
  storeSet("ytclone.playlists", playlists);
}

function updateQueueBadges() {
  const n = videoQueue.length;
  for (const el of [queueHeaderBadge, queueBadge]) {
    if (!el) continue;
    el.textContent = String(n);
    el.hidden = n === 0;
  }
  if (queueCount) queueCount.textContent = String(n);
  if (playlistCount) playlistCount.textContent = String(playlists.length);
}

function addToQueue(item) {
  const normalized = normalizeQueueItem(item);
  if (!normalized) return;
  const existing = videoQueue.findIndex((v) => v.videoId === normalized.videoId);
  if (existing >= 0) {
    showToast("Already in the queue.", "fa-check", "queue");
    return;
  }
  videoQueue.push(normalized);
  persistQueue();
  renderQueue();
  showToast(`Added to queue. ${videoQueue.length} waiting.`, "fa-plus", "queue");
}

function toolButton(icon, label, handler, extraClass) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `icon-btn${extraClass ? ` ${extraClass}` : ""}`;
  b.setAttribute("aria-label", label);
  b.innerHTML = `<i class="fas ${icon}" aria-hidden="true"></i>`;
  b.addEventListener("click", (event) => {
    event.stopPropagation();
    handler();
  });
  return b;
}

function buildQueueRow(item, index) {
  const li = document.createElement("li");
  li.className = "queue-item";

  const open = document.createElement("button");
  open.type = "button";
  open.className = "queue-open";
  open.setAttribute("aria-label", `Play ${item.title}`);
  open.innerHTML = `
    <span class="queue-index">${index + 1}</span>
    <img class="queue-thumb" src="${item.thumb}" alt="" loading="lazy" decoding="async" />
    <span class="queue-copy">
      <span class="queue-title"></span>
      <span class="queue-channel"></span>
    </span>`;
  open.querySelector(".queue-title").textContent = item.title;
  open.querySelector(".queue-channel").textContent = item.channel || "Queued";
  open.addEventListener("click", () => playQueueIndex(index));

  const tools = document.createElement("div");
  tools.className = "queue-tools";
  const up = toolButton("fa-arrow-up", "Move up", () => moveQueueItem(index, -1));
  up.disabled = index === 0;
  const down = toolButton("fa-arrow-down", "Move down", () => moveQueueItem(index, 1));
  down.disabled = index === videoQueue.length - 1;
  const remove = toolButton("fa-trash-alt", "Remove from queue", () => removeQueueItem(index), "danger");
  tools.append(up, down, remove);

  li.append(open, tools);
  return li;
}

function renderQueue() {
  updateQueueBadges();
  if (queueList) {
    queueList.innerHTML = "";
    const fragment = document.createDocumentFragment();
    videoQueue.forEach((item, index) => fragment.appendChild(buildQueueRow(item, index)));
    queueList.appendChild(fragment);
  }
  const empty = videoQueue.length === 0;
  if (queueEmpty) queueEmpty.hidden = !empty;
  for (const btn of [queuePlay, queueSave, queueClear]) {
    if (btn) btn.disabled = empty;
  }
}

function moveQueueItem(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= videoQueue.length) return;
  const [item] = videoQueue.splice(index, 1);
  videoQueue.splice(target, 0, item);
  persistQueue();
  renderQueue();
}

function removeQueueItem(index) {
  if (index < 0 || index >= videoQueue.length) return;
  videoQueue.splice(index, 1);
  persistQueue();
  renderQueue();
  showToast("Removed from queue.", "fa-check", "queue");
}

function clearQueue() {
  if (!videoQueue.length) return;
  videoQueue = [];
  persistQueue();
  renderQueue();
  showToast("Queue cleared.", "fa-check", "queue");
}

function playQueueIndex(index) {
  const item = videoQueue[index];
  if (!item) return;
  videoQueue = videoQueue.slice(index + 1);
  persistQueue();
  renderQueue();
  closeQueueSheet();
  openPlayer(item.videoId, item.title, item.channel, item.thumb);
}

function playNextInQueue() {
  if (!videoQueue.length) return false;
  const next = videoQueue.shift();
  persistQueue();
  renderQueue();
  openPlayer(next.videoId, next.title, next.channel, next.thumb);
  return true;
}

function saveQueueAsPlaylist(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) {
    showToast("Give the playlist a name first.", "fa-pen");
    if (playlistName) playlistName.focus();
    return;
  }
  playlists.unshift({
    id: uid(),
    name: trimmed,
    createdAt: Date.now(),
    items: videoQueue.slice(),
  });
  persistPlaylists();
  renderPlaylists();
  if (playlistName) playlistName.value = "";
  const n = videoQueue.length;
  showToast(`Saved ${trimmed} with ${n} video${n === 1 ? "" : "s"}.`, "fa-bookmark", "playlist");
}

function buildPlaylistRow(playlist) {
  const li = document.createElement("li");
  li.className = "playlist-item";
  const count = playlist.items.length;
  li.innerHTML = `
    <span class="playlist-stack" aria-hidden="true"><i class="fas fa-list"></i></span>
    <span class="playlist-copy">
      <span class="playlist-name"></span>
      <span class="playlist-meta"></span>
    </span>
    <span class="playlist-actions"></span>`;
  li.querySelector(".playlist-name").textContent = playlist.name;
  li.querySelector(".playlist-meta").textContent = `${count} video${count === 1 ? "" : "s"}`;

  const actions = li.querySelector(".playlist-actions");
  const play = document.createElement("button");
  play.type = "button";
  play.className = "pill-btn primary";
  play.textContent = "Play";
  play.addEventListener("click", () => playPlaylist(playlist.id));
  const queue = document.createElement("button");
  queue.type = "button";
  queue.className = "pill-btn";
  queue.textContent = "Queue";
  queue.addEventListener("click", () => queuePlaylist(playlist.id));
  const del = toolButton("fa-trash-alt", `Delete ${playlist.name}`, () => deletePlaylist(playlist.id));
  del.className = "icon-btn danger";
  actions.append(play, queue, del);
  return li;
}

function renderPlaylists() {
  updateQueueBadges();
  if (!playlistList) return;
  playlistList.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (const playlist of playlists) fragment.appendChild(buildPlaylistRow(playlist));
  playlistList.appendChild(fragment);
  if (playlistsEmpty) playlistsEmpty.hidden = playlists.length > 0;
}

function playPlaylist(id) {
  const playlist = playlists.find((p) => p.id === id);
  if (!playlist) return;
  if (!playlist.items.length) {
    showToast("That playlist is empty.", "fa-list");
    return;
  }
  const first = playlist.items[0];
  videoQueue = playlist.items.slice(1);
  persistQueue();
  renderQueue();
  closeQueueSheet();
  openPlayer(first.videoId, first.title, first.channel, first.thumb);
}

function queuePlaylist(id) {
  const playlist = playlists.find((p) => p.id === id);
  if (!playlist) return;
  let added = 0;
  for (const item of playlist.items) {
    if (videoQueue.some((v) => v.videoId === item.videoId)) continue;
    videoQueue.push(item);
    added += 1;
  }
  persistQueue();
  renderQueue();
  showToast(added ? `${added} added to queue.` : "Those videos are already queued.", added ? "fa-plus" : "fa-check", "queue");
}

function deletePlaylist(id) {
  const playlist = playlists.find((p) => p.id === id);
  if (!playlist) return;
  const ok = typeof window.confirm === "function"
    ? window.confirm(`Delete "${playlist.name}"? This cannot be undone.`)
    : true;
  if (!ok) return;
  playlists = playlists.filter((p) => p.id !== id);
  persistPlaylists();
  renderPlaylists();
  showToast("Playlist deleted.", "fa-check", "playlist");
}

function switchQueueTab(tab) {
  const showPlaylists = tab === "playlists";
  if (queueTabQueue) {
    queueTabQueue.classList.toggle("is-active", !showPlaylists);
    queueTabQueue.setAttribute("aria-selected", String(!showPlaylists));
  }
  if (queueTabPlaylists) {
    queueTabPlaylists.classList.toggle("is-active", showPlaylists);
    queueTabPlaylists.setAttribute("aria-selected", String(showPlaylists));
  }
  if (queuePanel) queuePanel.hidden = showPlaylists;
  if (playlistsPanel) playlistsPanel.hidden = !showPlaylists;
}

function openQueueSheet(tab) {
  if (!queueSheet) return;
  sheetReturnFocus = document.activeElement;
  // Lock the feed behind the sheet only when the theatre player is not already
  // holding the page still. Closing restores exactly what was there.
  if ((!playerEl || playerEl.hidden) && sheetLockedScroll === null) {
    sheetLockedScroll = document.body.style.overflow || "";
    document.body.style.overflow = "hidden";
  }
  renderQueue();
  renderPlaylists();
  switchQueueTab(tab || "queue");
  queueSheet.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => queueSheet.classList.add("is-open")));
  setTimeout(() => { if (queueClose) queueClose.focus(); }, 80);
}

function closeQueueSheet() {
  if (!queueSheet || queueSheet.hidden) return;
  queueSheet.classList.remove("is-open");
  const sheet = queueSheet;
  setTimeout(() => {
    if (!sheet.classList.contains("is-open")) sheet.hidden = true;
  }, 320);
  if (sheetLockedScroll !== null) {
    document.body.style.overflow = sheetLockedScroll;
    sheetLockedScroll = null;
  }
  const back = sheetReturnFocus;
  sheetReturnFocus = null;
  if (back && typeof back.focus === "function") {
    setTimeout(() => { try { back.focus(); } catch (_) { /* gone */ } }, 60);
  }
}

/* ------------------------- player plumbing ------------------------- */

function lockLandscape() {
  try {
    const sp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ScreenOrientation;
    if (sp && typeof sp.lock === "function") {
      return Promise.resolve(sp.lock({ orientation: "landscape" })).catch(() => {});
    }
  } catch (_) { /* fall through to the Web API */ }
  try {
    if (screen.orientation && screen.orientation.lock) {
      return Promise.resolve(screen.orientation.lock({ orientation: "landscape" })).catch(() => {});
    }
  } catch (_) { /* unsupported */ }
  return Promise.resolve();
}

function unlockOrientation() {
  try {
    const sp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ScreenOrientation;
    if (sp && typeof sp.unlock === "function") {
      sp.unlock();
      return;
    }
  } catch (_) { /* ignore */ }
  try {
    if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
  } catch (_) { /* ignore */ }
}

function isPlayerFullscreen() {
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  if (!fsEl) return false;
  if (fsEl === playerFrame) return true;
  try {
    return Boolean(playerFrame && playerFrame.contains && playerFrame.contains(fsEl));
  } catch (_) {
    return false;
  }
}

function handleFullscreenChange() {
  if (isPlayerFullscreen()) lockLandscape();
  else unlockOrientation();
}

// The YouTube embed exposes play/pause over postMessage when enablejsapi=1.
function ytCommand(func) {
  try {
    if (playerFrame && playerFrame.contentWindow) {
      playerFrame.contentWindow.postMessage(
        JSON.stringify({ event: "command", func, args: "" }),
        "*"
      );
    }
  } catch (_) { /* ignore */ }
}

// Ask the embed to post player state back. Without this handshake YouTube only
// answers direct commands, so we could not tell when a video ended.
function ytListen() {
  try {
    if (playerFrame && playerFrame.contentWindow) {
      playerFrame.contentWindow.postMessage(
        JSON.stringify({ event: "listening", id: "player-frame", channel: "ytclone" }),
        "*"
      );
    }
  } catch (_) { /* ignore */ }
}

// Reveal the live YouTube frame over the poster once it has painted. A timeout
// fallback means a blocked/slow embed can never leave an invisible player.
function revealFrame() {
  clearTimeout(frameReadyTimer);
  frameReadyTimer = 0;
  if (playerFrame) playerFrame.classList.add("is-ready");
  if (playerFrameHolder) playerFrameHolder.style.backgroundImage = "";
}

function setMediaPlaying(playing) {
  mediaPlaying = Boolean(playing);
  // Read by the service-worker upgrade handler in index.html: never reload the
  // page out from under a playing video.
  document.documentElement.dataset.playing = mediaPlaying ? "1" : "0";
  notifyPlaybackActive(mediaPlaying);
  const icon = mediaPlaying ? "fa-pause" : "fa-play";
  const label = mediaPlaying ? "Pause" : "Play";
  for (const btn of [miniPlay, audioPlay]) {
    if (!btn) continue;
    const i = btn.querySelector("i");
    const span = btn.querySelector("span");
    if (i) { i.className = `fas ${icon}`; }
    if (span) span.textContent = label;
    btn.setAttribute("aria-label", label);
  }
}

function togglePlayback() {
  setMediaPlaying(!mediaPlaying);
  ytCommand(mediaPlaying ? "playVideo" : "pauseVideo");
}

function measureTile() {
  const tile = grid && grid.querySelector(".video-item");
  const w = tile ? tile.getBoundingClientRect().width : Math.min(window.innerWidth || 0, 420);
  currentTileWidth = Math.max(280, Math.round(w || 360));
  if (playerEl) {
    playerEl.style.setProperty("--player-tile-w", `${currentTileWidth}px`);
    playerEl.classList.toggle("compact", currentTileWidth < (window.innerWidth || 0) - 40);
  }
}

function layoutFill() {
  const wrap = playerVideoWrap;
  const holder = playerFrameHolder;
  if (!wrap || !holder) return;
  const rect = wrap.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  if (!w || !h) return;
  // Scale the 16:9 embed until it covers the whole window, then let the holder
  // crop the overhang. The iframe itself is never re-created.
  const scale = Math.max(w / 16, h / 9);
  const frameW = Math.round(16 * scale);
  const frameH = Math.round(9 * scale);
  holder.style.width = `${frameW}px`;
  holder.style.height = `${frameH}px`;
  holder.style.left = `${Math.round((w - frameW) / 2)}px`;
  holder.style.top = `${Math.round((h - frameH) / 2)}px`;
}

function layoutVideoBox() {
  const wrap = playerVideoWrap;
  const holder = playerFrameHolder;
  if (!wrap || !holder || miniActive || audioMode) return;
  if (fillMode) {
    layoutFill();
    return;
  }
  // Leaving fill clears the centring offsets it wrote.
  holder.style.left = "";
  holder.style.top = "";
  const rect = wrap.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  if (!w || !h) return;
  // The video always fills its 16:9 frame. Narrowing it to the grid tile width
  // left a dead black band beside it on tablets and phones.
  let W = Math.min((h * 16) / 9, w);
  let H = (W * 9) / 16;
  if (H < 200) {
    H = Math.min(200, h);
    W = Math.min(w, Math.round((H * 16) / 9));
  }
  holder.style.width = `${Math.round(W)}px`;
  holder.style.height = `${Math.round(H)}px`;
}

function setupPlayerLayout() {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (playerVideoWrap && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      if (fillMode) layoutFill();
      else layoutVideoBox();
    });
    resizeObserver.observe(playerVideoWrap);
  }
}

function setFill(on) {
  if (!playerEl || playerEl.hidden) return;
  const next = Boolean(on);
  if (next && miniActive) exitMini(false);
  if (next && audioMode) setAudioMode(false);
  fillMode = next;
  playerEl.classList.toggle("is-fill", next);
  if (playerFrameHolder) {
    playerFrameHolder.classList.toggle("zoomed", next);
    // The centring offsets are written only by layoutFill; clear them the
    // moment fill ends so mini/audio/theatre can centre with flex again.
    if (!next) {
      playerFrameHolder.style.left = "";
      playerFrameHolder.style.top = "";
    }
  }
  if (zoomToggle) {
    zoomToggle.setAttribute("aria-checked", String(next));
    zoomToggle.setAttribute("aria-pressed", String(next));
    zoomToggle.setAttribute("aria-label", next ? "Exit full screen" : "Fill the screen");
    const icon = zoomToggle.querySelector("i");
    if (icon) icon.className = next ? "fas fa-compress" : "fas fa-expand";
  }
  if (next) {
    // A filled 16:9 video belongs in landscape: portrait fill has to crop most
    // of the frame. Ask the device to turn, then keep the cover math in sync
    // while the rotation lands (the ResizeObserver also fires, but Android
    // reports the new size a beat late).
    lockLandscape();
    [80, 260, 600].forEach((delay) => {
      setTimeout(() => { if (fillMode) layoutFill(); }, delay);
    });
  } else {
    unlockOrientation();
  }
  requestAnimationFrame(() => {
    if (next) layoutFill();
    else layoutVideoBox();
  });
}

function setAudioMode(on) {
  // Audio mode and the floating mini player are mutually exclusive layouts.
  // Leaving mini here keeps the two class switches from fighting.
  if (on && miniActive) {
    exitMini(false);
    if (playerEl && !playerEl.hidden) document.body.style.overflow = "hidden";
  }
  if (on && fillMode) setFill(false);
  audioMode = Boolean(on);
  // CSS sizes the frame in audio mode; no inline style and no src change.
  if (playerEl) playerEl.classList.toggle("audio-mode", audioMode);
  if (audioPanel) audioPanel.hidden = !audioMode;
  if (audioToggle) audioToggle.setAttribute("aria-pressed", audioMode ? "true" : "false");
  if (!audioMode && !miniActive) requestAnimationFrame(() => layoutVideoBox());
  // Background audio is handled natively: the Android shell keeps the WebView
  // alive while mediaPlaying is true (see notifyPlaybackActive / MainActivity).
}

function enterMini() {
  if (!playerEl || playerEl.hidden) return;
  if (fillMode) setFill(false);
  setAudioMode(false);
  measureTile();
  miniActive = true;
  playerEl.classList.add("mini");
  if (miniToggle) miniToggle.setAttribute("aria-pressed", "true");
  if (miniTitle) miniTitle.textContent = (playerTitle && playerTitle.textContent) || "YouTube video";
  if (miniEl) miniEl.hidden = false;
  document.body.style.overflow = "";
  unlockOrientation();
  const y = playerScrollY || 0;
  playerScrollY = 0;
  window.scrollTo(0, y);
  requestAnimationFrame(() => {
    if (playerFrameHolder) {
      playerFrameHolder.style.width = "100%";
      playerFrameHolder.style.height = "100%";
    }
  });
  setMediaPlaying(mediaPlaying);
}

function exitMini(showFullPlayer = true) {
  if (!miniActive) return;
  miniActive = false;
  playerEl.classList.remove("mini");
  if (miniToggle) miniToggle.setAttribute("aria-pressed", "false");
  if (miniEl) miniEl.hidden = true;
  if (showFullPlayer && playerEl) {
    playerEl.hidden = false;
    document.body.style.overflow = "hidden";
    playerScrollY = window.scrollY;
    window.scrollTo(0, 0);
    requestAnimationFrame(() => { measureTile(); layoutVideoBox(); });
  }
}

function openPlayer(videoId, title, channel, thumb) {
  if (!playerEl || !playerFrame) return;
  const resolvedId = toVideoId({ id: { videoId } }) || videoId;
  if (miniActive) exitMini(false);
  setAudioMode(false);
  endedFor = "";
  playerOpenedAt = Date.now();
  // Poster + soft fade: opening the player should never flash an empty black
  // stage while the embed loads.
  if (playerFrame) playerFrame.classList.remove("is-ready");
  if (playerFrameHolder) {
    playerFrameHolder.style.backgroundImage = thumb ? `url("${thumb}")` : "";
    playerFrameHolder.classList.remove("opening");
    void playerFrameHolder.offsetWidth;
    playerFrameHolder.classList.add("opening");
  }
  clearTimeout(frameReadyTimer);
  frameReadyTimer = setTimeout(revealFrame, 3000);
  playerFrame.src = `https://www.youtube.com/embed/${resolvedId}?autoplay=1&playsinline=1&rel=0&enablejsapi=1`;
  setMediaPlaying(true);
  const safeTitle = decodeEntities(title) || "YouTube video";
  const safeChannel = decodeEntities(channel);
  if (playerTitle) playerTitle.textContent = safeTitle;
  if (playerChannel) playerChannel.textContent = safeChannel;
  if (audioTitle) audioTitle.textContent = safeTitle;
  if (audioChannel) audioChannel.textContent = safeChannel;
  if (audioArt) {
    audioArt.innerHTML = "";
    if (thumb) {
      const img = document.createElement("img");
      img.src = thumb;
      img.alt = "";
      img.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:inherit";
      audioArt.appendChild(img);
    } else {
      audioArt.innerHTML = '<i class="fas fa-headphones" aria-hidden="true"></i>';
    }
  }
  recordHistory({ videoId: resolvedId, title: safeTitle, channel: safeChannel, thumb });
  renderSuggestions(currentResults, resolvedId);
  playerEl.hidden = false;
  if (miniEl) miniEl.hidden = true;
  document.body.style.overflow = "hidden";
  playerScrollY = window.scrollY;
  window.scrollTo(0, 0);
  setupPlayerLayout();
  measureTile();
  requestAnimationFrame(() => {
    if (fillMode) layoutFill();
    else layoutVideoBox();
  });
  clearTimeout(listeningTimer);
  listeningTimer = setTimeout(() => { ytListen(); setTimeout(ytListen, 900); }, 500);
}

function closePlayer() {
  if (!playerEl || !playerFrame) return;
  try { ytCommand("stopVideo"); } catch (_) { /* ignore */ }
  playerFrame.src = "";
  setMediaPlaying(false);
  if (fillMode) setFill(false);
  miniActive = false;
  playerEl.classList.remove("mini");
  if (miniToggle) miniToggle.setAttribute("aria-pressed", "false");
  if (miniEl) miniEl.hidden = true;
  setAudioMode(false);
  playerEl.hidden = true;
  document.body.style.overflow = "";
  unlockOrientation();
  const y = playerScrollY || 0;
  playerScrollY = 0;
  window.scrollTo(0, y);
}

// Android back: fill -> theatre, full player -> floating mini, then close.
// Both steps are CSS-only, so the iframe is never re-created.
window.__onAndroidBack = function () {
  if (queueSheet && !queueSheet.hidden) {
    closeQueueSheet();
    return true;
  }
  if (profilePanel && !profilePanel.hidden) {
    closeProfile();
    return true;
  }
  if (playerEl && !playerEl.hidden) {
    if (fillMode) setFill(false);
    else if (miniActive) closePlayer();
    else enterMini();
    return true;
  }
  return false;
};

function AllowMic() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Microphone access is not supported in this browser.", true);
    return;
  }
  navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((stream) => {
      stream.getTracks().forEach((t) => t.stop());
      setStatus("Microphone permission granted.");
    })
    .catch(() => setStatus("Microphone permission was denied.", true));
}

function AllowCam() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Camera access is not supported in this browser.", true);
    return;
  }
  navigator.mediaDevices
    .getUserMedia({ video: true })
    .then((stream) => {
      stream.getTracks().forEach((t) => t.stop());
      setStatus("Camera permission granted.");
    })
    .catch(() => setStatus("Camera permission was denied.", true));
}

function toggleMenu() {}

/* ------------------------- gestures ------------------------- */

// Touches over the YouTube iframe belong to YouTube, so the page owns a real
// gesture target: the video edges and the now-playing strip. A short swipe up
// fills the screen; a swipe down on the floating bar leaves it.
function attachSwipe(el) {
  if (!el) return;
  let startX = 0;
  let startY = 0;
  let tracking = false;
  el.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) { tracking = false; return; }
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    tracking = true;
  }, { passive: true });
  el.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    if (!t) return;
    const dy = t.clientY - startY;
    const dx = t.clientX - startX;
    if (Math.abs(dy) < 56 || Math.abs(dy) < Math.abs(dx) * 1.3) return;
    if (dy < 0 && !fillMode) setFill(true);
    else if (dy > 0 && fillMode) setFill(false);
  }, { passive: true });
}
attachSwipe(playerVideoWrap);
attachSwipe(playerInfo);

/* ------------------------- YouTube player state ------------------------- */

// The embed posts state back after the listening handshake. state 0 is ended,
// which is our cue to start the next queued video instead of showing YouTube's
// end screen.
function handlePlayerState(state) {
  const id = currentPlayerVideoId();
  if (state === 1) {
    endedFor = "";
    setMediaPlaying(true);
  } else if (state === 2) {
    setMediaPlaying(false);
  } else if (state === 0) {
    setMediaPlaying(false);
    if (!id || endedFor === id) return;
    // A stale "ended" from the previous video can land just after a new src.
    if (Date.now() - playerOpenedAt < 1600) return;
    endedFor = id;
    if (!videoQueue.length) return;
    if (!playerEl || playerEl.hidden) return;
    setTimeout(() => { playNextInQueue(); }, 400);
  }
}

window.addEventListener("message", (event) => {
  let origin = "";
  try { origin = new URL(event.origin).hostname; } catch (_) { return; }
  if (!/(^|\.)youtube\.com$/.test(origin) && !/(^|\.)youtube-nocookie\.com$/.test(origin)) return;
  let data = event.data;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch (_) { return; }
  }
  if (!data || typeof data !== "object") return;
  if (data.event === "onStateChange" && typeof data.info === "number") {
    handlePlayerState(data.info);
  } else if (data.event === "infoDelivery" && data.info && typeof data.info.playerState === "number") {
    handlePlayerState(data.info.playerState);
  }
});

/* ------------------------- event wiring ------------------------- */

if (chipsEl) {
  chipsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    searchByChip(btn.dataset.q || CONFIG.defaultQuery);
  });
}

if (clearBtn && searchInput) {
  clearBtn.addEventListener("click", () => {
    searchInput.value = "";
    updateClearBtn();
    searchInput.focus();
  });
  searchInput.addEventListener("input", updateClearBtn);
  updateClearBtn();
}

if (playerCollapse) playerCollapse.addEventListener("click", closePlayer);
if (audioToggle) audioToggle.addEventListener("click", () => setAudioMode(!audioMode));
if (audioPlay) audioPlay.addEventListener("click", togglePlayback);
if (miniToggle) miniToggle.addEventListener("click", () => (miniActive ? exitMini(true) : enterMini()));
if (miniPlay) miniPlay.addEventListener("click", togglePlayback);
if (miniExpand) miniExpand.addEventListener("click", () => exitMini(true));
if (miniClose) miniClose.addEventListener("click", closePlayer);
if (fillGrab) fillGrab.addEventListener("click", () => setFill(!fillMode));
if (zoomToggle) zoomToggle.addEventListener("click", () => setFill(!fillMode));

if (playerEl) {
  playerEl.addEventListener("click", (e) => {
    if (e.target === playerEl && !fillMode) closePlayer();
  });
}
if (playerFrame) {
  playerFrame.addEventListener("load", () => {
    // Ignore the empty-src load fired by closePlayer().
    if (!playerFrame.getAttribute("src")) return;
    ytListen();
    // Two frames gives the embed a chance to paint before the poster leaves.
    requestAnimationFrame(() => requestAnimationFrame(revealFrame));
  });
}
document.addEventListener("fullscreenchange", handleFullscreenChange);
document.addEventListener("webkitfullscreenchange", handleFullscreenChange);

// Some Android WebViews suspend the embed while the app is hidden. When the
// user comes back, resume instead of leaving them on a frozen frame. This
// never fires if they paused the video themselves (mediaPlaying is false).
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (!mediaPlaying || !playerFrame || !playerFrame.src) return;
  setTimeout(() => ytCommand("playVideo"), 300);
});

function relayoutPlayer() {
  measureTile();
  if (fillMode) layoutFill();
  else layoutVideoBox();
}

window.addEventListener("resize", relayoutPlayer);
window.addEventListener("orientationchange", () => {
  // Android reports the rotated size a beat after the event, so settle twice.
  setTimeout(relayoutPlayer, 60);
  setTimeout(relayoutPlayer, 320);
});
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", relayoutPlayer);
}
try {
  if (screen.orientation && typeof screen.orientation.addEventListener === "function") {
    screen.orientation.addEventListener("change", () => {
      setTimeout(relayoutPlayer, 60);
      setTimeout(relayoutPlayer, 320);
    });
  }
} catch (_) { /* unsupported */ }

/* queue sheet wiring */
if (queueHeaderBtn) queueHeaderBtn.addEventListener("click", () => openQueueSheet("queue"));
const queueToggleEl = document.getElementById("queue-toggle");
if (queueToggleEl) queueToggleEl.addEventListener("click", () => openQueueSheet("queue"));
if (queueClose) queueClose.addEventListener("click", closeQueueSheet);
if (queueSheet) {
  queueSheet.addEventListener("click", (e) => {
    if (e.target === queueSheet) closeQueueSheet();
  });
  queueSheet.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || !queueDialog) return;
    const focusables = queueDialog.querySelectorAll(
      'button:not([disabled]), input, [href], [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}
if (queueTabQueue) queueTabQueue.addEventListener("click", () => switchQueueTab("queue"));
if (queueTabPlaylists) queueTabPlaylists.addEventListener("click", () => switchQueueTab("playlists"));
if (queuePlay) queuePlay.addEventListener("click", () => playQueueIndex(0));
if (queueClear) queueClear.addEventListener("click", clearQueue);
if (queueSave) {
  queueSave.addEventListener("click", () => {
    switchQueueTab("playlists");
    if (playlistName) {
      playlistName.value = `Queue ${playlists.length + 1}`;
      playlistName.focus();
      playlistName.select();
      playlistName.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
}
if (playlistForm) {
  playlistForm.addEventListener("submit", (e) => {
    e.preventDefault();
    saveQueueAsPlaylist(playlistName ? playlistName.value : "");
  });
}
if (railQueue) {
  railQueue.addEventListener("click", () => {
    const current = currentPlayerVideoId();
    let added = 0;
    for (const s of currentSuggestions) {
      if (s.videoId === current) continue;
      if (videoQueue.some((v) => v.videoId === s.videoId)) continue;
      videoQueue.push(normalizeQueueItem(s));
      added += 1;
    }
    persistQueue();
    renderQueue();
    showToast(added ? `${added} added to queue.` : "Those videos are already queued.", added ? "fa-plus" : "fa-check", "queue");
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (queueSheet && !queueSheet.hidden) closeQueueSheet();
    else if (profilePanel && !profilePanel.hidden) closeProfile();
    else if (playerEl && !playerEl.hidden && fillMode) setFill(false);
    else if (playerEl && !playerEl.hidden && miniActive) exitMini(true);
    else if (playerEl && !playerEl.hidden) closePlayer();
    return;
  }
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  if ((e.key === "f" || e.key === "F") && playerEl && !playerEl.hidden) {
    e.preventDefault();
    setFill(!fillMode);
  }
});

if (searchInput) {
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchVideos();
    }
  });
}

if (profileBtn) profileBtn.addEventListener("click", openProfile);
const profileClose = document.getElementById("profile-close");
if (profileClose) profileClose.addEventListener("click", closeProfile);
if (profilePanel) {
  profilePanel.addEventListener("click", (e) => {
    if (e.target === profilePanel) closeProfile();
  });
}
const profileSave = document.getElementById("profile-save");
if (profileSave) profileSave.addEventListener("click", saveProfile);
if (apiKeySave) apiKeySave.addEventListener("click", saveApiKey);
if (apiKeyInput) {
  apiKeyInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveApiKey();
    }
  });
}
const historyClear = document.getElementById("history-clear");
if (historyClear) historyClear.addEventListener("click", resetProfile);
const feedReset = document.getElementById("feed-reset");
if (feedReset) feedReset.addEventListener("click", resetProfile);
const updatesCheck = document.getElementById("updates-check");
if (updatesCheck) updatesCheck.addEventListener("click", checkForUpdates);
const updatesBtn = document.getElementById("updates-btn");
if (updatesBtn) updatesBtn.addEventListener("click", () => { openProfile(); checkForUpdates(); });
const libraryBtn = document.getElementById("library-btn");
if (libraryBtn) libraryBtn.addEventListener("click", openProfile);

// Google login support
if (googleLoginBtn) googleLoginBtn.addEventListener("click", async () => {
  if (!CONFIG.backendUrl) {
    setStatus("Backend not configured");
    return;
  }
  try {
    const url = `${CONFIG.backendUrl.replace(/\/$/, "")}/api/auth/google`;
    window.location.href = url;
  } catch (e) {
    setStatus("Login failed: " + e.message);
  }
});

renderQueue();
renderPlaylists();
loadConfig();
