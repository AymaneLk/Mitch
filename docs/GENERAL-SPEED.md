# General workflow validation — v26

## Changes

These changes apply to structured native/browser workflows without a website recipe:

- An independent, read-only model pass interprets the entire request as bounded final predicates while the action planner works. It never sees the actor's plan and cannot execute tools. Exact, unique, current controls in the original scopes must prove every predicate before serial semantic review can be omitted. Unknown, truncated, ambiguous, protected or unsupported outcomes retain normal review. Dynamic copies require actual execution-time source reads. Eight-second compiler timeout and cancellation apply; a declined/timed-out compiler can add a model request without saving time.
- Preserve the Windows driver's checkbox state (`selected` on `CheckBox`) as `checked`, including during preparation. Missing state remains unknown.
- Distinguish a unique typed control from inert text labels with the same name. Two interactive matches, disabled duplicates and protected matches remain ambiguous. Explicit selectors are preserved.
- Prepare both explicitly named source and destination windows for cross-window tasks. Quoted field values do not select additional windows. Shorter planning instructions avoid redundant fill assertions; the executor still checks every fill.
- After a known failed browser navigation assertion, refresh only the same profile/tab/window/origin locally before semantic review. No input is repeated. A host-generated profile digest survives evidence redaction without exposing the raw session ID.

The existing single guarded executor, Stop, delivery ledger, permission checks, browser recipes and visual fallback remain. Browser Bridge 1.5.0 includes the shared selector fix; reload the extension and refresh controlled pages. No new permission or local GPU model is needed.

## Method

The comparison uses the unchanged installed v25 archive (`676b526ef9cd5c739236d2c5abc59b52e78d51e570f9161c9386e61d5f1f3307`), extracted under `outputs/general-baseline-v25`, and v26 source. Both use the same account-selected `gpt-6.1-terra` over HTTP. Procedure reuse and speculative voice planning are disabled to measure cold, unfamiliar tasks. Native actions use the real Windows driver; browser actions use the production extension and dispatcher. Neither suite offers site-specific task tools.

Six native cases run in process-owned disposable Electron windows with randomized titles. They cover multiple fields and a checkbox, both branches of an optional dialog, an exposed hostile notice, and two cross-window transfers of fresh random values. Independent renderer readback verifies exact saved values and button counts. This is real OS execution on controlled fixtures, not arbitrary-application coverage.

Three web cases use the public [Selenium demonstration form](https://www.selenium.dev/selenium/web/web-form.html) in an isolated, logged-out Opera profile. Only synthetic test data is used. CDP handles setup and independent final DOM/URL readback, not timed actions. No existing user tabs or accounts are touched.

Timing is typed request to returned answer, excluding voice, application/browser startup, fixture setup and independent post-run readback. Native discovery is warmed before timing, but preparation and fresh execution reads remain timed. Runs are sequential on the normal desktop with uncontrolled network/CPU load. Native enumeration occasionally stalled for 2–5 seconds. These small, nonrandomized samples cannot establish population accuracy or an all-task latency guarantee. Concurrent model request durations overlap and must not be added to infer wall time.

## Final matched results

Each cell is one run. A failed baseline's time is time to failure, **not successful latency**.

| Task | v25 | v26 | Independently verified completion |
|---|---:|---:|---|
| Native multiple fields + checkbox + save | 12.78 s, failed | 10.81 s | Failed → passed |
| Native optional dialog present + edit/save | 12.62 s, failed | 12.48 s | Failed → passed |
| Native optional dialog absent + edit/save | 10.46 s, failed | 12.26 s | Failed → passed |
| Native edit/save with hostile notice | 8.49 s, failed | 7.98 s | Failed → passed |
| Native copy two values across windows | 15.34 s | 8.50 s | Passed → passed; 45% less time |
| Native copy fresh values across windows | 17.29 s | 7.01 s | Passed → passed; 59% less time |
| Public form: edit two fields | 8.02 s | 4.77 s | Passed → passed; 41% less time |
| Public form: edit fields + checkbox states | 13.52 s | 7.82 s | Passed → passed; 42% less time |
| Public form: fill, submit, verify destination | 21.70 s | 9.86 s | Passed → passed; 55% less time |

Final completion: **v25 5/9; v26 9/9** on these cases. This is not a general accuracy percentage. Browser completion remains 3/3 while taking 41–55% less time. Native completion improves 2/6 → 6/6. The comparable successful cross-window tasks take 45–59% less time. Native repeated optimized runs varied: the earlier six-case confirmation also passed 6/6, at 7.14–17.20 seconds; the final run was 7.01–12.48 seconds. Only one final web trial per case was measured.

## Evidence and limits

- `test-output/general-speed-baseline-accessible.json` and `general-speed-final.json`: matched native results, tools, model phases, independent states.
- `test-output/general-web-baseline.json` and `general-web-final.json`: matched public-web results.
- Intermediate `optimized*` reports retain development failures. In particular, early browser trials correctly performed submission but hit the bounded model-call cap before confirming it; those were failures and are not counted as final successes.
- An initial native probe used a plain heading the driver did not expose. It is retained as `general-speed-baseline2.json`, excluded from matched timing; both compared versions instead use the same accessible Save status field. Missing native checkbox state was a product bug and remains represented in the baseline failures.
- All 824 source tests passed. Automated coverage includes cancellation, ignored aborts, protected/duplicate controls, missing state, stale/wrong profile evidence, dynamic source reads, malformed contracts, and read-only navigation recovery. Packaged checks are additionally required before installation.

**The 1–5 second target is not achieved for all tasks.** Most remaining time is remote planning/review, not execution: final browser workflow execution itself took tens of milliseconds. Unknown visual layouts, large/incomplete accessibility trees, authentication, ads and server delays still require extra work. This release improves general structured workflows; it does not demonstrate a speed gain for screenshot-heavy visual tasks.

## Installation

v26 was installed and reopened after both elevated packaged checks passed (native/UI smoke and ChatGPT settings/encryption smoke). Its installed archive matches the tested SHA-256 `1f9f2ac7aff42d8a224d8e2ee8a4f5586eef34deb7d4f5be4ba6be00a13b78b7`; runtime modules also match source. v25 backup: `outputs/backups/before-general-speed-20261109-231247`. Deployment evidence: `test-output/general-speed-deployment.json`.

The user confirmed reloading Browser Bridge 1.5.0 after Opera capture timed out twice. Mitch reports one connected Opera client with page access enabled. The packaged settings test uses an isolated OAuth fixture; live account inference was tested in the preceding benchmarks, not repeated against the running app after installation.
