# ChatGPT sign-in in Mitch v23

Mitch uses the official open-source Sign in with ChatGPT flow. An eligible account and an accepted ChatGPT plan-usage grant are required. Availability, models and limits depend on the account, workspace and OpenAI policy. A subscription is not an unlimited inference entitlement. There is no separately billed API-key fallback.

## Connect and choose a model

1. Open Settings → Connect ChatGPT → **Continue with ChatGPT**.
2. Complete authentication in your system browser on the official OpenAI site. Approve plan usage if you want this account to provide inference. Mitch never asks for your password or cookies.
3. Return to Mitch after the callback says it is connected. It requests the account-specific model catalog automatically.
4. Choose a model for **Fast** or **Smart**. These are two remembered preferences, not invented model capabilities or reasoning settings. Both initially use the first listed model; the server catalog supplies the IDs, labels and order.
5. If identity is connected but plan use is missing, choose **Enable ChatGPT plan usage**. Ordinary reconnects do not force consent.

Connect another account to add a separate registration. Use Saved connection to switch, Reconnect to renew authorization, or Disconnect to clear tokens and attempt remote revocation. Accounts are never automatically rotated to evade limits. An unavailable saved model remains visibly unavailable until you choose another. Refresh models updates the list.

If authorization is declined, expires or fails, the settings panel explains the problem. Usage-limit failures pause inference across restarts; open **ChatGPT usage**, then explicitly **Resume requests** after resolving the limit. If you enable the account's approved-app credit setting, connected apps may consume your existing credits after plan limits; that is an explicit account setting, not a separate API-key fallback. Mitch does not enable it automatically. Temporary availability failures keep the saved credentials. A failed remote sign-out is reported separately from successful local disconnection.

## What stays local

Nemotron speech recognition, Kokoro speech output, microphone capture, wake detection, app execution, Windows accessibility, mouse/keyboard input and browser operations remain local. GPT receives text, tool results and screenshots allowed by Screen sharing. It selects supported custom functions; it does not directly control the computer or use OpenAI's native computer tool. Existing permissions, target validation, emergency Stop, outcome checks and uncertain-action protections still apply.

The optional local Qwen provider remains available without cloud inference. Speech services must run separately for either provider. The historical cloud-voice code is retained for compatibility tests but is disabled by this edition's main-process settings; no Realtime session or cloud transcription is started by this integration.

Existing direct app/folder/tab routes, bounded action plans, procedural reuse and speculative read-only preparation are retained. Preparation can spend plan usage while the user speaks; actions wait for the matching final transcript. The local quick-planning switch does not invent a ChatGPT reasoning-effort option. Draft response text is marked as drafting and is replaced by the final verified answer or failure; drafts are not action-completion evidence.

## Authentication implementation

- `chatgpt-auth.js` discovers `https://auth.openai.com/.well-known/openid-configuration` and validates the documented issuer/endpoints. The live discovery endpoint was checked on 2026-11-09.
- The listener binds `127.0.0.1` on an available port at `/auth/callback` before opening the browser. Requests use random state, nonce, a 256-bit verifier and PKCE S256; callback and exchange use the identical redirect URI. Duplicate/mismatched callbacks are rejected.
- Initial requests use `dynamic_agent_client`, `agent_name_hint=Mitch`, a stable `urn:uuid:` host ID, the documented identity/offline/resource/direct-plan scopes, and resource `https://api.openai.com/v1`. The issued client ID is retained per connection and reused even if the first token exchange fails.
- `jose` verifies the JWT signature through the issuer's JWKS, issuer, audience, subject, expiration, issued-at and nonce. Reconnecting a saved account cannot silently replace it with a different subject/client.
- `chatgpt-storage.js` encrypts credentials and registrations using Electron's asynchronous safeStorage API. The encrypted envelope is atomically replaced. There is no plaintext fallback. The app and benchmark runners use the same single-instance profile lock; refresh rotation is also serialized per account.
- Terminal refresh errors clear unusable tokens while preserving the issued registration. Temporary errors preserve credentials. Disconnect attempts the discovered revocation endpoint, then removes tokens locally and reports unconfirmed revocation when necessary.
- The renderer receives only public connection labels, status and model preferences. Tokens, client IDs, host IDs and encrypted envelopes never cross its bridge. OAuth files are excluded from Git and packaging, including under otherwise allowed directories.

## Inference and transports

