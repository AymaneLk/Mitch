# Mitch

Mitch is an open-source AI desktop assistant for Windows, with notes, reminders, dictation, screen understanding, and native/browser computer control.

**Preview 0.6.0-local.33 · Windows 10/11 x64 · MIT licensed**

This is an independent implementation inspired by Pixie for macOS, not an official Pixie release or a complete port. No extracted app assets, proprietary prompts, or private Pixie services are included. See the [changelog](CHANGELOG.md).

The current version combines ChatGPT sign-in with structured browser/Windows automation and MCP-first routing. Seven optional integrations cover Filesystem, Desktop Commander, Excel, Playwright, Google Workspace, GitHub and Spotify. Account services require separate setup and consent; installation alone does not grant access. See [MCP setup and validation](docs/MCP-CONNECTIONS.md). v33 fixes Spotify desktop playback through the MCP, including app launch after a confirmed no-device rejection and playback confirmation without another AI call. See [the measured results and album-playback limitation](docs/SPOTIFY-PLAYBACK-FIX.md).

v28 improves general structured computer use with compact plans, prepared-scope references, named-container targeting, open shadow DOM, document-bound embedded frames and a capability-checked native text fallback. It preserves v27 recovery and blocks uncertain replay. Browser Bridge is now 1.6.0; reload the extension and refresh existing pages, with no new permission. See [the architecture audit](docs/GENERAL-ENGINE-AUDIT.md) and [measured results and limits](docs/GENERAL-ENGINE-RESULTS.md).

v25 adds fast, verified YouTube search/ranked playback, Wikipedia articles and GitHub repository search/ranked opening. Recognized requests run locally through Browser Bridge 1.4.0, without model calls. Reload the existing extension to activate them; no new permission is needed. Real-site timings, ad delays and remaining general-task limits are documented in [real website validation](docs/REAL-WEB-SPEED.md).

## Install from source

Use Git and Node.js 24 or later on Windows:

```powershell
git clone https://github.com/AymaneLk/Mitch.git
cd Mitch
git switch codex/chatgpt-oauth
npm ci
npm run setup:cua
npm start
```

Settings → Connect ChatGPT → **Continue with ChatGPT** opens the official OpenAI authorization flow in your system browser. Authorize an eligible account and ChatGPT plan usage, then choose a model from the returned account catalog. Subscription limits apply; Mitch never falls back to separately billed API calls. Local Qwen remains an optional provider. Voice and dictation still require the separate CPU speech services; models and Python environments are not bundled. See the [sign-in guide](docs/CHATGPT-SIGN-IN.md) and [user guide](docs/USER-GUIDE.md).

The Cua setup command downloads the pinned Windows driver and verifies its checksum and Authenticode signer. If npm install scripts are disabled, run `node node_modules/electron/install.js` first. Portable builds are unsigned and request Windows administrator access through UAC; source launches use the privileges of the launching process. Extract the whole portable folder and keep its neighboring files intact.

For the optional MCP integrations, install uv and run `npm run setup:mcp` before configuring connections in Settings. The pinned MCP runtimes are downloaded separately and are not included in Git or the Electron package. Local credentials, generated browser pairing configuration, models, build outputs and raw test reports are excluded from this repository.

## Permissions and privacy

Screen sharing, desktop actions, and voice wake are off by default. Once enabled, desktop actions can change files and submit forms without per-action prompts. Blue screen corners indicate active computer use. **Stop or Ctrl+Alt+Escape cancels pending work and pauses computer use; delivered actions cannot be undone.** Closing the main window keeps Mitch in the tray; choose Quit to exit.

With ChatGPT selected, chat, task-related app/page content, transcripts, and permitted screenshots are sent to the official Responses API using your OAuth authorization. Microphone audio, speech recognition, and synthesis stay on your PC. Preparation while speaking may send text and task context before the final transcript, but does not execute input. Windows-protected storage encrypts OAuth credentials; local notes and settings are not encrypted. See [Security and privacy](SECURITY.md).

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and checks. Mitch source is licensed under the [MIT License](LICENSE); dependencies and downloaded components retain their own licenses and [notices](THIRD_PARTY_NOTICES.md). The historical cloud edition is preserved by the `v0.5.2-cloud` tag. Official ChatGPT OAuth is implemented; live account eligibility and available models are determined by OpenAI. See [setup and validation](docs/CHATGPT-SIGN-IN.md).

