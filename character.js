// Focus Buddy character — a cute pixel-ish blob drawn in SVG.
// Exposes window.FocusBuddyCharacter.svg(mood) → string.
// Moods: "cheer" | "stern" | "proud" | "wave"
(function () {
  function svg(mood) {
    mood = mood || "cheer";

    // Mouth + brows per mood
    let brows = "";
    let mouth = "";
    let leftArm = '<rect x="12" y="60" width="10" height="20" rx="5" transform="rotate(18 17 70)" fill="#FF8FC7" stroke="#C0367F" stroke-width="3"/>';
    let rightArm = '<rect x="78" y="60" width="10" height="20" rx="5" transform="rotate(-18 83 70)" fill="#FF8FC7" stroke="#C0367F" stroke-width="3"/>';

    if (mood === "stern") {
      brows =
        '<rect x="30" y="30" width="16" height="4" rx="2" transform="rotate(12 38 32)" fill="#2A1B3D"/>' +
        '<rect x="54" y="30" width="16" height="4" rx="2" transform="rotate(-12 62 32)" fill="#2A1B3D"/>';
      mouth = '<path d="M40 66 Q50 60 60 66" stroke="#2A1B3D" stroke-width="4" fill="none" stroke-linecap="round"/>';
      // one arm pointing away ("go!")
      rightArm =
        '<rect x="80" y="52" width="10" height="24" rx="5" transform="rotate(-55 85 64)" fill="#FF8FC7" stroke="#C0367F" stroke-width="3"/>';
    } else if (mood === "proud") {
      mouth =
        '<path d="M36 60 Q50 78 64 60 Z" fill="#7A1F52" stroke="#2A1B3D" stroke-width="2"/>' +
        '<path d="M42 66 Q50 72 58 66" fill="#FF5FA2"/>';
      // both arms up
      leftArm = '<rect x="10" y="46" width="10" height="24" rx="5" transform="rotate(35 15 58)" fill="#FF8FC7" stroke="#C0367F" stroke-width="3"/>';
      rightArm = '<rect x="80" y="46" width="10" height="24" rx="5" transform="rotate(-35 85 58)" fill="#FF8FC7" stroke="#C0367F" stroke-width="3"/>';
    } else if (mood === "wave") {
      mouth = '<path d="M38 62 Q50 74 62 62" stroke="#2A1B3D" stroke-width="4" fill="none" stroke-linecap="round"/>';
      rightArm =
        '<g class="fb-wave-arm"><rect x="80" y="42" width="10" height="24" rx="5" transform="rotate(-25 85 54)" fill="#FF8FC7" stroke="#C0367F" stroke-width="3"/></g>';
    } else {
      // cheer (default)
      mouth = '<path d="M38 62 Q50 74 62 62" stroke="#2A1B3D" stroke-width="4" fill="none" stroke-linecap="round"/>';
    }

    return (
      '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="fb-svg" aria-hidden="true">' +
      leftArm +
      rightArm +
      // body
      '<path d="M50 12 C74 12 86 30 86 54 C86 78 72 90 50 90 C28 90 14 78 14 54 C14 30 26 12 50 12 Z" fill="#FF8FC7" stroke="#C0367F" stroke-width="3"/>' +
      // little antenna
      '<line x1="50" y1="12" x2="50" y2="4" stroke="#C0367F" stroke-width="3"/>' +
      '<circle cx="50" cy="3" r="3" fill="#FFE04D" stroke="#C0367F" stroke-width="2"/>' +
      brows +
      // eyes
      '<ellipse cx="38" cy="44" rx="8" ry="9" fill="#fff" stroke="#2A1B3D" stroke-width="2"/>' +
      '<ellipse cx="62" cy="44" rx="8" ry="9" fill="#fff" stroke="#2A1B3D" stroke-width="2"/>' +
      '<circle cx="39" cy="46" r="3.5" fill="#2A1B3D"/>' +
      '<circle cx="63" cy="46" r="3.5" fill="#2A1B3D"/>' +
      '<circle cx="40.5" cy="44.5" r="1.2" fill="#fff"/>' +
      '<circle cx="64.5" cy="44.5" r="1.2" fill="#fff"/>' +
      // blush
      '<ellipse cx="28" cy="56" rx="6" ry="4" fill="#FF5FA2" opacity="0.55"/>' +
      '<ellipse cx="72" cy="56" rx="6" ry="4" fill="#FF5FA2" opacity="0.55"/>' +
      mouth +
      "</svg>"
    );
  }

  const api = { svg };
  if (typeof window !== "undefined") window.FocusBuddyCharacter = api;
  if (typeof self !== "undefined") self.FocusBuddyCharacter = api;
})();
