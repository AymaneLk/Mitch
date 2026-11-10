# Real website speed validation — v25

## What changed

Mitch now has a bounded, parameterized website executor for:

- YouTube search and playing a ranked regular video result (1–10).
- Opening an English Wikipedia article, or searching Wikipedia.
- GitHub repository search and opening a ranked repository (1–10).

Recognized whole requests go directly from local intent parsing to the authenticated browser extension, with no model requests. Queries and ranks are parameters, not recorded coordinates or hardcoded test answers. Other wording can use `browser_site_task` through the existing model planner. Requests outside these operations retain the general browser/native/visual routes.

The extension reads a small set of relevant page facts instead of repeatedly collecting an entire accessibility tree. It waits for the needed results, not completion of every image/ad/network request. On YouTube it follows the freshly observed result anchor, keeping YouTube's loaded application instead of reloading the entire document. A fresh page receipt can also be used for a read-only page refresh without another inventory/model round trip; this helps the general browser route.

The executor verifies the requested query, result position, actual link, browser/tab/window/document identity, destination repository metadata or Wikipedia heading. YouTube completion requires the selected video identity, no ad playing, a nonpaused player and advancing playback time. Merely opening a video URL does not count as playback. Stop, permission checks and unknown-outcome replay protection still apply.

## Measurement method

- Public YouTube, English Wikipedia and GitHub in a separate, logged-out Opera GX profile. Existing user tabs and accounts were not used. Optional cookie consent was handled before timing; ads were not disabled.
- Preserved installed v24 engine/extension in `outputs/real-web-baseline-v24`, compared with v25 source using the same selected model (`gpt-6.1-terra`) and account. Preserved v24 archive SHA-256: `7b4cf133a53154ca1e98a81262a8ecc800335b48eb93ad718180075584f6d6b6`.
- Both versions used production AI/dispatcher/workflow/browser code with browser-only tools. v25 additionally exposed its new site adapter. Native clicks and screenshots were not offered as action fallbacks in this comparison. This measures real browser tasks, not full-system/native fallback accuracy.
- Each task began after the owned test tabs settled. Six model requests and 90 seconds maximum per task; 48 requests maximum per eight-case suite. Failures at this bound are recorded as failures, not assigned a successful latency.
- Primary latency is typed request to Mitch's returned answer. Additional independent verification (including 600 ms of playback observation) is reported separately in raw `totalMs`. Browser launch, cookie setup, voice endpointing/ASR and speech synthesis are excluded.
- A separate CDP reader recorded ranked search links, final page identity and advancing playback. It did not execute timed task actions. Website result ranking and ads can vary between runs; correctness refers to that run's observed order, not a remembered video/repository.
- Normal desktop load, live network and website variability were not controlled. Small samples cannot establish general accuracy percentages or a universal 1–5 second guarantee.

## Matched real-site results

Times below are request to returned answer, except failed bounded runs, where elapsed time to failure is shown. Each row is one live trial per version, not an average.

| Task | v24 | v25 | v25 model requests |
| --- | --- | --- | ---: |
| YouTube: NASA Artemis launch, second video | Stopped after 21.3 s, video not played | 16.62 s, content playback verified | 0 |
| YouTube: Blender beginner tutorial, first video | Six-request limit after 21.9 s, video not played | 24.22 s, content playback verified | 0 |
| YouTube: piano tutorial beginner, third video | Six-request limit after 20.7 s, video not played | 31.67 s, content playback verified | 0 |
| YouTube: James Webb telescope search | 21.25 s, completed | 1.25 s, completed | 0 |
| Wikipedia: Ada Lovelace | 14.61 s, completed | 1.03 s, completed | 0 |
| Wikipedia: Computer mouse | 12.04 s, completed | 0.88 s, completed | 0 |
| GitHub: microsoft playwright, first repository | Six-request limit after 21.9 s, not completed | 1.94 s, completed | 0 |
| GitHub: microsoft UFO, first repository | Target reached after 14.81 s, but Mitch reported failure | 2.18 s, completed | 0 |

Independent outcomes: **4/8 reached in v24; 8/8 in v25**. Correctly confirmed outcomes: **3/8 versus 8/8**. v24 used 39 model requests, v25 used none. On the three tasks that both versions correctly confirmed, the sampled speedups were 17.1×, 14.3× and 13.7× respectively. These ratios do not describe arbitrary computer use.

All three v25 video trials encountered ads. The selected video page/player was reached in **1.84–2.14 s**; confirmation of the actual content took **16.62–31.67 s**. Earlier no-ad trials confirmed playback in about 2.8–3.3 s before extra independent readback. Ads are included in end-to-end results, not subtracted to make the task look faster.

Raw comparison: `test-output/real-web-baseline-corrected.json` and `test-output/real-web-release.json`.