## Direct folder access (v0.6.0-local.22)

Explicit requests such as `open Operator folder` or `open folder "C:\Users\aymane\Desktop\Operator"` use Windows Shell folder discovery and opening before the app/browser planner. Discovery checks exact open Explorer locations and common personal directories, then a bounded deeper search when needed. Its reported completeness covers those searched locations, not all drives. Duplicate names require an exact path. Missing folders, incomplete searches and unverified actions stop without falling back to visual clicks.

Opening reuses an exact existing Explorer window where possible and verifies both its folder path and foreground window. Conflicting folder tabs sharing a window are not treated as a verified foreground folder. The route needs no model call, screenshot or GPU. On this PC, a live `open Operator folder` trial verified the Desktop folder in 1.915 seconds; separate source-app dispatcher trials opened a disposable folder in 1.762 seconds and reused it in 1.082 seconds. These are small local samples excluding speech recognition, not general speed/accuracy guarantees. The initial Operator trial is recorded in `test-output/folder-access-integration-run.log`; source-dispatcher and latest packaged results are in `test-output/folder-source/folder-access-integration.json` and `test-output/folder-packaged-integration.json`. Run `npm run smoke -- --folder-access-test` to exercise the real dispatcher against an owned temporary folder.

## Hybrid control (v0.6.0-local.20)

The runtime chooses controls per step: exact local workflow → browser DOM or Windows accessibility plan → visual fallback, with the selected AI provider planning unfamiliar work. All paths retain the existing task guard, cancellation, fresh observations, center clicks and completion verification. The new exact workflows include `Switch to Notepad`, `Bring Calculator to the front`, and `Switch to the Gmail tab in Opera`. They resolve a unique existing window/tab and verify its resulting state with zero model calls. Ambiguous targets are not guessed, and compound requests remain with the planner.

An experimental visual fallback accepts `computer_input` with `snapshot`, click `kind` and `target_label`, without a model-estimated `target_box`. A unique measured Windows target still wins first. Otherwise local GoClick proposes a point, a bounded crop is passed to the existing vision verifier for actual element bounds, and the shared executor clicks the verified box center. GoClick does **not** detect absent targets reliably, provide bounds, or prove completion. Its output never directly authorizes input. Missing, ambiguous, crop-clipped or contradictory point/box results are refused. Existing explicit-box requests retain their previous close-up route.

