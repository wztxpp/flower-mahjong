# Configurable 大单吊喜钱 candidate

Based on verified GitHub main `69d4e52a028ee008a21ff0466c3a5eefecb57696` (v0.7.0). This is a local implementation, not a push or deployment.

## Behavior

- The host can enter 大单吊喜钱（每家） before the first game and each next round. The default is 50 virtual points per opponent; 0 means no transfer. Only integers from 0 through 100000 are accepted, on both the client and server.
- The authoritative amount is saved in the game's rules and shown to every seated player. Refresh/reconnect restores it. Polling does not replace an unfinished next-round edit. Leaving for another table resets the draft to 50.
- Payment timing is unchanged: four completed melds and a stable one-tile ready hand after discard, or after the fourth kong before its replacement draw. Every player can trigger it only once per game. Zero also records that trigger once, with no payments.
- Later hu, kong, radish and dragon payments are independent. History displays the actual amount and labels it 听牌喜钱, rather than incorrectly calling it kong points.
- Saved games missing the amount retain the original 50-point rule. Games missing the enable flag do not receive retroactive payment. Completed scores and historical events are not recalculated. The legacy fixed 50-point hu rule is unrelated and unchanged.
- Start requests remain host-only and revision-protected. A running game's amount cannot change. Forged options/rules attached to ordinary actions cannot change it.

## Verification

- `npm test`: 588 passed, no failures or skips.
- `npm run build`: passed, including the Worker bundle.
- `npm run lint`: no errors; four existing warnings remain.
- `git diff --check`: passed.
- New regression coverage includes zero/custom/max amounts, invalid input types/ranges, one-time payment and later hu, old saved games, host-only start, concurrent requests, same-room next game and prior accounting, FileStore reload, forged midgame changes, accessible form rendering, disabled/busy state, repeated clicks, all-player read-only display, and polling/refresh draft behavior.
- Repository TypeScript checking still reports the same 10 scaffold errors in `db/index.ts` and `worker/index.ts`; output was compared against unchanged main and matches exactly. Those files were not changed.
- Desktop/mobile browser visual acceptance is not claimed. The actual Vue SFCs were compiled and exercised by server-rendered component tests; production compilation passed. No browser pixel or live-device input check was performed for this candidate.
