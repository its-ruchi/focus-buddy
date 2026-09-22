// ===== Focus Buddy — on-page companion + block overlay =====
(function () {
  if (window.__focusBuddyLoaded) return;
  window.__focusBuddyLoaded = true;

  let overlayHost = null;
  let companionHost = null;
  let hideTimer = null;
  let loopTimer = null;
  let countdownTimer = null;
  let dismissedForPage = false;
  let prevHtmlOverflow = "";
  let overlayVoice = null; // { audio, disarm } for the block-overlay voice clip
  let frictionHost = null;
  let frictionTimer = null;
  let frictionWaitUntil = 0;
  let frictionCleared = false;
  let frictionWaitOnly = false;
  const BOP_GOAL = 15;
  const FRICTION_WAIT_MS = 2 * 60 * 1000;

  // ---- Resilient messaging ----
  // A tab left open across an extension reload/update becomes "orphaned": this
  // old content script tries to talk to a background that no longer exists, and
  // chrome.runtime.sendMessage throws "Extension context invalidated". Every
  // message goes through here so that expected failure mode fails silently (the
  // callback gets null) instead of erroring. A page reload re-injects a fresh
  // script that reconnects cleanly.
  function safeSendMessage(msg, callback) {
    try {
      if (!chrome.runtime || !chrome.runtime.id) {
        if (callback) callback(null);
        return;
      }
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          // Extension context gone (old tab, reload, etc.) — fail silently.
          if (callback) callback(null);
          return;
        }
        if (callback) callback(response);
      });
    } catch (e) {
      // Context invalidated mid-call — same silent fallback.
      if (callback) callback(null);
    }
  }

  // How far into buddy.webm (seconds) her talking segment begins — scold.mp3 is
  // triggered here. Nudge this if her mouth and the voice don't line up.
  const TALK_SEGMENT_START = 2.5;

  // ---- Media: buddy.webm → SVG fallback ----
  // opts.muted: start muted so autoplay is always allowed (used by the
  // ambient corner buddy, which must appear without any user gesture).
  function buddyMedia(mood, opts) {
    opts = opts || {};
    const wrap = document.createElement("div");
    wrap.className = "fb-media";

    // If the extension was reloaded while this tab stayed open, this content
    // script is orphaned: chrome.runtime.getURL() below would throw
    // "Extension context invalidated". Bail to the static SVG instead of
    // spraying console errors — a page reload re-injects a fresh script.
    if (!chrome.runtime || !chrome.runtime.id) {
      wrap.innerHTML = window.FocusBuddyCharacter.svg(mood || "cheer");
      return wrap;
    }

    // voiceSrc → the video is visual-only (muted) and a separate audio clip
    // carries the sound; muted also guarantees autoplay for the corner buddy.
    const wantMuted = !!opts.muted || !!opts.voiceSrc;

    const video = document.createElement("video");
    video.className = "fb-video";
    video.autoplay = true;
    video.loop = opts.loop !== false; // block overlay passes loop:false (play once)
    video.playsInline = true;
    video.muted = wantMuted;

    const s1 = document.createElement("source");
    s1.src = chrome.runtime.getURL("buddy.webm");
    s1.type = "video/webm";
    video.appendChild(s1);
    wrap.appendChild(video);

    function armAutoUnmute() {
      const drop = (...types) => {
        for (const t of types) document.removeEventListener(t, unmute, true);
      };
      function unmute() {
        video.muted = false;
        video.play().then(() => {
          // Sound accepted — stop listening.
          drop("pointermove", "pointerdown", "keydown");
        }).catch(() => {
          // Browser refused unmuted playback (no real user activation yet — a
          // bare pointermove doesn't count). Fall back to MUTED and resume so
          // the video keeps playing instead of freezing paused. Drop the noisy
          // pointermove but stay armed for a genuine click/keypress.
          video.muted = true;
          video.play().catch(() => {});
          drop("pointermove");
          console.debug("Focus Buddy: unmute deferred — playing muted for now");
        });
      }
      document.addEventListener("pointermove", unmute, true);
      document.addEventListener("pointerdown", unmute, true);
      document.addEventListener("keydown", unmute, true);
    }

    (async () => {
      try {
        await video.play();
      } catch {
        video.muted = true;
        try {
          await video.play();
          if (!wantMuted) armAutoUnmute();
        } catch {
          wrap.innerHTML = window.FocusBuddyCharacter.svg(mood || "cheer");
        }
      }
    })();

    video.addEventListener("error", () => {
      if (video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
        wrap.innerHTML = window.FocusBuddyCharacter.svg(mood || "cheer");
      }
    });

    // ---- Synced voice clip (scold.mp3 on the block overlay) ----
    // Video stays muted; the voice plays once. Primary path attempts
    // autoplay-WITH-SOUND on a plain timer tied to her talking segment — NO
    // click required. On sites the user has already interacted with this
    // browsing session (YouTube, Gmail, etc.) the browser lets it through
    // automatically. Only if the browser genuinely blocks it do we fall back
    // to waiting for any page interaction.
    if (opts.voiceSrc) {
      const talkStart = opts.talkStart != null ? opts.talkStart : TALK_SEGMENT_START;
      let audio = null;
      try {
        // Orphaned content script (extension reloaded) → getURL throws. Skip the
        // voice rather than crash; a page reload re-injects a fresh script.
        audio = new Audio(chrome.runtime.getURL(opts.voiceSrc));
      } catch {
        audio = null;
      }

      if (audio) {
        audio.preload = "auto";
        audio.muted = false;   // start unmuted — success/failure is decided by play()
        let voiceDone = false; // played successfully — never fire again
        let armed = false;     // fallback listeners currently attached?
        let talkTimer = null;

        // Fallback only: any interaction anywhere on the page retries playback.
        // No requirement to click the buddy specifically.
        const GESTURES = ["pointermove", "pointerdown", "keydown"];

        const disarm = () => {
          if (talkTimer) { clearTimeout(talkTimer); talkTimer = null; }
          if (!armed) return;
          armed = false;
          for (const t of GESTURES) document.removeEventListener(t, onGesture, true);
        };
        const arm = () => {
          if (armed || voiceDone) return;
          armed = true;
          for (const t of GESTURES) document.addEventListener(t, onGesture, true);
        };
        function onGesture() {
          // Detach for this attempt; tryPlay re-arms if it is still blocked, so a
          // later interaction can try again instead of giving up forever.
          armed = false;
          for (const t of GESTURES) document.removeEventListener(t, onGesture, true);
          tryPlay();
        }
        function tryPlay() {
          if (voiceDone) return;
          audio.currentTime = 0;
          audio.play().then(() => {
            voiceDone = true;
            disarm();
          }).catch(() => {
            // Autoplay-with-sound was rejected (NotAllowedError) — genuinely
            // fresh site with no user activation yet. Expected, not an error;
            // wait for any interaction to retry.
            console.debug("Focus Buddy: voice autoplay blocked — waiting for interaction");
            arm();
          });
        }

        // Primary: once her talking segment begins, attempt playback directly —
        // do NOT wait for a click. A plain timer starts the moment the overlay's
        // media is created, so it fires even if the video stalls or falls back
        // to the SVG.
        talkTimer = setTimeout(tryPlay, talkStart * 1000);

        wrap.__fbVoice = { audio, disarm };
      }
    }

    return wrap;
  }

  function fmtRemaining(ms) {
    if (ms <= 0) return "00:00";
    const s = Math.floor(ms / 1000);
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  }

  // ---- Block overlay ----
  function showBlockOverlay(state) {
    hideCompanion();
    if (overlayHost) {
      overlayHost.querySelector(".fb-goal-text").textContent = state.goal || "your goal";
      overlayHost.querySelector(".fb-streak-n").textContent = state.streak || 0;
      return;
    }

    overlayHost = document.createElement("div");
    overlayHost.id = "focus-buddy-overlay";
    overlayHost.innerHTML = `
      <div class="fb-scrim"></div>
      <div class="fb-stage">
        <div class="fb-dialog" role="alertdialog" aria-labelledby="fb-ov-title">
          <div class="fb-titlebar">
            <span class="fb-title" id="fb-ov-title">focus-buddy.exe — access blocked</span>
          </div>
          <div class="fb-msg">
            <p class="fb-line">back to work you go 💪</p>
            <p class="fb-goal">you're focusing on: <b class="fb-goal-text"></b></p>
            <p class="fb-timer">—</p>
          </div>
          <div class="fb-actions">
            <button class="fb-btn fb-primary" data-act="back">← back to work</button>
            <button class="fb-btn" data-act="allow">I need this site</button>
            <button class="fb-btn" data-act="notes">📝 notes</button>
            <button class="fb-btn" data-act="end">end session early</button>
          </div>
          <div class="fb-allow" hidden>
            <p class="fb-allow-hint">If this page is actually part of your work, save it. It stays allowed next time too.</p>
            <input class="fb-allow-input" type="text" spellcheck="false" />
            <p class="fb-allow-err" hidden></p>
            <div class="fb-notes-row">
              <button class="fb-btn fb-primary" data-act="save-allow">save &amp; open</button>
            </div>
          </div>
          <div class="fb-notes" hidden>
            <textarea class="fb-note-input" rows="3"
              placeholder="jot it down, deal with it after this session..."></textarea>
            <div class="fb-notes-row">
              <span class="fb-note-saved" hidden>saved ✓</span>
              <button class="fb-btn fb-note-save" data-act="save-note">save note</button>
            </div>
          </div>
          <p class="fb-streak">🔥 focus streak: <b class="fb-streak-n">0</b></p>
        </div>
        <div class="fb-char"></div>
      </div>`;

    prevHtmlOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.documentElement.appendChild(overlayHost);

    const charMedia = buddyMedia("stern", {
      loop: false,               // play once: arrival → talk → idle/exit, then hold last frame
      voiceSrc: "scold.mp3",
      talkStart: TALK_SEGMENT_START,
    });
    overlayHost.querySelector(".fb-char").appendChild(charMedia);
    overlayVoice = charMedia.__fbVoice || null;
    overlayHost.querySelector(".fb-goal-text").textContent = state.goal || "your goal";
    overlayHost.querySelector(".fb-streak-n").textContent = state.streak || 0;
    overlayHost.querySelector(".fb-allow-input").value =
      (location.hostname || "").replace(/^www\./, "");

    // Kick off the slide-in on the next frame so the initial transform is honored.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (overlayHost) overlayHost.classList.add("fb-in");
      });
    });

    safeSendMessage({ type: "get-line", context: "block" }, (r) => {
      if (r && r.line && overlayHost) {
        overlayHost.querySelector(".fb-line").textContent = r.line;
      }
    });

    const tick = () => {
      safeSendMessage(
        { type: "check-blocked", host: location.hostname },
        (st) => {
          if (!st || !overlayHost) return;
          if (!st.blocked) {
            removeBlockOverlay();
            return;
          }
          overlayHost.querySelector(".fb-timer").textContent =
            fmtRemaining(st.endTime - Date.now()) + " left";
          overlayHost.querySelector(".fb-streak-n").textContent = st.streak || 0;
        }
      );
    };
    tick();
    countdownTimer = setInterval(tick, 1000);

    function saveNote() {
      const input = overlayHost.querySelector(".fb-note-input");
      const text = input.value.trim();
      if (!text) return;
      const goal = overlayHost.querySelector(".fb-goal-text").textContent || "your goal";
      const note = { text, goal, timestamp: Date.now() };
      try {
        chrome.storage.local.get({ capturedNotes: [] }, (data) => {
          const list = Array.isArray(data.capturedNotes) ? data.capturedNotes : [];
          list.push(note); // append — never overwrite; supports multiple notes/session
          chrome.storage.local.set({ capturedNotes: list }, () => {
            input.value = "";
            const saved = overlayHost.querySelector(".fb-note-saved");
            saved.hidden = false;
            clearTimeout(saved.__t);
            saved.__t = setTimeout(() => { saved.hidden = true; }, 1800);
            input.focus(); // keep working — session stays active, overlay stays up
          });
        });
      } catch {} // orphaned content script (extension reloaded) — ignore
    }

    overlayHost.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      if (btn.dataset.act === "back") {
        if (history.length > 1) history.back();
        else location.href = "about:blank";
      } else if (btn.dataset.act === "end") {
        if (confirm("End your focus session early? Your streak won't count for this one.")) {
          safeSendMessage({ type: "end-session" }, () => removeBlockOverlay());
        }
      } else if (btn.dataset.act === "notes") {
        const panel = overlayHost.querySelector(".fb-notes");
        const allowPanel = overlayHost.querySelector(".fb-allow");
        panel.hidden = !panel.hidden;
        if (!panel.hidden) {
          allowPanel.hidden = true;
          overlayHost.querySelector(".fb-note-input").focus();
        }
      } else if (btn.dataset.act === "allow") {
        const panel = overlayHost.querySelector(".fb-allow");
        const notes = overlayHost.querySelector(".fb-notes");
        panel.hidden = !panel.hidden;
        if (!panel.hidden) {
          notes.hidden = true;
          const input = overlayHost.querySelector(".fb-allow-input");
          if (!input.value) input.value = (location.hostname || "").replace(/^www\./, "");
          input.focus();
          input.select();
        }
      } else if (btn.dataset.act === "save-allow") {
        const input = overlayHost.querySelector(".fb-allow-input");
        const err = overlayHost.querySelector(".fb-allow-err");
        err.hidden = true;
        safeSendMessage({ type: "add-allow", host: input.value }, (r) => {
          if (!overlayHost) return;
          if (!r || !r.ok) {
            err.textContent = (r && r.error) || "Couldn't save that site.";
            err.hidden = false;
            return;
          }
          removeBlockOverlay();
        });
      } else if (btn.dataset.act === "save-note") {
        saveNote();
      }
    });
  }

  function removeBlockOverlay() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    if (overlayVoice) {
      try { overlayVoice.audio.pause(); } catch {}
      overlayVoice.disarm();
      overlayVoice = null;
    }
    if (overlayHost && overlayHost.parentNode) {
      overlayHost.parentNode.removeChild(overlayHost);
      document.documentElement.style.overflow = prevHtmlOverflow;
    }
    overlayHost = null;
  }

  function siteLabel(host) {
    const h = (host || location.hostname || "").toLowerCase();
    if (h.includes("instagram")) return "Instagram";
    if (h.includes("linkedin")) return "LinkedIn";
    return h || "this app";
  }

  function isFrictionUnlocked() {
    return frictionCleared;
  }

  function markFrictionUnlocked() {
    frictionCleared = true;
  }

  function unlockFriction() {
    markFrictionUnlocked();
    removeFrictionOverlay();
  }

  function removeFrictionOverlay() {
    if (frictionTimer) { clearInterval(frictionTimer); frictionTimer = null; }
    if (frictionHost && frictionHost.parentNode) {
      frictionHost.parentNode.removeChild(frictionHost);
      document.documentElement.style.overflow = prevHtmlOverflow;
    }
    frictionHost = null;
    frictionWaitUntil = 0;
    frictionWaitOnly = false;
  }

  function showFrictionOverlay(host, opts) {
    opts = opts || {};
    const waitOnly = !!opts.waitOnly;
    if (!waitOnly && isFrictionUnlocked()) {
      removeFrictionOverlay();
      return;
    }
    hideCompanion();
    removeBlockOverlay();
    if (waitOnly) frictionCleared = false;
    if (frictionHost) {
      if (waitOnly && !frictionWaitOnly) {
        removeFrictionOverlay();
      } else {
        return;
      }
    }

    const name = siteLabel(host);
    frictionWaitOnly = waitOnly;
    frictionWaitUntil = Date.now() + FRICTION_WAIT_MS;
    let bops = 0;

    const line = waitOnly
      ? "you're in a focus block — " + name + " can wait"
      : "caught you opening " + name;
    const goal = waitOnly
      ? "No skipping. Sit with this for 2 minutes, then decide if you still want it."
      : "If you really want " + name + ", prove it on purpose — not by accident.";
    const bopLine = waitOnly
      ? "bops are off during focus. wait it out."
      : "bop the buddy <b>0</b> / " + BOP_GOAL + " times";
    const orLine = waitOnly ? "required wait" : "or wait it out";

    frictionHost = document.createElement("div");
    frictionHost.id = "focus-buddy-friction";
    frictionHost.innerHTML = `
      <div class="fb-scrim"></div>
      <div class="fb-stage">
        <div class="fb-dialog" role="alertdialog" aria-labelledby="fb-fr-title">
          <div class="fb-titlebar">
            <span class="fb-title" id="fb-fr-title">focus-buddy.exe — ${waitOnly ? "focus pause" : "pause first"}</span>
          </div>
          <div class="fb-msg">
            <p class="fb-line"></p>
            <p class="fb-goal"></p>
            <p class="fb-bop-count"></p>
            <p class="fb-or"></p>
            <p class="fb-timer">02:00</p>
          </div>
          <div class="fb-actions">
            <button class="fb-btn fb-primary" data-act="back">← never mind, go back</button>
          </div>
        </div>
        <button class="fb-char${waitOnly ? "" : " fb-boppable"}" type="button" aria-label="bop the buddy">
        </button>
      </div>`;

    frictionHost.querySelector(".fb-line").textContent = line;
    frictionHost.querySelector(".fb-goal").textContent = goal;
    frictionHost.querySelector(".fb-bop-count").innerHTML = bopLine;
    frictionHost.querySelector(".fb-or").textContent = orLine;

    prevHtmlOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.documentElement.appendChild(frictionHost);

    const charBtn = frictionHost.querySelector(".fb-char");
    charBtn.appendChild(buddyMedia("stern", { muted: true }));

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (frictionHost) frictionHost.classList.add("fb-in");
      });
    });

    const bopEl = frictionHost.querySelector(".fb-bop-count b");
    const timerEl = frictionHost.querySelector(".fb-timer");

    function onBop() {
      if (waitOnly || isFrictionUnlocked() || !bopEl) return;
      bops += 1;
      bopEl.textContent = String(bops);
      charBtn.classList.remove("fb-bop-hit");
      void charBtn.offsetWidth;
      charBtn.classList.add("fb-bop-hit");
      if (bops >= BOP_GOAL) unlockFriction();
    }

    if (!waitOnly) {
      charBtn.addEventListener("click", onBop);
      charBtn.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onBop();
        }
      });
    }

    const tickWait = () => {
      if (!frictionHost) return;
      const left = frictionWaitUntil - Date.now();
      if (left <= 0) {
        timerEl.textContent = "00:00";
        unlockFriction();
        return;
      }
      timerEl.textContent = fmtRemaining(left);
    };
    tickWait();
    frictionTimer = setInterval(tickWait, 250);

    frictionHost.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      if (btn.dataset.act === "back") {
        if (history.length > 1) history.back();
        else location.href = "about:blank";
      }
    });
  }

  // ---- Ambient corner companion (SVG only — quieter) ----
  function ensureCompanion() {
    if (companionHost) return companionHost;
    companionHost = document.createElement("div");
    companionHost.id = "focus-buddy-root";
    companionHost.innerHTML = `
      <div class="fb-window" role="status" aria-live="polite">
        <div class="fb-titlebar">
          <span class="fb-title">focus-buddy</span>
          <button class="fb-x" aria-label="dismiss buddy">×</button>
        </div>
        <div class="fb-body">
          <div class="fb-char"></div>
          <div class="fb-bubble"></div>
        </div>
      </div>`;
    document.documentElement.appendChild(companionHost);
    companionHost.querySelector(".fb-x").addEventListener("click", () => {
      dismissedForPage = true;
      hideCompanion();
    });
    return companionHost;
  }

  function showCompanion(mood, text) {
    if (dismissedForPage) return;
    ensureCompanion();
    const charEl = companionHost.querySelector(".fb-char");
    charEl.innerHTML = "";
    charEl.appendChild(buddyMedia(mood, { muted: true }));
    companionHost.querySelector(".fb-bubble").textContent = text;
    companionHost.classList.add("fb-visible");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideCompanion, 6500);
  }

  function hideCompanion() {
    if (companionHost) companionHost.classList.remove("fb-visible");
  }

  function requestLine(cb) {
    safeSendMessage({ type: "get-line", context: "encouragement" }, (r) => {
      cb((r && r.line) || "keep going, you've got this 🌸");
    });
  }

  // ---- React to nudges from the background (session start / complete) ----
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      // If the context is already invalid when this fires, no-op instead of
      // throwing on the sendMessage calls below.
      if (!chrome.runtime || !chrome.runtime.id) return;
      try {
        if (!msg) return;
        if (msg.type === "force-friction") {
          showFrictionOverlay(msg.host || location.hostname, { waitOnly: !!msg.waitOnly });
          return;
        }
        if (msg.type === "force-unblock") {
          removeBlockOverlay();
          return;
        }
        if (msg.type === "force-block") {
          if (frictionHost || isFrictionUnlocked()) return;
          dismissedForPage = false;
          showBlockOverlay({
            goal: msg.goal,
            endTime: msg.endTime,
            streak: msg.streak || 0,
            blocked: true,
          });
          return;
        }
        if (msg.type !== "buddy-say") return;
        // Intentionally no right-side companion cards — they were popping up
        // on every tab. Session complete still does nothing visual here.
      } catch (e) {
        // Context invalidated while handling the message — stay silent.
        console.debug("Focus Buddy: message ignored — context invalidated");
      }
    });
  } catch {}

  // ---- Decide on load ----
  safeSendMessage(
    { type: "check-blocked", host: location.hostname },
    (st) => {
      if (!st) return;
      if (st.friction) {
        showFrictionOverlay(location.hostname, { waitOnly: !!st.waitOnly });
        return;
      }
      if (st.blocked) {
        showBlockOverlay(st);
      }
    }
  );

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (!changes.alwaysOn && !changes.active && !changes.endTime && !changes.allowlist) return;
      safeSendMessage(
        { type: "check-blocked", host: location.hostname },
        (st) => {
          if (!st) return;
          if (st.friction) {
            showFrictionOverlay(location.hostname, { waitOnly: !!st.waitOnly });
            return;
          }
          removeFrictionOverlay();
          if (!st.blocked) removeBlockOverlay();
        }
      );
    });
  } catch {}
})();
