# 服务端阅读指南 / Server reading guide

这份指南给刚接触后端的读者：先看“请求怎样走”，再看身份、并发、历史。代码中的中文注释在前，英文解释紧随其后。本次只改变注释与排版，保留函数签名、网络字段、存档字段、错误提示和规则行为。

This guide starts with request flow, then identity, concurrency, and history. Chinese comments are followed by English explanations. This readability pass changes only comments/layout, preserving signatures, wire/storage fields, error messages, and rules.

## 1. 从哪里读 / Reading order

1. `server/worker.js`：当前托管入口。`/api/` 请求交给 D1 支持的接口；其他请求交给 `ASSETS`。
   Active hosted entry: `/api/` requests go to the D1-backed API; other requests go to `ASSETS`.
2. `server/api.js`：`createApi(store)` 创建处理器。上半部分是验证/隐私/提交助手，下半部分按路径和 HTTP 方法分发。
   `createApi(store)` builds the handler. Helpers cover validation, privacy, and commits; the router selects by path and method.
3. `server/store.js`：存储约定和两个实现。业务层调用相同方法，不需要知道保存到内存还是 D1。
   The store contract has memory and D1 implementations. Business logic uses the same methods for either backend.
4. `server/history.js`：身份快照、公开历史和本桌成绩，与版本化的麻将规则分离。
   Participant snapshots, public history, and table totals are separate from versioned Mahjong rules.
5. `shared/character-assignment.js`：落座分配不同角色并保存在占座者；开局复制为单局快照，刷新和续局不重抽。
   Assign distinct roles on seating and save them on occupants; start copies a game snapshot, while refresh/next rounds never reroll.
6. `server/node.js`、`server/start.js`：独立 Node 适配和文件持久化路径。
   Standalone Node adaptation and file persistence.
7. `db/schema.ts`：描述现有 D1 表，不会自己执行迁移。
   Describe existing D1 tables without running migrations.

`worker/index.ts` 与 `db/index.ts` 是保留的平台脚手架，不是当前麻将部署入口。本轮保持原样。前者引用的 `lib/connector-context` 等并不是当前麻将运行链路的一部分，不应沿着这个旧入口推断实际请求走向。当前构建和发布说明见 [发布流程](RELEASE-WORKFLOW.md)。独立 Node 的 `server/start.js` 使用 `dist` 作为静态根目录；当前托管构建产物为 `dist/client` 和 `dist/server`，不要把两条启动链路混为一谈。

`worker/index.ts` and `db/index.ts` are retained platform scaffolding, not active Mahjong deployment entries, and remain unchanged. References such as `lib/connector-context` in the former are not part of the active Mahjong request path. See the [release workflow](RELEASE-WORKFLOW.md). Standalone `server/start.js` serves `dist`, whereas the hosted build produces `dist/client` and `dist/server`; these are distinct launch paths.

## 2. 房间、牌局、座位、个人 / Room, game, seat, and profile

- **房间 `room`** 是长期存在的一桌，包含当前座位、房主、当前局和过去局的档案。房间号可分享，只是定位入口。
  A **room** is a durable table holding occupants, host, current game, and archives. Its shareable code locates it; it is not authorization.
- **牌局 `room.game`** 是一次发牌到结束的规则状态，包含私人手牌和牌墙。再次开局替换它，但先保存旧局的公开记录。
  A **game** is rule state from dealing to completion, including private hands and wall. Restarting replaces it after archiving the previous game's public record.
- **座位 `seat`** 是绝对下标 0、1、2，不是某个永久的人。`tokenHash` 表示这一位落座者的座位凭证摘要；换人必须换凭证。
  A **seat** is absolute index 0, 1, or 2, not a permanent person. `tokenHash` identifies the occupant's seat credential digest; replacement occupants have different credentials.
- **个人记录 `profile`** 使用另一份随机凭证，摘要存在 `playerHash` 关联中，用于跨桌查成绩。昵称不用于身份合并。
  A **profile** uses a separate random credential, linked through `playerHash`, for cross-room records. Names never merge identities.
- **参与快照 `gameMeta.participants`** 在开局时记住各座位是谁。当前座位换人后，上一局仍属于原参与者。
  **Participant snapshots** record who occupied each seat at game start. Replacements do not acquire the previous participant's records.

