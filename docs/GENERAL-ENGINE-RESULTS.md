# General engine v28: measured results

11/16 baseline tasks completed and 16/16 final checks completed in this controlled test set. This is coverage on sixteen tasks, not a general computer-use accuracy percentage.

The six native fixture tasks had median end-to-end latency **10.21 → 6.79 seconds**. Across the eleven cases completed by both versions, the median was **8.61 → 6.94 seconds**. Form submission regressed in its final retry; not every task is faster.

## Method

Frozen installed v27 is the baseline (SHA-256 in GENERAL-ENGINE-AUDIT.md). Same selected ChatGPT model, gpt-6.1-terra; Windows 10; identical cold-task settings with procedure reuse and speculative planning disabled. Timing starts at the typed request and ends at the final reply. Microphone/transcription and fixture/application startup are excluded. Native fixtures use real UIA and actual input; web fixtures use the production extension in an owned Opera profile. CDP is only setup and independent readback. Classic Notepad uses fresh process-owned documents; its final UIA value is read independently after the task. No user documents or ordinary browser sessions were modified by the benchmark.

These are single matched samples, with intermediate trials retained. Two full structured rounds were run; the final round exposed an unnecessary test-form approval and a button/heading predicate error. The affected conditional-open and form-submit cases were rerun after the planning-instruction correction; the table explicitly uses those retests. The new native text route was checked separately after both initial Notepad cases failed. No statistical confidence interval or universal 1–5-second guarantee is claimed. Background machine load and remote inference latency were uncontrolled.

## Per-task results

Times for failures mean time to stop/request cap, not successful completion time.

| Task | v27 seconds | v28 seconds | v27 → v28 calls | Result |
|---|---:|---:|---:|---|
| multiple-fields | 12.42 | 6.94 | 2 → 2 | pass → pass |
| conditional-locked | 11.80 | 9.87 | 3 → 3 | pass → pass |
| conditional-open | 12.71 | 11.89 | 3 → 3 | pass → pass |
| untrusted-notice | 8.61 | 6.64 | 2 → 2 | pass → pass |
| cross-workspace | 8.01 | 5.79 | 2 → 2 | pass → pass |
| cross-workspace-new | 7.88 | 6.21 | 2 → 2 | pass → pass |
| unfamiliar-fields | 5.22 | 4.73 | 2 → 2 | pass → pass |
| unfamiliar-states | 10.26 | 7.21 | 2 → 2 | pass → pass |
| form-submit-transition | 7.23 | 12.74 | 3 → 4 | pass → pass |
| repeated | 20.54 (failed) | 9.73 | 8 → 3 | fail → pass |
| large | 6.22 | 5.06 | 2 → 2 | pass → pass |
| shadow | 21.02 (failed) | 4.95 | 8 → 2 | fail → pass |
| iframe | 23.44 (failed) | 7.24 | 8 → 3 | fail → pass |
| popup | 11.87 | 9.76 | 4 → 3 | pass → pass |
| notepad-write | 4.61 (failed) | 4.24 | 2 → 2 | fail → pass |
| cross-application-copy | 6.05 (failed) | 6.59 | 2 → 2 | fail → pass |

The new layout cases cover repeated controls within named groups, a 220-control page, open shadow DOM, a cross-origin embedded editor, and an unexpected dialog. The native cases include both conditional states, prompt-injection text in an interface, multi-field edits, dynamic-value copying, classic Notepad, and two applications in one task. Existing Spotify/media and Explorer folder paths were not live rebenchmarked in this run; no speed improvement is claimed for them. No example-specific production workflow was added.

## Calls, actions and resources

All cases ran with **zero screenshots**. Action counts below are logical executor input attempts, not low-level native messages; only leaf plans are counted, avoiding nested-workflow duplication. Recovery stops are interrupted leaf plans; pre-input compiler refusals are separate. Summed model time can exceed wall-clock time because independent goal compilation overlaps planning.

