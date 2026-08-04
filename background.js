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
function hostAllowed(host, allowlist) {
  host = (host || "").toLowerCase();
  return allowlist.some((entry) => {
    entry = entry.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!entry) return false;
    return host === entry || host.endsWith("." + entry);
  });
}

// ---- Force-block: check active tabs whenever they change ----
async function isBlocked(url) {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  const st = await getState();
  if (!st.active || Date.now() >= st.endTime) return false;
  let host;
  try { host = new URL(url).hostname; } catch { return false; }
  return !hostAllowed(host, st.allowlist);
}

async function forceBlockTab(tabId) {
  const st = await getState();
  const payload = {
    type: "force-block",
    goal: st.goal,
    endTime: st.endTime,
    streak: st.streak || 0,
  };
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
  if (await isBlocked(url)) forceBlockTab(tabId);
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

// ---- Session lifecycle ----
async function startSession({ goal, durationMin, allowlist, apiKey }) {
  const endTime = Date.now() + durationMin * 60 * 1000;
  await setState({
    active: true,
    goal: goal || "your focus goal",
    durationMin,
    endTime,
    allowlist: allowlist && allowlist.length ? allowlist : DEFAULTS.allowlist,
    apiKey: apiKey || "",
  });
  aiPool = { encouragement: [], block: [], complete: [] };
  chrome.alarms.create("sessionEnd", { when: endTime });
  chrome.alarms.create("refillLines", { periodInMinutes: 4 });
  refillLines(); // kick off immediately if a key exists
  greetActiveTab();
}

async function endSession(completed) {
  const st = await getState();
  const patch = { active: false, endTime: 0 };
  if (completed) {
    patch.streak = (st.streak || 0) + 1;
    patch.lastCompletedGoal = st.goal;
  }
  await setState(patch);
  chrome.alarms.clear("sessionEnd");
  chrome.alarms.clear("refillLines");
  aiPool = { encouragement: [], block: [], complete: [] };
  if (completed) celebrateActiveTab();
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
    } else if (msg.type === "get-line") {
      sendResponse({ line: getLine(msg.context) });
    } else if (msg.type === "check-blocked") {
      const st = await getState();
      const active = st.active && Date.now() < st.endTime;
      const blocked = active && !hostAllowed(msg.host || "", st.allowlist);
      sendResponse({
        blocked,
        active,
        goal: st.goal,
        endTime: st.endTime,
        streak: st.streak || 0,
        allowlist: st.allowlist,
      });
    }
  })();
  return true; // async response
});
