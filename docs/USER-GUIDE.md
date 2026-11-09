# Mitch user guide

## Portable build
1. Extract the entire portable ZIP into a folder on your PC.
2. Open "Mitch.exe". Keep the other files next to it.
3. Open Settings and enter your own OpenAI API key, then Save settings.
   Your normal ChatGPT or Pixie subscription is not an API key.
4. Enable screen sharing and desktop actions if you want those features.

Requires Windows 10/11, x64. No separate Node.js, Python, Ghidra or REA install
is needed for the portable build. This preview is unsigned.

## What Is Included
- Movable, always-on-top companion with blinking eyes, two sizes, and tray menu.
- Text conversation with a validated set of 31 desktop/local tools.
- Live voice connection and delegated tools using OpenAI WebRTC.
- Dictation recording up to two minutes, punctuation, editable transcript,
  and Copy. Paste into your app with Ctrl+V.
- Captures of a selected display, model-based screen explanation, and screen
  annotations. Draw your own red marks and ask the assistant about them.
- Installed app discovery and launching, browser links/searches, app inspection,
  and automatic clicks/text replacement through Windows accessibility.
- Cua-backed exact-window discovery and inspection, automatic clicks/text
  replacement, scrolling, and navigation keys, shared by chat and voice.
- Screenshot-grounded desktop/window mouse and keyboard input for custom UI,
  canvas content, ordinary app shortcuts, browser pages and file dialogs.
- Windows global media keys and Spotify search links.
- Local notes, reminders and timed notifications.
- Local ICS calendar import, recurring events and exclusions.
- Windows-protected API key storage and model settings.

## Shortcuts
Ctrl+Alt+Space       Start or end a voice conversation
Ctrl+Alt+D           Start or stop dictation
Ctrl+Alt+M           Enter or finish screen drawing
Ctrl+Alt+Backspace   Clear screen marks
Ctrl+Alt+Escape      Stop tasks and pause computer use
Escape              Finish drawing

Drag the small dotted grip above the eyes to move the floating companion.
Click its eyes to open the main window. Click its small dot to toggle voice.
Closing the main window hides it to the tray. Choose Quit to stop the app.

## Try Saying Or Typing
"Create a note called Ideas: Make a simple Windows assistant."
"Remind me to stretch in ten minutes."
"Find Notepad and open it."
"Use computer use to inspect Calculator, compute 6 times 7, and read the result."
"Look at my screen and explain this error."
"Circle the button you mean."
"Make yourself bigger."
"شنو كاين فالشاشة ديالي؟"

## Api Configuration
Defaults recovered from the Mac app:
Voice: gpt-live-1, Marin
Chat and delegated reasoning: gpt-6-luna
Dictation: gpt-4o-mini-transcribe
Optional transcription cleanup: gpt-4.1-mini

Model access and usage billing depend on your OpenAI API account. Voice uses
POST /v1/live/sessions with WebRTC, not the older Realtime event protocol.
An unavailable model or invalid key produces an error; there is no silent
substitution or bundled free backend. Change model names in Settings if needed.
Do not put a consumer Claude/ChatGPT session cookie into the API key field.

## Differences From The Mac App
- This is a functional preview, not feature-for-feature parity with Pixie.
- No original Pixie account, subscription, credits, telemetry, or private server.
- Windows controls replace AppKit/AppleScript; support varies by application.
  Accessible controls use named actions; other visible content uses screenshots
  and mouse/keyboard input. Protected apps may reject access.
- Clicks and text replacements run directly when Desktop actions is enabled.
  Typing replaces the selected accessible field and does not press Enter.
- Dictation uses record-then-transcribe and manual paste, not the Mac streaming
  dictation backend or Fn-based automatic insertion.
- Global media keys affect the active Windows player. They do not verify
  playback, choose a song automatically, or set per-player absolute volume.
- Spotify search opens a search. Apple Music catalog and Arc tab switching
  are not implemented.
- Notes/reminders are local; they do not sync with Apple Notes, Outlook, or
  Microsoft To Do. Calendar imports are snapshots, not live account sync.
