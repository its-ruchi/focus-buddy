# Senior Rebuild Prompt: Focus Buddy Chrome Extension

Build a Manifest V3 Chrome extension called **Focus Buddy**. It should be a cute, strict focus-session blocker with a retro desktop-buddy aesthetic. The extension must work without a backend or build step: plain HTML, CSS, and JavaScript files only.

## Core Product

Create a browser extension that lets the user start a timed focus session with:

- A text goal, such as "finish assignment" or "learn Next.js server actions".
- Duration presets: 25 minutes, 50 minutes, and 90 minutes, with 50 minutes selected by default.
- A user-editable allowlist of websites that are permitted during focus mode.
- An optional Anthropic API key field for generating fresh, goal-aware motivational lines.
- A visible focus streak count.
- A small animated/cute buddy mascot that encourages the user while they work and scolds them when they open blocked sites.

During an active session, any `http` or `https` page whose hostname is not on the allowlist must be blocked. Do not merely redirect the tab; inject a full-page overlay into the current page so the user sees the blocked state immediately. The overlay must prevent scrolling, show the user goal, show a live countdown, show the current streak, and offer:

- "Back to work" button, which calls `history.back()` or navigates to `about:blank` if there is no previous page.
- "Notes" button, which opens a textarea for capturing distracting thoughts. Saved notes must be appended to `chrome.storage.local.capturedNotes` and shown later in the popup.
- "End session early" button, with confirmation. Ending early should not increment the streak.

When a session naturally completes, increment the streak and store the completed goal.

## Files to Create

Create this structure:

```text
focus-buddy/
  manifest.json
  background.js
  content.js
  character.js
  companion.css
  popup.html
  popup.css
  popup.js
  blocked.html
  blocked.css
  blocked.js
  buddy.webm
  scold.mp3
  icons/
    icon16.png
    icon48.png
    icon128.png
```

## Manifest

Use Manifest V3.

Required permissions:

- `storage`
- `webNavigation`
- `tabs`
- `alarms`
- `scripting`

Host permissions:

- `<all_urls>`

Use `background.js` as the service worker. Use `popup.html` as the action popup. Register a content script on `<all_urls>` at `document_idle` that loads `character.js`, then `content.js`, and injects `companion.css`. Expose `blocked.html`, `character.js`, `buddy.webm`, and `scold.mp3` as web-accessible resources for all URLs.

## State Model

Store all session state in `chrome.storage.local`.

Defaults:

```js
{
  active: false,
  goal: "",
  endTime: 0,
  durationMin: 25,
  allowlist: ["localhost", "127.0.0.1", "youtube.com", "claude.ai"],
  streak: 0,
  apiKey: "",
  lastCompletedGoal: ""
}
```

Also store captured notes as:

```js
capturedNotes: [
  { text: string, goal: string, timestamp: number }
]
```

## Blocking Rules

Only block `http` and `https` URLs. Allow other schemes.

Normalize allowlist entries by:

- lowercasing,
- trimming whitespace,
- removing `http://` or `https://`,
- removing path portions after the hostname.

A host is allowed when it exactly equals an allowlist entry or is a subdomain of one. For example, `mail.google.com` should match `google.com`.

The background worker should enforce blocking on:

- tab activation,
- tab URL update,
- completed tab load,
- browser window focus change.

If a content script is not already available in the tab, inject `companion.css`, `character.js`, and `content.js` using `chrome.scripting`, then send the force-block message.

## Background Worker Behavior

Implement:

- Static fallback line banks for `encouragement`, `block`, and `complete`.
- `get-state`, `start-session`, `end-session`, `get-line`, and `check-blocked` message handlers.
- `start-session`: set state, calculate `endTime`, create a `sessionEnd` alarm, create a `refillLines` alarm every 4 minutes, clear AI line pools, optionally refill AI lines, and greet the active tab.
- `end-session(completed)`: clear active state and alarms. If completed, increment streak and save `lastCompletedGoal`.
- `sessionEnd` alarm should call `endSession(true)`.
- `refillLines` alarm should generate more AI lines if an API key is present.

For optional AI lines, call the Anthropic Messages API directly from the extension background worker using:

- endpoint: `https://api.anthropic.com/v1/messages`
- model: `claude-fable-5`
- `anthropic-version: 2023-06-01`
- `anthropic-dangerous-direct-browser-access: true`

Prompt the model to return JSON only:

```json
{
  "encouragement": ["6 short strings"],
  "block": ["6 short strings"],
  "complete": ["3 short strings"]
}
```

Each line should be under 12 words, lowercase, playful, warm, and a little cheeky. If anything fails, silently fall back to the static line banks.

## Content Script Behavior

The content script is responsible for two UI systems:

