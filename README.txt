MITCH — WINDOWS COMPANION PREVIEW 0.5.2

0.5.2: The floating companion shows Connecting and Listening immediately,
then streams the latest You / Mitch captions, even with the main window hidden.
Arabic text follows its natural right-to-left direction. Long speech scrolls to
the newest words. Ending voice or Stop clears the ephemeral captions. The pet
expands within its current monitor and never takes keyboard focus from your app.

0.5.1: Wait for Windows speech recognition to finish cancellation before
releasing the wake microphone and handing off to the conversation.

0.5.0: Hands-free voice wake. With Settings > Hey Mitch > Wake by voice enabled,
say "Mitch", "Hi Mitch", "Hey Mitch", "Hello Mitch" or "Good morning Mitch".
Common evening/afternoon greetings and Bonjour/Salut/Salam variants are included.
Pause after the greeting. A short two-note chime sounds once the voice session
is ready; then speak your request. The greeting itself is not sent as a command.
Windows detects greetings locally while Mitch is running, including in the tray.
Waiting audio is not written to disk or sent to the AI. Normal conversation audio
uses the existing voice API after activation. The microphone is muted during
the ready chime. Wake detection pauses during voice and dictation and rearms
after they finish. Stop pauses wake detection too; use Resume voice wake in
Settings to enable it again. An installed English/French Windows desktop speech
recognizer, a working default microphone and a saved API key are needed.
Recognition varies with accent, noise and microphone quality. Local synthetic
greetings, unrelated speech, microphone access, cue playback and cancellation
are tested; the user's own voice and live cloud conversation are not covered.

0.4.2: Renamed the application to Mitch across Windows, the interface, chat,
voice captions and reminders. Open Mitch.exe. Existing profiles continue using
the original data directory so saved settings, API keys and notes carry forward.

0.4.1: Faster visual text entry and fewer repeated reads. computer_input type
with replace:true combines field focus, Ctrl+A and typing into one model call,
then returns a fresh screenshot. It never submits the field. Each local step
still checks the current target and Stop; partial input is not replayed.
Window screenshots reuse their own validated bounds/title instead of enumerating
all windows again. Chat drops superseded control lists for the same exact window
while preserving results and current controls. Voice prepares its tool connection
when the conversation activates, before the first desktop action needs it.
Five isolated native trials: median focus/select/replace fell from 2.42 seconds
to 0.95 seconds, and model calls for that entry fell from three to one. These are
local fixture timings, not a measured end-to-end cloud/model speedup.

0.4.0: General visual computer control alongside the fast accessibility path.
Pixie can observe an exact window or the primary desktop, click/double-click/
right-click image locations, type Unicode, use ordinary keyboard shortcuts,
scroll and drag. Actual pointer hover uses the primary desktop view. Exact
windows on other monitors can also be captured and controlled. Every visual
input consumes a fresh image, checks its target and returns a new observation.
Screenshots feed the existing reasoning model directly; voice sends tool images
over an authenticated backend connection while audio stays on WebRTC. Recent
chat tool images are replaced rather than accumulated in saved history.
Enable both Screen sharing and Desktop actions. Blue corners and Stop remain.
Model/network latency still applies; this is not a guarantee of human-level
reliability in every application. Windows secure desktops remain inaccessible.

0.3.2: Calculator uses observed digit/operator buttons instead of trying to type
into its read-only display. Controls now report editability; type refusals guide
the assistant toward the available input buttons. Cua's compressed Windows tree
may omit non-actionable parents at any depth: sequence matching preserves that
boundary and its depth rather than rejecting valid Calculator buttons.
Minimized windows are included in discovery and can be restored by their observed
PID, handle and exact title before inspection; this also handles Calculator's
empty internal window while its main frame is minimized.
Opt-in real Calculator check: npm run smoke -- --calculator-test (French UI).