- Reminders fire while the app is running. Due reminders are delivered when
  it next opens. There is no automatic startup or Windows background service.
- Screen marks use selected-display coordinates. A fresh screenshot is required
  for assistant drawings; if the screen changes, capture it again.
- Browser pages and file dialogs can be used through their visible interface.
  There is no direct shell execution tool or background purchasing workflow.

## Data
The API key is encrypted using Electron safeStorage and Windows protection.
It is decrypted only in the main process for requests. A user/process with
access to your Windows account may still be able to access its protected data.
Local library and settings: %APPDATA%\Pixie Windows Companion\library.json
A small wake-status.json in that folder stores only the current wake state,
recognizer language, timestamp and startup error if any; never speech or audio.
An imported calendar is stored in the same folder as calendar.ics.
Chat history stays in memory, limited to recent turns. Screenshots are held in
memory; screen questions and visual computer tasks send captures to OpenAI. Microphone audio
is sent during voice sessions or when a dictation is submitted. App controls,
notes and calendar content requested in chat can be included in AI requests.
There is no additional analytics service. API requests use store:false where
the Responses/Live APIs support it; provider-side retention policies still apply.

## Validation
Automated unit tests cover argument validation, unsafe URLs, stale snapshots,
local persistence, one-time reminders, serialized actions, API error handling,
tool call/response correlation, dictation fallback, and voice deduplication.
The Electron smoke test checks UI load, navigation, local notes, companion size,
Windows encryption, app discovery, screenshots, overlays, and ICS recurrence.
A dedicated Windows test window verifies actual text entry, button activation,
Unicode preservation, password protection, and refusal of changed targets.
Live paid OpenAI calls, end-to-end microphone/speaker quality, Spotify playback,
and every third-party application's accessibility were not tested with an API
key. These are limitations of validation, not claims that the tests passed.

## Source / Development
Install Node.js 24+ and run npm ci, npm run setup:cua, then npm start.
setup:cua installs a pinned, checksum-verified and Authenticode-verified Cua
release in vendor/cua-driver. It does not install a service or modify PATH.
If your npm configuration disables install scripts, run:
  node node_modules/electron/install.js
Run unit tests: npm test
Run Electron smoke checks: npm run smoke
Run isolated Windows control checks: node tests/windows-integration.js
Run real Cua fixture checks: node tests/cua-integration.js
Run real visual mouse/keyboard checks: npm run smoke -- --visual-test
Run local voice-wake and chime checks: npm run smoke -- --wake-test
Measure local computer speed: node tests/computer-performance.js current --sequence
Measure visual text-entry speed: npx electron tests/visual-performance.js current --compound
Build portable app: npm run package
Source ZIP includes the lockfile, tests, original procedural icon generator,
UI, typed tools, Windows helper, and packaging script.

## Official References Used
https://developers.openai.com/api/docs/guides/voice-webrtc
https://developers.openai.com/api/docs/guides/live-delegation
https://developers.openai.com/api/docs/guides/speech-to-text
https://developers.openai.com/api/docs/guides/images-vision
https://www.electronjs.org/docs/latest/api/safe-storage
https://www.electronjs.org/docs/latest/api/desktop-capturer
https://cua.ai/docs/cua-driver/reference/mcp-tools
https://cua.ai/docs/cua-driver/concepts/platform-support

## Computer Use Limits
Use accessible controls for fast named actions, and fresh screenshots when a
custom interface needs mouse/keyboard input. Visual input is intentionally
foreground and can move focus. Desktop screenshots cover the primary monitor;
use exact-window screenshots on additional monitors. Window-scoped native mouse
movement is decorative, so real hover requires a desktop observation.
No automatic mutation retry follows timeout or unknown delivery. Screenshot
targets expire after 20 seconds and are single-use; moving/resizing a target
requires another observation. Driver refusals and Windows security boundaries
still apply. Do not equate input delivery with the user's whole task succeeding.
Live paid model requests and end-to-end microphone/network quality are not part
of the isolated local tests. Native fixture events independently verify input.

