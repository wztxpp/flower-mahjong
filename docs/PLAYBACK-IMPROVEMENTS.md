# Live playback and win feedback

Client-only changes based on main `1de15e9a43ce373a4b408d3fd6b8cddd2aa9247c`. No rules, scoring, automatic-turn logic, server authority, private-hand visibility, or reconnect credentials changed.

## Diagnosis and behavior

- The former live route could queue twelve voice clips and start them up to six seconds later. One server response can already contain several automatic post-win discards and the next player's draw, so narrating every historical discard produces the reported mismatch.
- The live route now announces only the newest ordinary public action in an update. A confirmed win interrupts an obsolete discard and takes precedence over automatic discards in that update. Up to two simultaneous winners remain one serial group, with the correct winning characters and source calls. Ordinary updates during that group do not accumulate delayed speech. A newer win replaces an outdated group.
- A cold ordinary call must be ready within 550 ms, or a win group within 650 ms, otherwise it is skipped rather than played late. Public win assets are warmed with at most three concurrent requests after sound unlock; locked/muted clients make no preload requests. Audio never waits before applying server state or enabling legal actions.
- Confirmed wins show the source, exact tile and winner. Discard wins highlight the matching river record and matching win-pile entry, with a 550 ms transform-only tile flight where both are visible. Simultaneous winners each have an explicit destination. Self-draw and rob-kong use their actual source labels.
- The cue lasts 2.8 seconds for one winner and 4.5 seconds for two. It has no pointer interception. Reduced-motion users receive the same text and static highlights without a tile flight. A polite, atomic live region provides the source and winner for assistive technology. Muting sound does not remove visual feedback.
- Initial history, hidden-tab updates, reconnect baselines and duplicate revisions do not replay. Leaving, changing game, reducing legacy history or hiding the page clears transient presentation and old audio.

## Rendering work

The river was filtered separately for each player's count, empty check and tile list on every local render. It is now grouped once per snapshot. Unchanged river tiles and history rows reuse their VNodes. Reversed history keys now use original per-game history indices, so appending a new event no longer changes the identity of older rows.

Run the repeatable comparison with:

`node tests/performance/benchmark-presentation.mjs 1de15e9a43ce373a4b408d3fd6b8cddd2aa9247c`

The recorded synthetic run uses 60 river tiles, 150 initial history entries, six alternating before/after runs and 40 warmups per scenario. It measures Vue client patch CPU in an in-memory host, **not browser frame rate, paint, network latency or a real-device guarantee**. Selection p50 was 1.523 ms before and 0.808 ms after; a new snapshot with an appended history event was 3.645 ms before and 3.187 ms after. Full quantiles, including noisy maxima, are in `verification/playback-render-benchmark.json`.

## Verification

- Audio and component regression tests cover compressed automatic bursts, win preemption, serial simultaneous winners, slow loads, cancellation/retry, bounded warming, duplicate/history suppression, exact discard/win-pile references, self-draw, rob-kong, muted feedback, reduced motion, leaving and new games.
- Full `npm test`, `npm run build`, `npm run lint` and `git diff --check` pass. Lint retains four pre-existing warnings in unchanged server/shared/test files and the existing Next pages-directory notice.
- Browser visual QA remains **not run successfully** in this environment: installed headless Chromium cannot create its required socket (`Operation not permitted`); the cloud browser cannot reach the local dev server, and the configured preview host is blocked. Do not claim desktop/mobile visual or real-audio-listening acceptance from these tests.
- A synthetic browser fixture is available locally at `/tests/performance/presentation.html` under Vite. It intercepts its API requests and never creates or changes a real game. Use its Reset, Discard win, Two winners and Benchmark controls after the layout is integrated, including a narrow viewport and reduced motion. The fixture is not included in the production Vite bundle.

## Integration

Animation styles are confined to `win-*` / `winning-*` classes plus `position: relative` on `.playing-center`. App changes are the audio/state-application hooks, source/destination data attributes, cue/live-region markup, discard grouping and list rendering. Keep these when merging a tabletop redesign. No push or deployment was performed.
