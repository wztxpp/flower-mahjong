# 架构与生命周期 / Architecture and lifecycles

## 1. 一次点击经过哪些层 / The path of a click

1. `src/App.vue` 从服务器视图的 `legalActions` 展示按钮，玩家点击提交动作意图。 / App renders server-supplied legal actions and submits intent.
2. 本地开发由 Vite 中间件进入 `server/node.js`；托管环境由 `server/worker.js` 进入；两者都调用 `server/api.js`。 / Vite/Node and hosted Worker adapters share the same API.
3. API 校验凭证、房间修订号和输入，复制房间，从保存的 `schemaVersion` 选择引擎。 / The API verifies credentials, revision, and input, copies the room, and selects the saved engine version.
4. `applyAction` 从合法动作中精确匹配，在局副本变更状态、跑必要的自动步骤、检查守恒。 / The engine matches the allowlist, mutates a game copy, advances automatic steps, and checks invariants.
5. API 更新需要的元信息/房间版本，用 store 的原子比较保存；已结束局只在下一次 start 时加入 archivedGames。发生并发冲突时不覆盖别人的更新。 / The API updates metadata and persists through CAS without overwriting a concurrent update; archivedGames receives a finished game only at the next start.
6. `getPlayerView` 隐藏对手私有信息，返回当前座位可见的结果；Vue 接收最新且仍属于当前会话的响应。 / A private projection removes concealed opponent data; Vue accepts only a current-session response.
7. `computed` 重算展示，`watch` 或专用同步函数驱动新事件的声音/动画；它们不能再次计分。 / Derived views update and presentation effects consume events without changing scores.

**服务器是规则和账本的唯一权威。** 浏览器负责输入、展示、等待与过期响应保护。代码里没有第二套前端算分权威。
**The server owns rules and ledgers.** The browser owns input, presentation, waiting, and stale-response protection, not authoritative scoring.

## 2. 页面与会话生命周期 / Page and session lifecycle

- **挂载 mounted**：读 URL 和本标签页对应凭证；无 room 参数时进入大厅，不盲目恢复上一桌。个人记录身份与座位连接分别处理。 / On mount, read URL/tab credentials. A URL without room opens the lobby rather than reviving the last room. Profile identity is separate.
- **加入 connecting/restoring**：快照目标房间和当前代次，提交/恢复会话；等待时不会让旧桌响应覆盖新目标。 / Snapshot target and epoch before joining/restoring; old-room responses cannot overwrite the new target.
- **在桌 connected**：权威视图驱动界面，轻量轮询只在版本变化时取完整状态；动作请求直接接受对应最新结果。 / Authoritative views drive UI; version-aware polling avoids unnecessary full refreshes.
- **断网 offline**：展示网络状态，不伪造动作成功，不自动代打。写请求丢响应不等于没执行，不能随意重发造成重复副作用。 / Display network failure without inventing success or auto-playing. A missing write response does not prove no commit occurred.
- **离桌 leaving**：保留离席意图并尝试服务器确认，停旧轮询/声音/动画，增加请求代次；进行中局仍保留原座位牌局。 / Record departure intent, confirm server-side when possible, stop old effects, and advance the request epoch. Ongoing games keep the seat state.
- **卸载 unmounted**：清理监听器、定时器和请求；过期回调必须失效。 / Dispose listeners, timers, requests, and stale callbacks.

`epoch`、`historyGeneration`、音画代次分别保护不同异步流程，不能因为都是数字就合并成一个服务器 revision。
Request, history, and presentation generations protect different async flows. Their numeric representation does not make them a server revision.

## 3. 房间与占座生命周期 / Room and occupancy lifecycle

创建房间 → 第一位占座并成为房主 → 后续加入至三人 → 房主开局 → 游戏结束 → 原房间可再开下一局。
Create room → first occupant becomes host → fill three seats → host starts → game ends → start another game in the same room.

- 房间比一局活得更久，包含当前座位、当前局、历史归档和本桌账本来源。 / A room outlives one game and holds occupancy, current game, archives, and ledger sources.
- lobby 离席释放位置并按既有顺序交接房主；进行中的局离席只标记离开，不删手牌/积分，也不让新人顶替原局参与者。 / Lobby departure releases the seat and hands off hosting; ongoing departure preserves participant state and does not substitute a newcomer.
- 结束后换人要新凭证、新账本身份；同昵称/同座位号不继承旧人的积分。旧参与者的历史行仍可保留。 / A replacement occupant gets a new credential and ledger identity; names and seat numbers do not transfer scores.
- 刷新与通过原链接重连不是重开；重开只能走明确的 start 路径并生成新局记录身份。 / Refresh/reconnect is not restart; only the explicit start path creates a new game identity.

## 4. 单局与回合生命周期 / Game and turn lifecycle

当前引擎的常见路径：
Common current-engine path:

`createGame → turn/discard → discardTile → claim → resolveClaimWindow → turn/draw → drawTile → turn/discard`

