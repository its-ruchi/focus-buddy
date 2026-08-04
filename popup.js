(function () {
  let durationMin = 50;
  let countdownTimer = null;

  const $ = (id) => document.getElementById(id);

  function send(msg) {
    return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
  }

  function render(state) {
    $("streak").textContent = state.streak || 0;
    const running = state.active && Date.now() < state.endTime;

    if (running) {
      $("idle").classList.add("hidden");
      $("active").classList.remove("hidden");
      $("buddy").innerHTML = window.FocusBuddyCharacter.svg("wave");
      $("active-goal-text").textContent = state.goal;
      startCountdown(state.endTime);
      $("notes-recap").classList.add("hidden");
    } else {
      $("active").classList.add("hidden");
      $("idle").classList.remove("hidden");
      $("buddy").innerHTML = window.FocusBuddyCharacter.svg("cheer");
      // prefill allowlist from saved state
      $("allow").value = (state.allowlist || ["localhost", "127.0.0.1", "youtube.com", "claude.ai"]).join("\n");
      // API key UI removed
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
    if ($("custom-dur")) $("custom-dur").value = "";
  });

  if ($("custom-dur")) {
    $("custom-dur").addEventListener("input", (e) => {
      const val = parseInt(e.target.value, 10);
      if (val > 0) {
        durationMin = val;
        document.querySelectorAll(".dur").forEach((d) => d.classList.remove("active"));
      }
    });
  }

  // Start
  $("start").addEventListener("click", async () => {
    const goal = $("goal").value.trim();
    const allowlist = $("allow").value
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const apiKey = "";
    await send({
      type: "start-session",
      payload: { goal, durationMin, allowlist, apiKey },
    });
    refresh();
  });

  // End
  $("end").addEventListener("click", async () => {
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
