# Special win rules audit

Audit date: 2026-11-03. Read-only engine audit; no engine, application, or test files were changed by this audit. Repository working tree includes another worker's kong-discard correction. All behavioral probes below were run against `shared/game.js` through immutable `applyAction` calls and passed `assertGameInvariants` (144 physical tiles, exactly eight of every tile, valid hand sizes, zero-sum scores).

## Confirmed requested changes

- After a first seven-pairs win, all seven original tile types can win again. With one four-of-a-kind in that initial seven-pairs shape, there are six original tile types instead.
- Subsequent seven-pairs wins have fixed three fan/four points, or four fan/eight points in the four-of-a-kind case. The user explicitly confirmed that “八张” meant eight points. Radishes still add normally.
- After a first big-single win, tile types in the exposed meld area can also win; this special mode does not cap ordinary fan bonuses.
- Big single, pure suit, and all triplets each add two fan. Overlap/first-win interpretation is awaiting clarification; do not silently select an interpretation.

## Existing behavior and gaps

1. `isWinningHand` accepts seven pairs with no melds and all even counts. Four identical tiles count as two pairs, six as three, and eight as four (`shared/game.js:113–118`). It does not record which shape produced the first win.
2. Every later win still goes through the normal structural validator (`huWaits`, lines 156–165). A seven-pairs first win freezes a 13-tile hand which normally only waits on the original missing pair tile. Another original pair type is automatically discarded if it offers no kong. Example below reproduced this actual automatic discard.
3. A big single has four melds and one concealed base tile. Only that concealed tile completes a normal pair. A new meld-type tile currently offers a legal supplemental kong, not hu. No special expanded-wait path exists.
4. `scoreHu` adds only base fan and same-tile count bonuses (`303–323`); there is no seven-pairs fixed tier, pure-suit detector, or all-triplets detector. Big single overrides the result with 50 points by default, discarding the radish contribution. These are deliberate old behaviors covered by tests, not missing assertions.
5. `getWaitTiles`, `huWaits`, diagnostics, private view, and post-hu `canKong` all use structural waits. Updating only action availability would leave displayed waits, diagnostics, lock comparisons, and kong preservation inconsistent.
6. Existing rules, UI score text, docs, and test expectations explicitly describe 50-point big single and no pair-hand bonus. They need version-aware updates, not global replacements of historical rules.
7. Big-single classification also affects **payer selection**, independently of its 50-point score. Ordinary discard currently charges both opponents for a big single (`awardHuBatch`, lines 381–387). A scoring correction alone should not silently change this payment policy.

## Duplicate peng is already supported and verified

No tile-uniqueness restriction exists in `claimOptions` or `resolveClaims`. Each peng pushes a separate three-tile meld. Invariants permit repeated meld tile types, up to four total melds. Supplemental kong finds the first matching eligible meld; it does not merge duplicate pengs.

A complete action sequence starting with zero exposed melds succeeded:

- Tile IDs 0–8 are 1–9条; 9–17 are 1–9筒.
- Let W = `[0,1,2,3,4,5,9,10,11,12,13,14,17]`.
- Seat 0 starts `[0,...W]`; seat 1 starts `[0,0,0,0,1,2,3,5,6,9,10,13,15]`; seat 2 starts W. Wall head is `[7,0]`; all remaining physical copies fill the wall.
- Seat 0 discards 0; seat 1 pengs 0 and discards 15. Seat 2 draws/discards 7. Seat 0 draws/discards 0. Seat 1 pengs 0 again.
- Final seat-1 melds are two independent `[0,0,0]` pengs. Both peng history entries exist; full invariants pass.
- Thus six physical copies can form two pengs. Remaining two copies can support other uses; there cannot be a third peng of that tile in an eight-copy deck.

## Live behavioral probe results