`phase` 是给客户端和引擎使用的协议值，不能因为变量“更易读”就翻译或重命名。房间公开阶段由是否有局及该局是否 `finished` 派生；局内还有自己的行动阶段。`detached` 表示主动离席，`connected` 是最近 30 秒心跳的显示判断，两者都不同于“座位是否为空”。

`phase` values are protocol values and must not be translated or renamed for readability. Public room phase derives from game existence/completion; the engine also has its own action phases. `detached` means explicitly left, while `connected` is a recent-heartbeat display test. Neither is the same as an empty seat.

## 3. 请求如何改变状态 / How requests change state

典型动作：浏览器发送 `revision` 和动作 → 校验来源、请求体、座位/个人身份 → 校验客户端版本 → `structuredClone(room)` 创建副本 → 对应版本引擎计算下一状态 → `commit` 原子保存 → `publicRoom` 返回该玩家可见的数据。

Typical action: send `revision` and action → validate origin/body/seat/profile → validate client revision → clone the room → let the matching engine compute next state → atomically `commit` → return the player's `publicRoom` view.

- `POST /api/profile`：创建或验证匿名身份；客户端可提前保存随机凭证，避免响应丢失后丢失身份。
  Create/validate an anonymous profile; a client may persist its random credential before registration to survive a lost response.
- `GET /api/profile/history`：先找候选房间，再验证各局参与身份；只把结束局加入累计已结算分。
  Find candidate rooms, verify participation in each game, and include only completed games in settled totals.
- `POST /api/rooms` 与 `/join`：建房或抢空座。进行中的局不允许新人替换玩家。
  Create a room or claim an empty seat. Active games do not admit replacement players.
- `POST /start`：只有房主且三人在座、没有进行中局才可开始；先固定占座角色、归档旧局，再创建新局并复制角色映射。
  Require the host, three attached occupants, and no active game; freeze occupant roles, archive the old game, then create the new game and copy the same role mapping.
- `POST /action`：只复制允许的动作字段，再由当前局所属版本判定是否合法。
  Copy only allowed action fields and let the saved-version engine determine legality.
- `POST /leave`：大厅或结束后释放座位；进行中只标记离席，保留牌和分数，不代打、不跳过。
  Release the seat before/after play; during play only detach, preserving tiles and scores without autoplay or skipped turns.
- `POST /resume`：用原座位凭证恢复，不重新落座、不重新发牌。
  Restore the original credential's seat without reseating or redealing.
- `GET /api/rooms/:id`：验证后读取。心跳最多每十秒更新一次；`since` 与当前版本相等时只返回轻量结果。
  Authenticated read. Heartbeats update at most every ten seconds; matching `since` receives a lightweight response.

## 4. CAS 为什么必须保留 / Why CAS matters

假设两个请求都读到 `revision = 8`。它们各自在副本上操作，并尝试把房间写为版本 9。`compareAndSwap(next, 8)` 的意思是“数据库仍然是 8 才写”。第一个成功，第二个必须失败并返回 `STALE_STATE`，不能覆盖第一人的操作。

If two requests both read revision 8, both may prepare revision 9. `compareAndSwap(next, 8)` means “write only if storage is still revision 8.” One wins; the other receives `STALE_STATE` rather than overwriting the winner.

- `revisionMatches` 防止客户端从旧画面操作；数据库 CAS 防止服务器读取之后又发生竞争。这是两道不同的检查。
  `revisionMatches` detects stale client views; database CAS detects races after the server read. Both are necessary.
- MemoryStore 的检查和内存替换在第一个 `await` 前完成，限单进程。FileStore 继承此行为；多个进程不能同时写同一个 `.data`。
  MemoryStore checks/replaces before its first `await`, within one process. FileStore inherits this and does not support concurrent processes writing the same `.data`.
- D1 的 `UPDATE ... WHERE id = ? AND revision = ?` 在数据库侧解决并发，适用于多个 Worker 实例。
  D1's conditional SQL update resolves concurrency in the database across Worker isolates.
- 心跳只更新 `lastSeen`，不提升业务版本；仍要匹配座位凭证、版本和未离席状态，防止旧请求复活已离席玩家。
  Heartbeats update `lastSeen` without incrementing game revision, but still verify credential, revision, and detach state.
