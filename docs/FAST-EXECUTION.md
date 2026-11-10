# Fast execution v29

Requested change: use Nus-style execution optimizations without Jev, remove the extra final AI check, and replace the fixed voice acknowledgement with a natural task response.

## Runtime changes

- `fastExecution` defaults to true for new and existing profiles. In this mode, independent goal compilation and the separate final completion reviewer are not called. The previous audit path remains available for regression comparisons with the internal setting disabled.
- A planner can provide `result_text` with a final native, browser or cross-application batch. The host strips this metadata before dispatch. It releases the sentence only after successful local execution and readback, with complete evidence and no unknown effect. `final:false` continues the actor loop for unfinished work or an answer requiring a newly read value. A missing response falls back to “Done.” rather than another model call.
- The general fallback uses a shorter, application-independent instruction prefix. Compact conditional workflows, cross-scope bindings, dynamic reads, local assertions, fresh target resolution and the existing native/DOM/visual fallback remain available.
- Voice preparation now covers the general desktop-request router, including editing and cross-application instructions. It can read and draft while speech is arriving, but does not execute speculative input. Final words must match before a draft is adopted. The local driver is connected while listening; no warm-up inference is purchased.
- The fixed acknowledgement, its speculative speech synthesis, and its playback wait were removed. The popup retains the transcript and switches to Working immediately. The actual task response is synthesized once after completion.
- No Jev integration, additional model, MCP server, account change, GPU model or application-specific production workflow was added.

## Verification and limits

857 source tests passed, including new regressions for one-call completion, delayed response release, incomplete/truncated evidence, intermediate phases, cancellation, uncertain delivery, metadata validation, and no acknowledgement speech request. Existing native/DOM target validation, local assertions, explicit consequential-action approval, Stop and uncertain-write replay guards remain in place.

Removing the independent reviewer changes a tradeoff: the actor now decides which outcomes cover the user's complete request, while the executor verifies the specified local predicates. The local predicates do not independently establish that the planner included every requested semantic outcome. Some tasks still require additional observation/planning calls, particularly unknown transitions and answers requiring freshly read values. No universal latency or accuracy guarantee is made.

The existing ChatGPT account and selected model are retained. The official [Models and inference documentation](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) establishes the public Responses route and account model catalog. No undocumented ChatGPT reasoning-effort override was introduced; low-thinking local-model planning remains separate from that OAuth provider.

## Reproduction

`npm test` runs source checks. `scripts/install-fast-execution-build.ps1` pins the packaged archive hash, runs packaged smoke/settings/native checks, compares three owned native tasks with the v28 build, runs three general browser form tasks with independent readback, and then backs up/replaces the installed app. The test host obtains exclusive ownership of the existing OAuth profile. Browser tests use an isolated Opera profile, not personal tabs. Speech, fixture setup and app startup are outside benchmark timing.

Reports are local under `test-output/fast-execution-deployment.json`, `general-speed-fast-v28-before.json`, `general-speed-fast-v29-after.json` and `general-web-fast-v29-after.json`. Live results and installation status must be read from these reports; a successful source test alone does not establish installation or end-to-end speed.

## Measured results and installation

The installer completed on November 10, 2026. The installed and reopened version is `0.6.0-local.29`; its packaged archive SHA256 is `93cd61b708f498b5ced310b4b71d1c0b98e337a653ca34ba25549635af8f9792`. Smoke, settings, native text, native recovery, baseline native, updated native and updated browser checks passed. Opera reconnected after the user reloaded the extension, with page access enabled (status timestamp `2026-11-10T00:16:27.524Z`).

| Native task | v28 | v29 | Model requests before → after |
| --- | ---: | ---: | ---: |
| Multiple fields and save | 6.688 s | 7.105 s | 2 → 1 |
| Conditional editor unlock and save | 9.660 s | 6.512 s | 3 → 1 |
| Transfer between workspaces | 7.263 s | 5.705 s | 2 → 1 |

All three tasks passed independent outcome checks in both versions. Median time fell from 7.263 to 6.512 seconds (10.3%); total time fell by 18.2%. The multiple-field case became 6.2% slower despite using fewer model requests. These are single matched samples with uncontrolled remote inference latency, not a universal speed claim.

The three v29 browser scenarios took 4.436, 5.526 and 5.583 seconds, with one, one and two model requests respectively. All passed independent readback. No matching browser baseline was collected in this run. Across the six v29 live tasks, five completed with one model request; elapsed time ranged from 4.436 to 7.105 seconds, excluding speech and fixture/app startup. Six successful samples are not an estimate of arbitrary-task accuracy.
