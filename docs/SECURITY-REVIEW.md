# Preparation security review — 2026-11-09

Scope: main-branch source at `0f35a21`, plus this preparation change. This was a focused source/dependency review on Linux, not a penetration test or Windows certification.

## Findings and changes

1. **Local files could enter portable builds.** Packaging did not apply `.gitignore` and used a small exclusion list. Added a dedicated packaging filter for application directories/files, with explicit rejection of environment files, npm credentials, private-key containers, logs, and user-library/calendar data, including inside runtime directories. Regression tests cover rejected sensitive paths and retained app/driver/license files. This cannot detect secrets embedded in ordinary source or arbitrary permitted assets; inspect release contents.
2. **Public-project documentation was incomplete.** Added MIT licensing metadata and a license file, contribution/security/third-party guidance, and a structured README. Moved historical notes and detailed usage guidance into separate files. Removed personal Windows workspace paths from current documentation; those paths remain in existing Git history and do not require a destructive rewrite.
3. **Privilege and permission risks needed clearer disclosure.** Documented default-off settings, direct actions without per-action dialogs, administrator packaging, cloud data flows, and Stop's inability to undo delivered input. Updated the Settings copy. The existing administrator execution level is unchanged; a future least-privilege redesign needs Windows integration testing.
4. **Two mocked unit tests assumed a Windows environment variable.** Added an injectable PowerShell executable path for the mocks, preserving production executable lookup. This allows the suite to run on Linux as well as Windows CI.

## Existing boundaries inspected

Sandboxed/context-isolated renderers disable Node integration, deny popups/navigation, and use an allowlisted preload bridge. Main-process IPC checks frame identity and expected local page URLs. Screen/desktop permissions default off. API keys use safeStorage, while notes/settings are ordinary local files. Cua installation verifies an archive checksum and expected Authenticode signer. Computer-use tests cover stale targets, cancellation, and uncertain delivery.

These controls are not a guarantee against prompt injection, model mistakes, a compromised Windows account, or every third-party UI behavior. Administrator execution increases impact. Native behavior must still be tested on Windows.

## Checks

- Gitleaks 8.30.1, default rules, redacted output: all 11 commits reachable from fetched repository branches, including `main` and `codex/local-ai-architecture`; no leaks found. No remote history was rewritten. Deleted/unreachable remote commits and unknown secret formats are outside this result.
- Unit suite: 208 tests passed on Linux with Node.js 24 (also passed under the host's Node.js 22 runtime).
- `npm audit --omit=dev`: zero reported production vulnerabilities.
- Full `npm audit`: five moderate findings in the build dependency chain (`@electron/packager`, `@electron/universal`, `@electron/asar`, `glob`, `minimatch`). These are two underlying advisories plus affected parents, not five distinct runtime flaws. See [glob cancellation](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) and [minimatch amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249). The installed asar declares glob 13/minimatch 10 ranges; patched major lines are outside those ranges. npm reports no supported fix for parts of the chain. Do not package untrusted source trees; follow upstream fixes through Dependabot. No forced major overrides were introduced without compatibility validation.
- Windows CI configuration added for mocked unit tests, alongside Linux; hosted CI has not yet run in this review.
- Windows smoke/native automation, actual portable packaging, microphone/speaker quality, and live paid OpenAI requests were not run in this Linux environment.

## Release follow-up

Resolve build-tool advisories with compatible upstream releases, run native Windows checks and inspect packaged contents, and verify preserved upstream license notices. ChatGPT sign-in remains a separate phase, per the requested scope.
