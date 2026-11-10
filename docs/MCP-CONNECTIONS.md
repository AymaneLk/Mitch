# MCP-first execution in Mitch v33

Mitch now hosts seven MCP integrations: Filesystem, Desktop Commander, Google Workspace, the official remote GitHub server, Excel, Spotify and Playwright. Account services remain unavailable until credentials and consent are configured. Installation alone is not account access.

## Runtime

Run `npm run setup:mcp` with Node 24 and uv installed. Pinned Node/Python runtimes live under `outputs/mcp-runtime`. Their generated manifest is copied to the installed app's user-data directory during deployment. They are not bundled inside Electron's ASAR. Regenerate the manifest when relocating/reinstalling runtimes. No package installation occurs during a user task.

Local servers are persistent child processes over MCP stdio; GitHub uses HTTPS Streamable HTTP. Startup warms the local connections in the background. Stop aborts requests and closes servers. Schema discovery is cached per connection. JSON Schema draft 7 and 2020-12 are validated locally. MCP batches run up to 12 operations, with explicit references to actual prior results. Writes are never automatically replayed on timeout, disconnection or ambiguous errors.

## Routing

The planner sees a compact provider catalog and relevant discovered schemas. For matched capabilities, the first model turn offers MCP discovery, batch execution and an explicit UI fallback; built-in fast workflows and DOM/UIA preparation are skipped. Unfamiliar desktop requests also go through this capability choice. Relevant tool search is a local heuristic, not a trained semantic router: the model can discover additional schemas for arbitrary tasks.

`mcp_use_ui` explains a missing capability, unavailable connection, or existing browser session. It can perform initial native/browser discovery in the same call. UI tools then become available for the unfinished portion; instructions retain MCP priority for supported portions. The model still decides whether a capability gap exists. This is not a proof that it will always choose the fastest route.

Playwright uses its own persistent Edge profile. It does not inherit Opera's authenticated tabs. Existing Opera tab workflows continue through Mitch Browser Bridge. Playwright itself uses structured browser/DOM data; MCP is a tool protocol, not an alternative to DOM internally.

## Accounts and data

- GitHub: a personal access token scoped to the intended repositories/operations, sent only to `https://api.githubcopilot.com/mcp/`.
- Google: your own OAuth web client, account email, enabled Workspace APIs, and redirect `http://localhost:22142/oauth2callback`. Click Authorize account, complete consent, then Check connection. Personal testing can require reconnecting after seven days.
- Spotify: your own developer Client ID and redirect `http://127.0.0.1:8888/callback`, followed by account consent. Premium and an available playback device are required. After a confirmed no-device rejection, Mitch can launch the uniquely discovered Spotify app, wait for a device and retry that rejected operation once. Accepted or uncertain writes are never replayed.
- Local file servers: initially restricted to Documents, Desktop and Downloads; change these roots in Settings. Desktop Commander terminal execution is broader than these file roots and requests approval before executing commands. Sensitive operations retain an approval backstop.

GitHub tokens and Google client secrets entered into Mitch are encrypted using Electron's Windows secure storage in `mcp-auth.json`. Upstream Google and Spotify servers manage their own OAuth token files under the separate per-provider user-data directories; these files are not DPAPI-encrypted by Mitch. They are never packaged or committed. Desktop Commander telemetry is disabled. Its configuration and history, and Spotify tokens, are isolated with small documented patches to the pinned runtime copies rather than changing the system home directory.

Provider schemas and results are untrusted task data, not authorization. Authentication/configuration tools are excluded from model access. Task results can be sent to the user's chosen language-model provider, as with other Mitch tools. Screenshots returned by MCP servers are omitted from model results; existing visual fallback handles screenshot permissions.

Connection checks never open sign-in. Google tool calls with missing/expired authorization fail without initiating OAuth; a pinned-provider patch enforces this. Explicit Google authorization returns one URL to Mitch, which opens it once and deduplicates repeated clicks for ten minutes. The setup helper waits only for a local credential file, then makes one verification read. Setup helpers use the installed app's profile and single-instance lock so they cannot overwrite credentials from a running Mitch instance. Google Custom Search is excluded; the eleven configured Workspace services are loaded. Some Google Chat and Apps Script features can still require service-specific configuration or a Workspace account.

## Validation

v33 distinguishes a provider's confirmed rejection from a lost or partially applied write and exposes its actual error. The pinned Spotify adapter starts individual tracks at their exact offset in the observed album, working around desktop clients that accept bare track URI lists but clear playback. Spotify may continue with the remaining album tracks. One immediate playback read confirms the requested track/context; up to four delayed reads handle propagation, stopping at the first match. These are local provider reads, not an additional model review. See [Spotify playback verification](SPOTIFY-PLAYBACK-FIX.md).

`node --test tests/*.test.js` covers MCP priority, fallback gating, schema validation, actual-result references, connection reuse, cancellation, credential redaction, and unknown-write handling along with the existing suite. `npm run test:mcp` exercises actual file round trips, Desktop Commander directory reads, an Excel formula and an owned browser form. It does not use a language model or private cloud accounts, and its execution times exclude voice/model latency.

On 2026-11-10, v32 passed 880 source tests and both packaged checks. The packaged Settings test also verifies that three repeated checks of an unauthorized Google account never start its provider. Six read-only account operations passed through `McpHub.execute`: GitHub profile 704 ms, Spotify current playback 69 ms, Calendar list 103 ms, Gmail INBOX label 269 ms, one Drive item 671 ms, and one Tasks list 164 ms. These are single warm-connection samples, not latency percentiles or complete voice-to-action measurements. No emails, messages, playback changes or cloud-file writes were performed in these checks. Other service operations have not all been exercised.
