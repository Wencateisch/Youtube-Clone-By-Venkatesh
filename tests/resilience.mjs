// Resilience checks: the app must draw a grid and explain itself in plain words
// no matter which dependency fails. Each scenario runs the real app in headless
// Chrome with one fault injected, then asserts what the user would see.
//
// No dependencies: static server + Chrome DevTools Protocol over the built-in
// WebSocket (Node 22+).
import http from "node:http";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "www");
const PORT = Number(process.env.TEST_PORT || 8123);
const CHROME_PORT = Number(process.env.TEST_CHROME_PORT || 9335);
const APP = `http://localhost:${PORT}/`;
const BACKEND = `http://localhost:${PORT}/__backend`;

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

async function startServer() {
  const config = JSON.parse(await fs.readFile(path.join(WEB, "config.json"), "utf8"));
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    // Point the app at a backend that always fails, so every scenario also
    // proves the direct-API fallback.
    if (url.pathname === "/config.json") {
      return send(res, 200, JSON.stringify({ ...config, backendUrl: BACKEND }));
    }
    if (url.pathname === "/__backend/api/search") {
      return send(res, 500, JSON.stringify({ error: "unavailable" }));
    }
    let file = url.pathname.split("?")[0];
    if (file === "/") file = "/index.html";
    const full = path.join(WEB, decodeURIComponent(file));
    try {
      const data = await fs.readFile(full);
      send(res, 200, data, MIME[path.extname(full)] || "application/octet-stream");
    } catch (_) {
      send(res, 404, "not found", "text/plain");
    }
  });
  await new Promise((resolve) => server.listen(PORT, resolve));
  return server;
}

async function getJSON(url) {
  const res = await fetch(url);
  return res.json();
}

async function launchChrome() {
  const binary = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!binary) throw new Error(`Chrome not found. Set CHROME_BIN. Tried: ${CHROME_CANDIDATES.join(", ")}`);
  const profile = path.join(os.tmpdir(), `ytclone-test-${Date.now()}`);
  const child = spawn(
    binary,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--disable-extensions",
      "--no-first-run",
      `--remote-debugging-port=${CHROME_PORT}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  for (let i = 0; i < 60; i += 1) {
    try {
      const targets = await getJSON(`http://127.0.0.1:${CHROME_PORT}/json/list`);
      if (targets && targets.length) return { child, target: targets.find((t) => t.type === "page") || targets[0] };
    } catch (_) {
      /* still starting */
    }
    await sleep(250);
  }
  child.kill();
  throw new Error("Chrome did not expose a debugging target");
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
    }
  });
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return { call, close: () => ws.close() };
}

function faultScript(mode) {
  return `(() => {
    const mode = ${JSON.stringify(mode)};
    const realFetch = window.fetch.bind(window);
    const json = (status, body) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    const quota = () =>
      json(403, { error: { code: 403, errors: [{ reason: "quotaExceeded", message: "Quota exceeded for quota metric 'Search Queries' of service 'youtube.googleapis.com' for consumer 'project_number:123456789'." }] } });
    const invalidKey = () =>
      json(400, { error: { code: 400, errors: [{ reason: "keyInvalid", message: "API key not valid. Please pass a valid API key." }] } });
    const popular = () =>
      json(200, { items: [
        { id: "dQw4w9WgXcQ", snippet: { title: "Popular video", channelTitle: "Studio" } },
        { id: "jNQXAC9IVRw", snippet: { title: "Second popular video", channelTitle: "Studio" } }
      ] });
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      if (url.includes("/__backend/")) return Promise.resolve(json(500, { error: "unavailable" }));
      if (url.includes("youtube.googleapis.com")) {
        if (mode === "offline") return Promise.reject(new TypeError("Failed to fetch"));
        if (mode === "keyInvalid") return Promise.resolve(invalidKey());
        if (mode === "quota") {
          if (url.includes("/search")) return Promise.resolve(quota());
          if (url.includes("chart=mostPopular")) return Promise.resolve(popular());
        }
      }
      return realFetch(input, init);
    };
  })();`;
}

const HOME_PROBE = `(() => {
  const cards = () => document.querySelectorAll(".video-item").length;
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const status = document.getElementById("status");
      const text = status ? status.textContent : "";
      if (cards() > 0 || Date.now() - start > 9000) {
        const action = status && status.querySelector(".retry-btn");
        resolve({
          cards: cards(),
          status: text,
          action: action ? action.textContent : null,
          empty: Boolean(document.querySelector("#videodiv .empty, .empty-state")),
        });
        return;
      }
      setTimeout(tick, 200);
    };
    tick();
  });
})();`;

const SEARCH_PROBE = (query) => `(() => {
  const cards = () => document.querySelectorAll(".video-item").length;
  const input = document.getElementById("video");
  input.value = ${JSON.stringify(query)};
  document.querySelector(".search-btn").click();
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const status = document.getElementById("status");
      const text = status ? status.textContent : "";
      if (/Results for|limited today|built-in catalog|saved on this device|Couldn't load/.test(text) || Date.now() - start > 12000) {
        const action = status && status.querySelector(".retry-btn");
        resolve({
          cards: cards(),
          status: text,
          action: action ? action.textContent : null,
          first: document.querySelector(".video-item .title") ? document.querySelector(".video-item .title").textContent : null,
        });
        return;
      }
      setTimeout(tick, 200);
    };
    tick();
  });
})();`;

