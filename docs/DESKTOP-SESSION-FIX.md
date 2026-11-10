# Desktop session recovery, v30

The native driver can end an idle desktop session while its MCP process and connection remain alive. Driver 0.41.0 reports an idle lease of about 300 seconds and returns the structured refusal `session_ended`; `start_session` explicitly revives a named session. Mitch previously cached initialization for the whole process lifetime and omitted the session label on window discovery, allowing discovery to use a separate implicit session. A short fresh-process benchmark did not exercise this failure.

The fix applies to all desktop applications:

- Native discovery, inspection, screenshots and input share the same explicit session.
- Session initialization is reasserted on demand after 30 seconds. It adds no background heartbeat and no model request; calls within a batch retain the setup cache.
- An unexpectedly ended read renews the session and repeats that read at most once. Input is never automatically replayed.
- A revived lease or changed connection invalidates old accessibility tokens and screenshots. Pre-dispatch checks prevent input from using the previous session's targets.
- Stop, permission checks, uncertain-delivery guards and partially completed input protections remain active.
- Task timing diagnostics retain `session_ended` rather than replacing it with `other`.

Validation uses 865 source tests plus the exact packaged runtime. `scripts/test-desktop-session.js` creates an owned disposable window, verifies real clicks through independent renderer state, explicitly ends real driver sessions to exercise recovery and refused-input paths, and rejects a screenshot from an ended session. The deployment uses this deterministic session-end test. An optional `MITCH_SESSION_IDLE=1` probe also waits five minutes before inspecting the driver's reported lifecycle state and checking discovery; the idle lease countdown does not establish exactly when cleanup will run. An initial long probe incorrectly assumed an ended-session marker immediately after that interval and failed that assumption; it is not reported as a passed idle-expiry test. It uses no model or account credentials and does not change user applications.

The live result is `test-output/desktop-session-live.json`; installation state is `test-output/desktop-session-deployment.json`. Installation occurs only after packaged smoke and lifecycle checks pass. The update preserves the existing ChatGPT account and browser extension permissions, and does not add Jev, a final AI review or a fixed voice acknowledgement.

Final result on November 10, 2026: v30 installed and reopened. All 865 source tests passed. Packaged smoke and five real-driver lifecycle checks passed, including three actual button clicks confirmed through independent renderer state. The archive SHA256 is `974767f21bce416f60bb87ae4ef41d937a954c7fe06e1d576c7654e1a274cec6`. These checks used a disposable window; they do not claim an end-to-end Spotify playback test. The incomplete long-idle attempt is retained separately as `test-output/desktop-session-idle-attempt.json`.