0.3.1: Faster computer use. Pixie's Cua session uses a 1 ms cursor glide and no
decorative dwell, while retaining fresh observations and Stop. Window lookup and
inspection can run in one call. Up to 20 already-observed, uniquely named clicks
or text replacements can run as one local sequence, reducing model roundtrips.
Sequences stop on errors, ambiguous/changed targets or incomplete observations.
Text must be confirmed before proceeding. Unconditional accepted clicks may be
unverifiable; the final observation must still be checked for the actual outcome.
Do not batch choices dependent on an unknown result, such as checkbox then submit.
The existing default gpt-6-luna uses supported low reasoning effort in chat and
voice; custom models are unchanged. Network/model response time still varies.

0.3.0: Desktop actions run directly without per-action permission dialogs.
Blue glowing corners appear on every display during computer tasks and disappear
on completion or Stop. Overlays do not intercept clicks or take keyboard focus.
The portable executable requests Administrator at startup through normal Windows
UAC. This does not disable UAC or grant access to Windows secure desktops.

0.2.0 introduced bundled Cua Driver 0.41.0 for Windows computer use in both chat and
voice. Find a window, inspect its accessible controls, then click, replace text,
scroll or press a navigation key. Desktop permission is granted once in Settings. A fresh
observation follows each input. Driver delivery is not proof the task succeeded.
Use the Stop button or Ctrl+Alt+Escape to cancel pending work and stop Cua.
Resume in Settings > Computer use before asking for another computer task.
Stop cannot undo an input that has already reached an application.

0.1.1: Spotify searches now require plain-text words from chat and voice.
Accidental compact + separators in multiword search phrases and Spotify web
search links are normalized before encoding. Literal pluses such as +44 and
Florence + The Machine are preserved. Search results report the actual query.

This is a new Windows implementation inspired by the behavior recovered from
Pixie for macOS 0.3.4. It is not an official Pixie release, a binary conversion,
or a complete port of the original source. No extracted app assets, proprietary
prompts, or private Pixie services are included.

RUN
1. Extract the entire portable ZIP into a folder on your PC.
2. Open "Mitch.exe". Keep the other files next to it.
3. Open Settings and enter your own OpenAI API key, then Save settings.
   Your normal ChatGPT or Pixie subscription is not an API key.
4. Enable screen sharing and desktop actions if you want those features.

Requires Windows 10/11, x64. No separate Node.js, Python, Ghidra or REA install
is needed for the portable build. This preview is unsigned.

WHAT IS INCLUDED
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

SHORTCUTS
Ctrl+Alt+Space       Start or end a voice conversation
Ctrl+Alt+D           Start or stop dictation
Ctrl+Alt+M           Enter or finish screen drawing
Ctrl+Alt+Backspace   Clear screen marks
Ctrl+Alt+Escape      Stop tasks and pause computer use
Escape              Finish drawing

Drag the small dotted grip above the eyes to move the floating companion.
Click its eyes to open the main window. Click its small dot to toggle voice.
Closing the main window hides it to the tray. Choose Quit to stop the app.

TRY SAYING OR TYPING
"Create a note called Ideas: Make a simple Windows assistant."
"Remind me to stretch in ten minutes."
"Find Notepad and open it."
"Use computer use to inspect Calculator, compute 6 times 7, and read the result."
"Look at my screen and explain this error."
"Circle the button you mean."
"Make yourself bigger."
"شنو كاين فالشاشة ديالي؟"

API CONFIGURATION
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

DIFFERENCES FROM THE MAC APP
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

DATA
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

VALIDATION
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

SOURCE / DEVELOPMENT
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

OFFICIAL REFERENCES USED
https://developers.openai.com/api/docs/guides/voice-webrtc
https://developers.openai.com/api/docs/guides/live-delegation
https://developers.openai.com/api/docs/guides/speech-to-text
https://developers.openai.com/api/docs/guides/images-vision
https://www.electronjs.org/docs/latest/api/safe-storage
https://www.electronjs.org/docs/latest/api/desktop-capturer
https://cua.ai/docs/cua-driver/reference/mcp-tools
https://cua.ai/docs/cua-driver/concepts/platform-support

COMPUTER USE LIMITS
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

SOURCE LOCATION
Based on the existing v0.1.1 Windows companion from:
C:/Users/aymane/Documents/Codex/2026-11-06/wh/work/windows-companion
The integration workspace is C:/Users/aymane/Documents/ChatGPT/Pixie.
