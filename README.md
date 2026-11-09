# Mitch

Mitch is an open-source AI desktop assistant for Windows. Use text and voice to interact with applications, automate workflows, and control your computer.

**Preview 0.5.2 · Windows 10/11 x64 · MIT licensed**

## Features

- Floating desktop companion, tray controls, text chat, and live voice.
- Opt-in local “Hey Mitch” wake detection and record-then-transcribe dictation.
- Screen questions, annotations, and screenshot-guided mouse and keyboard input.
- Windows accessibility controls for app discovery, inspection, and interaction.
- Local notes, reminders, calendar imports, and media controls.

This is an independent implementation inspired by Pixie for macOS, not an official Pixie release or a complete port. No extracted app assets, proprietary prompts, or private Pixie services are included. See the [changelog](CHANGELOG.md).

## Install from source

Use Windows 10/11 x64 with Git and Node.js 24 or later:

```powershell
git clone https://github.com/AymaneLk/Mitch.git
cd Mitch
npm ci
npm run setup:cua
npm start
```

The Cua setup command downloads the pinned Windows driver and verifies its checksum and Authenticode signer. If npm install scripts are disabled, run `node node_modules/electron/install.js` first.

Open Settings, enter your OpenAI API key, and save. API requests are billed through your OpenAI API account. Enable Screen sharing and Desktop actions only when you want those capabilities. Model availability depends on your account; models can be changed in Settings.

For an existing portable build, extract the entire ZIP and open `Mitch.exe`, keeping its neighboring files intact. Builds are currently unsigned. Packaging requests Windows administrator access through UAC; source launches use the privileges of the launching process.

## Permissions and privacy

Screen sharing, desktop actions, and voice wake are off by default. Once desktop actions are enabled, requested actions run without per-action dialogs and can change files, send input, or submit forms through other apps. Blue screen corners indicate active computer use.

**Press Ctrl+Alt+Escape or Stop to cancel pending work and pause computer use.** Stop cannot undo input already delivered. Resume explicitly in Settings. Closing the main window leaves Mitch running in the tray; choose Quit to exit.

Screenshots, requested app content, chat text, and active voice/dictation audio may be sent to OpenAI. Ambient wake detection runs locally. API keys use Windows-protected Electron storage; local notes and settings are not encrypted. See [Security and privacy](SECURITY.md) and the [user guide](docs/USER-GUIDE.md) for data locations and limitations.

## Development and validation

```powershell
npm test
npm run smoke
node tests/windows-integration.js
node tests/cua-integration.js
npm run smoke -- --visual-test
npm run smoke -- --wake-test
npm run package
```

Unit tests use mocked external services. Native smoke, Cua, microphone, and packaging checks require Windows and the relevant hardware. Passing unit tests does not establish live model or Windows automation reliability. The [user guide](docs/USER-GUIDE.md) includes shortcuts, model configuration, and further checks.

## ChatGPT sign-in status

Mitch currently uses an API key. **Continue with ChatGPT is not implemented in this update.** OpenAI documents an open-source dynamic-registration flow for eligible ChatGPT plan usage; this is a separate authentication and inference integration, not an API-key substitution or certification. See the [integration follow-up](docs/CHATGPT-SIGN-IN.md).

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks, and contribution expectations. Report sensitive vulnerabilities using [SECURITY.md](SECURITY.md).

Mitch source is licensed under the [MIT License](LICENSE). Third-party dependencies and downloaded components retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