`chatgpt-responses.js` calls only `https://api.openai.com/v1/responses` with the selected account's bearer token. HTTP always uses `store:false`, `stream:true` and an input array containing required context. Unsupported legacy parameters are excluded with an allowlist. Function tools are grouped in the `mitch` namespace. Encrypted reasoning items, function-call IDs and results are preserved during tool continuations. Completed user/assistant turns remain in Mitch's bounded in-memory history; screenshots and tool transcripts are not saved as chat history.

Only `response.completed` succeeds. Failed, incomplete, malformed, interrupted and cancelled responses never deliver proposed tools to the executor. Function names/namespaces/IDs and JSON arguments are checked before the existing dispatcher's schema and permission checks. Structured verification responses are also validated locally. A rejected initial 401 refreshes once; no post-action or interrupted-stream retry occurs. Subscription restrictions do not change billing paths.

The live OAuth HTTP route was observed returning valid SSE without a Content-Type header. Mitch accepts that omission through its normal bounded event parser and still requires the completion event; a plain JSON completion object is never sufficient.

Streamed HTTP is the default. **Connection optimization** offers optional WebSocket-only and WebSocket-with-HTTP-fallback modes. These use Responses WebSocket, not Realtime voice. A persistent connection caches only its latest parent. Continuation is used only when model, instructions, tools and the required input prefix still match. Changed/pruned context or a new connection uses full replay; an explicitly rejected missing parent gets one full-context retry. This replays messages and recorded results, never desktop actions.

Cancellation, account changes, token changes and connection expiration close the socket and discard its parent. Connections are renewed before the documented 60-minute limit. Concurrent speculative work uses independent HTTP rather than mixing socket response streams. HTTP fallback is allowed only before a WebSocket request was sent, for connection/unsupported-upgrade failures; not after partial output or a permission denial. WebSockets may reduce transport overhead, not model computation time.

## Validation and reproducible measurements

Automated coverage includes signed OAuth callbacks, invalid state/nonce/JWTs, registration reuse, refresh rotation, consent denial, account changes, revocation, catalog changes, actual loopback WebSocket exchanges, SSE chunking, tool continuations, encrypted reasoning, structured output, usage limits, screenshot permission revocation, cancellation and local voice → GPT → validated tool → local speech.

Windows Electron settings smoke tests use a separate profile and exercise real Windows encryption and renderer IPC. Passing these tests does **not** establish successful live OAuth authentication or model availability. See `test-output/chatgpt-settings-result.json` and the final task report for live status. Test output and credentials are excluded from Git.

```powershell
npm test
npm run smoke -- --provider-settings-test
node package.js outputs/chatgpt-build
```

For an opt-in real HTTP/WebSocket comparison, first connect an account in Mitch, then quit Mitch so the benchmark can exclusively own its rotating-token profile:

```powershell
.\node_modules\electron\dist\electron.exe scripts\run-chatgpt-benchmark.js
```

The bounded benchmark uses a synthetic, in-memory note task through the real Responses adapter and Mitch's validated dispatcher. It alternates transports with one warmup and three measured tasks each, caps the total at 32 model requests, saves no prompts/tokens/raw responses, and restores the transport preference. It records first-text time, median/p95 model and task times, calls per task, and independently checked fixture success. Recovery rate stays null because no recovery is induced. These results exclude real Windows execution and speech. Create `test-output/chatgpt-benchmark.stop` to stop before the next task; remove it before another run.

`scripts/run-chatgpt-live-smoke.js` additionally tests synthetic CPU speech through the production voice/AI loop, an exact owned native button through the production dispatcher/controller, tool-result continuation, and screenshot understanding of that fixture. It requires the same exclusive profile access and consumes a bounded number of real model calls. It never records the microphone or sends user-window contents.

`scripts/run-workflow-model.js` accepts the same authorized OAuth provider for the owned conditional/cross-window fixture and learned-procedure benchmark. Historic DeepSeek-only launchers were retired; original measurements and version history remain. Prior v22 measurements are not a matched GPT comparison and must not be used to assert a speedup. See [v23 validation](CHATGPT-VALIDATION.md) for the measured results and limitations. A 1–5 second goal remains task-dependent.

## Official specifications

- [Quickstart](https://developers.openai.com/siwc/quickstart)
- [Open-source sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Profiles and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)
- [Responses WebSocket](https://developers.openai.com/api/docs/guides/websocket-mode)
- [Sign in with ChatGPT terms](https://openai.com/policies/sign-in-with-chatgpt-terms/)

Mitch remains MIT licensed; OpenAI service terms and third-party dependency licenses apply separately.