const RAW_LEAK = /quotaExceeded|dailyLimitExceeded|project_number|quota metric|API key not valid|Failed to fetch|NetworkError/i;

function check(name, condition, detail) {
  if (condition) {
    console.log(`  PASS ${name}`);
    return;
  }
  console.log(`  FAIL ${name}: ${JSON.stringify(detail)}`);
  throw new Error(`${name} failed`);
}

async function main() {
  const server = await startServer();
  const { child, target } = await launchChrome();
  const cdp = await connect(target.webSocketDebuggerUrl);

  await cdp.call("Page.enable");
  await cdp.call("Runtime.enable");
  await cdp.call("Network.enable");
  await cdp.call("Network.setBypassServiceWorker", { bypass: true });
  await cdp.call("Network.setCacheDisabled", { cacheDisabled: true });

  const evaluate = async (expression) => {
    const result = await cdp.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return result && result.result ? result.result.value : undefined;
  };

  const runScenario = async (name, mode, probe) => {
    console.log(`\n${name}`);
    await cdp.call("Storage.clearDataForOrigin", {
      origin: APP.replace(/\/$/, ""),
      storageTypes: "local_storage",
    });
    const injected = await cdp.call("Page.addScriptToEvaluateOnNewDocument", { source: faultScript(mode) });
    await cdp.call("Page.navigate", { url: APP });
    await sleep(2500);
    const value = await evaluate(probe);
    await cdp.call("Page.removeScriptToEvaluateOnNewDocument", { identifier: injected.identifier });
    return value || {};
  };

  let failures = 0;
  const scenario = async (name, mode, probe, assert) => {
    try {
      const value = await runScenario(name, mode, probe);
      assert(value);
    } catch (error) {
      failures += 1;
      console.log(`  ${name} threw: ${error.message}`);
    }
  };

  await scenario("home with a spent search quota", "quota", HOME_PROBE, (value) => {
    check("home still shows videos", value.cards > 0, value);
    check("no raw API text", !RAW_LEAK.test(value.status || ""), value.status);
  });

  await scenario("search with a spent quota", "quota", SEARCH_PROBE("jailer 2"), (value) => {
    check("search shows fallback videos", value.cards > 0, value);
    check("says it is limited", /limited today/i.test(value.status || ""), value.status);
    check("offers the personal key", /Add your key/i.test(value.action || ""), value.action);
    check("no raw API text", !RAW_LEAK.test(value.status || ""), value.status);
  });

  await scenario("invalid API key", "keyInvalid", HOME_PROBE, (value) => {
    check("catalog covers the home screen", value.cards > 0, value);
    check("explains the catalog", /built-in catalog|saved on this device/i.test(value.status || ""), value.status);
    check("no raw API text", !RAW_LEAK.test(value.status || ""), value.status);
  });

  await scenario("no network at all", "offline", HOME_PROBE, (value) => {
    check("catalog covers the home screen", value.cards > 0, value);
    check("no raw API text", !RAW_LEAK.test(value.status || ""), value.status);
  });

  await scenario("no network, searching", "offline", SEARCH_PROBE("trending music"), (value) => {
    check("catalog answers the search", value.cards > 0, value);
    check("no raw API text", !RAW_LEAK.test(value.status || ""), value.status);
  });

  // The last feed wins over the catalog, so a returning user sees their own
  // content even when nothing can be fetched.
  console.log("\nlast feed beats the catalog");
  try {
    await cdp.call("Storage.clearDataForOrigin", { origin: APP.replace(/\/$/, ""), storageTypes: "local_storage" });
    await cdp.call("Page.navigate", { url: APP });
    await sleep(2000);
    await evaluate(`localStorage.setItem("ytclone.lastFeed", JSON.stringify({
      at: Date.now(),
      label: "Popular right now",
      items: [
        { id: { videoId: "dQw4w9WgXcQ" }, snippet: { title: "Saved video one", channelTitle: "Studio" } },
        { id: { videoId: "jNQXAC9IVRw" }, snippet: { title: "Saved video two", channelTitle: "Studio" } }
      ]
    }))`);
    const injected = await cdp.call("Page.addScriptToEvaluateOnNewDocument", { source: faultScript("offline") });
    await cdp.call("Page.navigate", { url: APP });
    await sleep(2500);
    const value = await evaluate(HOME_PROBE);
    await cdp.call("Page.removeScriptToEvaluateOnNewDocument", { identifier: injected.identifier });
    check("shows the saved feed", (value.cards || 0) >= 2, value);
    check("says it is saved on the device", /saved on this device/i.test(value.status || ""), value);
    check("no raw API text", !RAW_LEAK.test(value.status || ""), value.status);
  } catch (error) {
    failures += 1;
    console.log(`  last feed threw: ${error.message}`);
  }

  cdp.close();
  child.kill();
  server.close();

  console.log(failures ? `\n${failures} scenario(s) failed.` : "\nAll resilience scenarios passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