1. A small corner companion.
2. A full-page blocking overlay.

Guard against duplicate injection with `window.__focusBuddyLoaded`.

All runtime messaging must go through a safe wrapper that catches invalidated extension contexts. If `chrome.runtime` is unavailable or `chrome.runtime.lastError` occurs, fail silently.

On page load:

- Send `check-blocked` with `location.hostname`.
- If blocked, show the block overlay.
- If not blocked, show the corner buddy with an encouragement line.
- If a session is active and the current host is allowed, schedule encouragement popups every random 90 to 180 seconds.

Respond to background messages:

- `force-block`: show the block overlay.
- `buddy-say`: show a companion message unless the current page is blocked.

## Buddy Media

Use `buddy.webm` as the visual mascot video. It should be a cute walking/talking girl or pixel-art style buddy animation with transparent or visually removable background. The original asset can be created with tools such as Veo, ChatGPT, Claude, pixel-art tools, animation tools, a walking-girl animation workflow, and background-removal tooling.

Important behavior:

- The small corner buddy should use `buddy.webm` muted so autoplay works.
- The block overlay should show a large version of `buddy.webm`, not looped, sliding in from the right.
- Use a separate `scold.mp3` voice clip for the blocked overlay because background removal may remove the original video audio.
- Trigger `scold.mp3` about 2.5 seconds after the overlay media is created so it lines up with the talking segment of the video.
- Attempt autoplay with sound first. If the browser blocks audio, wait for any page interaction such as pointer movement, pointer down, or keydown, then retry.
- If video playback fails or the extension context is stale, fall back to an inline SVG mascot.

## Character Fallback

Create `character.js` exposing:

```js
window.FocusBuddyCharacter.svg(mood)
```

Supported moods:

- `cheer`
- `stern`
- `proud`
- `wave`

The SVG should be a cute pink pixel-ish blob mascot with eyes, blush, antenna, arms, and mood-specific mouth/eyebrows/arm pose. The wave mood should include a waving arm that CSS can animate.

## Popup UI

The popup should be about 288px wide with a retro Windows/Tahoma look.

Idle view:

- Titlebar with "focus-buddy" and streak.
- Mascot SVG.
- Notes recap from the last session, if any, with a clear button.
- Goal input.
- Duration buttons.
- Collapsible "allowed sites & options".
- Allowlist textarea.
- Optional Claude API key password input.
- Start button.

Active view:

- Mascot SVG.
- Current goal.
- Live countdown.
- End session button.

Use `textContent` when rendering user notes to avoid HTML injection.

## Overlay UI

The injected overlay should:

- Use maximum z-index.
- Freeze document scrolling while active, then restore it when removed.
- Add a teal blurred scrim with soft pink/yellow radial highlights.
- Place a retro dialog panel on the left and the large buddy video on the right.
- Slide the buddy in from off-screen right.
- Stack the dialog above the character on narrow screens.
- Respect `prefers-reduced-motion`.

Dialog content:

- Title: `focus-buddy.exe - access blocked`
- Random block line.
- `you're focusing on: <goal>`
- Live countdown.
- Buttons: back to work, notes, end session early.
- Notes textarea and save button when notes panel is open.
- Streak line.

## Alternate Block Page

Also create `blocked.html`, `blocked.css`, and `blocked.js` as a standalone fallback page. It should use the same retro style, static stern SVG mascot, random block line, goal/from query params, live countdown, back button, end-session button, and streak display. The current main enforcement path may use the injected overlay, but keep this page available as a fallback resource.

## Visual Style

Use:

- Tahoma / Segoe UI / Verdana.
- Retro desktop-window titlebars.
- Pink gradient titlebars using `#c0367f` and `#ff5fa2`.
- Dark purple text/borders `#2a1b3d`.
- Light gray/lavender panel backgrounds `#dcd7e3` and `#efecf4`.
- Teal blocked-page background/scrim `#0f8a8a`.
- Chunky borders and hard offset shadows.
- Rounded corners around 4-8px.

## Acceptance Criteria

- Loading the unpacked extension shows the popup.
- Starting a session stores state and changes the popup into active countdown mode.
- Allowed sites remain usable.
- Disallowed sites get the injected overlay.
- The overlay countdown updates every second.
- The "back to work" button leaves the distracting page.
- Notes can be saved from the overlay and later appear in the popup recap.
- Ending early clears the session without incrementing streak.
- Natural completion increments streak.
- The buddy appears on allowed pages during a session with encouragement every 90-180 seconds.
- The block overlay plays the buddy video and attempts the scold voice around 2.5 seconds after appearing.
- If media or extension context fails, the app degrades gracefully to the SVG buddy and static line bank.