## New queries and natural wording

Eight additional queries/ranks also passed **8/8** independent checks with zero model requests (`real-web-extended.json`). They included wildlife documentaries (second video), an ISS tour (third), origami (first), Roman aqueduct search, Grace Hopper and Alan Turing articles, and second/third repositories for electron desktop/browser automation. The five non-playback tasks took **0.63–2.20 s**. The no-ad ISS playback task took **3.24 s**; the other two video tasks took **14.70 and 17.07 s**, including ads.

Three natural phrases initially took 12–15 seconds even with the new executor because they still went through planning and review. The local grammar was extended to recognize these parameterized forms, while rejecting appended unsupported actions. They were then rerun against real sites:

| Request | Before grammar extension | After | Outcomes before / after |
| --- | ---: | ---: | --- |
| “Please bring up YouTube results for Mars rover.” | 13.81 s, 4 model calls | 1.79 s, 0 calls | Passed / passed |
| “Could you take me to the Wikipedia page about Margaret Hamilton (software engineer)?” | 12.12 s, 4 calls | 0.55 s, 0 calls | Passed / passed |
| “On GitHub, look for repositories about speech recognition and take me to result number two.” | 14.56 s, 4 calls | 2.01 s, 0 calls | Passed / passed |

Raw wording reports: `real-web-model-wording.json` and `real-web-wording-optimized.json`. Across the final matched, additional-query and optimized-wording suites, **19/19 tested outcomes were independently verified**. This is a small supported-operation test set, not 100% accuracy for general computer use. Unrecognized/compound instructions still need the model and may take substantially longer.

## Development runs and limitations

Initial runs exposed real repeated model calls and unsupported navigation assertions. A first adapter iteration completed videos but still performed expensive full-page reloads. The next iteration used YouTube's own page navigation.

The recorder also needed corrections: blocking readback could add a 15-second timeout; tab resets needed to wait for Chrome's tab inventory and allow Opera's built-in pinned GX Corner; each request needed a distinct activity scope; fast result navigation required a synchronous read-only DOM observer. Early debug runs are retained under `test-output/real-web-*` and are not silently substituted for the final comparison. One earlier third-video run had verified playback in the executor but insufficient independent rank capture and was counted unverified in that report.

An advertisement is not the requested video. The adapter can reach the selected page quickly yet wait tens of seconds for content playback. It does not bypass advertisements or claim that such tasks always finish in five seconds. It also does not turn arbitrary websites, native applications or reasoning-heavy tasks into local recipes.

## Reproduction and artifacts

Quit the normal Mitch instance without disconnecting ChatGPT before running a live benchmark; the harness takes the normal profile process lock to avoid competing OAuth refresh. Run `node_modules\electron\dist\electron.exe scripts/run-real-web-benchmark.js --baseline --label=baseline-corrected` for preserved v24. Run without `--baseline` for current source; `--extended` uses different queries and ranks, and `--model-wording` exercises the natural phrasing suite (now supported locally).

`scripts/run-real-web-validation.ps1` runs matched, unseen-query and model-wording suites sequentially. `scripts/real-browser-lab.js` owns setup/readback/cleanup; `tests/public-site-task.test.js`, `tests/site-operations.test.js` and browser bridge tests cover scope, ranking, playback proof, cancellation and replay rejection. Raw JSON, logs and screenshots remain local under `test-output`; disposable browser profiles and pairing configuration are excluded from Git and packaging.

Browser Bridge 1.4.0 requires reloading the existing unpacked extension. No additional browser permissions are requested. General computer use, ChatGPT selection and CPU voice settings remain available.

## Installed validation

- All **803 automated tests passed**. Packaged v25 native/UI smoke and ChatGPT settings checks passed with administrator privileges.
- The first packaged run stopped before installation because the unchanged native Cua driver exited with access violation `3221225477` during the owned WinForms fixture check. Its failure is preserved in `test-output/real-web-packaged-first-failure.txt`. A fresh process passed both complete packaged checks; no native-driver code was changed to bypass the failure.
- v25 was installed at `outputs/playback-fix-build/Mitch-win32-x64`; v24 was backed up to `outputs/backups/before-real-web-20261109-223533`.
- Installed `resources/app.asar` SHA-256 matches the tested build: `676b526ef9cd5c739236d2c5abc59b52e78d51e570f9161c9386e61d5f1f3307`.
- The user reloaded the existing Opera extension. At `2026-11-09T21:37:43.743Z`, the running installed bridge reported one Opera connection, page access enabled, and `publicSiteCapable: 1`. This verifies the production connection/capability, not another timed action on the user's normal browsing profile.
- Installation preserved the existing ChatGPT connection. No local GPU model was started and no additional browser permission was requested.