GoClick runs in its own CPU environment and does not start Qwen or use the GPU. Downloaded model files and custom code are revision/checksum pinned; the runtime is offline and only accepts backend requests on loopback port 22135. A slow/unavailable local service falls back to the configured vision provider before any input, with a short circuit breaker to avoid repeated delays. Screen permission, screenshot expiry and Stop remain enforced. Local targeting attempts are recorded separately from provider requests, without image/label contents.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-goclick.ps1
powershell -ExecutionPolicy Bypass -File scripts/start-goclick.ps1
# Stop only the target proposer:
powershell -ExecutionPolicy Bypass -File scripts/start-goclick.ps1 -Stop
```

Settings → Visual targeting exposes the experimental local proposal option, **off by default** after validation showed a regression: two visible targets took a median 3,429 ms with local proposals versus 1,194.5 ms with the existing box-refinement path. One hybrid result missed its target; a subsequently added point/box consistency guard rejects that recorded mismatch. The test supplied baseline boxes and excluded planning/execution, so these are refinement measurements, not full task times. Six live native window-switch/restore trials passed with zero model requests (356 ms switch median; 721 ms restore/switch median). These small fixtures do not establish arbitrary-task accuracy.

The GoClick service is separate from the packaged app and must be restarted after reboot. The installer does not bundle the model environment. GoClick has no per-call API charge; ChatGPT planning and visual confirmation count toward your plan usage. No new browser extension reload is required for v20.

## Local AI preview

By default, chat, vision and tool calls use Qwen3.5-4B Q4_K_M through llama.cpp on the GPU. Dictation and voice recognition use Nemotron Speech Streaming English 0.6B Q8 on the CPU. A local Kokoro service supplies English speech synthesis. These local requests have no API charges or provider daily quotas; they use your hardware and electricity. Failed local requests do not fall back to a paid provider.

Historical version 0.6.0-local.9 introduced optional DeepSeek chat. Version 23 replaces that provider with official ChatGPT OAuth; legacy API-key billing remains disabled. Dictation and speech synthesis stay local. Voice uses Nemotron ASR → selected chat model/tools → Kokoro with automatic submission after 1.8 seconds of silence. Choose the input device in Settings; the voice bar shows its name and input level. Capture pauses while thinking/speaking; End conversation cancels pending work. This is half-duplex, not an interruptible streaming conversation. Pipecat, Silero and SmartTurn are not integrated. OmniRoute remains separate.

Version 0.6.0-local.15 shows live voice captions in the floating popup using the installed CPU recognizer's streaming endpoint. After the pause, the whole popup turns red and reads “Working…”. Once the final transcript is ready, Mitch displays and says “Got it. I'm on it.” while reasoning starts. The final answer replaces that acknowledgement; the popup returns to its normal color when speaking/listening. Partial transcripts never execute actions. If streaming fails, the complete recording is transcribed through the existing local adapter. End conversation cancels pending captions and audio. No additional model or GPU service is required.

Version 0.6.0-local.16 adds local routines for exact app opening, Calculator binary arithmetic with displayed-result readback, quoted Notepad text, and Instagram Messages/Profile navigation when accessible destination evidence is clear. Unfamiliar or ambiguous requests continue through the general model with every attempted step preserved. The fast path never treats launch/input delivery alone as success, never replays an uncertain action, and does not overwrite existing Notepad content without an explicit replacement request. App opening still uses the real app catalog and exact observed window identity.

Known in-place controls with fresh complete progress skip delayed recovery polling; uncertain actions, navigation and Call/Send/Save retain recovery checks. Restore/focus reuses the restored observation. Exact unique screenshot labels use measured Windows targets without another close-up inference; ambiguous, clipped or incomplete targets retain visual verification. A complete native observation hides incompatible legacy control tools from the next model choice. Model-driven steps retain High thinking: bounded API comparisons did not show a consistent Low-effort speed advantage. Deterministic completion checks replace model reviews only for the supported verified routines.

Stable complete voice commands submit after 850–1,000 ms of silence; incomplete phrases, free-form dictation, sensitive actions and broken streams retain 1,800 ms. During speech Mitch may warm its app catalog and read window identities, but does not focus apps or execute partial commands. The audio queue is bounded and falls back to the full recording on a stalled stream. Timing metadata contains operation names/durations, not transcript, screenshot or credential contents. Version 0.6.0-local.17 displays the latest total and model-request count in Settings and saves only the latest timing metadata in the application profile's `last-task-timing.json`. Model durations can be nested inside tool durations; use totalMs for elapsed task time rather than adding these categories.

Version 0.6.0-local.17 adds direct browser tab controls. The bundled Mitch Browser Bridge extension connects to an authenticated loopback WebSocket; it uses the browser's Tabs API rather than screenshots. Explicit requests such as “Close the two Gmail tabs in Opera GX” list fresh tab metadata, select exact URL hosts, close the matching IDs in one batch and verify absence locally, without model calls. A requested count must match exactly; pinned/private tabs and ambiguous profiles are not acted on. Partial or unknown results stop without replay. The general agent also has list, switch and batch-close tab tools. Page interaction remains with existing desktop/visual tools; this extension does not read page bodies or control the DOM.

Mitch creates its paired extension folder inside its existing application profile. Settings → Fast browser controls → Open extension folder shows it. Load that directory through Opera's extension developer interface (or an equivalent supported Chromium browser). The source extension contains no pairing secret; `config.js` is generated only in the user profile. The extension requires tab metadata, storage and alarms permissions, not website content access. Official implementation references: [Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs), [WebSocket service-worker lifecycle](https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets), [Opera extension testing](https://help.opera.com/en/extensions/testing/). [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp) is a useful structured-page layer for future DOM automation; it is not bundled into this tab-only adapter.

Local tool turns now enable reasoning and preserve it between tool calls only. Desktop replies undergo a separate check against tool evidence, without the draft reply or private reasoning. Input delivery without a subsequent observation cannot pass the completion gate. Simple Spotify Liked Songs and current-track playback requests additionally require explicit accessible heading/track-list or transport evidence; navigation links and timestamps cannot establish completion. If those controls are unavailable or incomplete, Mitch reports unverified completion instead of accepting a model's guess. Simple play/resume/pause commands reject blind global toggles; observed Spotify Play/Pause controls are checked to prevent reversing the requested state. Named-song and more complex workflows retain the general review and are not covered by this specialized check. For local Qwen, screenshot-only analysis and short structured audits use non-thinking mode. These checks improve the tested workflows but do not make the 4B model as capable as the cloud edition or guarantee every UI interpretation.

The original cloud edition is preserved by tag `v0.5.2-cloud`. The v22 local/DeepSeek history remains on `codex/local-ai-architecture`; this migration is on `codex/chatgpt-oauth`.

### Setup (Windows NVIDIA)

Requires Node/npm, uv, Python 3.12 (managed by uv), and a compatible NVIDIA driver. Tested on RTX 4060 8GB / 32GB RAM. GPU memory was about 7.4GB in the test environment, so other GPU applications may cause contention.

```powershell
npm ci
npm run setup:cua
powershell -ExecutionPolicy Bypass -File scripts/setup-local-ai.ps1
powershell -ExecutionPolicy Bypass -File scripts/start-local-ai.ps1
npm start
```

Allow services to load. In Settings select Local for both chat and dictation. Defaults: chat `http://127.0.0.1:22130/v1`, model `mitch-local`, speech `http://127.0.0.1:22132`. ASR internally listens on port 22131. All three services bind to loopback. Health endpoints: chat/ASR `/health`, speech `/health`. No cloud key is sent to these endpoints. Local dictation returns the raw transcript without cloud formatting.

