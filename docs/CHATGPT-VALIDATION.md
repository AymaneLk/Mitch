# v23 ChatGPT validation — 2026-11-09

The user completed the official OAuth flow. The live account granted direct plan use and returned eight available models. Tests used the catalog-selected `gpt-6.1-sol`. The account's shared allowance was exhausted; tests resumed only after the user explicitly authorized approved connected apps to use existing credits. No API-key fallback, credit purchase, auto-reload or account reset was used.

## Live HTTP / WebSocket comparison

Three measured trials per transport, plus one excluded warmup each. Transports alternated. Each trial created one owned in-memory note through Mitch's real AI loop and validated dispatcher, then checked the exact note and final response. Two model calls per task. This excludes Windows execution, microphone, ASR/TTS and application launch.

| Metric | Streamed HTTP | Persistent WebSocket |
| --- | ---: | ---: |
| Verified tasks | 3/3 | 3/3 |
| Median complete task | 5,870 ms | 5,060 ms |
| P95 complete task | 6,155 ms | 6,413 ms |
| Median model call | 2,925 ms | 2,632.5 ms |
| P95 model call | 3,337 ms | 3,964 ms |
| Median first text, final-answer call | 2,726 ms | 1,970 ms |
| Model calls per task | 2 | 2 |

WebSocket's median task time was 13.8% lower, but its P95 was higher. Three tasks is too small to establish a stable speed advantage or general reliability. First-text timing starts at the final-answer request, after the tool call; it is not time from speech onset. Recovery was not induced, so no recovery-success rate is claimed. Raw local evidence: `test-output/chatgpt-transport-benchmark.json` (excluded from Git).

Historical DeepSeek Flash measurements recorded a 1,193.5 ms median and 8/12 exact fixture choices; Pro recorded 1,430 ms and 10/12. Those used different prompts, recorded observations, non-streamed requests and an earlier environment. They do not establish a matched GPT speedup or accuracy difference. In particular, the present GPT results do not justify claiming universal 1–5 second desktop completion.

## Live integration checks

- Synthetic speech → local CPU recognition → real GPT → validated note creation → local CPU synthesis passed in 6,317 ms, from submitting the audio to receiving the generated reply audio. Physical microphone capture and playback were not measured.
- GPT selected the correct observed button and Mitch's native controller clicked it exactly once in an owned Electron window. Independent fixture state and fresh accessibility text confirmed the change; the driver itself marked the input effect unverified, so the test did not treat submission as success. The tool result returned to GPT and produced the expected final response.
- GPT read the changed result from a screenshot of that owned fixture. No user desktop screenshot was sent in this check.
- Local evidence: `test-output/chatgpt-live-smoke.json`; five real model calls for the successful combined run.

All 770 automated tests passed. They cover OAuth/JWT/PKCE, refresh, account isolation, encrypted storage, streaming, tool validation, cancellation, missing completion, usage pauses and both transports. The production dependency audit reported zero known vulnerabilities.

Final packaged Windows smoke and ChatGPT settings tests passed with administrator privileges. They separately exercise the existing native input, readback, Stop/Resume, app discovery, screenshots, encryption and interface. The installed archive matched the tested build's SHA-256, and Mitch reopened with the existing profile. These are targeted checks, not a broad desktop benchmark.