| Task | AI seconds before → after | Actions before → after | Recovery stops before → after | v28 compiler refusals | CPU seconds before → after | Peak resident MB before → after |
|---|---:|---:|---:|---:|---:|---:|
| multiple-fields | 15.32 → 10.73 | 4 → 4 | 0 → 0 | 0 | 1.094 → 1.203 | 643.8 → 639.5 |
| conditional-locked | 17.49 → 14.35 | 6 → 6 | 0 → 0 | 0 | 0.969 → 1.297 | 649 → 644 |
| conditional-open | 15.55 → 17.30 | 4 → 4 | 0 → 0 | 0 | 1.188 → 1.281 | 631.3 → 637.1 |
| untrusted-notice | 11.89 → 9.97 | 4 → 4 | 0 → 0 | 0 | 0.859 → 0.781 | 639.9 → 633.2 |
| cross-workspace | 10.44 → 7.99 | 3 → 3 | 0 → 0 | 0 | 1.141 → 1.094 | 653 → 652.5 |
| cross-workspace-new | 11.51 → 8.66 | 3 → 3 | 0 → 0 | 0 | 0.984 → 1.25 | 653 → 664.3 |
| unfamiliar-fields | 9.93 → 9.11 | 2 → 2 | 0 → 0 | 0 | 2.781 → 2.219 | 1141.9 → 1133.2 |
| unfamiliar-states | 14.71 → 11.87 | 3 → 3 | 0 → 0 | 0 | 1.344 → 1.094 | 1141.9 → 1139.8 |
| form-submit-transition | 8.88 → 20.32 | 3 → 3 | 1 → 1 | 1 | 0.938 → 3.625 | 1126.5 → 1136.7 |
| repeated | 20.50 → 12.73 | 0 → 3 | 0 → 1 | 0 | 5.656 → 2.609 | 1120.8 → 1116.7 |
| large | 6.14 → 4.97 | 2 → 2 | 0 → 0 | 0 | 1.328 → 0.672 | 1102.3 → 1121.7 |
| shadow | 18.93 → 7.58 | 0 → 2 | 1 → 0 | 0 | 0.891 → 0.719 | 1102.3 → 1126.1 |
| iframe | 21.34 → 8.87 | 0 → 2 | 1 → 0 | 0 | 1.016 → 0.984 | 1054.9 → 1126.1 |
| popup | 14.98 → 15.36 | 4 → 4 | 1 → 1 | 0 | 1.25 → 0.734 | 1051 → 1107.6 |
| notepad-write | 7.17 → 6.76 | 1 → 1 | 1 → 0 | 0 | 0.953 → 1.297 | 566.6 → 645.4 |
| cross-application-copy | 7.20 → 7.89 | 1 → 1 | 1 → 0 | 0 | 1 → 1.406 | 579.3 → 663.7 |

Resource measurements cover the benchmark controller and its live descendants (driver, owned browser/renderers, helpers), excluding the sampler. Sampling boundaries approximate task boundaries; they are not whole-machine CPU/RAM readings. Shorter wall time does not necessarily lower total CPU. Browser CPU usage increased in several samples and RSS stayed broadly similar; resource reduction is not established.

## Remaining limits

- Most time still comes from remote planning and review. Some final tasks take 7–13 seconds. The native controller itself is not the dominant delay.
- The compact planner can still produce a rejected program; one proven pre-input correction is permitted. The final form-submit sample needed this correction and took 12.74 seconds versus 7.23 seconds in v27. This regression is retained, not hidden.
- Closed shadow roots, canvas-only interfaces, opaque native controls, nested-frame ambiguity and frame navigation can require another route or user help. Ordinary same-tab navigation remains independently reviewed after a transition.
- Native text fallback supports capability-verified Win32 Edit controls, not arbitrary rich-text editors. It never retries an unknown write.
- Consequential-label approval is a conservative backstop, not complete semantic risk detection. Protected fields and unknown input remain blocked.
- WebMCP APIs were unavailable in the tested Opera runtime. No experimental browser flags, paid framework, extra AI provider or unofficial login was added.

## Reproduction and evidence

Run the harnesses sequentially with Mitch closed but ChatGPT connected, so rotating OAuth tokens are never refreshed by two owners. `MITCH_BENCHMARK_SOURCE` selects the frozen baseline; unset it for current source. `MITCH_BENCH_TASKS` selects cases in the general native/web/owned-web harnesses. Use an isolated test profile and process-owned fixtures only.

- `scripts/run-general-speed.js`: six native fixture tasks.
- `scripts/run-general-web-speed.js`: three public Selenium forms.
- `scripts/run-unfamiliar-web.js`: five owned unfamiliar web layouts.
- `scripts/run-native-apps.js`: owned Notepad and cross-application copy.
- `scripts/test-native-text.js`: packaged native route plus stale text, wrong process and wrong name refusal.
- `test-output/general-engine-comparison.json`: per-case source reports, timings, counters and resources.

Raw exploratory/failed trials remain in `test-output`, including compact-planner, hierarchy, frame, pre-fix native-app and final/confirmed series. They contain synthetic fixture values, not credentials.
