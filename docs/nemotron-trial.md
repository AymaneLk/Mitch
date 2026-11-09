# Nemotron English trial — 8 November 2026

Historical trial conclusion: clear latency improvement on this PC, no demonstrated overall recognition accuracy improvement. After this trial, the user requested replacement: v0.6.0-local.5 now uses Nemotron at port 22131 for both dictation and voice. The separate trial server at port 22133 is stopped. Qwen remains installed for rollback via v0.6.0-local.4.

## Setup

- Intel i5-14400F, 32GB RAM, RTX 4060 8GB.
- Nemotron English 0.6B Q8 using NVIDIA NeMo-Speech.cpp 0.3.0, Windows x86-64 CPU runtime. Model revision `ebe59e5a817142986528bbbee5dba8db7b38ed50`. SHA256 values pinned in setup script.
- Qwen3-ASR-0.6B Q8 using the existing CPU llama.cpp service and forced English prompt.
- Both loaded/warm; sequential requests, alternating model order; same mono 16kHz PCM16 WAV inputs. Qwen timing includes the existing ffmpeg adapter, while Nemotron uses its native HTTP endpoint. This compares the current application paths, not pure model inference kernels. Existing model server defaults were retained; this is not an equal-thread comparison.
- Nemotron working set after testing: approximately 1.11 GiB. CPU runtime adds no inference VRAM requirement; the GPU stays available for Mitch's chat model.

## Human speech results

Data: [LibriSpeech test-clean](https://www.openslr.org/12), CC BY 4.0, Vassil Panayotov, Guoguo Chen, Daniel Povey and Sanjeev Khudanpur. First eligible 3–12 second clip per speaker in archive order, 20 speakers. Five of these clips were also attenuated to 5% amplitude, and independently mixed with seeded white noise at 10dB SNR. This is 30 cases, not 30 independent speakers.

| Condition | Qwen word errors | Nemotron word errors | Qwen median time | Nemotron median time |
|---|---:|---:|---:|---:|
| Clean, 20 clips / 329 words | 6 (1.82%) | 8 (2.43%) | 1.176s | 0.451s |
| Quiet, 5 clips / 82 words | 2 (2.44%) | 1 (1.22%) | 1.194s | 0.513s |
| White noise, 5 clips / 82 words | 2 (2.44%) | 1 (1.22%) | 1.331s | 0.484s |

Word errors are Levenshtein edit distance after lowercasing and stripping punctuation, retaining apostrophes. This is not the full OpenASR benchmark normalizer. Proper-name spelling and variants such as “O”/“Oh” and “to morrow”/“tomorrow” contribute errors. The small differences are not statistically established. Recordings are audiobook speech, not the user's microphone, room, accent, or desktop commands. No paid cloud comparison was run.

Clean-clip median latency improved about 2.6×. Quiet/noise cases favor Nemotron slightly, while clean cases favor Qwen slightly. This does not prove that changing the model will fix the reported microphone problem.

Raw references, hypotheses and timings are in `nemotron-trial-results.json`; aggregates and dataset SHA256 are in `nemotron-trial-summary.json`. Audio remains in ignored `test-output` and was not uploaded to GitHub or a transcription provider.

## Streaming check

The public 11-second JFK fixture shipped with [NVIDIA's runtime](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.3.0/test_files/asr/wav/test/jfk.wav) was sent as 16kHz PCM16 chunks paced at 160ms intervals. The English session used a long endpointing threshold so explicit final commit closed the utterance.

- First nonempty partial: 743ms after streaming started.
- Final commit acknowledgement: 172ms after the final audio commit; the completed transcript arrived before that acknowledgement.
- Final transcript retained the expected sentence.
- These are recognizer-only timings for one recording, not time until Mitch speaks. Client scheduling added pacing overhead. Mitch's UI has not been migrated to the streaming protocol; it still submits completed recordings.

## Reproduce

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-nemotron.ps1
powershell -ExecutionPolicy Bypass -File scripts/start-nemotron-trial.ps1
```

For the two-model comparison, run the Qwen baseline services from `v0.6.0-local.4` and retain these benchmark scripts from the newer version. The comparison script refuses to label the active Nemotron backend as Qwen. Wait for `http://127.0.0.1:22133/health`, with those original baseline services running. Download `https://www.openslr.org/resources/12/test-clean.tar.gz` and the JFK WAV linked above into `test-output/asr-comparison` as `test-clean.tar.gz` and `jfk.wav`. Then:

```powershell
vendor/local-ai/venv/Scripts/python.exe scripts/benchmark-asr.py
node scripts/test-nemotron-streaming.js
powershell -ExecutionPolicy Bypass -File scripts/start-nemotron-trial.ps1 -Stop
```

Recommendation: use Nemotron as the next candidate for live transcription responsiveness, but compare a user-provided English microphone recording before claiming an accuracy upgrade. Full conversation streaming, speech interruption and end-of-turn handling remain separate integration work.
