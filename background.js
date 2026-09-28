// ===== Focus Buddy — background service worker =====

const DEFAULTS = {
  active: false,
  goal: "",
  endTime: 0,
  durationMin: 25,
  allowlist: ["localhost", "127.0.0.1", "youtube.com", "claude.ai"],
  streak: 0,
  apiKey: "",
  lastCompletedGoal: "",
  alwaysOn: false,
  blockSites: ["instagram.com", "linkedin.com"],
  frictionSites: ["instagram.com", "linkedin.com"],
};

// ---- Static line bank (works with zero setup) ----
const LINES = {
  encouragement: [
    "eyes on the prize, bestie 👀",
    "you're SO locked in right now",
    "future you is already proud",
    "one task. one tab. you got this.",
    "look at you, actually focusing 🥹",
    "keep going — momentum is real",
    "brain: engaged. vibes: immaculate.",
    "don't stop, you're in the zone",
  ],
  block: [
    "nope! back to work you go 💪",
    "not today, distraction. shoo.",
    "you literally said you're focusing rn",
    "this can wait. your goal can't.",
    "caught you! go back, you're doing great",
    "denied 🚫 (with love)",
    "we don't scroll during focus hours",
    "go be productive, i believe in you",
  ],
  complete: [
    "SESSION DONE. you ate that up 🎉",
    "streak secured. iconic behavior.",
    "told you you could do it 😤",
    "proud of you, seriously. go rest.",
    "another one in the books ✅",
  ],
};

// AI-generated pool (filled only if an API key is set)
let aiPool = { encouragement: [], block: [], complete: [] };

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getLine(context) {
  const ctx = LINES[context] ? context : "encouragement";
  const pool = aiPool[ctx];
  if (pool && pool.length) {
    // consume from the fresh AI pool first
    return pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
  }
  return pick(LINES[ctx]);
}

// ---- Storage helpers ----
async function getState() {
  const s = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...s };
}
async function setState(patch) {
  await chrome.storage.local.set(patch);
}

// ---- Allowlist matching ----
function hostMatchesList(host, list) {
  host = (host || "").toLowerCase();
  return (list || []).some((entry) => {
    entry = String(entry || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "");
    if (!entry) return false;
    return host === entry || host.endsWith("." + entry);
  });
}

function hostAllowed(host, allowlist) {
  return hostMatchesList(host, allowlist);
}

function siteLabel(host) {
  const h = normalizeHost(host);
  if (h.includes("instagram")) return "Instagram";
  if (h.includes("linkedin") || h === "lnkd.in") return "LinkedIn";
  return h || "this site";
}

function chosenBlockSites(list) {
  const out = [];
  for (const raw of list || []) {
    const host = normalizeHost(raw);
    if (!host || !host.includes(".") || out.includes(host)) continue;
    out.push(host);
  }
  return out.slice(0, 20);
}

function expandBlockSites(list) {
  const out = chosenBlockSites(list);
  if (out.some((h) => h === "linkedin.com" || h.endsWith(".linkedin.com")) && !out.includes("lnkd.in")) {
    out.push("lnkd.in");
  }
  return out;
}

function isSessionBlockHost(host, st) {
  return hostMatchesList(host, expandBlockSites(st && st.blockSites));
}

function sessionIsOn(st) {
  return !!(st && st.active && Date.now() < st.endTime);
}

async function setDistractionRules(on, goal) {
  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existing.map((r) => r.id);
    if (removeRuleIds.length) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds });
    }
    if (!on) return;
    const st = await getState();
    const sites = expandBlockSites(st.blockSites);
    if (!sites.length) return;
    const q = "goal=" + encodeURIComponent(goal || st.goal || "your focus goal");
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: sites.map((domain, i) => ({
        id: i + 1,
        priority: 1,
        action: {
          type: "redirect",
          redirect: {
            extensionPath:
              "/blocked.html?from=" + encodeURIComponent(siteLabel(domain)) + "&" + q,
          },
        },
        condition: {
          requestDomains: [domain],
          resourceTypes: ["main_frame"],
        },
      })),
    });
  } catch (e) {
    console.debug("Focus Buddy: block rules skipped —", e && e.message);
  }
}

async function reloadDistractionTabs() {
  try {
    const st = await getState();
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      const h = hostFromUrl(tab.url);
      if (tab.id && isSessionBlockHost(h, st)) {
        chrome.tabs.reload(tab.id);
      }
    }
  } catch {}
}

