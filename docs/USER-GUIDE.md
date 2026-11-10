# Mitch user guide

This guide covers v0.6.0-local.25. The historical OpenAI cloud edition is preserved by the `v0.5.2-cloud` tag.

For fast website tasks, reload Mitch Browser Bridge in `opera://extensions` after updating to v25. Try “Open YouTube, search for NASA Artemis launch, and play the second video”, “Open the Wikipedia article Alan Turing”, or “Search GitHub repositories for browser automation and open the third repository”. These supported requests resolve actual results locally. YouTube ads can delay confirmation of content playback; arbitrary or compound tasks still use the normal planner. See [measured real-site results](REAL-WEB-SPEED.md).

## Setup

Use Windows 10/11 x64. For a portable build, extract the whole ZIP and keep all files beside `Mitch.exe`. Builds are unsigned and request administrator access. For source development, install Node.js 24+, then run `npm ci`, `npm run setup:cua`, and `npm start`.

In Settings, click **Continue with ChatGPT** and complete sign-in and plan-usage consent in your system browser. Mitch loads the models available to that account. Select an available model for Fast or Smart, reconnect or switch saved accounts, or disconnect from the same panel. Subscription eligibility and limits apply. No API key is required. [Full sign-in guide](CHATGPT-SIGN-IN.md).

Voice and dictation need the CPU speech services described in the [README](../README.md). Local Qwen chat and optional GoClick targeting need their own downloaded models. These models and Python environments are not included in a portable build, and services do not automatically restart after reboot. You can use ChatGPT text chat without starting Qwen.

Enable Desktop actions for app/folder control and Screen sharing for screenshot-based tasks. Voice wake is optional. Press Stop or Ctrl+Alt+Escape to cancel pending work and pause desktop input. Stop cannot undo actions already delivered; Resume is explicit.

## Using Mitch

- Conversation accepts English text or voice requests. The floating popup shows your transcript, turns red with Working while handling the request, and shows the final reply.
- Voice uses local speech recognition, the selected chat model/tools, and local speech synthesis. It pauses capture during responses; it is not a fully interruptible conversation.
- Preparation while speaking can read task context and draft a plan, but does not click, type, launch, or focus an app before the final transcript. ChatGPT preparation counts toward your plan usage even when a draft is discarded.
- Dictation records up to two minutes and produces an editable transcript. Copy it and paste into the desired app.
- Notes, reminders, and imported ICS calendars are local. They do not sync with Apple Notes, Outlook, or Microsoft To Do. Reminders require Mitch to be running.

The control path uses direct local routines, browser controls, Windows accessibility, or screenshot-based fallback as available. Input delivery alone is not treated as proof that the whole request succeeded. Incomplete observations, ambiguous targets, and uncertain action outcomes can stop a task.

Recognized field edits and navigation can finish from exact local readback without another model review. Approved procedures can run again without a model call after fresh scope checks, even if unrelated controls changed. Unknown or compound requests still use model planning/review. Browser controls reuse an invalidated candidate index; Windows change events invalidate short-lived cached observations. See [the measured scope and results](SPEED-VALIDATION.md).

## Browser controls

Settings → Fast browser controls → Open extension folder shows the paired Browser Bridge directory. Load that folder through the supported Chromium browser's extension developer interface. The generated folder contains a pairing secret; do not publish it.

Tab controls read titles/URLs and can switch or close observed tabs. Page controls require a separate browser permission through the extension popup. With that permission, Mitch can inspect and interact with page controls, and task-related data may be sent to the selected AI provider. After an extension update, reload it and refresh controlled webpages.

## Examples

- “Open Calculator and calculate 120 times 5.”
- “Switch to Notepad.”
- “Open Operator folder.” Use a full local folder path if names are ambiguous or the folder is outside the searched locations.
- “Close the two Gmail tabs in Opera GX.” The count must match the observed tabs.
- “Create a note titled Ideas with the text: Build something useful today.”
- “Remind me to stretch in ten minutes.”
- “Look at my screen and explain this error.”

Folder opening verifies the exact Explorer path and whether its window is in front. Windows can refuse focus, and ambiguous Explorer tabs cannot be verified from a window handle alone. These are reasons to stop rather than keep clicking.

## Shortcuts and window controls

| Shortcut | Action |
| --- | --- |
| Ctrl+Alt+Space | Start or end a voice conversation |
| Ctrl+Alt+D | Start or stop dictation |
| Ctrl+Alt+M | Enter or finish screen drawing |
| Ctrl+Alt+Backspace | Clear screen marks |
| Ctrl+Alt+Escape | Stop tasks and pause computer use |
| Escape | Finish drawing |

Drag the grip above the eyes to move the floating companion. Click the eyes to open the main window, or its small dot to toggle voice. Closing the main window hides it to the tray; choose Quit to exit.

## Privacy and limits

Saved API keys and learned procedures use Windows-protected storage. Notes, settings, reminders, and imported calendars are stored locally in `%APPDATA%\Pixie Windows Companion`. Recent chat and screenshots are held in memory. The latest timing report contains bounded operation metadata, not transcript or screenshot contents.

When ChatGPT is selected, transcripts, chat, requested app/page content, and permitted screenshots can be sent to the official OpenAI Responses API under your OAuth plan-usage grant. Speech recognition, synthesis, and ambient wake detection run locally. Provider retention policies still apply. See [SECURITY.md](../SECURITY.md).

Desktop actions can modify files or submit forms once enabled. App permissions, Windows security boundaries, unavailable controls, loading delays, and model errors still affect results. GoClick is experimental and off by default; it proposes a target and does not independently authorize clicks or prove completion. Fixture benchmarks are not promises that arbitrary tasks finish in 1–5 seconds.

## Development checks

Run `npm test` for mocked unit tests. Native checks need Windows and the Cua driver: `npm run smoke`, `node tests/windows-integration.js`, and `node tests/cua-integration.js`. The folder smoke check is `npm run smoke -- --folder-access-test`; it opens an owned temporary Explorer fixture. Some historical benchmark scripts require archived builds that are deliberately excluded from Git.

Build with `npm run package`. Verify packaged resources, licenses, browser extension source, and `folder-helper.ps1`. Runtime models, credentials, profile data, pairing configuration, and local test reports must remain excluded. See [CONTRIBUTING.md](../CONTRIBUTING.md) for additional checks.


### General engine v28

Reload Mitch Browser Bridge 1.6.0 and refresh already-open pages. Existing page permissions suffice. Mitch can use a named row/group to distinguish repeated controls, traverse open shadow roots, and select embedded browser documents explicitly. No new model or account is required.

Routine edits remain automatic; recognized consequential actions open an approval dialog. The engine still refuses ambiguous, protected or uncertain targets. Closed shadow roots, canvas interfaces, inaccessible native controls and some navigation transitions still need the existing visual route. Multi-step tasks can exceed five seconds; see the measured general-engine results.
