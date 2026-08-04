(function () {
  const params = new URLSearchParams(location.search);
  const goal = params.get("goal") || "your focus goal";
  const from = params.get("from") || "a distraction";

  document.getElementById("goal").textContent = goal;
  document.getElementById("from").textContent = from;
  document.getElementById("char").innerHTML = window.FocusBuddyCharacter.svg("stern");

  // Buddy line
  chrome.runtime.sendMessage({ type: "get-line", context: "block" }, (r) => {
    if (r && r.line) document.getElementById("line").textContent = r.line;
  });

  // Streak + live countdown
  function fmt(ms) {
    if (ms <= 0) return "session complete 🎉";
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return String(m).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0") + " left";
  }
  function tick() {
    chrome.runtime.sendMessage({ type: "get-state" }, (st) => {
      if (!st) return;
      document.getElementById("streak").textContent = st.streak || 0;
      const remaining = st.active ? st.endTime - Date.now() : 0;
      document.getElementById("timer").textContent = fmt(remaining);
      if (!st.active || remaining <= 0) {
        document.getElementById("line").textContent = "session's over — you did it! 🎉";
        document.getElementById("char").innerHTML = window.FocusBuddyCharacter.svg("proud");
      }
    });
  }
  tick();
  setInterval(tick, 1000);

  document.getElementById("back").addEventListener("click", () => {
    if (history.length > 1) history.back();
    else location.href = "about:blank";
  });

  document.getElementById("end").addEventListener("click", () => {
    if (confirm("End your focus session early? Your streak won't count for this one.")) {
      chrome.runtime.sendMessage({ type: "end-session" }, () => {
        location.href = "about:blank";
      });
    }
  });
})();
