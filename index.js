const API_KEY = "AIzaSyDC-ej1rqEn_Ia92E1g3MyK-eJACxNTMFU";
const DEFAULT_QUERY = "artificial intelligence";
const MAX_RESULTS = 24;

const grid = document.getElementById("videodiv");
const statusEl = document.getElementById("status");
const searchInput = document.getElementById("video");
const clearBtn = document.getElementById("clear-search");
const chipsEl = document.getElementById("chips");
const playerModal = document.getElementById("player-modal");
const playerFrame = document.getElementById("player-frame");
const playerTitle = document.getElementById("player-title");
const playerChannel = document.getElementById("player-channel");
const playerClose = document.getElementById("player-close");

let lastQuery = DEFAULT_QUERY;
let lastController = null;

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
  window.scrollTo({ top: 0, behavior: "smooth" });
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
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openPlayer(videoId, title, channel) {
  if (!playerModal || !playerFrame) return;
  playerFrame.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&playsinline=1&rel=0`;
  if (playerTitle) playerTitle.textContent = title || "YouTube video";
  if (playerChannel) playerChannel.textContent = channel || "";
  playerModal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closePlayer() {
  if (!playerModal || !playerFrame) return;
  playerFrame.src = "";
  playerModal.hidden = true;
  document.body.style.overflow = "";
}

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

if (playerClose) playerClose.addEventListener("click", closePlayer);
if (playerModal) {
  playerModal.addEventListener("click", (e) => {
    if (e.target === playerModal) closePlayer();
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