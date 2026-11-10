# General computer-use audit and upgrade plan

Inspected before production changes, 9 November 2026. Baseline: installed v27, archive SHA-256 `952c3a33c347c8f4796149b8e2ce89c7fb4b1a6cae62e7680271336fb924ca9f`, extracted unchanged into `outputs/general-engine-baseline-v27`. All existing uncommitted work is preserved. Host: Windows 10 Pro 22H2, build 19045.

## Existing architecture

Voice/transcription feeds `AI.chat`. Known local paths are followed by read-only scope preparation, optional verified procedure reuse, and model planning. `computer_run_workflow` executes bounded typed programs with cross-scope bindings, conditionals, variables, assertions and cancellation. Browser operations use an authenticated persistent extension in the existing profile; native operations use a persistent Cua process and live UIA element tokens. Visual grounding is a fallback. Independent goal compilation, final review, task guards and v27 native recovery remain authoritative.

The engine already has persistent sessions, batched plans, conditional execution, local verification, parameterized procedure caching, native event invalidation, browser mutation tracking and parallel preparation. These should be extended, not replaced. Existing application/site shortcuts are not the target of this upgrade and will not serve as evidence of generalization.

## Baseline and bottlenecks

Six real native fixture tasks and three public Selenium browser-form tasks passed on the frozen v27 runtime. Each used the saved selected ChatGPT model, with identical settings intended for the after run. No site recipe, procedure replay, screenshots or speculative planning was used. The native suite includes conditional states and copying unknown values between windows. Timed scope: typed request to verified reply; speech and fixture setup excluded.

Durations were 5.216–12.713 seconds, with 2–3 requests per task. Native planner inputs were approximately 23–25 KB; the offered workflow schema alone was 10,449 bytes. Browser execution took 54–66 ms while model work took seconds. Removing observation or verification would not be an acceptable shortcut.

Coverage gaps found in source: flat name/role selectors cannot describe a repeated button within a specific row; UIA parent/capability data is discarded; preparation truncates at 80 controls and can disable workflow planning on otherwise usable interfaces; page observation only visits the top document and does not traverse shadow roots. New validation must include these unfamiliar layouts, not just repeat the already-passing nine tasks.

## Technology comparison

- **Stagehand:** official [4.4 announcement](https://www.stagehand.dev/blog/changelog-stagehand-4-4) supersedes the suggested 4.2 and documents persistent local-browser reconnection through CDP. Mitch's extension already supplies persistent local DOM actions in the user's normal Opera profile. Adding a second browser controller would not itself remove model latency. First improve that existing path; add Stagehand only for a demonstrated capability gap that cannot be addressed cleanly without duplicating sessions or authentication. No new model provider or Browserbase account is needed for the chosen work.
- **UFO²:** its [local executors](https://microsoft.github.io/UFO/mcp/local_servers/) support the useful principle of routing by capability across UIA and application APIs. Importing its whole planner would duplicate Mitch's existing orchestration and change the tested model/authentication path. Reuse the principle, not another full agent loop.
- **WinApp CLI:** Microsoft's [UIA documentation](https://learn.microsoft.com/en-us/windows/apps/dev-tools/winapp-cli/ui-automation) provides scoped queries and semantic pattern operations, with a reusable .NET library. Per-action CLI startup is unnecessary here: the bundled persistent Cua driver already exposes UIA parent indices, supported actions, bounded reads, query/diff reads, deterministic predicates and batching.
- **FlaUI:** its [UIA wrapper](https://github.com/FlaUI/FlaUI) is useful for a new .NET controller. It would duplicate the controller already bundled with Mitch. Preserve the current Windows 10-compatible native backend and expose its structured information correctly.
- **WebMCP:** optional site-provided capabilities must be feature-detected, origin-bound and checked against the user's requested effects. It is not a universal browser-control replacement, and page-supplied descriptions cannot authorize actions. Do not enable browser experimental flags or introduce a new authentication mechanism merely to claim support.

## Incremental implementation direction

1. Compact general task planning, compiled locally into the existing validated workflow representation. No raw model-generated JavaScript, guessed coordinates, or task-name recipes.
2. Hierarchical symbolic selectors and live disambiguation, preserving native/DOM parent context and existing duplicate/protected-control refusal.
3. Bounded task-relevant planning views without misrepresenting a partial view as complete. Execute and verify against fresh authoritative state.
4. Broader structured browser discovery, including shadow DOM and scoped embedded documents where existing permissions permit it.
5. Recovery that returns fresh relevant evidence and unfinished work without replaying uncertain inputs. Reuse existing learning and guards instead of treating a cached workflow as unconditional authority.
6. Matched before/after measurements, additional unfamiliar layouts, resource sampling, and explicit reporting of unsupported scenarios. Example application names remain benchmark data only.

The 1–5 second goal applies where feasible. Remote model latency, genuinely unknown transitions and inaccessible UI can exceed it. No universal completion rate or speed is assumed in advance.

## Implemented v28

The selected implementation extends the existing persistent extension and Cua/UIA host. No Stagehand, UFO, WinApp CLI or FlaUI package was added, because the measured bottleneck was model planning rather than controller startup; their relevant native/structured execution capabilities were already present. The missing hierarchy, open-shadow and frame capabilities were added to the existing controller. The actual Opera feature probe reported both `navigator.modelContext` and `navigator.modelContextTesting` unavailable; no experimental flags or nominal WebMCP integration were introduced.

A compact data compiler, host-resolved prepared-scope references, one bounded pre-input schema repair, task-relevant preparation and hierarchy-aware procedure fingerprints improve generic planning. Browser frame routing follows the documented [Chrome scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting) and [document-targeted messaging](https://developer.chrome.com/docs/extensions/reference/api/tabs); scripts are fixed application code, not planner output. Cross-origin frames retain their own host permission and document checks.

Real classic Notepad testing exposed a driver capability mismatch: its editable control advertises `set_value` but rejects ValuePattern. A generic Win32 Edit capability path now handles that specific pre-write refusal with unique UIA name resolution, exact process/HWND ownership, native class/protection checks, original-value comparison and bounded WM_SETTEXT/WM_GETTEXT verification. Unknown driver failures never enter this path. No Notepad name or task string is used in production routing.

See `GENERAL-ENGINE-RESULTS.md` for the full benchmark coverage, resource scope, regression corrections and limitations. Existing voice preparation and general verified-procedure reuse remain enabled; no action executes from unfinished speech.
