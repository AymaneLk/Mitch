# Changelog

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