function normalizeHost(raw) {
  let s = String(raw || "").trim().toLowerCase();
  if (!s) return "";
  if (!/^https?:\/\//.test(s)) s = "https://" + s;
  try {
    return new URL(s).hostname.replace(/^www\./, "");
  } catch {
    return String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/^www\./, "");
  }
}

async function liftBlockOnHost(host) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      const h = hostFromUrl(tab.url);
      if (tab.id && h && (h === host || h.endsWith("." + host))) {
        sendToTab(tab.id, { type: "force-unblock" });
      }
    }
  } catch {}
}

async function addToAllowlist(raw) {
  const host = normalizeHost(raw);
  if (!host) return { ok: false, error: "Type a site like github.com" };
  const st = await getState();
  if (isSessionBlockHost(host, st)) {
    return {
      ok: false,
      error: "Instagram and LinkedIn stay blocked during a focus session. They can't be allowlisted.",
    };
  }
  const allowlist = Array.isArray(st.allowlist) ? st.allowlist.slice() : [];
  if (hostAllowed(host, allowlist)) {
    await liftBlockOnHost(host);
    return { ok: true, host, allowlist, already: true };
  }
  allowlist.push(host);
  await setState({ allowlist });
  await liftBlockOnHost(host);
  return { ok: true, host, allowlist, already: false };
}

async function removeFromAllowlist(raw) {
  const host = normalizeHost(raw);
  if (!host) return { ok: false, error: "Missing site" };
  const st = await getState();
  const allowlist = (st.allowlist || []).filter((entry) => normalizeHost(entry) !== host);
  await setState({ allowlist });
  return { ok: true, host, allowlist };
}

// ---- Force-block: check active tabs whenever they change ----
function hostFromUrl(url) {
  if (!url || !/^https?:\/\//i.test(url)) return "";
  try { return new URL(url).hostname; } catch { return ""; }
}

async function classifyUrl(url) {
  const host = hostFromUrl(url);
  if (!host) return { friction: false, blocked: false, host: "" };
  const st = await getState();
  const sessionOn = sessionIsOn(st);
  const blocked = sessionOn && isSessionBlockHost(host, st);
  return { friction: false, blocked, host, st, sessionOn };
}

async function sendToTab(tabId, payload) {
  try {
    await chrome.tabs.sendMessage(tabId, payload);
  } catch {
    // content script isn't loaded (tab predates the extension, or WAR page) — inject it.
    try {
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ["companion.css"],
      });
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["character.js", "content.js"],
      });
      await chrome.tabs.sendMessage(tabId, payload);
    } catch {}
  }
}

async function maybeBlockTab(tabId, url) {
  const kind = await classifyUrl(url);
  if (kind.friction) {
    await sendToTab(tabId, {
      type: "force-friction",
      host: kind.host,
      waitOnly: !!kind.sessionOn,
      goal: kind.st && kind.st.goal,
    });
    return;
  }
  if (kind.blocked) {
    const st = kind.st;
    await sendToTab(tabId, {
      type: "force-block",
      goal: st.goal,
      endTime: st.endTime,
      streak: st.streak || 0,
      locked: true,
    });
  }
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    maybeBlockTab(tabId, tab.url);
  } catch {}
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.status === "complete") {
    maybeBlockTab(tabId, tab.url);
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab && tab.id) maybeBlockTab(tab.id, tab.url);
  } catch {}
});

async function scanOpenTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) maybeBlockTab(tab.id, tab.url);
    }
  } catch {}
}

async function reconcileSession() {
  const st = await getState();
  if (st.alwaysOn) await setState({ alwaysOn: false });
  if (st.active && Date.now() >= st.endTime) {
    await endSession(true);
    return;
  }
  const on = sessionIsOn(st);
  await setDistractionRules(on, st.goal);
  if (on) await reloadDistractionTabs();
  await scanOpenTabs();
}

chrome.runtime.onInstalled.addListener(() => {
  reconcileSession();
});
chrome.runtime.onStartup.addListener(() => {
  reconcileSession();
});

// ---- Session lifecycle ----
async function startSession({ goal, durationMin, apiKey, blockSites }) {
  const minutes = Math.max(1, Number(durationMin) || 25);
  const startedAt = Date.now();
  const endTime = startedAt + minutes * 60 * 1000;
  const sites = chosenBlockSites(Array.isArray(blockSites) ? blockSites : DEFAULTS.blockSites);
  await setState({
    active: true,
    goal: goal || "your focus goal",
    durationMin: minutes,
    startedAt,
    endTime,
    apiKey: apiKey || "",
    blockSites: sites,
    alwaysOn: false,
  });
  aiPool = { encouragement: [], block: [], complete: [] };
  await setDistractionRules(true, goal || "your focus goal");
  chrome.alarms.create("sessionEnd", { when: endTime });
  chrome.alarms.create("refillLines", { periodInMinutes: 4 });
  refillLines(); // kick off immediately if a key exists
  await reloadDistractionTabs();
  await scanOpenTabs();
}

