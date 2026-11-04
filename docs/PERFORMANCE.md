# Performance verification

## Scope and reproducibility

All production measurements use one **new anonymous synthetic room per run** with three independently issued seat credentials. No existing user room, user hand, user credential, or live database row is inspected. Credentials and game snapshots stay in process memory; reports contain only timings, byte counts, response status and aggregate methodology.

Run from the repository root:

```sh
node tests/performance/benchmark-api.mjs \
  https://flower-mahjong-wztxpp.squaresong.chatgpt.site \
  before-v1 docs/performance-before-v1.json
```

For a later deployed v2 comparison use the same script, URL, and workload, with `after-v2 docs/performance-after-v2.json` as the final arguments. Each run:

1. Creates one room and seats three synthetic clients.
2. Starts a game and warms authenticated reads.
3. Plays six discards, selecting only available discard, pass, or legacy manual-draw actions. Required claim responses/manual draws vary with the random deal and engine version.
4. After every successful action, fetches all three authenticated views concurrently.
5. Measures four rounds of full idle GETs and four rounds of same-revision GETs, each with three concurrent clients.

Timings use Node `fetch` from request start to the **entire response body**. Payload bytes are decoded JSON UTF-8 bytes, not compressed wire size. P50/P95 are nearest-rank statistics. Each category is reported separately; samples are deliberately limited to avoid load testing the public site. Server processing is additionally reported when the deployment provides `Server-Timing: app;dur=...`. That duration includes the API/database/serialization path but excludes network transit, browser work and response-body delivery.

**These are HTTP measurements, not browser click-to-render measurements, user-device frame rates, or a measurement of the user's network.** Small samples, random deals, variable history sizes, scheduling, and public network/edge conditions limit conclusions about tail latency. No regional claim is made.

## Production v1 baseline

Captured on 2026-11-03. `/api/health` reported version **0.1.0**. Raw sanitized samples: [performance-before-v1.json](performance-before-v1.json).

| Category | Requests | P50 (ms) | P95 (ms) | Mean decoded bytes |
| --- | ---: | ---: | ---: | ---: |
| Action POST | 11 | 143.98 | 614.30 | 2,267.64 |
| Three-client refresh after actions | 33 | 170.09 | 2,241.72 | 2,180.85 |
| Full idle GET | 12 | 165.18 | 205.54 | 2,781.67 |
| Same-revision idle GET | 12 | 157.02 | 474.53 | 2,781.67 |

Six discards required **11 action POSTs** in this run, including five manual draws. None of the 12 same-revision requests returned a compact unchanged response: the v1 server returned the complete personalized snapshot each time. This observation supports eliminating redundant draw/action requests and full idle snapshots. It does not establish a browser-rendering bottleneck.

## V2 server contracts tested locally

The API/D1 regressions verify these properties independently of the performance samples:

- Every authenticated room GET performs **one store/SQL read**, with no redundant reread.
- A valid equal `since` revision returns `{ unchanged, revision, connections }`, **under 100 decoded bytes** in the test fixture, without serializing a hand.
- Heartbeat writes occur only when that seat's last update is at least **10 seconds** old. A subsequent rapid poll performs no heartbeat write.
- Authentication still happens before a compact response. Invalid tokens do not write a heartbeat.
- Presence can change without a game revision change and is included in the compact response.
- POST success returns the authoritative personalized state. The actor can use it directly; other seats retrieve a changed snapshot on their next conditional poll.
- V2 performs draw transitions inside the accepted server action, with no client `draw` action. A response window stays paused until all eligible players respond.
- SQL conditional revision updates apply simultaneous actions once, including score transfers and radish flips. Two independent API handlers sharing SQLite exercise the D1 SQL adapter through real HTTP sockets.
- Saved v1 games still use v1 rules and manual draw; reads/reconnects do not migrate or rewrite game state.

## V2 production measurement

Captured on 2026-11-03 after the production deployment. `/api/health` reported **0.2.0**. Raw sanitized samples: [performance-after-v2.json](performance-after-v2.json). The URL and script methodology match the baseline.

| Category | V1 → V2 requests | V1 → V2 P50 (ms) | V1 → V2 P95 (ms) | V1 → V2 mean decoded bytes |
| --- | ---: | ---: | ---: | ---: |
| Action POST | 11 → 10 | 143.98 → 121.03 | 614.30 → 176.55 | 2,267.64 → 2,868.90 |
| Three-client refresh after actions | 33 → 30 | 170.09 → 93.94 | 2,241.72 → 390.14 | 2,180.85 → 2,898.97 |
| Full idle GET | 12 → 12 | 165.18 → 95.59 | 205.54 → 127.41 | 2,781.67 → 3,664.00 |
| Same-revision idle GET | 12 → 12 | 157.02 → 85.60 | 474.53 → 191.67 | 2,781.67 → 63.00 |

All **12/12 v2 conditional idle polls** returned the unchanged envelope; none returned a full snapshot. Its decoded payload was **63 bytes**, about **97.7% smaller** than the v1 same-revision snapshot mean in these runs. V2 full snapshots are larger because they carry the additional rule explanations, diagnostics and public scoring fields. The compact idle response is the clear bandwidth improvement; full response payloads did not shrink.

The v2 six-discard run required **10 POST actions**: six discards and four claim passes, with no manual draws. The v1 run required six discards and five manual draws. Different random deals produced different claim counts, so total action counts are not a controlled quantitative comparison of the engines. Both runs made three concurrent full refreshes after each action for comparability, even though the v2 UI can consume the successful action response without an extra actor refresh.

V2 `Server-Timing` app-processing P50/P95:

- Action POST: **42/104 ms** (10 samples).
- Post-action full GET: **17/24 ms** (30 samples).
- Idle full GET: **15/24 ms** (12 samples).
- Idle unchanged GET: **16/21 ms** (12 samples).

The baseline had no server-timing header, so these are **not** before/after server-only measurements. All measured requests in both reports returned HTTP 200. The observed HTTP latencies improved in this pair of runs, but the limited, non-simultaneous samples cannot establish browser responsiveness, a sustained latency guarantee, or the root cause of the originally reported inability to hu.

## Production smoke verification

A second fresh anonymous synthetic room passed all smoke checks in 21 requests: three separate credentials, schema 2, automatic server draw, reconnect, private-hand/token filtering, missing/forged authentication denial, duplicate action exactly once, stale revision rejection, manual-draw rejection, seat impersonation rejection, a blocked fourth seat and compact conditional polls. No original user game is inspected. The v1 benchmark credentials were intentionally not persisted, so no old production room is revisited; saved-v1 preservation is covered by the local FileStore and engine regressions described above.