Model revisions/checksums and Python dependency versions are pinned under `local_runtime`. Downloads and environments stay under ignored `vendor/local-ai`; packaging excludes this directory. Packaged Mitch can use services started from this checkout. Services do not automatically start after reboot. Stop them with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-local-ai.ps1 -Stop
```

For ChatGPT with local voice and no local GPU model, start only the CPU speech services:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-local-ai.ps1 -SpeechOnly
```

Stopping these speech services also stops microphone transcription and spoken replies. ChatGPT text chat continues to work. Speech-only mode leaves the Qwen chat server off.

### Verification

With services running:

```powershell
npm test
npm run smoke
vendor/local-ai/venv/Scripts/python.exe scripts/test-local-speech.py
node scripts/test-local-ai.js
node scripts/test-local-desktop-reasoning.js
```

Speech tests generate synthetic English/French audio and a controlled vision fixture; run them before the local AI test. AI tests use a mock note dispatcher, not your notes. Results go to ignored `test-output`. Tests cover actual model chat, tool selection, image recognition, WebM transcription and Kokoro output. They do not establish microphone quality, long-session reliability or live conversation latency.

The desktop reasoning regression uses the real local model with a simulated French Spotify UI. It rejects invented app/window identities and checks navigation, paused-to-playing, already-playing, and incomplete-state audits. It does not control the user's Spotify account. The final successful three-turn run during this fix took about 11.3, 24.5 and 4.5 seconds respectively. Reanalysis of the reported screenshot correctly identified Home and paused playback; live Spotify capture verification was blocked by native window-capture timeouts. Do not treat these checks as a live Spotify end-to-end pass.

Initial verification on 2026-11-08: 213 unit tests and desktop smoke passed. Local chat ~1.7s, tool round trip ~1.0s, controlled vision ~0.5s, short synthetic ASR clips ~1.1–1.6s. These are single-run measurements, not performance guarantees.