- 离席意图可有限重试，因为每次重新读取并重新验证身份；打牌动作不能盲目按新状态重放。
  Leave intent can retry boundedly after rereading and reauthenticating; game moves cannot blindly replay against new state.

## 5. 隐私与版本边界 / Privacy and version boundaries

`server/game-engines.js` 的 `engineFor` 先按已保存的 `gameMode` 选择模式，再按该模式的 `schemaVersion` 选版本；花麻将仍有当前、v2 或旧引擎。只有新局使用当前版本；重连和读取不迁移手牌或积分。未知的新版本明确报错，不猜测规则。

`engineFor` in server/game-engines.js selects saved gameMode first, then that mode’s schemaVersion; Flower retains current, v2 and legacy engines. Only new games use current rules; reads/reconnects never migrate hands or scores. Unknown newer versions fail explicitly rather than guessing.

`publicRoom` 先调用引擎的玩家视图过滤，再返回白名单字段。刚换座的人即使坐在同一下标，也不能读取上一人的手牌、暗杠、待胡牌或诊断。`publicEvents` 同样只复制允许的字段，并重新生成摸牌文案，避免从事件文字泄露牌。

`publicRoom` first calls the engine's player-view filter, then returns explicit fields. Replacement occupants cannot see a predecessor's hand, concealed kongs, waits, or diagnostics. `publicEvents` also allowlists fields and regenerates draw messages to avoid text leaks.

不要打印请求体、明文 token、凭证摘要、SQL 参数或完整 room/game 来调试。客户端发来的房间号、昵称、座位号都不能代替凭证校验。HTTP 仅适合可信本地开发；公开部署要用 HTTPS。

Do not debug by logging request bodies, raw tokens, credential digests, SQL bindings, or full room/game objects. Room codes, names, and seat indexes never replace credentials. HTTP is for trusted local development; public deployments need HTTPS.

## 6. 历史为什么不会重复计分 / Why history does not double-count

`gameMeta.id` 为每局提供稳定 ID。旧局只能补入仍可验证的一局，时间带 estimated 标记；已经被覆盖的历史不凭空补造。归档只保留公开事件和成绩，不复制完整牌墙和手牌。

`gameMeta.id` gives each game a stable ID. Legacy backfill covers only a still-verifiable game and marks estimated times; overwritten history is not fabricated. Archives preserve public events/scores rather than full walls/hands.

个人历史按 `roomId + gameId + seat` 去重。本桌分数按 `gameId + seat` 去重，并按座位凭证摘要聚合同一位参与者。`totalScore = settledScore + provisionalScore`，但个人大厅累计只算已结束局。本桌计算每次从现有账本派生，不是“刷新就加一次”的计数器。旧玩家离桌保留旧账，新人从零开始。

Profile history deduplicates by room/game/seat. Table totals deduplicate by game/seat and group by seat credential digest. `totalScore = settledScore + provisionalScore`, while lobby settled totals include only finished games. Totals derive from the ledger rather than increment on refresh. Departed players retain their scores; replacements start at zero.

个人/房间索引先写，房间 CAS 后写。冲突可能留下孤立索引，但查询会再核对房间中的参与者身份，所以索引本身不能授予成绩或手牌访问权。

Profile/room links are written before room CAS. A conflict may leave an orphan index entry, but queries recheck participant identity inside the room; the index alone grants no access to records or hands.

## 7. 常见语法与字段 / Syntax and naming glossary

- `await`：等异步操作完成；在它前后可能有其他请求推进。
  Wait for an asynchronous operation; other requests may progress around it.
- `?.`：左边缺失时停止访问，返回 `undefined`，不是自动创建对象。
  Optional chaining stops on missing values and returns `undefined`; it does not create objects.
- `??`：只有 null/undefined 才用默认值；合法的 0 和 false 会保留。`||` 则对所有假值使用默认值，二者不可随意互换。
  Nullish fallback preserves 0 and false; `||` falls back for all falsy values. Do not interchange them casually.
- `structuredClone`：复制嵌套数据，副本修改不直接污染原状态。
  Deep-copy data so mutations do not directly affect the source.
