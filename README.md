# Mitch

Windows Electron desktop companion with notes, reminders, dictation, screen understanding, and Cua desktop tools.

## Local AI preview

Chat, vision and tool calls use Qwen3.5-4B Q4_K_M through llama.cpp on the GPU. Dictation and voice recognition use Nemotron Speech Streaming English 0.6B Q8 on the CPU. A local Kokoro service supplies English speech synthesis. These local requests have no API charges or provider daily quotas; they use your hardware and electricity. Failed local requests do not fall back to a paid provider.

Version 0.6.0-local.5 forces local chat, dictation and voice. Cloud API calls are blocked even when an old key is saved. Voice uses Nemotron ASR → Qwen/tools → Kokoro with manual Send turn by default and optional automatic submission after 1.8 seconds of silence. Choose the input device in Settings; the voice bar shows its name and input level. Capture pauses while thinking/speaking; End conversation cancels pending work. This is half-duplex, not an interruptible streaming conversation. Pipecat, Silero and SmartTurn are not integrated. OmniRoute remains separate.

The original cloud edition remains on `main` and tag `v0.5.2-cloud`. The local edition is on `codex/local-ai-architecture`.

### Setup (Windows NVIDIA)

Requires Node/npm, uv, Python 3.12 (managed by uv), and a compatible NVIDIA driver. Tested on RTX 4060 8GB / 32GB RAM. GPU memory was about 7.4GB in the test environment, so other GPU applications may cause contention.

```powershell
npm ci
npm run setup:cua
powershell -ExecutionPolicy Bypass -File scripts/setup-local-ai.ps1
powershell -ExecutionPolicy Bypass -File scripts/start-local-ai.ps1
npm start
```

Allow services to load. In Settings select Local for both chat and dictation. Defaults: chat `http://127.0.0.1:22130/v1`, model `mitch-local`, speech `http://127.0.0.1:22132`. ASR internally listens on port 22131. All three services bind to loopback. Health endpoints: chat/ASR `/health`, speech `/health`. No cloud key is sent to these endpoints. Local dictation returns the raw transcript without cloud formatting.

Model revisions/checksums and Python dependency versions are pinned under `local_runtime`. Downloads and environments stay under ignored `vendor/local-ai`; packaging excludes this directory. Packaged Mitch can use services started from this checkout. Services do not automatically start after reboot. Stop them with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-local-ai.ps1 -Stop
```

### Verification

With services running:

```powershell
npm test
npm run smoke
vendor/local-ai/venv/Scripts/python.exe scripts/test-local-speech.py
node scripts/test-local-ai.js
```

Speech tests generate synthetic English/French audio and a controlled vision fixture; run them before the local AI test. AI tests use a mock note dispatcher, not your notes. Results go to ignored `test-output`. Tests cover actual model chat, tool selection, image recognition, WebM transcription and Kokoro output. They do not establish microphone quality, long-session reliability or live conversation latency.

Initial verification on 2026-11-08: 213 unit tests and desktop smoke passed. Local chat ~1.7s, tool round trip ~1.0s, controlled vision ~0.5s, short synthetic ASR clips ~1.1–1.6s. These are single-run measurements, not performance guarantees.

To return to the cloud edition, use the `v0.5.2-cloud` checkout. Your saved key is preserved. Local models are smaller than the previous cloud models; review their actions and use Stop when needed.


For Woof versus Kokoro measurements, reproduction steps and voice limitations, see [the local voice evaluation](docs/local-voice-evaluation.md).

Current language policy is English-only: the ASR server uses the English-only Nemotron model, Kokoro accepts English output only, and Mitch is prompted to reply in English. Earlier French benchmark results describe historical versions.

To roll back recognition, stop the current local services, check out tag `v0.6.0-local.4`, and restart its local services. Qwen ASR model files remain installed. The full cloud baseline remains at `v0.5.2-cloud`.
