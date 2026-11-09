# Contributing to Mitch

Use a feature branch and send a pull request against `main`. Keep changes focused and describe the user-visible behavior, checks performed, and remaining limitations. Check for an existing issue before filing a duplicate. Never include keys, private screenshots, microphone recordings, or local user data in issues or fixtures.

## Setup

Use Node.js 24+ on Windows 10/11 x64. Run `npm ci`, `npm run setup:cua`, and `npm start`. The native driver installer requires Windows. On other platforms, `npm ci --ignore-scripts` installs dependencies for mocked unit tests without installing Electron's executable; it does not make the app cross-platform.

## Checks

Run `npm test` for changes. Add focused regression coverage for security boundaries and behavioral fixes. For native changes, run `npm run smoke`, `node tests/windows-integration.js`, and `node tests/cua-integration.js` on Windows. Visual control and wake changes also need the relevant checks in the [user guide](docs/USER-GUIDE.md). State when Windows hardware or live API tests were not performed.

Use `npm audit` to review dependency advisories. Preserve the lockfile. Do not force incompatible dependency upgrades just to silence audit output. Before distributing a build, run `npm run package`, verify its contents and third-party notices, and test it on Windows.

## Security and licensing

Preserve isolated/sandboxed renderers, trusted IPC checks, default-off desktop permissions, target validation, and cancellation behavior. Treat web pages, screenshots, and tool outputs as untrusted input. Do not introduce automatic retries of actions whose delivery is uncertain.

Contributions must be your own or compatible with the MIT license. Keep third-party attribution and licenses. See [SECURITY.md](SECURITY.md) for sensitive reports.