To return to the cloud edition, use the `v0.5.2-cloud` checkout. Your saved key is preserved. Local models are smaller than the previous cloud models; review their actions and use Stop when needed.


For Woof versus Kokoro measurements, reproduction steps and voice limitations, see [the local voice evaluation](docs/local-voice-evaluation.md).

Current language policy is English-only: the ASR server uses the English-only Nemotron model, Kokoro accepts English output only, and Mitch is prompted to reply in English. Earlier French benchmark results describe historical versions.

To roll back recognition, stop the current local services, check out tag `v0.6.0-local.4`, and restart its local services. Qwen ASR model files remain installed. The full cloud baseline remains at `v0.5.2-cloud`.

## ChatGPT subscription reasoning

Mitch uses official OAuth with PKCE, a loopback callback, verified signed identity, automatic refresh and encrypted main-process storage. Model names come from the account catalog. Fast and Smart are per-account model preferences; both initially use the server’s first listed model until you assign them. No model-specific reasoning effort is invented.

HTTP Responses are streamed with `store:false` and full required context. Optional WebSocket mode reuses the authenticated connection and same-connection response IDs; reconnects replay context without re-executing tools. Only completed, validated function calls reach the existing local executor. No native OpenAI computer tool or Realtime voice API is used.

See [the implementation and limitations](docs/CHATGPT-SIGN-IN.md). DeepSeek runtime code, key inputs and API-only benchmark launchers have been removed. Existing v22 credentials are removed from the active profile at migration; independently preserved backups are not rewritten. Historical measurements below describe those earlier builds, not GPT performance.

App launches now correlate a newly created window with a fresh accessibility observation, avoiding confusion with older instances or empty internal windows. Installed-app search also matches app IDs, so English names can find localized apps. Windows Calculator uses accessible digit/operator buttons when present; pixel input is refused in that case. A task stops after three desktop failures or three inputs with no observable control-state change. These checks do not establish reliability for arbitrary desktop tasks.

Visual click, double-click and right-click now require the visible element's normalized `target_box` (`left`, `top`, `right`, `bottom`). Mitch calculates its center in screenshot pixels and sends it with the native capture identity; point-only clicks and invalid boxes are refused before input. Exact accessible controls still use direct activation. Center targeting depends on correctly identified element bounds and does not itself prove that the right element was selected. Run `npm run smoke -- --visual-center-test` for isolated native pointer-event verification.

Version `0.6.0-local.11` prefers `target_id` and `expected_name` from the current image's Windows-measured `targets`. Clicks and `draw_computer_target` use those same bounds; named marks are placed on the target window's monitor and stale geometry is refused. When a model must estimate a box, it supplies `target_label` and Mitch verifies the object in a close-up before clicking or drawing a circle/rectangle. Missing/ambiguous close-up targets are refused, without falling back to the original guess. This adds one provider request only for estimated targets. `look_at_screen` now returns the image directly, removing the separate text-only vision handoff. Three clicks without a meaningful image change stop the task; this heuristic is not proof of completion and animated pages can affect it. Marks from one monitor are not composited onto another monitor's screenshot.

Diagnostics: `npm run smoke -- --target-marks-test` checks actual measured clicks and painted circle positions on each monitor. `tests/coordinate-diagnostic.js` separately checks native pixel delivery in framed and frameless windows. Optional development flags `--grounding-audit` and `--grounding-refinement-audit` make small provider calls on those synthetic fixtures to compare estimated, measured and close-up targeting; they do not operate user apps or establish general desktop accuracy.

Version `0.6.0-local.13` preserves native failure codes and whether input may already have been delivered. `tool_invocation_failed` does not authorize a replay. Model-driven input checks the window inventory before and after its single dispatch, briefly polling reads for a delayed popup. A unique new or changed window belonging to the same process (or with a reported owner relationship) is inspected and brought forward; foreground HWND confirmation is required. Other candidates are returned without choosing one. Browser tabs inside an existing window still require inspection of that window's tab controls. The recovery guard blocks the uncertain action, not every control in its window. Failed input without a fresh observation triggers a read of the source window. A suppressed duplicate returns fresh controls and permits the model to choose the next distinct action; three requests for that blocked action end the task without delivering any of those inputs. No-progress blocks expire only when comparable window content changes; uncertain actions remain blocked for the task across accessibility, visual, and sequence routes. Unverified duplicate navigation clicks in a sequence stop before the duplicate, while explicit Calculator digit entry remains supported.