无人可接时跳过 claim。碰成功直接进入碰牌者 discard 步骤，不能伪造一次摸牌。胡/杠后可能进入 continuation/replacement 摸牌；v2/v3 的自动推进会在一次 API 动作内完成无需选择的步骤。
Skip claim when nobody is eligible. A successful peng enters its claimant’s discard step without inventing a draw. Hu/kong may start continuation/replacement draws; v2/v3 automatic advancement completes non-decision steps in one API action.

接牌窗口要收齐回应，再按引擎版本和保存方向处理。`pass` 也必须记录，没回应和明确放弃不同。一炮多响先准备所有赢家再一起算分，不按最快点击者结算。
Collect all eligible responses before resolving by saved engine/direction. No response is not a pass. Simultaneous winners are prepared together before scoring, not by click speed.

终局使 action 白名单为空，关闭 claim、lastDraw 和 turnStep；现有局状态及历史仍留在房间。v3 神龙终局结算有独立 settled 防重复标记。随后房间可归档并开始下一局。
Finished games have no actions, claims, or active draw step but remain stored with history. v3 dragon settlement has an independent persisted idempotence guard. The room can then archive and start again.

**版本差异不能抹平。** v1 有显式 draw 动作、旧计分/锁规则；v2 有自动轮转但萝卜/计分仍是该版本；v3 使用当前保存的规则快照。缺省 schemaVersion 按 v1 处理，未知更高版本应拒绝而不是猜测。
**Version differences are intentional.** v1 has explicit draw and historical scoring/locks; v2 has automatic turns but its own scoring; v3 uses saved current rules. Missing schemaVersion routes to v1; an unknown newer version is rejected.

## 5. 实体牌与逻辑记录 / Physical tiles and logical records

每种八张，总共 144 张。实体牌在 wall、hand、melds、radishes、retiredTiles 或尚未被接走的 discard 之间移动。`winPile` 可以引用弃牌和已移出的牌；一炮多响额外赢家的 `virtual` 只增加逻辑记录，不创造牌。
Eight copies of each identity total 144. Physical tiles move among wall, hands, melds, radishes, retired tiles, and unclaimed discards. winPile may reference those tiles; virtual additional winners do not create physical copies.

因此不变量检查不能把所有数组平铺后直接相加；必须排除重复历史引用。对照引擎末尾 `assertGameInvariants` 阅读，再看测试夹具如何从八张预算中扣牌。
Conservation cannot simply concatenate every array. Read assertGameInvariants and fixture tile budgets to see how historical references are excluded.

## 6. 分数生命周期 / Score lifecycle

1. 一次动作可能产生多个 payments，例如杠分、喜钱、胡分。每一组扣款与收款总和为零。 / One action may produce several zero-sum payment events.
2. `player.score` 是本局暂记净分，不是终身累计。 / Player score is a provisional game delta, not lifetime balance.
3. 终局写 finishedAt；下一次 start 才归档。稳定 game ID 防止重复读取/恢复/结算形成第二份完成局。 / Finish sets finishedAt; the next start archives the game. Stable game IDs deduplicate completed records across reads/recovery.
4. `tableScores` 从本桌完成局与当前局派生，区分已结算和暂记，不另维护易重复增加的总分计数器。 / Table totals derive from archived/current games with separate settled and provisional amounts.
5. 个人记录按 profile 身份关联房间，只公开本人可访问的历史；不按昵称合并。 / Profile-linked records expose only authorized personal history, never nickname-based merging.

## 7. 存储与运行边界 / Storage and runtime boundaries

- `MemoryStore`：测试/进程内数据；重启不保留。 / In-process testing storage, not persistent across restarts.
- `FileStore`：单进程本地 `.data`；房间和档案 JSON，使用文件替换保存。禁止两个进程同时写同一目录。 / Single-process local JSON storage; never share its writable directory across processes.
- `D1Store`：托管数据库，房间 JSON 和 revision 条件写；数据库 schema 与已应用 migration 不能随便改。 / Hosted D1 with revision-guarded room writes; preserve schema and applied migrations.
- `vite.config.ts` + `scripts/build-mahjong.mjs` 是当前 Vue/Worker 构建路径。保留的 `worker/index.ts` 是旧平台模板，不是正式麻将入口。 / Vite config and build-mahjong form the active Vue/Worker build; retained worker/index.ts is not the Mahjong runtime entry.
- 平台生成环境绑定、package-lock、Drizzle meta、音频和图片不是手工注释范围。 / Platform bindings, lockfiles, migration metadata, and generated media are not hand-annotation targets.

## 已授权的规则纠错例外 / Authorized rule-correction exception

一般不能静默改变旧局规则。补杠时机是用户明确纠正旧实现的例外：v0.7.0 的 `allowPungUpgrade:false` 不再解释为永久禁止，而是碰后先完成一次出牌、之后正常窗口允许补杠。由 `requiresPungDiscard` 与兼容推断读取处理，不重写旧规则字段、牌区、历史或已结算分；更老的允许/缺省策略仍保留。详见 [补杠纠错说明](PUNG-UPGRADE-CORRECTION.md)。
Normally saved rules must not change silently. The user-authorized pung timing correction is an explicit exception: v0.7.0 false means discard once after peng before later legal upgrades, not a permanent ban. Compatibility reads apply it without rewriting saved rules, tiles, history, or settled scores; older allow/missing timing remains intact.
