# Main-first release workflow

GitHub `wztxpp/flower-mahjong` main is the canonical release source. Before each publication:

1. Fetch main and preserve concurrent changes; never force-push release updates.
2. Commit changes on top of current main, run `npm test` and the production build, then push main normally (or update the ref with an expected-head lease and force=false).
3. Fetch and verify the exact remote main commit. Build and publish that verified source only. Sites may keep a separate packaging commit, but its runtime files must match the verified main source.
4. Verify the deployment and record the GitHub main SHA and Site version. Never migrate, reset or repair live game scores as a side effect of source synchronization.

## Initial reconciliation

Production v0.6.1 was deployed from Sites source `be1ff55b934299474d30cd32fae6d356203b8930`, Site version 12. GitHub main still pointed to `8a1595b999aa63b027b9c4f5f8b1297b2388097c`; the independently hosted Git histories had no common ancestor. This reconciliation preserves main as the first parent and the existing feedback branch history as an additional parent, while importing the verified production source. No game-code changes are part of reconciliation.

The old `db/migrations/*.sql` files are retained for manual SQL deployments. They are byte-for-byte equivalent to the numbered SQL files in `drizzle/`. They are alternatives, not additional migrations: never apply both sets to the same database. The existing production Site uses Drizzle's applied migration history; do not rerun old migrations or recreate tables.

Hosted builds use `npm run build`, which emits `dist/client` and the Worker bundle under `dist/server`. The default `npm start` is the Wrangler local-worker runtime. The standalone Node server remains available with `node server/start.js`; it expects an appropriate static build and its own private `.data` directory. Never expose `.data` or copy production records into the public repository.
