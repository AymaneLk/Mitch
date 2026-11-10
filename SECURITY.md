# Security and privacy

Mitch is a Windows preview with powerful desktop access. This policy describes the v0.6.0-local.24 ChatGPT/local edition; it is not a security certification.

## Reporting vulnerabilities

Use GitHub's **Report a vulnerability** option on this repository's Security tab if available. If private reporting is unavailable, open an issue asking the maintainer for a private reporting channel without exploit details or sensitive data. Do not publish credentials, user content, or a working exploit in a public issue. Only the current preview is maintained; no response-time guarantee is offered.

## Permissions and limits

- Screen sharing, desktop actions, and local wake detection default to off.
- Desktop actions run without repeated confirmation once enabled. They can interact with apps, change files, type text, and submit forms. The model's instructions are not an enforceable sandbox against every harmful action or prompt injection.
- The portable build requests administrator access through UAC, increasing the impact of a compromised app or mistaken action. Secure Windows desktops remain inaccessible. Do not approve elevation unless you intend to grant it.
- Blue corners indicate computer activity. Stop or Ctrl+Alt+Escape cancels pending tasks and pauses computer use; already delivered actions cannot be reversed. Resume is explicit. Closing the window leaves the app in the tray.
- Target freshness, password-field detection, argument validation, and cancellation reduce risk but cannot guarantee correct behavior in every application. Stay present during sensitive tasks.

## Data handling

OAuth access, refresh and identity tokens, issued client registrations and host identity are encrypted together with Electron safeStorage / Windows account protection in `chatgpt-auth.json`. Writes are atomic and refreshes serialized. Tokens are decrypted only in the main process, never exposed through renderer IPC or included in diagnostics. This does not defend against compromise of that Windows account. Notes, reminders, settings, and imported calendars are stored locally without content encryption in `%APPDATA%\Pixie Windows Companion` (the legacy directory preserves existing profiles).

Recent chat history and screenshots are held in memory. When ChatGPT is selected, chat, requested app/page content, transcripts, and permitted screenshots may be transmitted to `https://api.openai.com/v1/responses`. OAuth uses the official OpenAI issuer and signed identity validation. Model output remains untrusted; custom calls must pass the existing tool allowlist, schema checks, permissions and outcome verification. No API-key billing fallback is enabled. Local chat uses loopback; speech recognition, synthesis and ambient wake detection stay local. Preparation while speaking can send task context before the final transcript but cannot execute input. `store:false` is used; provider retention policies still apply.

The optional Browser Bridge pairs with an authenticated loopback service. Its generated extension directory contains a local pairing token and must not be published. Tab controls use tab titles/URLs; page controls require additional browser permission and expose task-related page controls to the planner. Learned procedures are encrypted with Windows-protected storage; the latest task timing report stores bounded operation metadata rather than transcripts, screenshots, or credentials. These checks do not make arbitrary website content trustworthy or guarantee task completion.

## Development and releases

Never commit credentials or local user data. `.gitignore` does not remove secrets already committed. Rotate exposed credentials before considering history cleanup; history rewriting requires coordination with collaborators. Review build contents as well as Git history: packaging uses its own filter to exclude local credential files and user data.

Run dependency and secret checks before releases. Third-party components keep their own licenses. Windows builds are unsigned; the Cua installer verifies its pinned archive checksum and expected Authenticode signer. See [the review](docs/SECURITY-REVIEW.md) for the scope and limitations of the latest checks.

## ChatGPT sessions

Disconnect cancels pending work, attempts bounded refresh-token revocation and clears local tokens. If remote revocation cannot be confirmed, Mitch reports that explicitly; remove its connection in ChatGPT settings too. Account changes invalidate active requests and clear conversation context. Benchmarks acquire the same profile lock as the app to prevent concurrent rotating-token refresh. System-browser authentication does not inspect browser cookies or ask for passwords in Mitch. Legacy DeepSeek credentials are removed from the active library on migration; older backups remain the user’s responsibility.


### General structured execution (v28)

Compact workflows are data, fully compiled and validated before input. Numeric prepared-scope references can only resolve to the host-provided scope list; every binding still refreshes identity. Ancestor selectors disambiguate observed controls and never fall back to coordinates. Embedded frames are explicitly bound to browser document IDs and permitted HTTP(S) origins. Unknown delivery blocks further input.

Recognized destructive, financial, access-changing or externally communicating controls require a local approval dialog; refusal stops the task. This conservative label backstop is not a complete semantic risk detector: opaque labels still require planner judgment and user clarification. Protected fields remain unavailable.

The native text fallback accepts only a unique named Win32 Edit child of the exact process/window, with a matching original value, writable non-password style and exact post-write readback. It is enabled only by the exact trusted driver diagnostic that ValuePattern/RangeValuePattern is absent, never by a generic tool failure. Timeouts after issuance remain unknown and cannot be replayed. The persistent helper accepts bounded JSON fields, not executable code.