`open_app` reuses and focuses one existing matching window, and raises a unique newly launched window. `computer_focus_window` can also bring an exact discovered background window forward without clicking it. `npm run smoke -- --window-recovery-test` verifies a real local popup deliberately placed behind its parent, including a simulated error after a delivered click: one physical click, popup recovery, and duplicate suppression. It also checks navigation inside one window after a lost acknowledgement: Messages once, duplicate suppressed, then the contact once. This test makes no external calls or social actions and does not establish live Instagram reliability.

## General computer plans (0.6.0-local.18)

Mitch can plan a short sequence once and execute its steps locally. `computer_execute_plan` resolves live Windows accessibility controls, while `browser_read_page` and `browser_execute_plan` use the browser extension's DOM adapter. Plans can address predictable controls that appear later, such as a result opened after a search. Each phase has up to 12 typed steps and explicit completion assertions; the model independently checks those results against the original request. No model-generated JavaScript, shell commands, CSS selectors or remembered coordinates are executed.

The browser adapter keeps a mutation-invalidated candidate index, checks live values, visibility/enabled state and occlusion before action, and reads values back after filling. The Windows adapter reuses fresh returned observations and validates the exact process/window. A persistent Windows WinEvent listener invalidates cached observations when a window or focus changes; listener failures force fresh reads. Its native driver still performs full accessibility reads after input; this is not incremental UIA subtree capture. Screenshot-based interaction remains available when structured controls are unavailable.

Update the existing Mitch Browser Bridge extension with **Reload** in `opera://extensions`, then open its popup and choose **Enable page controls**. The browser requests optional access to HTTP/HTTPS sites. This lets Mitch read page controls and carry out requested actions; page data used for reasoning is sent to the selected AI provider. Tab controls continue to work without this extra permission. Password/secret/payment fields and child frames are not supported by this adapter. Removing page permission cancels in-flight page plans.

A plan stops on ambiguity, protected controls, document/origin changes, cancellation, or an unknown input outcome. Uncertain inputs are never automatically replayed. The browser protocol verifies per-assertion evidence and preserves unknown-action blocks across worker reconnections for the current task. Large pages can be inspected by a bounded name/role query; incomplete views do not prove absence. Final success covers the phase's assertions, so independent review must still account for every user-requested outcome.

Reproduce the controlled tests with `npm test`, `npm run smoke -- --general-plan-native-test`, and `node scripts/test-general-page.js`. The browser test uses a disposable Opera profile and local fixture, separate from normal browsing. Reports in `test-output/general-plan-native-integration.json` and `test-output/general-page-integration.json` distinguish local execution timing from cloud/model latency. Controlled fixture success does not estimate reliability on arbitrary applications.

Version `0.6.0-local.19` fixes a false stop after a browser menu opens but the next predicted control is missing. Acknowledged DOM inputs now return the full current page/menu and an exact delivered-step ledger. The planner can choose a different observed control; the host blocks replay of delivered steps across fresh reads or worker reconnections, and the task guard blocks native/visual input from bypassing that browser recovery. Unknown delivery remains a task-wide input stop.

If full-page navigation destroys the issuing script's reply channel, the extension can perform one bounded read-only recovery in the same tab/window/origin. Mitch may independently verify that the original task already finished, but this recovery never permits another input. Completion proofs can be scoped even when the full page overview is large. Tool timings now retain fixed-vocabulary failure codes and input counts without page text, URLs, arguments or keys. Update the extension to 1.1.1; old workers are refused before page input until reloaded.

`node scripts/test-github-menu.js` reproduces the reported menu failure in a disposable Opera profile: one profile click, a wrong next selector, fresh menu recovery, blocked replay/cross-route fallback, then one repository-link click and read-only recovery after a full document navigation. It does not access a GitHub account.

## Conditional workflows (0.6.0-local.21)

