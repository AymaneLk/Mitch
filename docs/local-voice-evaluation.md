# Local voice evaluation — 8 November 2026

## Active configuration: v0.6.0-local.6

At the user's request, manual Send turn and its toggle are removed. Voice submits automatically after 1.8 seconds of silence. The microphone selector and meter remain. Targeted voice lifecycle tests and the Electron capture-controls check passed.

At the user's request, Nemotron Speech Streaming English 0.6B Q8 replaces Qwen-ASR for dictation and voice. It runs on CPU at port 22131 through the existing local speech adapter. Chat/vision remain Qwen3.5-4B; speech output remains Kokoro. English-only, no cloud fallback. The app still submits completed recordings; streaming captions and interruptions are not integrated.

Validation: 220 JavaScript tests and 2 Python adapter tests passed, covering local-only upload, English language selection, invalid responses and no fallback. Actual WebM dictation passed (531ms ASR on a synthetic clip). A full local voice turn returned the correct arithmetic answer and WAV in 3.192s after recording submission. These are synthetic single-run timings, not user-microphone accuracy measurements. Qwen weights and tag v0.6.0-local.4 remain available for rollback.

The sections below describe the research and earlier configurations.

## English-only update and model research

As of v0.6.0-local.4, recognition is conditioned on English, replies are instructed to be English, and speech synthesis rejects non-English language selections. The current installed models remain Qwen3-ASR-0.6B and Kokoro. English WebM transcription/TTS, non-English TTS rejection, a complete local voice turn and all 220 unit tests passed. The full turn took 3.991s after restarting services; this is another single synthetic measurement, not a user-microphone accuracy result.

The Qwen ASR template uses the official `language English<asr_text>` assistant prefix. Reference: [Qwen inference implementation](https://github.com/QwenLM/Qwen3-ASR/blob/main/qwen_asr/inference/qwen3_asr.py).

Research shortlist (not installed or benchmarked on this PC):

- [NVIDIA Nemotron Speech Streaming English 0.6B](https://huggingface.co/nvidia/nemotron-speech-streaming-en-0.6b): recommended next trial for real-time English recognition. Supports 80/160/560/1120ms chunks; NVIDIA reports 6.93% average WER at 1120ms and 7.67% at 160ms. Chunk duration is not total conversation latency.
- [NVIDIA Canary-Qwen 2.5B](https://huggingface.co/nvidia/canary-qwen-2.5b): accuracy-first English candidate, with reported average WER 5.63%. Larger model and less attractive for simultaneous GPU residency: this machine's 8GB RTX 4060 was already using ~7.1GB with Mitch running.
- [NVIDIA Parakeet TDT 0.6B v2](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2): English-focused candidate for completed utterances, with reported average WER 6.05%.

[NeMo-Speech.cpp](https://github.com/NVIDIA/NeMo-Speech.cpp) now documents native Windows installation, CPU/GPU ASR and a streaming server. This makes Nemotron a credible integration candidate, but performance must be measured on this machine with representative human speech. These model-card scores do not establish equivalence to Mitch's previous OpenAI live model; we have no matched recordings or cloud baseline for that comparison. Moving closer to the old live experience also requires streaming transport, reliable end-of-turn detection and interruption handling.

The separate [Nemotron Labs VoiceChat full-duplex model](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/s2s/README.md) requires at least 16GB of GPU-accessible memory in its recommended configuration. It is not the same as the 0.6B streaming recognizer and is not recommended for direct deployment on this 8GB GPU.

The evaluation sections below describe the earlier multilingual versions where applicable.

The original cloud edition is preserved at `v0.5.2-cloud` and `main`. The local edition lives on `codex/local-ai-architecture`, with tested release `v0.6.0-local.2`.

## Current local edition

Microphone → local energy/silence detector → Qwen3-ASR CPU → Qwen3.5-4B GPU + Mitch tool dispatcher → Kokoro CPU → speakers.

All AI providers are forced local on profile load and save. The backend blocks cloud AI requests before reading credentials; the UI no longer permits cloud connections. Existing encrypted credentials are preserved for the original cloud edition. User-requested browser actions and websites can still use the internet.

Voice is half-duplex: capture pauses during inference and playback. Automatic capture waits 1.8 seconds of silence. Disable Auto-send and use Send turn to preserve pauses or submit quiet speech. Recordings are capped at two minutes per turn. End conversation cancels pending work and suppresses stale replies. Already delivered desktop actions cannot be undone. The voice output language is selectable as English or French. Spoken replies are prompted to be concise.

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


## Capture update: v0.6.0-local.3

Manual Send turn is now the default, so natural pauses or low volume do not automatically submit a partial utterance. Optional auto-send waits 1.8 seconds. Settings includes a microphone selector used by both voice and dictation. The voice bar identifies the actual microphone and shows live input level. No microphone audio is persisted for diagnostics.

220 unit tests passed and a targeted Electron control check passed (microphone selector, manual mode, Send turn, cleanup). The broader desktop smoke failed twice at Cua accessibility inspection with a zero-node timeout, before voice caption checks; this has not been resolved by the capture change. Real user microphone/transcription accuracy still needs validation. Qwen-ASR remains the recognition model; Woof is TTS and cannot improve transcription.
