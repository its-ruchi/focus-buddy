(function () {
  let durationMin = 50;
  let countdownTimer = null;

  const $ = (id) => document.getElementById(id);

  function send(msg) {
    return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
  }

  function prettySite(host) {
    if (host === "instagram.com") return "Instagram";
    if (host === "linkedin.com") return "LinkedIn";
    return host;
  }

  function normalizeInput(raw) {
    let s = String(raw || "").trim().toLowerCase();
    if (!s) return "";
    s = s.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
    if (!s.includes(".")) return "";
    return s;
  }

  function sitesFromBox() {
    const seen = [];
    $("distract").value.split("\n").forEach((line) => {
      const host = normalizeInput(line);
      if (host && seen.indexOf(host) === -1) seen.push(host);
    });
    return seen;
  }

  function fillDistractBox(list) {
    const sites = (Array.isArray(list) ? list : ["instagram.com", "linkedin.com"])
      .filter((h) => h && h !== "lnkd.in");
    $("distract").value = sites.join("\n");
  }

  function blockedNote(sites) {
    const names = (sites || [])
      .filter((h) => h !== "lnkd.in")
      .map(prettySite);
    if (!names.length) return "No sites are blocked. This session is just a timer.";
    return "Blocked until the timer ends: " + names.join(", ") + ".";
  }

  function render(state) {
    $("streak").textContent = state.streak || 0;
    const running = state.active && Date.now() < state.endTime;

    if (running) {
      $("idle").classList.add("hidden");
      $("active").classList.remove("hidden");
      $("buddy").innerHTML = window.FocusBuddyCharacter.svg("wave");
      $("active-goal-text").textContent = state.goal;
      $("blocked-note").textContent = blockedNote(state.blockSites);
      startCountdown(state.endTime);
      $("notes-recap").classList.add("hidden");
    } else {
      $("active").classList.add("hidden");
      $("idle").classList.remove("hidden");
      $("buddy").innerHTML = window.FocusBuddyCharacter.svg("cheer");
      if (state.apiKey) $("key").value = state.apiKey;
      fillDistractBox(state.blockSites);
      stopCountdown();
      loadNotesRecap();
    }
  }

  function loadNotesRecap() {
    chrome.storage.local.get({ capturedNotes: [] }, (data) => {
      const notes = Array.isArray(data.capturedNotes) ? data.capturedNotes : [];
      const box = $("notes-recap");
      const list = $("notes-list");
      if (!notes.length) { box.classList.add("hidden"); return; }
      list.innerHTML = "";
      notes.forEach((n) => {
        const li = document.createElement("li");
        li.textContent = n.text; // textContent → no HTML injection from note text
        if (n.goal) {
          const g = document.createElement("span");
          g.className = "note-goal";
          g.textContent = "— " + n.goal;
          li.appendChild(g);
        }
        list.appendChild(li);
      });
      box.classList.remove("hidden");
    });
  }

  function startCountdown(endTime) {
    stopCountdown();
    const update = () => {
      const ms = endTime - Date.now();
      if (ms <= 0) {
        $("countdown").textContent = "done! 🎉";
        stopCountdown();
        setTimeout(refresh, 1200);
        return;
      }
      const s = Math.floor(ms / 1000);
      $("countdown").textContent =
        String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
    };
    update();
    countdownTimer = setInterval(update, 1000);
  }
  function stopCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = null;
  }

  async function refresh() {
    render(await send({ type: "get-state" }));
  }

  // Duration buttons
  $("durations").addEventListener("click", (e) => {
    const b = e.target.closest(".dur");
    if (!b) return;
    durationMin = parseInt(b.dataset.min, 10);
    document.querySelectorAll(".dur").forEach((d) => d.classList.remove("active"));
    b.classList.add("active");
  });

  $("start").addEventListener("click", async () => {
    const goal = $("goal").value.trim();
    const apiKey = $("key").value.trim();
    await send({
      type: "start-session",
      payload: { goal, durationMin, apiKey, blockSites: sitesFromBox() },
    });
    refresh();
  });

  $("end").addEventListener("click", async () => {
    const state = await send({ type: "get-state" });
    const timeLeft = state && state.active && state.endTime > Date.now();
    if (timeLeft && !confirm("End this session early? Your streak only counts if you finish the whole timer.")) {
      return;
    }
    await send({ type: "end-session" });
    refresh();
  });

  // Clear last-session notes
  $("notes-clear").addEventListener("click", () => {
    chrome.storage.local.set({ capturedNotes: [] }, () => {
      $("notes-recap").classList.add("hidden");
    });
  });

  refresh();
})();
