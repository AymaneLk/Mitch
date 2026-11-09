# Security and privacy

Mitch is a Windows preview with powerful desktop access. This policy describes the current `main` branch; it is not a security certification.

## Reporting vulnerabilities

Use GitHub's **Report a vulnerability** option on this repository's Security tab if available. If private reporting is unavailable, open an issue asking the maintainer for a private reporting channel without exploit details or sensitive data. Do not publish credentials, user content, or a working exploit in a public issue. Only the current preview is maintained; no response-time guarantee is offered.

## Permissions and limits

- Screen sharing, desktop actions, and local wake detection default to off.
- Desktop actions run without repeated confirmation once enabled. They can interact with apps, change files, type text, and submit forms. The model's instructions are not an enforceable sandbox against every harmful action or prompt injection.
- The portable build requests administrator access through UAC, increasing the impact of a compromised app or mistaken action. Secure Windows desktops remain inaccessible. Do not approve elevation unless you intend to grant it.
- Blue corners indicate computer activity. Stop or Ctrl+Alt+Escape cancels pending tasks and pauses computer use; already delivered actions cannot be reversed. Resume is explicit. Closing the window leaves the app in the tray.
- Target freshness, password-field detection, argument validation, and cancellation reduce risk but cannot guarantee correct behavior in every application. Stay present during sensitive tasks.

## Data handling

API keys are protected with Electron safeStorage and Windows account protection and decrypted in the main process. This does not defend against compromise of that Windows account. Notes, reminders, settings, and imported calendars are stored locally without content encryption in `%APPDATA%\Pixie Windows Companion` (the legacy directory preserves existing profiles).

Recent chat history and screenshots are held in memory. Chat, requested app content, screenshots, active voice audio, and submitted dictation may be transmitted to OpenAI. Ambient wake detection is local. Provider retention policies still apply even where requests specify `store:false`. There is no additional analytics service in this source.

## Development and releases

Never commit credentials or local user data. `.gitignore` does not remove secrets already committed. Rotate exposed credentials before considering history cleanup; history rewriting requires coordination with collaborators. Review build contents as well as Git history: packaging uses its own filter to exclude local credential files and user data.

Run dependency and secret checks before releases. Third-party components keep their own licenses. Windows builds are unsigned; the Cua installer verifies its pinned archive checksum and expected Authenticode signer. See [the review](docs/SECURITY-REVIEW.md) for the scope and limitations of the latest checks.