- Seven pairs `[0,0,2,2,4,4,6,6,9,9,11,11,13,13]`, first winning tile 13, continuation wall head `[2,7]`, nonmatching radish tail `[8,8,8,15,15,15]`: first score is one fan/one point; new tile 2 is automatically discarded; reported waits stay `[13]`.
- The same initial shape with four consecutive 13s at the wall head can win five times. Current fan/point sequence is `1/1, 1/1, 2/2, 3/4, 4/8`. This proves repeat scores still grow from accumulated identical winning tiles instead of staying fixed.
- One-quad seven pairs `[0,0,0,0,2,2,4,4,6,6,9,9,11,11]`, first win on 11: current score two fan/two points; only 11 remains a structural wait.
- Big-single base `[17]`, prior winning tile 17, four pengs at tile IDs `[0,3,9,12]`, fresh draw 0: current actions are discard 0, supplemental kong 0, pass. Diagnostic reports `SHAPE`, and waits `[17]`.
- That big single's first normal win on 17 is currently 50 points.
- Pure-suit sequence hand `[0,1,2,0,1,2,3,4,5,6,7,8,8,8]` currently scores one fan/one point with nonmatching radishes.
- Mixed-suit all-triplets hand `[0,0,0,2,2,2,9,9,9,11,11,11,17,17]` currently scores one fan/one point with nonmatching radishes.

All probes allocate the residual eight-copy inventory to the wall, rather than inventing/discarding physical tiles. Prior selfdraw win records have corresponding retired physical tiles.

## Decisions identified by the initial audit (resolved below)

Primary clarifications:

1. Does the fixed three/four fan apply to the first seven-pairs win too, or only later wins? Can a first seven-pairs win stack pure suit or other bonuses?
2. Do big single and all triplets stack? Four exposed pengs plus a pair necessarily qualify for both: additive scoring starts at `1+2+2 = 5 fan = 10 points`, before radishes or duplicate-count bonuses. Adding pure suit makes seven fan/14 points. If the intended big-single floor is four points, one of those overlapping bonuses must not stack.
3. Is the one-quad seven-pairs tier frozen using the **initial complete 14-tile winning shape**? If the winning tile itself completes the quad, the retained 13 tiles show only three copies, so inspecting only the retained hand gives the wrong tier. Later accumulated win tiles must not accidentally promote a fixed tier unless expressly intended.
4. With two quads, there are five distinct tile types, not six. Is this still fixed four fan/eight points, or a higher tier? Existing structural seven pairs also admits six/eight identical copies, so those cases need an explicit policy rather than an invented extension.

Secondary boundaries to keep explicit:

- Does big-single expansion include kong tiles too, and does it retain its original concealed-tile wait? “碰牌区” may mean the whole meld area or only peng entries. Existing big-single recognition includes kongs.
- Do repeated same-type pengs add only one tile type to the wait set? Natural distinct-type behavior is likely, but preserve both melds for counts and scoring.
- Is the special mode kept after a legal post-hu kong? Expanded waits must participate in the existing “preserve waits” rule, rather than comparing only ordinary structural waits.
- Existing ordinary-discard locks and protected post-hu discards are separate source-legality rules. Expanded tile eligibility does not itself authorize removing these restrictions.

## Implementation and regression design

- Gate new behavior with a new-game flag such as `specialHuRules: true`. A stored game lacking the flag retains old scoring and behavior; do not reset a live room or retroactively rewrite previous hu records.
- Save `firstHuPattern` before removing the first winning tile, with only the metadata required for the confirmed fixed tier and distinct original wait types. Do not infer this mode from `huCount > 0` alone or recompute it from the latest repeated win.
- Build one contextual wait/hu resolver used by legal actions, diagnostics, private views, locks, and kong-preservation checks. Keep `isWinningHand` structural so first-hu rules do not become overly permissive.
- Preserve physical behavior: each accepted selfdraw leaves the original concealed base untouched, moves the new tile to retired physical storage, and appends one logical win. A discard win references its river tile once. Expanded meld-type wins never append the winning tile to a peng and never create a fifth meld.
- Detect pure suit from the actual qualifying shape/melds. Detect all triplets by whether a triplet-only decomposition exists, including six copies as two triplets and existing kong groups as one group each; do not require one triplet per unique tile.
- Preserve existing radish ownership/counting and source/payer logic unless the user changes them. Fixed seven-pairs fan suppresses ordinary fan additions only in the exact confirmed scope; radishes continue counting all authorized zones and repeated wins.
- For no-quad seven pairs, iterate all seven original tile types after first hu, using both selfdraw and legal discard paths. Reject outsiders, still reject expanded candidates before first hu, and preserve the original 13-tile base.
- For one quad, test all six types, including two separate first wins: one on a quad tile and one on another pair. Verify tier persistence after serialization and repeated wins which alter duplicate counts.
- For big single, use peng types `[0,0,9,12]` plus concealed base 17. After first hu, verify distinct waits, duplicate meld preservation, an expanded win on 0, no synthetic fifth meld, score accumulation, radishes, and eight-copy conservation. Use opponents without tile 0 so six meld copies plus one expanded winning tile stay valid.
- Cover isolated pure suit, isolated all triplets, combined patterns under the confirmed overlap rule, a sequence-only hand that is not all triplets, and mixed-suit negatives.
- Regress ordinary discard locks, immediate kong-discard bypass, protected ordinary post-hu discards, simultaneous winners, final-first-hu payment exceptions, exactly-once terminal dragons, and old games without the new flag.
- Update UI score summaries, wait descriptions, rule copy, API tests, snapshot/serialization tests, and aggregate tests together. Keep legacy v1/v2 behavior frozen.