Mitch can request one bounded workflow for a new desktop task instead of requesting a new model decision after each interface change. The workflow can branch on observed state, read named values, fill them into a different app, wait for an expected result, and follow a verified same-origin webpage link across a document navigation. It uses existing DOM/UIA executors and checks every action against fresh identities. It cannot execute generated JavaScript, shell commands, or arbitrary code. Incomplete controls, unknown input delivery, or an ambiguous target interrupt execution. Screenshot recovery remains available through the existing separate path.

Settings → Faster tasks controls workflow execution, quick planning, preparation while speaking, and reuse. All four default on. The quick-planning toggle applies only to the optional local provider. ChatGPT uses the selected account model without unsupported reasoning settings. Preparation reads relevant app/page state and may draft a plan during stable partial speech, with at most two attempts per utterance; changing the words cancels the old draft. No click, launch, focus, restore or text entry is allowed before the final transcript. Only an exactly matching, unexpired draft can be adopted. Drafts count toward provider usage even when discarded.

New workflows receive an independent whole-request completion review unless the entire request matches a trusted field-edit/navigation grammar and fresh scoped controls prove that exact outcome. Adjacent action phases can be combined while preserving intermediate assertions; all final predicates use one consistent fresh frame. Eligible procedures can be reused without new model decisions after relevant controls match, followed by a full fresh scope check before input. Unrelated control ordering/content may change; relevant ambiguity and new dialogs prevent reuse. When all actions were acknowledged but only the last model-generated assertion was wrong, an approved complete task can learn its small, fully observed destination view instead; execution steps cannot be rewritten this way. Reuse is deliberately limited to one scope and safe display/search/edit operations; submissions, calls, deletion, security/payment actions, app launches and requests for a fresh informational answer are excluded. Stored procedures expire after 30 days, are limited to 32 entries, and are encrypted with Windows secure storage. No pixels, live element IDs or coordinate targets are saved for replay. Unknown outcomes remain task-wide input stops.

See [v24 speed validation](docs/SPEED-VALIDATION.md) for the matched v23 comparison and model trials. The new local completion grammar includes `In "Notepad", set "Text Editor" to "Hello"` when those exact accessible names exist, and `open Instagram and go to messages` when a fresh destination heading or selected item proves navigation. Other wording, compound requests, and incomplete observations retain model review.

The browser navigation feature requires Mitch Browser Bridge **1.2.0**: reload the extension in `opera://extensions` and refresh existing pages. It uses the existing granted page permissions. Older workers retain supported tab/page operations but cannot execute the new navigation methods. There is no additional GPU model and the experimental GoClick default remains off.

Run `npm test` and `npm run smoke -- --task-program-native-test` to verify workflow validation, cancellation, cached-state checks and a real two-window UIA value transfer. Controlled benchmarks distinguish local executor time from actual provider latency. These changes do not guarantee that every unfamiliar or complex task finishes in 1–5 seconds; model planning, page/app loading and external-service delays remain on the critical path.

The 2026-11-09 model probes used real Flash API calls with owned synthetic interfaces. Initial all-High workflow planning regressed and was not selected as the new default. Quick workflow planning plus High review completed a cross-window copy in 4.04 s (one trial), versus the v20 all-High baseline median of 9.55 s (three trials in a different epoch). Conditional edit/save requests still took 11.85–14.37 s. A real learned search procedure used two calls on its first run (3.54 s), then zero on an identical-state repeat. The repeat's 1.67 ms is synthetic fixture/controller overhead, not Windows desktop latency. These small controlled samples do not establish general accuracy or a universal speedup. Separate actual Windows and Opera fixtures test local execution without cloud/speech latency; see `test-output/workflow-model-comparison.json`, `task-program-native-integration.json`, and `browser-navigation-integration.json`.

The separate real Windows replay test completed three identical-state trials in 732–799 ms (median 769 ms), including fresh UIA discovery, cache lookup, one guarded click and result readback. This uses a script-approved known procedure, rather than one learned by a live model. All three trials passed and used zero model calls. Real browser link navigation and tab creation measured 91 ms and 99 ms median in disposable local fixtures; network websites can take longer.