- `Map` / `Set`：分别是按键存值和去重集合，这里用于索引、限流和账本去重。
  Key/value maps and unique-value sets support indexing, throttling, and ledger deduplication.
- `person` / `participant` / `player`：分别表示当前占座者、开局身份快照、引擎中的玩家状态，不应为了“统一”而合并概念。
  Current occupant, game-start identity snapshot, and engine player state are different concepts, not interchangeable names.

## 8. 修改后的检查 / Checks after changes

运行 `npm test` 和 `npm run build`。重点关注并发抢座、过期版本、重复离席、重连、换人后的隐私、同桌续局、跨桌历史和角色分配。可读性改动不应运行数据库迁移、覆盖私人数据、发布站点或混入新计番规则。

Run `npm test` and `npm run build`, focusing on concurrent joins, stale revisions, repeated leaves, reconnects, replacement privacy, next games, cross-room history, and character assignment. Readability changes must not run migrations, overwrite private data, publish a site, or introduce new scoring rules.

## 本次整合的规则边界 / Integrated rule boundary

`9da4b4e` 是只改布局、注释和内部名称的独立可读性提交。最终整合另包含已授权的大单吊喜钱金额配置与碰后补杠时机纠正；`server/api.js` 的 startRules 接受已知布尔和金额选项，金额只在开局固定。不能把最终整合描述为完全没有功能变化。
9da4b4e is the independent readability-only commit. Integration separately includes authorized ready-bonus amounts and corrected pung timing. startRules accepts known boolean/amount options and fixes them at start; the integrated result is not entirely feature-free.

保存的 v0.7.0 `allowPungUpgrade:false` 通过引擎 requiresPungDiscard 解释为“碰后必须实际出牌一次”，不重写旧规则、手牌、历史或积分。更老的 true/缺字段时机保留。0 分喜钱不转账，但仍记录一次已处理标记和事件。
The engine interprets saved v0.7.0 false as an actual post-peng discard requirement without rewriting old rules, tiles, history, or scores. Older true/missing timing remains intact. Zero ready points still record the processing marker/event but transfer no points.

## 当前本地播放模式 / Current local playback mode

`presentationMode: local` 保留原分段引擎，服务端按650ms普通段和2800/4500ms胡牌段惰性续进，不写展示租约、不等任何客户端回执。GET心跳竞争只对明确CAS false有界重读并重验权；未知写入结果不重试。真实玩家回应与权限未放松。详见 [音画节奏](PRESENTATION-PACING.md)。
Local mode retains the staged engine with lazy 650ms ordinary and 2800/4500ms win cadence, without leases or receipts. Heartbeat races retry only proven CAS nonwrites with reauthentication; unknown outcomes never retry. Real player responses and authorization remain unchanged. See the pacing guide.

## 旧模式展示回执与多端 / Legacy presentation receipts and multiple clients

新增 `POST /api/rooms/:id/presentation`，按原凭证验证本人座位，再按局 ID + 展示 ID 合并 CAS 回执。`phase: begin` 与 `clientId` 认领唯一播放实例；完成回执须匹配归属。四十秒超时由读取/动作请求惰性恢复，主动离席移除该座位等待，重启不丢屏障。`gameMeta.presentationEnabled` 一经启用，本局旧客户端也不能绕过。完整设计、隐私、重试和兼容边界见 [音画节奏](PRESENTATION-PACING.md)。
The new endpoint authenticates the original seat and merges receipts by game/gate IDs with CAS. Begin/clientId claims a unique playback instance; completion must match ownership. Reads/actions lazily recover forty-second timeouts, departure releases that seat, and restart preserves gates. Once enabled, older clients cannot bypass pacing. See [presentation pacing](PRESENTATION-PACING.md) for privacy, retries and compatibility.

`phase: release` 须匹配同段 ID、clientId 与未完成座位的当前 owner；仅归还归属，不完成也不触发超时续进。重复、非 owner 和旧段 release 都不可删除新归属。
A release must match the current gate/client owner of an incomplete seat. It only relinquishes ownership, never completes or expires the gate. Duplicate, non-owner and stale releases cannot remove newer ownership.

