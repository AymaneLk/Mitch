# Changelog

## 0.6.0-local.33 — Spotify MCP playback recovery

- Work around Spotify desktop's accepted-but-empty direct-track playback by starting the requested recording at its exact album offset. Confirm playback inside the provider without an extra model review; report that subsequent album tracks may follow.
- Distinguish rejected, accepted and lost MCP writes. Launch the discovered Spotify app and retry once only after a proven no-device rejection; never replay an accepted or uncertain operation.
- Expose specific provider errors and add live playback/progress, pause and resume checks. See `docs/SPOTIFY-PLAYBACK-FIX.md` for evidence and limitations.

## 0.6.0-local.28 — General structured computer-use engine

- Compile compact bounded plans and exact prepared-scope references into the existing executor, reducing model context and window-title transcription errors. Permit one correction of a proven pre-input schema refusal.
- Resolve repeated DOM/UIA controls by observed named ancestors; select relevant controls for large planning views while retaining explicit truncation. Preserve hierarchy in cached-workflow fingerprints and delivered-input receipts.
- Inspect and act inside open shadow roots and explicitly selected embedded documents, with origin permissions, exact browser document identity, stale-frame refusal, and no model-generated JavaScript. Browser Bridge 1.6.0 uses the existing permissions.
- Add a persistent, capability-checked Win32 text replacement route only after a specific pre-write UIA pattern refusal. Revalidate unique control, process, window, class, protection and original text; verify exact text readback. No application-name branch.
- Require approval for recognized consequential controls, preserving automatic ordinary edits. Keep generic unknown outcomes blocked.
- Add controlled unfamiliar-layout, classic Notepad, cross-application and resource benchmarks. See `docs/GENERAL-ENGINE-RESULTS.md` for measured results, failed exploratory trials and limits.

## 0.6.0-local.27 — Recover interrupted native plans

- Distinguish an ambiguous next target from a lost input acknowledgement. After a clean but unverified native action, refresh the exact window and allow a distinct continuation only when interactive controls demonstrably changed.
- Reserve every attempted control in interrupted native plans. Block prefix replay, switching input routes, and switching windows during recovery. Keep uncertain delivery explicitly marked; final task completion still needs independent evidence.
- Preserve recovery evidence through nested workflows. Native and browser read-only recovery can confirm an already-completed request without replaying its inputs.
- Add a real native regression that reproduces the previous stop with unmodified driver responses, then completes with exactly two clicks and no replay. See `docs/NATIVE-RECOVERY.md`.

## 0.6.0-local.26 — General workflow latency and reliability

- Compile independent whole-request completion predicates concurrently with the planner. Fresh scoped execution evidence can prove eligible tasks locally; unsupported, incomplete or uncertain evidence retains semantic review. This does not authorize inputs.
- Preserve native checkbox/selection state and distinguish a unique typed control from inert labels without accepting duplicate interactive, disabled or protected controls.
- Prepare explicitly named source and destination windows together. Reduce redundant planning instructions and field assertions while preserving local verification.
- Refresh the exact browser tab after a known failed navigation assertion, then review fresh evidence without model-driven rediscovery or repeated input. Preserve browser profile binding through redacted workflow evidence using a noncredential digest.
- Add real native and public-browser before/after tests with independent readback; Browser Bridge 1.5.0. See `docs/GENERAL-SPEED.md`. Arbitrary tasks are not guaranteed to finish within five seconds.

## 0.6.0-local.25 — Verified public website tasks

- Execute parameterized YouTube search/ranked playback, English Wikipedia articles and GitHub repository search/ranked opening locally through Browser Bridge 1.4.0. Exact recognized requests need no model calls; other wording can use the same bounded tool from the planner.
- Follow actual ranked YouTube links within its loaded application, avoiding a full document reload for every video. Wait for the relevant results and player instead of unrelated network loading.
- Verify result order, document/tab identity, loaded repository metadata and actual advancing video playback. Advertisements do not count as the requested video. Cancellation, unknown-outcome guards and general native/visual fallback remain active.
- Add real public-site before/after tests in disposable Opera profiles, independent DOM/playback readback and phase timing. These adapters do not guarantee 1–5 seconds for arbitrary websites, complex tasks or advertisements. See `docs/REAL-WEB-SPEED.md`.

## 0.6.0-local.24 — Fewer computer-use round trips

- Finish recognized whole-request field edits and navigation from fresh scoped evidence without a second model review. Other tasks retain semantic review.
- Combine adjacent workflow action phases while preserving intermediate assertions and binding/branch boundaries; check final predicates against one consistent fresh frame.
- Reuse approved single-scope procedures after unrelated control changes, while rechecking the entire current scope before input and rejecting relevant ambiguity or new dialogs.
- Keep a mutation-invalidated browser control index, reading values, visibility and target bounds live. A persistent Windows event listener invalidates short-lived native snapshot reuse; unavailable listeners fall back to fresh reads.
- Add a bounded real-model/native-UI benchmark against the preserved v23 engine, with independent fixture readback and measured model selection. See `docs/SPEED-VALIDATION.md` for results and scope.

## 0.6.0-local.23 — ChatGPT OAuth

- Replace DeepSeek reasoning with official system-browser ChatGPT OAuth, verified identity, protected account storage and automatic refresh.
- Discover available models per account and stream Responses through the existing validated local tool loop.
- Add optional persistent Responses WebSocket continuation with safe context replay; preserve CPU voice, workflows and Stop.
- Remove retired provider keys/UI/runtime, add protocol and Windows settings tests, and provide bounded live transport benchmarks. Live OAuth, both transports, local voice, a native fixture click and screenshot understanding were verified on one account; these checks do not establish arbitrary-task accuracy.
- Parse valid completed SSE when the live OAuth route omits Content-Type, and persist usage-limit pauses across restarts until the user resumes.

## 0.6.0-local.22

- Adds optional DeepSeek chat/planning alongside local Qwen; OpenAI API calls are disabled in this edition. CPU Nemotron recognition and Kokoro speech synthesis remain separate local services.
- Adds live voice captions, a red Working popup, and bounded read-only preparation while speaking.
- Adds authenticated browser tab/page controls, direct Windows folder access, conditional desktop workflows, and guarded procedure reuse. Unknown action outcomes stop without automatic input replay.
- Adds optional local GoClick targeting, off by default, with independent target verification and visual fallback.
- Includes latency diagnostics, reproducible fixtures, deployment scripts, and regression tests. Measured fixture timings do not guarantee general task completion or a universal 1–5 second response.
- Incorporates the MIT license, contribution/security documentation, CI, and packaging safeguards from the distribution branch. Packaging includes the Browser Bridge source and folder helper while excluding pairing secrets and local model environments.

## 0.5.2 and earlier

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