## Subsequent implementation update

The audit findings above describe the pre-change baseline. The parent later authorized implementation in `shared/game.js` and `tests/special-patterns.test.js` and relayed these clarifications:

- 大单吊 and 对对胡 are mutually exclusive; 大单吊 takes priority. 清一色 adds two fan alongside the applicable normal pattern.
- Seven-pairs initial grouping follows the confirmed general formula `3 + Σ(n − 3)` for each initial group containing at least four identical tiles. Two quads give five fan; six identical tiles give six fan. The tier is captured from the complete first qualifying seven-pairs shape and does not grow with subsequent winning-tile records.
- Final clarification on 2026-11-04: 清七对 is five fan/10 points. The first qualifying seven-pairs win uses the full initial tier plus two fan if pure suit. Every later win retains that same total; new duplicate counts or patterns never increase it. Radishes continue recalculating.

Implemented: new-game-only `specialHuPatterns` flag, saved first qualifying special metadata, expanded private waits and diagnostics, mutually exclusive normal pattern bonuses, fixed first-and-repeat seven-pairs scoring with independent radishes, source/lock protections including the kong-discard exception, serialization, and unchanged old-room scoring. A prior standard win can later become a first qualifying seven-pairs or big-single win. Owned winning-tile records participate in the eight-copy eligibility ceiling so no ninth physical copy is suggested.

Focused tests cover full action sequences and tile/score conservation, original hand preservation, duplicate pengs, every seven-pairs tile type, quad/six/eight-copy tiers, radish growth, concealed/exposed kong melds, first-special activation after a standard win, ordinary/forbidden/kong discard sources, simultaneous virtual wins, privacy, and old-room behavior. Engine and test lint passed without findings (the project-level Next pages-directory notice is unrelated).

### Final scoring contract and verification

- `firstHuPattern.sevenPairsFan` is the frozen seven-pairs tier before pure suit: `3 + Σ(n − 3)` for initial groups of four or more identical tiles.
- `firstHuPattern.fixedFan` is the frozen **total**, including two fan when the original qualifying seven-pairs shape is pure suit.
- Every qualifying seven-pairs score, including the first, sets `sevenPairsFixed: true`, suppresses `copyFanBonus`, and reports separate `patternBonuses` entries for the base seven-pairs tier and the original pure-suit bonus. `score.fan` equals the frozen total, not a new sum involving later win-pile counts.
- Examples: ordinary seven pairs 3 fan/4 points; 清七对 5 fan/10 points; pure one-quad seven pairs 6 fan/12 points; pure two-quad seven pairs 7 fan/14 points. All add current radish matching points independently.
- A first qualifying seven-pairs win after a prior standard win follows the same rule. A shape also admitting an all-triplets decomposition does not add an extra all-triplets bonus once the seven-pairs fixed mode applies.
- New tests cover the first and two later wins of each tier through serialization; changing repeated win counts and radish matches; simultaneous first pure-seven-pairs discard wins; and unchanged pre-flag saved rooms.