每个占座者的 presentationClients 分别记录最多八个页面，五秒租约、一秒合并续租；公开视图不输出记录。preferredClients 只公开已选非秘密实例 ID，前台可发声优先。无 owner 时已知后台立即不等，未知页面仅发现 1.5 秒；有 owner 后不因遥测或租约变化提前结束。现代动作的完整 gameId/gameRevision 证明允许仅遥测造成的 room.revision 差异，但显式错误/不完整证明始终拒绝。详见音画节奏文档。
Each occupant retains at most eight private page records with five-second leases and one-second coalescing. Public preferredClients exposes only selected non-secret IDs, preferring audible foreground pages. Unowned hidden seats do not wait; unknown pages get 1.5-second discovery. Owners survive telemetry/lease changes until completion. Complete modern game proofs tolerate telemetry-only room-version differences, while wrong/partial supplied proof always rejects.

### 展示租约竞争的动作重试 / Action retries for presentation leases

`differsOnlyInPresence` 在动作 CAS 失败后比较完整保存模型，仅排除房间版本/更新时间与座位心跳/页面租约。带有效局证明的 v3 请求最多四次提交尝试；真实牌局、座位、身份或生命周期变化立即拒绝。每轮重建动作副本，不复用失败结果；未知存储错误不重试。详见 [播放节奏](PRESENTATION-PACING.md) 的“动作提交与租约竞争”及 `tests/presentation-api.test.js` 的确定性 CAS 竞争用例。

After an action CAS failure, `differsOnlyInPresence` compares the full saved model, excluding only room revision/update time and seat heartbeat/client leases. Proven v3 requests have at most four commit attempts; real game, occupancy, identity, or lifecycle changes reject immediately. Each attempt rebuilds its candidate, never reusing failed results, and unknown storage errors are not retried. See [presentation pacing](PRESENTATION-PACING.md) and the deterministic CAS-race cases in `tests/presentation-api.test.js`.


### 再开局与空闲租约 / Another round and idle leases

`recordPresence` 仅在 room.game 存在且未结束时保存展示租约。大厅/终局轮询不因遥测提升房间版本，因此不会阻塞严格 revision 校验的 `/start`；正常在线心跳、换座/离席及并发开局保护不变。新局创建后恢复登记。详见 [音画节奏](PRESENTATION-PACING.md)。
`recordPresence` stores presentation leases only while room.game exists and remains unfinished. Lobby/finished polling no longer bumps room revisions for telemetry, so it cannot block `/start`'s strict revision checks. Normal heartbeats, occupancy/departure and concurrent-start protections remain unchanged. Registration resumes after game creation. See [presentation pacing](PRESENTATION-PACING.md).

新局公开暗杠、自摸胡牌隐私通过 `shared/tile-visibility.js` 统一过滤；`publicEvents` 接收本人历史座位，避免从个人记录旁路读取对手牌面或计分牌数。缺快照旧局与 schema1/2 保持原样，详见 [展示隐私](TILE-VISIBILITY.md)。 / New-game kong/win visibility shares one filter; publicEvents receives the profile participant seat so records cannot bypass tile/count privacy. Older snapshots and schemas remain unchanged.

## 可变牌桌维护入口 / Variable-table maintenance

[可变人数与副数](VARIABLE-TABLES.md) 是3/4人、1–5副、神龙门槛及新计分快照的当前说明，替代本指南早期固定三人/144张/八张上限的默认描述。新增维护测试为 `tests/variable-table.test.js`、`tests/fixtures/variable-table.js` 和 `tests/variable-room-api.test.js`；UI专项并入原测试。旧局和schema1/2不改。
[Variable tables](VARIABLE-TABLES.md) documents snapshot-driven dimensions and scoring, superseding earlier fixed-three/144/eight-copy defaults here. The listed new maintained tests join existing UI coverage; old games and frozen engines remain unchanged.

## 观战扩展 / Spectating extension

观众通过独立只读凭证进入，不占座、不参与个人成绩或播放屏障。前端保留观战/玩家两类缓存，公开动态按各局快照显示名字，所有隐私和生命周期边界见 [观战与名字动态](SPECTATING-AND-NAMED-LOGS.md)。 / Spectators use independent read-only credentials without seats, profile records or presentation gates. Separate browser caches preserve player identities, and event names follow each game's snapshot. See the dedicated guide for privacy/lifecycle boundaries.


## 建房玩法快照 / Creation-time rule snapshot

