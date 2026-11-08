# Local voice evaluation — 8 November 2026

The original cloud edition is preserved at `v0.5.2-cloud` and `main`. The local edition lives on `codex/local-ai-architecture`, with tested release `v0.6.0-local.2`.

## Current local edition

Microphone → local energy/silence detector → Qwen3-ASR CPU → Qwen3.5-4B GPU + Mitch tool dispatcher → Kokoro CPU → speakers.

All AI providers are forced local on profile load and save. The backend blocks cloud AI requests before reading credentials; the UI no longer permits cloud connections. Existing encrypted credentials are preserved for the original cloud edition. User-requested browser actions and websites can still use the internet.

Voice is half-duplex: capture pauses during inference and playback. A one-second silence ends a spoken turn; recordings are capped at 30 seconds per turn. End conversation cancels pending work and suppresses stale replies. Already delivered desktop actions cannot be undone. The voice output language is selectable as English or French. Spoken replies are prompted to be concise.

Pipecat, Silero, SmartTurn, streaming output and speech interruption are not implemented. The energy detector needs real-room/microphone validation. Automated tests do not establish natural conversation quality or noise robustness.

## Woof comparison

Hardware: Intel i5-14400F, 32GB RAM, RTX 4060 8GB. All speech synthesis ran on CPU. Woof used NumPy with one OpenBLAS/OMP thread; Kokoro's configured ONNX session uses four threads. This compares the proposed deployment configurations, not equal-thread engine efficiency. Kokoro was already loaded; Woof initialization was measured separately (~0.3s). Seed 0, default normalization and retries, three different English sentences per voice. The table uses the second run without concurrent desktop smoke testing. These are small-sample measurements, not a comprehensive benchmark.

| Sentence | Kokoro af_heart | Woof Juno | Woof Mira |
|---|---:|---:|---:|
| Greeting | 0.870s | 2.569s | 21.039s |
| Date and phone number | 2.740s | 2.322s | 2.741s |
| Grocery note | 1.400s | 1.506s | 14.633s |

Time is full WAV generation, not time to first streaming audio. Output duration differs by voice. Raw timings, durations, ratios and ASR transcripts are in `tts-benchmark-2026-11-08.json`.

All nine outputs were non-empty finite audio, and local Qwen-ASR recovered their content. Woof read the phone number as individual digits; Kokoro read grouped numbers and the dashes. We did not run an independent word-error benchmark or a human listening panel. Mira's severe delays repeated in both runs; their internal cause has not been established.

Recommendation: retain Kokoro as the default, particularly for English/French support. Keep Juno as an optional English evaluation candidate. Do not select Mira for latency-sensitive replies on this setup without further investigation. Woof is downloaded for benchmarks, not integrated as the app's voice provider.

Woof revision: `be702960539777fc3f698e54335276a8391b00f9`. See its [model card and license](https://huggingface.co/ConwayResearch/Underdog-Woof). It is free for non-commercial use with attribution; commercial use needs a separate license. **Voice by Underdog Woof.** No weights or third-party runtime code are committed here.

## Tests

- 218 unit tests passed, including cloud request refusal, local voice turn routing, cancellation during ASR, silence boundary capture and stale reply suppression.
- Desktop smoke passed, including local settings, Cua, floating captions, Stop and sender trust restrictions.
- Real local chat, synthetic note-tool dispatch and controlled vision tests passed.
- Synthetic complete voice turn: “Hello Mitch. What is two plus two? Answer in one short sentence.” → “Two plus two equals four.” with playable WAV, 2.277s after submitting the recording. This excludes fixture synthesis, user recording, one-second silence detection and playback. No real microphone or full-duplex test was performed.

Reproduce after starting local services:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-woof.ps1
vendor/local-ai/venv/Scripts/python.exe scripts/benchmark-tts.py
node scripts/test-local-conversation.js
npm test
npm run smoke
```

Generated audio and machine-readable results remain in ignored `test-output`. Model files remain in ignored `vendor/local-ai` and are excluded from packaged builds. Start the local services before launching Mitch; automatic service startup after reboot is not configured.
