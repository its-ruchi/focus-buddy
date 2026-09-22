(function () {
  let durationMin = 50;
  let countdownTimer = null;

  const $ = (id) => document.getElementById(id);

  function send(msg) {
    return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
  }

  function render(state) {
    $("streak").textContent = state.streak || 0;
    $("always-on").checked = state.alwaysOn !== false;
    const running = state.active && Date.now() < state.endTime;

    if (running) {
      $("idle").classList.add("hidden");
      $("active").classList.remove("hidden");
      $("buddy").innerHTML = window.FocusBuddyCharacter.svg("wave");
      $("active-goal-text").textContent = state.goal;
      startCountdown(state.endTime);
      $("notes-recap").classList.add("hidden");
      renderAllowLive(state.allowlist || []);
      prefillCurrentTab();
    } else {
      $("active").classList.add("hidden");
      $("idle").classList.remove("hidden");
      $("buddy").innerHTML = window.FocusBuddyCharacter.svg("cheer");
      // prefill allowlist from saved state
      $("allow").value = (state.allowlist || ["localhost", "127.0.0.1", "youtube.com", "claude.ai"]).join("\n");
      if (state.apiKey) $("key").value = state.apiKey;
      stopCountdown();
      loadNotesRecap();
    }
  }

  function renderAllowLive(list) {
    const ul = $("allow-live");
    ul.innerHTML = "";
    (list || []).forEach((site) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = site;
      const rm = document.createElement("button");
      rm.type = "button";
      rm.textContent = "remove";
      rm.addEventListener("click", async () => {
        await send({ type: "remove-allow", host: site });
        refresh();
      });
      li.appendChild(name);
      li.appendChild(rm);
      ul.appendChild(li);
    });
  }

  function showAddMsg(text, isErr) {
    const el = $("add-site-msg");
    el.hidden = !text;
    el.textContent = text || "";
    el.classList.toggle("err", !!isErr);
  }

  async function allowHost(raw) {
    const r = await send({ type: "add-allow", host: raw });
    if (!r || !r.ok) {
      showAddMsg((r && r.error) || "Couldn't save that site.", true);
      return;
    }
    showAddMsg(
      r.already ? r.host + " was already allowed." : r.host + " saved. You can open it now.",
      false
    );
    $("add-site").value = "";
    refresh();
  }

  function prefillCurrentTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs && tabs[0] && tabs[0].url;
      if (!url) return;
      try {
        const host = new URL(url).hostname.replace(/^www\./, "");
        if (host && !$("add-site").value) $("add-site").value = host;
      } catch {}
    });
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

  $("always-on").addEventListener("change", async (e) => {
    await send({ type: "set-always-on", value: e.target.checked });
  });

  $("add-site-btn").addEventListener("click", () => {
    allowHost($("add-site").value);
  });
  $("add-site").addEventListener("keydown", (e) => {
    if (e.key === "Enter") allowHost($("add-site").value);
  });
  $("allow-current").addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs && tabs[0] && tabs[0].url;
      if (!url) {
        showAddMsg("Couldn't read this tab.", true);
        return;
      }
      try {
        allowHost(new URL(url).hostname);
      } catch {
        showAddMsg("This tab isn't a normal website.", true);
      }
    });
  });

  // Start
  $("start").addEventListener("click", async () => {
    const goal = $("goal").value.trim();
    const allowlist = $("allow").value
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const apiKey = $("key").value.trim();
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
