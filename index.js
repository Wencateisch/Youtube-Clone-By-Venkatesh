const API_KEY = "AIzaSyDC-ej1rqEn_Ia92E1g3MyK-eJACxNTMFU";
const DEFAULT_QUERY = "artificial intelligence";
const MAX_RESULTS = 24;

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

let lastQuery = DEFAULT_QUERY;
let lastController = null;
let currentResults = [];
let zoomEnabled = false;
let playerScrollY = 0;
let resizeObserver = null;

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
    card.addEventListener("click", () => openPlayer(videoId, title, channel));
    fragment.appendChild(card);
  }
  grid.appendChild(fragment);
}

async function enrichDurations(items) {
  const ids = items.map((i) => i?.id?.videoId).filter(Boolean);
  if (!ids.length) return items;
  try {
    const url = `https://youtube.googleapis.com/youtube/v3/videos?part=contentDetails&id=${encodeURIComponent(
      ids.join(",")
    )}&key=${API_KEY}`;
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return items;
    const map = new Map((data.items || []).map((v) => [v.id, parseISODuration(v.contentDetails?.duration)]));
    items.forEach((i) => {
      const id = i?.id?.videoId;
      if (id && map.get(id)) i._duration = map.get(id);
    });
  } catch (_) {
    // ignore enrichment failures
  }
  return items;
}

async function fetchVideos(query) {
  const q = (query || "").trim() || DEFAULT_QUERY;
  lastQuery = q;
  if (lastController) lastController.abort();
  lastController = new AbortController();
  window.scrollTo(0, 0);

  const url = `https://youtube.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=${MAX_RESULTS}&q=${encodeURIComponent(
    q
  )}&key=${API_KEY}`;

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
    if (items.length) {
      setStatus(q === DEFAULT_QUERY ? "Recommended for you" : `Results for "${q}"`);
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
    chip.classList.toggle("active", chipQ === q || (q === DEFAULT_QUERY && chipQ === DEFAULT_QUERY));
  });
}

function display() {
  return fetchVideos(DEFAULT_QUERY);
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
  setActiveChip(DEFAULT_QUERY);
  await fetchVideos(DEFAULT_QUERY);
  window.scrollTo(0, 0);
}

function focusSearch() {
  if (searchInput) {
    searchInput.focus();
    searchInput.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

async function searchByChip(query) {
  const q = (query || "").trim() || DEFAULT_QUERY;
  if (searchInput) searchInput.value = q === DEFAULT_QUERY ? "" : q;
  updateClearBtn();
  setActiveChip(q);
  await fetchVideos(q);
  window.scrollTo(0, 0);
}

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
      </div>
    </div>`;
  const titleEl = btn.querySelector(".title");
  titleEl.textContent = s.title;
  const channelEl = btn.querySelector(".channel");
  if (channelEl) channelEl.textContent = s.channel;
  btn.addEventListener("click", () => openPlayer(s.videoId, s.title, s.channel));
  return btn;
}

async function loadFallbackSuggestions(videoId) {
  try {
    const url = `https://youtube.googleapis.com/youtube/v3/videos?part=snippet&chart=mostPopular&maxResults=12&key=${API_KEY}`;
    const res = await fetch(url);
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
      if (list.length >= 12) break;
    }
    return list;
  } catch (_) {
    return [];
  }
}

async function renderSuggestions(items, currentVideoId) {
  const container = playerSuggest;
  if (!container) return;
  const list = [];
  for (const item of items || []) {
    const s = suggestionFromItem(item, currentVideoId);
    if (s) list.push(s);
    if (list.length >= 12) break;
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

function layoutVideoBox() {
  const wrap = playerVideoWrap;
  const holder = playerFrameHolder;
  if (!wrap || !holder) return;
  const rect = wrap.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  if (!w || !h) return;
  if (zoomEnabled) {
    holder.style.width = `${Math.round(w)}px`;
    holder.style.height = `${Math.round(h)}px`;
    return;
  }
  const fitH = (w * 9) / 16;
  const H = Math.min(fitH, h);
  const W = (H * 16) / 9;
  holder.style.width = `${Math.round(W)}px`;
  holder.style.height = `${Math.round(H)}px`;
}

function setupPlayerLayout() {
  if (!playerVideoWrap) return;
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => layoutVideoBox());
    resizeObserver.observe(playerVideoWrap);
  }
  window.addEventListener("resize", () => layoutVideoBox());
  window.addEventListener("orientationchange", () => setTimeout(layoutVideoBox, 0));
}

function openPlayer(videoId, title, channel) {
  if (!playerEl || !playerFrame) return;
  const resolvedId = toVideoId({ id: { videoId } }) || videoId;
  playerFrame.src = `https://www.youtube.com/embed/${resolvedId}?autoplay=1&playsinline=1&rel=0`;
  if (playerTitle) playerTitle.textContent = title || "YouTube video";
  if (playerChannel) playerChannel.textContent = channel || "";
  renderSuggestions(currentResults, resolvedId);
  playerEl.hidden = false;
  document.body.style.overflow = "hidden";
  playerScrollY = window.scrollY;
  window.scrollTo(0, 0);
  setupPlayerLayout();
  requestAnimationFrame(() => layoutVideoBox());
}

function closePlayer() {
  if (!playerEl || !playerFrame) return;
  playerFrame.src = "";
  playerEl.hidden = true;
  document.body.style.overflow = "";
  unlockOrientation();
  const y = playerScrollY || 0;
  playerScrollY = 0;
  window.scrollTo(0, y);
}

// Android hardware/gesture back support. The native shell calls this before it
// closes the app; returning true means "handled - keep the app open".
window.__onAndroidBack = function () {
  if (playerEl && !playerEl.hidden) {
    closePlayer();
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

if (chipsEl) {
  chipsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    searchByChip(btn.dataset.q || DEFAULT_QUERY);
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
if (playerEl) {
  playerEl.addEventListener("click", (e) => {
    if (e.target === playerEl) closePlayer();
  });
}
document.addEventListener("fullscreenchange", handleFullscreenChange);
document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
if (zoomToggle) {
  zoomToggle.addEventListener("click", () => {
    zoomEnabled = !zoomEnabled;
    const on = zoomEnabled;
    zoomToggle.setAttribute("aria-checked", on ? "true" : "false");
    zoomToggle.setAttribute("aria-pressed", on ? "true" : "false");
    layoutVideoBox();
  });
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePlayer();
});

if (searchInput) {
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchVideos();
    }
  });
}

display();