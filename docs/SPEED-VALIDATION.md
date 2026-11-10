# v24 computer-use speed validation

Measured on this Windows machine on 2026-11-09. These are controlled task results, not general computer-use accuracy or a universal 1–5 second guarantee.

## What changed

- A trusted parser recognizes the whole request for a bounded set of field edits and navigation requests. Fresh exact scoped evidence can finish these without another model review. Missing destination semantics, compound requests, partial observations and uncertain delivery retain the existing review/stop behavior.
- Scope-first wording and explicitly quoted app names now enter read-only preparation. Other quoted strings remain data, so a field value such as `GitHub` does not cause preparation of that website.
- Adjacent action phases can share one local execution plan. Intermediate assertions and explicit branch/bind/wait boundaries remain. Final predicates share one fresh consistent observation.
- Approved single-scope procedures match their relevant selectors instead of hashing every unrelated control for lookup. Execution still compares the full freshly observed scope before any input. Relevant ambiguity, protected fields and new dialogs prevent reuse.
- Browser observations reuse a candidate-element index until DOM mutation. Names, values, visibility, enabled state and target geometry remain live. Windows WinEvent metadata invalidates short-lived native observation reuse; an unavailable listener forces fresh reads. Native driver captures remain full trees, not incremental UIA subtrees.
- Existing CPU speech, direct app/folder/browser routes, guarded execution, Stop and visual fallback are preserved.

## Matched native comparison

`scripts/run-speed-benchmark.js --final-check` loaded the preserved installed v23 controller modules and the current source in the same bounded harness. Both used `gpt-6.1-sol`, HTTP, the same real Cua driver, the same owned Electron fixture and the same supported tool capabilities. Version order alternated. Timing includes discovery/preparation, real model requests, Windows input, verification and the final reply; it excludes fixture reset, speech and application launch. Model reuse was disabled for the cold comparison.

| Task | v23 | v24, same model | Confirmed trials v23 / v24 |
| --- | ---: | ---: | ---: |
| Exact field edit, two trials each | 14,183.5 ms median; 3 model calls | 5,198 ms median; 1 model call | 2/2 / 2/2 |
| Navigate to Settings, two trials each | No confirmed completion | 10,380.5 ms median; 2 model calls | 0/2 / 2/2 |
| Open settings, handle prompt, edit, apply, verify; one trial each | 14,869 ms; 3 model calls | 11,708 ms; 2 model calls | 1/1 / 1/1 |

The field task was 63.4% faster and the conditional task 21.3% faster in these samples. v23 did navigate in both navigation trials, but stopped without confirming the result; those early stops are not counted as faster successful completion. Overall confirmed completion was 3/5 versus 5/5. Samples are too small to estimate general accuracy, P95 or a stable speed distribution.

Three learned field-procedure repeats used zero model calls and took 660, 660 and 710 ms, including fresh native preparation, binding and final verification. This first replay check added unrelated passive page content. A separate final model/replay check adds an actual accessible button, so it also exercises the relaxed procedure lookup rather than merely an invisible text change.

The native driver does not expose every passive HTML heading. Local navigation completion therefore does not accept an arbitrary text match as destination proof. The benchmark's final Saved indicator is an accessible fixture control; independent DOM state also verifies the exact saved value and click sequence. No user apps, accounts, files, browser pages, microphone or screenshots were controlled in the benchmark.

## Model selection and local checks

Eight account-available models were screened on the field task. Single samples do not establish a reliable winner. The two fastest candidates were checked again against the final code and corrected fixture. `gpt-5.6-luna` stopped without confirming the field task and was excluded. `gpt-6.1-terra` confirmed all three tasks, then confirmed all three again in a separate suite. Its confirmation-suite median was 7,840 ms versus 10,259 ms in the original-model comparison, exceeding the preset 15% improvement threshold. Fast was changed to `gpt-6.1-terra`; Smart remains `gpt-6.1-sol`, and HTTP remains selected. This is a small targeted selection, not a general reliability ranking.

| v24 task with selected Fast model | Two-trial median | Model calls per trial |
| --- | ---: | ---: |
| Field edit | 4,586 ms | 1 |
| Navigate to Settings | 7,573 ms | 2 |
| Conditional edit/apply task | 10,432 ms | 2 |

These model trials ran after the matched architecture comparison, so their difference also includes model choice and time-varying service latency. Three subsequent field-procedure replays with a new unrelated accessible button took 703, 664 and 652 ms, all with zero model calls and independent exact readback. Raw results are in `test-output/speed-model-final.json`.

All 785 automated tests passed, including stale-state refusal, unknown-outcome stops, exact goal contracts, workflow assertions, procedure invalidation, cancellation and provider regressions. The real Windows listener started and invalidated its owned window after a control/focus change. In a real Chromium renderer, 100 observations reused one candidate scan; adding a control caused a second scan, changed values were read live, and hidden controls disappeared. The entire small index probe took 11 ms; that is not an end-to-end desktop task measurement.

Packaged administrator smoke and ChatGPT settings tests passed for v24. The installed archive matched the tested build (`7B4CF133A53154CA1E98A81262A8ECC800335B48EB93AD718180075584F6D6B6`), and desktop inventory confirmed Mitch reopened. v23 was backed up to `outputs/backups/before-speed-20261109-214229`. The user reloaded Browser Bridge 1.3.0 after Opera automation twice timed out; afterward the local bridge had one established loopback connection. No new browser permission was requested.

Earlier pilot reports are retained for diagnosis but excluded from the matched table: the first harness queued nested calls incorrectly; later preliminary runs exposed missing harness capabilities and an inaccessible fixture result. They must not be used as model-accuracy or speed measurements.

## Reproduction

Quit Mitch first, keeping ChatGPT connected, because these opt-in paid tests acquire its normal profile lock to prevent simultaneous refresh-token rotation. Then launch Electron with `scripts/run-speed-benchmark.js --final-check`. The script limits requests and restricts all native input to its exact owned process/window. It requires the locally preserved `outputs/v23-speed-baseline` extraction; that artifact and account state are deliberately excluded from Git. `--candidates-only` validates the two screened candidates against the saved final comparison. Run `scripts/test-native-state-signals.js` through Electron for the independent Windows event and real Chromium index checks.

Raw local evidence: `test-output/speed-benchmark.json`, `test-output/speed-model-screening.json`, `test-output/speed-model-final.json`, `test-output/native-state-live.json`, and `test-output/speed-deployment.json`. These files are excluded from Git; the repository contains the bounded harness and this summary.