let endingSession = false;

async function endSession(completed) {
  if (endingSession) return;
  endingSession = true;
  try {
    const st = await getState();
    if (!st.active) return;
    await chrome.alarms.clear("sessionEnd");
    const plannedMs = Math.max(1, Number(st.durationMin) || 0) * 60 * 1000;
    const startedAt = st.startedAt || (st.endTime ? st.endTime - plannedMs : 0);
    const elapsed = startedAt ? Date.now() - startedAt : 0;
    const finishedWholeSession = elapsed + 2000 >= plannedMs;
    const patch = { active: false, endTime: 0 };
    if (finishedWholeSession) {
      patch.streak = (st.streak || 0) + 1;
      patch.lastCompletedGoal = st.goal;
    }
    await setState(patch);
    await setDistractionRules(false);
    chrome.alarms.clear("refillLines");
    aiPool = { encouragement: [], block: [], complete: [] };
    await scanOpenTabs();
  } finally {
    endingSession = false;
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "sessionEnd") endSession(true);
  if (alarm.name === "refillLines") refillLines();
});

// ---- Tell the on-page companion to show up ----
async function messageActiveTab(payload) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
  } catch {}
}
function greetActiveTab() {
  messageActiveTab({ type: "buddy-say", mood: "wave", text: "let's focus! 🌸" });
}
function celebrateActiveTab() {
  messageActiveTab({ type: "buddy-say", mood: "proud", text: getLine("complete") });
}

// ---- Optional: fresh, goal-aware lines from Claude Fable 5 ----
async function refillLines() {
  const st = await getState();
  if (!st.active || !st.apiKey) return;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": st.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-fable-5",
        max_tokens: 400,
        system:
          "You are a cute desktop mascot for a focus app. Reply ONLY with JSON: " +
          '{"encouragement":[6 strings],"block":[6 strings],"complete":[3 strings]}. ' +
          "Each line under 12 words, lowercase, playful, warm, a little cheeky. " +
          "encouragement = cheering them on. block = playfully telling them to get back to work. " +
          "complete = celebrating a finished session. No emojis-only lines; occasional emoji is fine.",
        messages: [
          {
            role: "user",
            content: "The focus goal is: " + (st.goal || "getting work done"),
          },
        ],
      }),
    });
    const data = await res.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .replace(/```json|```/g, "")
      .trim();
    const parsed = JSON.parse(text);
    for (const k of ["encouragement", "block", "complete"]) {
      if (Array.isArray(parsed[k])) aiPool[k] = aiPool[k].concat(parsed[k]);
    }
  } catch (e) {
    // Silent fallback: static lines keep working.
    console.debug("Focus Buddy: line refill skipped —", e.message);
  }
}

// ---- Message router (popup, content, blocked page) ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === "get-state") {
      sendResponse(await getState());
    } else if (msg.type === "start-session") {
      await startSession(msg.payload);
      sendResponse({ ok: true });
    } else if (msg.type === "end-session") {
      await endSession(false);
      sendResponse({ ok: true });
    } else if (msg.type === "set-always-on") {
      await setState({ alwaysOn: !!msg.value });
      if (msg.value) await scanOpenTabs();
      sendResponse({ ok: true, alwaysOn: !!msg.value });
    } else if (msg.type === "add-allow") {
      sendResponse(await addToAllowlist(msg.host || msg.raw || ""));
    } else if (msg.type === "remove-allow") {
      sendResponse(await removeFromAllowlist(msg.host || msg.raw || ""));
    } else if (msg.type === "get-line") {
      sendResponse({ line: getLine(msg.context) });
    } else if (msg.type === "check-blocked") {
      const st = await getState();
      const active = sessionIsOn(st);
      const blocked = active && isSessionBlockHost(msg.host || "", st);
      sendResponse({
        blocked,
        locked: blocked,
        friction: false,
        waitOnly: false,
        alwaysOn: false,
        active,
        goal: st.goal,
        endTime: st.endTime,
        streak: st.streak || 0,
        allowlist: st.allowlist,
        blockSites: st.blockSites || [],
        frictionSites: st.frictionSites,
      });
    }
  })();
  return true; // async response
});