新建 `room.settings` 保存 `playerCount`、`deckCount`、`dragonStartCount`、`autoDiscardAfterHu`（默认 true）与 `bigSingleReadyPoints`（默认50，0–100000整数）。false/0是有效选择。首局及下一局按建房快照固定，旧客户端 `start.options` 仍严格校验但不能覆盖已保存字段；人数、副数和神龙仍不可通过 start.options 修改。`game.rules` 是本局权威规则，`gameMeta.config` 记录实际设置并进入公开归档/个人记录。只有房主、满员、正确版本且无进行中局才可开局，观众继续只读。
New room.settings saves the three table dimensions plus autoDiscardAfterHu (default true) and bigSingleReadyPoints (default 50, integer 0–100000). False/zero are valid. Creation snapshots govern first/subsequent rounds; legacy start.options remain strictly validated but cannot override saved fields, and cannot change table dimensions. game.rules remains authoritative for the current game, while gameMeta.config snapshots actual settings for public archives/profile records. Starts still require host, full occupancy, current revision and no active game; spectators remain read-only.

兼容按字段存在判断，不按真假值判断：缺字段旧房保留原开局/下一局选项及默认，部分配置只锁已保存字段；读取、恢复和新局都不回填旧房设置，不给旧局补规则，不改旧记录或schema1/2。新增配置元信息只为建房明确保存的字段写入。验证见 `tests/variable-room-api.test.js`（默认、校验、0值、固定续局、部分旧配置、权限、FileStore恢复）及 `tests/api.test.js` 的旧房开局选项回归。
Compatibility checks field presence rather than truthiness: absent legacy fields retain original start/next-round options and defaults; partial snapshots lock only present fields. Reads, resumes and new rounds never backfill room settings, retrofit old game rules or alter old records/frozen schemas. New metadata fields are recorded only for explicitly saved creation settings. See the variable-room API suite and legacy start-option API regressions.

## 模式与生命周期分工 / Modes versus lifecycle

[模式边界](GAME-MODES.md) 是后续成都接入入口：API保留鉴权/CAS/角色/座位/观战凭证，模式适配器负责输入、状态转换、公开配置、三类视图和事件。`server/flower-visibility.js` 保存原花麻将投影，不反向依赖历史模块。
The mode boundary describes Chengdu integration: API keeps auth/CAS/characters/seats/spectator capabilities; adapters own inputs/transitions/configuration/views/events. Flower projections live in server/flower-visibility.js without importing history.

## 落座角色生命周期 / Seated-character lifecycle

`roomSeatCharacters` 只派生合法唯一公开角色；旧局参与者按凭证沿用旧局映射，替补者用自己的占座角色。`saveSeatCharacters` 只在已有 join/leave/start 写入候选里固定兼容结果；没有额外读取迁移或新 CAS。创建/加入用 `assignSeatCharacter` 选择未占用角色，开局只复制，旧引擎、规则、牌区、历史与身份权限不变。完整兼容合同见 [七角色](SEVEN-CHARACTERS.md)。
`roomSeatCharacters` derives valid unique public roles, matching existing participants by credentials to the game map and replacements to their own occupancy. `saveSeatCharacters` freezes compatibility results only inside existing join/leave/start candidates, with no read migration or extra CAS. Create/join chooses unused roles; start only copies. Engines, rules, tiles, history and authorization stay unchanged. See the [character contract](SEVEN-CHARACTERS.md).

## 终局摘要白名单 / Finished-round summary allowlist

用户明确要求终局展示每家手牌；新增 `game.roundSummary` 只在服务端真实 `phase:finished` 时构造。`server/round-summary.js` 由引擎注册表分发，`history.roundSummaryForRoom` 加入本局原参与者名字和同身份累计；旧手牌/观战/回应投影不改，新局不带旧摘要。只读已记 huCount、score、牌区与实际神龙结算，不从终局牌面重算。完整字段、缺记录兼容和测试见 [终局摘要](FINISHED-ROUND-SUMMARY.md)。
The requested final reveal uses a separate finished-only allowlist. Registry dispatch selects the projection; history adds original participant names and identity-matched totals. Old private views stay intact and new games omit the old summary. Read recorded counts, scores, zones and dragon settlements without rescoring; see the contract and tests.
