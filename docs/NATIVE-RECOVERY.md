# Native plan recovery — v27

The user's latest diagnostic ended with `computer_execute_plan`: `ambiguous_target`, one attempted and completed step, `verified:false`, and `outcome_unknown:true`. The AI immediately returned the generic “An action was sent…” message. No prompt, app title, or private content was saved in that diagnostic, so it does not identify every affected task.

The native driver can return `effect:unverifiable` after a click that changes the interface. The old plan executor correctly retained uncertainty, but its caller had no native equivalent of the existing partial browser-plan recovery. A later ambiguous selector therefore ended the whole task even when fresh controls allowed useful progress.

## Change

`NativePlanRecovery` wraps the existing bounded executor. It records exact resolved input targets before dispatch. When a clean native call returns unverified and a later selector/assertion fails, it re-reads the same process/window. Changed interactive controls, or a changed checked/selected state on the clicked control, can authorize a distinct continuation. Focus changes, new snapshot IDs, clocks, unrelated text, and unchanged interfaces cannot.

The original `outcome_unknown` flag is retained. The recovery ledger blocks every attempted operation/target from replay, including different selectors and fresh tokens. `PlanTaskGuard` prohibits alternative input routes; the native wrapper also refuses window changes. A new user task has a separate ledger. Transport errors, escalation, partial views, cancellation, and deadlines still stop input.

If fresh evidence is available but distinct continuation is not justified, a single tool-free completion audit may establish that the requested result already exists. Otherwise it stops. Nested workflows preserve these flags and the underlying failure reason instead of dropping them. No browser extension update or model change is required.

## Validation

- Unit regressions cover the original ambiguity/uncertainty combination, delayed accessibility readback, prefix and cross-route replay, unchanged interfaces, unrelated text changes, native window binding, driver failure/escalation, and AI completion review.
- `scripts/test-native-plan-recovery.js` performs real Cua clicks in one owned Electron window. It first reproduces the old failure, then opens a menu, blocks a repeated menu click, rejects a visual-route replay, chooses the distinct Alpha control, and verifies the final interface independently from fixture state. Native responses are unmodified. It does not access user applications or account credentials and makes no model calls.
- All 833 source tests passed. Source-test results: `test-output/recovery-source-tests.txt`. Live results: `test-output/native-plan-recovery-live.json`. Deployment results: `test-output/recovery-deployment.json`.

These regressions establish the repaired failure path, not universal computer-use accuracy or end-to-end voice/model latency. Genuinely unobservable outcomes still require stopping.

## Installation

v27 was installed and reopened after both elevated packaged checks passed (native/UI smoke and isolated ChatGPT settings/encryption smoke). The packaged native recovery test also passed with unmodified driver responses: two actual clicks, zero replayed clicks, and a blocked alternative input route. Its controlled local recovery/completion segment took 246 ms; this excludes speech and model latency.

Installed archive SHA-256: `952c3a33c347c8f4796149b8e2ce89c7fb4b1a6cae62e7680271336fb924ca9f`, matching the tested package. v26 backup: `outputs/backups/before-recovery-20261109-233605`. Opera reconnected with page access enabled. ChatGPT credentials and local voice settings were preserved; this validation used no live account inference.
