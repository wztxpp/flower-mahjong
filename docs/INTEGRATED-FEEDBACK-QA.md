# Integrated playtest feedback candidate

Built from verified main `1de15e9a43ce373a4b408d3fd6b8cddd2aa9247c` with the independent rules/score, playback, tabletop, and original-photo tile changes. This is a local candidate; this document does not claim a push or deployment.

## Integration checks

- Kept the persistent per-table cumulative card alongside per-round scores and private cross-table personal history. Its small labels use the tabletop's warm-paper contrast palette.
- Kept fixed screen seats. New games advance counterclockwise; equal claims use that same saved direction. Old games retain their original direction and pending responses.
- New games reject peng-to-kong upgrades while allowing actual kongs to extend through eight tiles. Pending and confirmed rob-kong presentation uses “加杠” under the new rules, not the forbidden peng-upgrade wording.
- Preserved the exact photographed faces, accessible tile labels, button state, hidden backs, public winning-source/destination references, non-blocking animation, reduced motion, and memoized river/history rendering.
- Updated the synthetic browser fixture to import both base and tabletop CSS, use new-rule flags, show cumulative scores, and display simultaneous winners in counterclockwise order. It intercepts API requests and does not create real games.
- Updated the presentation benchmark's component loader for the photo-face dependency. Both sides use the same current tile component, isolating App-level patch changes; the result is not a full old-version/new-version browser comparison.

## Final automated verification

- `npm test`: **571 passed**, zero failures.
- `npm run build`: passed, including the public source photo asset and Worker bundle.
- `npm run lint`: zero errors, four existing warnings.
- `git diff --check`: passed.
- Repo-wide TypeScript checking retains the existing scaffold errors in `db/index.ts` and `worker/index.ts` (missing Env fields and connector modules); the same errors were reproduced on unchanged main. The production build and gameplay tests above passed separately.
- Final synthetic client-patch benchmark: selection median 1.358 → 0.647 ms; snapshot median 3.453 → 2.916 ms. See `verification/integrated-render-benchmark.json` for sample counts, tails and method. These figures exclude layout, paint, image decoding, networking and audio; they do not establish real-device FPS or latency.

## Visual and audio acceptance limit

The supplied 18-face preview was inspected: all nine bamboo and nine dot faces are upright and use the original artwork. The 1-dot face has an ivory underlay only for its absent blank photo corner, with its rosette intact. Source resolution remains limited; it is not presented as newly high-resolution art.

The integrated local Vite server started on `127.0.0.1:5194`, but the supported cloud browser returned `ERR_CONNECTION_REFUSED` for its synthetic QA route. A prior standalone Chromium attempt was blocked by socket restrictions; no restricted browser launch, security setting change, or socket bypass was used in integration. Desktop/mobile pixel checks, animation timing and real audio listening therefore remain **unverified**, rather than inferred from component tests or the synthetic benchmark.
