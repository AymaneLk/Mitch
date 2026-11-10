# Spotify playback verification — v33

On 2026-11-10, the reported request was reproduced with the user's connected account and Windows Spotify app. Search and device discovery worked. Both the upstream MCP and a direct official API request with `uris: [track]` returned HTTP 204 while leaving the device with no current item. Manually playing the song worked. Testing a second release and an explicit device ID did not resolve it.

Starting the same requested recording through its observed `album.uri` and `offset.uri` did work, with independently advancing playback. This matches first-hand reports in the [Spotify developer community](https://community.spotify.com/forum/en/discussion/7552922/web-api-me-player-play-returns-204-but-does-not-start-playback-and-clears-current-playback-desktop). The request shape uses Spotify's documented [context and offset fields](https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback). The provider's internal cause has not been established.

## Changes

- Reuse album metadata from search, or perform one track lookup for an explicit track URI, before sending a single album-context playback request. No song identifiers or app-specific UI coordinates are hardcoded.
- Confirm the requested item/context and explicit device when supplied. Accept a documented relinked track URI. Success is no longer inferred from HTTP acknowledgement alone.
- Track accepted, rejected and unknown mutation outcomes inside each MCP call. Only a proven no-device rejection may trigger one app launch and one retry. Accepted but unconfirmed playback never causes another Play request or a UI click.
- Report the provider's actual failure, including unavailable devices, instead of only the previous generic MCP error.
- Keep the playback test's exit status aligned with independent playback verification.

The album-context workaround can continue with subsequent album tracks. This behavior is included in the tool result. It does not change the user's autoplay/repeat settings or create a playlist.

## Measurements

The warm real-account test through Mitch's production dispatcher passed: Play 666 ms (including search and playback confirmation), Pause 134 ms, Resume 140 ms. Independent reads confirmed the right song, advancing position from 0 to 2 seconds, paused state and resumed state. Pause/resume timings cover action execution; their independent test readbacks are outside those timings. Measurements exclude speech recognition and model planning and are single samples, not latency percentiles.

A closed-app test initially timed out with the short playback confirmation window even though playback later appeared. The final test uses up to four delayed read-only checks (3.75 seconds of scheduled waiting, stopping immediately on a match). Starting with no Spotify device, Mitch discovered and launched the app, started the requested recording and confirmed playback in 8,841 ms. Position advanced from 2 to 4 seconds; Pause and Resume were also independently confirmed (119 ms and 120 ms action times). Cold application startup remains slower than the warm route. The initial failed test is retained locally as `spotify-recovery-cold-initial.json`, and the successful warm run as `spotify-recovery-warm.json`.

All 889 source tests passed, including rejected versus unknown writes, concurrent receipt isolation, exact app discovery, no replay after accepted playback, track/device/context matching and album resolution. The live test is `scripts/test-spotify-recovery.js`; its local reports are under `test-output/spotify-recovery-*.json` and contain no credentials.

The v33 packaged desktop smoke test and packaged MCP Settings/transport test both passed. v33 was installed over v32 with a timestamped backup and reopened. The installed archive hash matched the tested build (`3c952fa04d8735305d89270e8da3430a386a5f12b5dfdef30effb1e1db6c4a11`). The real Spotify tests exercised the production source dispatcher and shared pinned provider runtime; they were not spoken end-to-end model tests.
