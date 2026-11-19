// Runtime configuration. Every URL and the API key come from ./config.json so
// nothing about the app's home or feed endpoint is hardcoded here.
const DEFAULT_CONFIG = {
  apiBase: "https://youtube.googleapis.com/youtube/v3",
  apiKey: "AIzaSyDC-ej1rqEn_Ia92E1g3MyK-eJACxNTMFU",
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
const pipToggle = document.getElementById("pip-toggle");
const googleLoginBtn = document.getElementById("google-login-btn");
const profileNameInput = document.getElementById("profile-name");
const brandText = document.getElementById("brand-text");
const profileBtn = document.getElementById("profile-btn");
const homeLink = document.getElementById("home-link");
const updatesInfo = document.getElementById("updates-info");
const historyList = document.getElementById("history-list");

let lastQuery = homeQuery;
let lastController = null;
let currentResults = [];
let zoomEnabled = false;
let audioMode = false;
let miniActive = false;
let mediaPlaying = false;
let currentTileWidth = 0;
let playerScrollY = 0;
let resizeObserver = null;
let videoQueue = [];
let queueMode = false;
let queueAutoPlay = true; // Auto-play next video

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

function apiUrl(endpoint, params) {
  const base = String(CONFIG.apiBase || DEFAULT_CONFIG.apiBase).replace(/\/$/, "");
  const search = new URLSearchParams({ ...params, key: CONFIG.apiKey });
  return `${base}/${endpoint}?${search.toString()}`;
}

function setStatus(message, isError = false, showRetry = false) {
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
  renderHistory();
  profilePanel.hidden = false;
}

function closeProfile() {
  if (profilePanel) profilePanel.hidden = true;
}

function saveProfile() {
  const name = profileNameInput ? profileNameInput.value.trim() : "";
  storeSet("ytclone.profile", { name });
  if (profileBtn) {
    profileBtn.classList.add("profile-initials");
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
  for (const item of videos) {
    const videoId = item.id.videoId;
    const sn = item.snippet || {};
    const title = sn.title || "YouTube video";
    const channel = sn.channelTitle || "Unknown channel";
    const when = timeAgo(sn.publishedAt);
    const duration = item._duration || "";
    const sub = [when].filter(Boolean).join(" • ") || "Tap to play";
    const thumb =
      sn.thumbnails?.high?.url ||
      sn.thumbnails?.medium?.url ||
      sn.thumbnails?.default?.url ||
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    const card = document.createElement("button");
    card.type = "button";
    card.className = "video-item";
    card.setAttribute("aria-label", `Play ${title}`);
    card.innerHTML = `
      <div class="thumb-wrap">
        <img class="thumb" src="${thumb}" alt="" loading="lazy" decoding="async" />
        <span class="duration-badge">${duration ? "" : '<i class="fas fa-play" aria-hidden="true"></i>'}</span>
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
    card.addEventListener("click", () => openPlayer(videoId, title, channel, thumb));
    fragment.appendChild(card);
  }
  grid.appendChild(fragment);
}

async function enrichDurations(items) {
  const ids = items.map((i) => i?.id?.videoId).filter(Boolean);
  if (!ids.length) return items;
  try {
    const url = apiUrl("videos", { part: "contentDetails", id: ids.join(",") });
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return items;
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

async function fetchVideos(query) {
  const q = (query || "").trim() || homeQuery;
  lastQuery = q;
  if (lastController) lastController.abort();
  lastController = new AbortController();
  window.scrollTo(0, 0);

  const url = apiUrl("search", {
    part: "snippet",
    type: "video",
    maxResults: CONFIG.maxResults,
    q,
  });

  setStatus("Loading videos...");
  showSkeletons(8);

  try {
    const res = await fetch(url, { signal: lastController.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const apiMsg = data?.error?.message || `Request failed (${res.status})`;
      throw new Error(apiMsg);
    }
    const items = Array.isArray(data.items) ? data.items : [];
    currentResults = items;
    await enrichDurations(items);
    renderVideos(items);
    // Keep an already-open player's Up-next rail filled. Opening a video while
    // the first feed request is still in flight used to leave a blank rail.
    if (items.length && playerEl && !playerEl.hidden) {
      renderSuggestions(items, currentPlayerVideoId());
    }
    if (items.length) {
      setStatus(q === homeQuery ? "Recommended for you" : `Results for "${q}"`);
    }
  } catch (err) {
    if (err && err.name === "AbortError") return;
    if (grid) renderEmpty("Couldn't load videos", "Check your connection or API key, then try again.");
    const message =
      err && err.message ? err.message : "Unable to load videos. Check your connection and try again.";
    setStatus(message, true, true);
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
  return fetchVideos(homeQuery);
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
  homeQuery = storeGet("ytclone.homeQuery", CONFIG.defaultQuery) || CONFIG.defaultQuery;
  await fetchVideos(homeQuery);
  window.scrollTo(0, 0);
}

function focusSearch() {
  if (searchInput) {
    searchInput.focus();
    searchInput.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

async function searchByChip(query) {
  const q = (query || "").trim() || CONFIG.defaultQuery;
  if (searchInput) searchInput.value = q === CONFIG.defaultQuery ? "" : q;
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
  const thumb =
    sn.thumbnails?.high?.url ||
    sn.thumbnails?.medium?.url ||
    sn.thumbnails?.default?.url ||
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  return {
    videoId,
    title: sn.title || "YouTube video",
    channel: sn.channelTitle || "Unknown channel",
    thumb,
    duration: item._duration || "",
    publishedAt: sn.publishedAt,
  };
}

function buildSuggestionElement(s) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ps-item";
  btn.setAttribute("aria-label", `Play ${s.title}`);
  btn.innerHTML = `
    <div class="thumb-wrap">
      <img class="thumb" src="${s.thumb}" alt="" loading="lazy" decoding="async" />
      <span class="duration-badge">${s.duration ? s.duration : '<i class="fas fa-play" aria-hidden="true"></i>'}</span>
    </div>
    <div class="meta">
      <div class="meta-text">
        <h3 class="title"></h3>
        <p class="channel"></p>
        <span class="queue-indicator" style="font-size:0.7em;color:var(--accent);margin-left:auto;opacity:0;"></span>
      </div>
    </div>`;
  btn.querySelector(".title").textContent = s.title;
  const channelEl = btn.querySelector(".channel");
  if (channelEl) channelEl.textContent = s.channel;
  const indicator = btn.querySelector(".queue-indicator");
  if (videoQueue.length > 0) {
    indicator.textContent = "▶";
    indicator.style.opacity = "0.7";
  }
  btn.addEventListener("click", () => {
    // Add to queue and play if not already playing
    if (!mediaPlaying || playerEl.hidden) {
      addQueue(s.videoId, s.title, s.channel, s.thumb);
    }
    openPlayer(s.videoId, s.title, s.channel, s.thumb);
  });
  return btn;
}

/* ------------------------- queue management ------------------------- */

function addQueue(videoId, title, channel, thumb) {
  const existingIdx = videoQueue.findIndex(v => v.videoId === videoId);
  if (existingIdx >= 0 && existingIdx === 0) return; // Already at front
  if (existingIdx >= 0) videoQueue.splice(existingIdx, 1);
  videoQueue.push({ videoId, title, channel, thumb });
  updateQueueUI();
}

function playNextInQueue() {
  if (videoQueue.length === 0) {
    queueMode = false;
    return;
  }
  const next = videoQueue.shift();
  openPlayer(next.videoId, next.title, next.channel, next.thumb);
}

function toggleQueueMode() {
  queueMode = !queueMode;
  if (queueMode && videoQueue.length > 0 && mediaPlaying && !playerEl.hidden) {
    // Already playing, will auto-play next
  } else if (queueMode && videoQueue.length > 0 && !mediaPlaying) {
    // Not playing, play the first in queue
    const next = videoQueue.shift();
    openPlayer(next.videoId, next.title, next.channel, next.thumb);
  }
  updateQueueUI();
}

function updateQueueUI() {
  // Update suggestion items to show queue indicator
  if (!playerSuggest) return;
  const items = playerSuggest.querySelectorAll(".ps-item");
  items.forEach((item, idx) => {
    const indicator = item.querySelector(".queue-indicator");
    if (indicator && videoQueue.length > 0) {
      if (idx === 0 && queueMode) {
        indicator.textContent = "▶";
        indicator.style.opacity = "0.7";
      } else {
        indicator.textContent = "";
        indicator.style.opacity = "0";
      }
    }
  });
}

async function loadFallbackSuggestions(videoId) {
  try {
    const res = await fetch(apiUrl("videos", { part: "snippet", chart: "mostPopular", maxResults: 20 }));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return [];
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
  container.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (const s of list) fragment.appendChild(buildSuggestionElement(s));
  container.appendChild(fragment);
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

function setMediaPlaying(playing) {
  mediaPlaying = Boolean(playing);
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

function layoutVideoBox() {
  const wrap = playerVideoWrap;
  const holder = playerFrameHolder;
  if (!wrap || !holder || miniActive || audioMode) return;
  // Mini / audio modes are styled by CSS classes only. The iframe is never
  // detached or re-created, so switching modes cannot restart playback.
  const rect = wrap.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  if (!w || !h) return;
  if (zoomEnabled) {
    holder.style.width = `${Math.round(w)}px`;
    holder.style.height = `${Math.round(h)}px`;
    return;
  }
  // Desktop theatre: the video fills the stage, not the grid tile width.
  const wide = window.matchMedia && window.matchMedia("(min-width: 901px), (orientation: landscape)").matches;
  let W = Math.min((h * 16) / 9, w, wide ? w : currentTileWidth || w);
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
    resizeObserver = new ResizeObserver(() => layoutVideoBox());
    resizeObserver.observe(playerVideoWrap);
  }
  window.addEventListener("resize", () => { measureTile(); layoutVideoBox(); });
  window.addEventListener("orientationchange", () => setTimeout(() => { measureTile(); layoutVideoBox(); }, 0));
}

function setAudioMode(on) {
  // Audio mode and the floating mini player are mutually exclusive layouts.
  // Leaving mini here keeps the two class switches from fighting.
  if (on && miniActive) {
    exitMini(false);
    if (playerEl && !playerEl.hidden) document.body.style.overflow = "hidden";
  }
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
  setAudioMode(false);
  measureTile();
  miniActive = true;
  playerEl.classList.add("mini");
  if (pipToggle) pipToggle.setAttribute("aria-pressed", "true");
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
  if (pipToggle) pipToggle.setAttribute("aria-pressed", "false");
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
  playerFrame.src = `https://www.youtube.com/embed/${resolvedId}?autoplay=1&playsinline=1&rel=0&enablejsapi=1`;
  setMediaPlaying(true);
  const safeTitle = title || "YouTube video";
  const safeChannel = channel || "";
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
      img.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:14px";
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
  requestAnimationFrame(() => layoutVideoBox());
}

function closePlayer() {
  if (!playerEl || !playerFrame) return;
  try { ytCommand("stopVideo"); } catch (_) { /* ignore */ }
  playerFrame.src = "";
  setMediaPlaying(false);
  miniActive = false;
  playerEl.classList.remove("mini");
  if (pipToggle) pipToggle.setAttribute("aria-pressed", "false");
  if (miniEl) miniEl.hidden = true;
  setAudioMode(false);
  playerEl.hidden = true;
  document.body.style.overflow = "";
  unlockOrientation();
  const y = playerScrollY || 0;
  playerScrollY = 0;
  window.scrollTo(0, y);
}

// Android back: full player -> floating mini player, then a second back closes.
// Both steps are CSS-only, so the iframe is never re-created and audio continues.
window.__onAndroidBack = function () {
  if (profilePanel && !profilePanel.hidden) {
    closeProfile();
    return true;
  }
  if (playerEl && !playerEl.hidden) {
    if (miniActive) closePlayer();
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
const queueToggleEl = document.getElementById("queue-toggle");
if (queueToggleEl) queueToggleEl.addEventListener("click", () => toggleQueueMode());
if (audioPlay) audioPlay.addEventListener("click", togglePlayback);
if (miniToggle) miniToggle.addEventListener("click", enterMini);
if (miniPlay) miniPlay.addEventListener("click", togglePlayback);
if (miniExpand) miniExpand.addEventListener("click", () => exitMini(true));
if (miniClose) miniClose.addEventListener("click", closePlayer);
if (playerEl) {
  playerEl.addEventListener("click", (e) => {
    if (e.target === playerEl) closePlayer();
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
if (zoomToggle) {
  zoomToggle.addEventListener("click", () => {
    zoomEnabled = !zoomEnabled;
    const on = zoomEnabled;
    zoomToggle.setAttribute("aria-checked", on ? "true" : "false");
    zoomToggle.setAttribute("aria-pressed", on ? "true" : "false");
    layoutVideoBox();
    // Apply zoom to fill when enabled
    if (on && playerFrameHolder) {
      playerFrameHolder.classList.add("zoomed");
    } else if (playerFrameHolder) {
      playerFrameHolder.classList.remove("zoomed");
    }
  });
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (profilePanel && !profilePanel.hidden) closeProfile();
    else if (playerEl && !playerEl.hidden && !miniActive && zoomEnabled) {
      // Exit zoom-to-fill mode instead of closing player
      zoomEnabled = false;
      if (zoomToggle) {
        zoomToggle.setAttribute("aria-checked", "false");
        zoomToggle.setAttribute("aria-pressed", "false");
      }
      if (playerFrameHolder) playerFrameHolder.classList.remove("zoomed");
      layoutVideoBox();
    } else if (playerEl && !playerEl.hidden && miniActive) {
      // Leave the floating player and return to full theatre view.
      exitMini(true);
    } else {
      closePlayer();
    }
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

// Picture in picture reuses the mini player. The old implementation created a
// second iframe with the same URL, which restarted the video from 0:00 — the
// exact behaviour we must avoid. Now only a CSS class changes.
if (pipToggle) {
  pipToggle.addEventListener("click", () => {
    if (!playerEl || playerEl.hidden) return;
    if (miniActive) exitMini(true);
    else enterMini();
  });
}

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

loadConfig();
