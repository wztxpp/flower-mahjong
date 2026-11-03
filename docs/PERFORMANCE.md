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

Pending deployment and a second run of the same script. Do not represent local contract tests as production measurements. The baseline has no server-timing header, so the first v2 server-timing samples cannot be a before/after server-only comparison.
