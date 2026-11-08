# 架构与生命周期 / Architecture and lifecycles

当前角色画框使用 [原图局部Canvas2D](PORTRAIT-MOTION.md)：原img永远可见，新普通开关默认静态。可见/前台/基础表情/非减少动态才加载和绘制；反应暂停复用，关开/换角/卸载失效旧代次。旧SDK许可不迁移，旧模型不执行或公开分发。装饰不拥有游戏、三秒表情计时或声音。
Current frames use original-preserving local Canvas2D: original img always remains visible and a new ordinary setting defaults static. Visibility, foreground, base reaction and motion allowance govern load/draw. Reactions pause/reuse; toggling, role changes and unmount revoke generations. Old SDK assent is not migrated, old models are neither executed nor redistributed, and decoration owns no game/reaction/audio authority.

v2多帧仅扩展装饰资产生命周期：原图和各供体逐张摘取小ROI，同物理图集URL只在一次加载中解码一次；全局只共享最多两张在途图，不永久缓存已解码完整图。停止保留小ROI，关闭/换角/卸载释放，旧代次不可接纳迟到供体。30fps保留RAF余量，暂停后不补播遗漏眨眼。
V2 expands only decorative asset lifetime: originals/donors are cropped sequentially to small ROIs, with one decode per physical atlas URL in a load. At most two pending images are shared globally, never a permanent completed full-image cache. Pauses retain ROIs; disable/role change/unmount release them and reject stale donors. The 30fps clock retains RAF remainder without replaying missed blinks after pauses.

可选geometry发区在准备时只读取一次局部RGBA，resize重建显示场不重读源图；原canvas已是目标尺寸也必须完成首次场初始化。停用和旧代次释放时同时清空typed arrays/小canvas；root/end/mask保护与Jacobian界限只属于展示数学，不拥有身体/场景、身份或游戏状态。
Optional geometry reads local RGBA once during preparation and rebuilds display fields on resize without source rereads, including initial setup when canvas dimensions already match. Revocation releases arrays/local canvases together. Pin/mask protection and Jacobian bounds are presentation math, not authority over body/scene, identity or game state.

## 1. 一次点击经过哪些层 / The path of a click

1. `src/App.vue` 从服务器视图的 `legalActions` 展示按钮，玩家点击提交动作意图。 / App renders server-supplied legal actions and submits intent.
2. 本地开发由 Vite 中间件进入 `server/node.js`；托管环境由 `server/worker.js` 进入；两者都调用 `server/api.js`。 / Vite/Node and hosted Worker adapters share the same API.
3. API 校验凭证、房间修订号和输入，复制房间，由 `server/game-engines.js` 按保存的 `gameMode` 与 `schemaVersion` 选择引擎。 / The API verifies credentials, revision, and input, copies the room, and dispatches by saved mode/version through the registry.
4. `applyAction` 从合法动作中精确匹配，在局副本变更状态、跑必要的自动步骤、检查守恒。 / The engine matches the allowlist, mutates a game copy, advances automatic steps, and checks invariants.
5. API 更新需要的元信息/房间版本，用 store 的原子比较保存；已结束局只在下一次 start 时加入 archivedGames。发生并发冲突时不覆盖别人的更新。 / The API updates metadata and persists through CAS without overwriting a concurrent update; archivedGames receives a finished game only at the next start.
6. `getPlayerView` 隐藏对手私有信息，返回当前座位可见的结果；Vue 接收最新且仍属于当前会话的响应。 / A private projection removes concealed opponent data; Vue accepts only a current-session response.
7. `computed` 重算展示，`watch` 或专用同步函数驱动新事件的声音/动画；它们不能再次计分。 / Derived views update and presentation effects consume events without changing scores.

**服务器是规则和账本的唯一权威。** 浏览器负责输入、展示、等待与过期响应保护。代码里没有第二套前端算分权威。
**The server owns rules and ledgers.** The browser owns input, presentation, waiting, and stale-response protection, not authoritative scoring.

schema 3 已胡者的可胡窗口只给 `hu`，仍等本人点击。读取旧待回应窗口时筛选选项，不改其已提交回应；所有 HTTP 动作共用引擎白名单拒绝跳胡。见 [胡后必胡纠错](POST-HU-WIN-CORRECTION.md)。
Schema-three prior winners receive hu alone when available and still confirm manually. Reads filter saved unanswered options without changing submitted responses; every HTTP action uses the engine allowlist to reject skips. See [mandatory-win correction](POST-HU-WIN-CORRECTION.md).

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

无人可接时跳过 claim。碰成功直接进入碰牌者 discard 步骤，不能伪造一次摸牌。胡/杠后可能进入 continuation/replacement 摸牌；v2 与未启用展示的 v3 在一次 API 动作内完成自动步骤；启用展示的 v3 按已提交动作分段；local 使用服务端短节拍，只有旧屏障等待全桌音画回执。
Skip claim when nobody is eligible. A successful peng enters its claimant’s discard step without inventing a draw. Hu/kong may start continuation/replacement draws; v2 and unpaced v3 complete non-decision steps in one action; paced v3 pauses at committed segments: local mode uses server cadence, while legacy gates await table media receipts.

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

## 7. 展示屏障生命周期 / Presentation-gate lifecycle

[音画节奏](PRESENTATION-PACING.md) 说明分段引擎、房间级 CAS 屏障、同座位播放归属、完成/取消、四十秒惰性恢复及旧客户端边界。引擎 revision 仍代表一次原始动作；每个播放认领、完成或续进分别提升 room.revision。断线恢复只能继续已提交动作，不选择胡、碰、杠或过。
[Presentation pacing](PRESENTATION-PACING.md) documents staged execution, room CAS gates, same-seat playback ownership, completion/cancellation, forty-second lazy recovery and compatibility. Engine revision retains original-action provenance; ownership, receipts and continuation each advance room revision. Recovery never chooses a player action.


展示页面租约只属于进行中的局；大厅与终局不续租、不因此增加房间版本，避免多人轮询使“再来一局”持续过期。房间在线心跳仍正常更新，开局仍须通过房主、满员、版本和 CAS 校验。
Presentation page leases belong only to an active game. Lobbies and finished rounds neither renew them nor bump room revisions for them, preventing multi-player polling from continuously staling another-round requests. Normal heartbeats continue; starts still require host, occupancy, revision and CAS checks.

## 展示不再是全员屏障 / Presentation is no longer an all-seat barrier

新版 local 模式把服务端短节拍、最新接收快照、页面展示快照和本地FIFO分开。声音慢只影响该页控制，不影响其他设备或真实规则判定；真实 claim 的玩家选择仍必须完整。旧段原样排空后再切换。详细生命周期、故障恢复与兼容边界见 [音画节奏](PRESENTATION-PACING.md)。
Local mode separates server cadence, received authority, displayed frames and per-page FIFO. Slow media affects only that page's controls, while real claim choices remain required. Existing legacy segments drain unchanged before opt-in. See the pacing guide for cancellation, recovery and compatibility.


### 可靠播放的页内/同座边界 / Page-local and shared playback boundaries

`src/shared-playback.js` 接收完整公开 history 投影，以房间/局/历史下标重建共享起点到当前段的完整前缀。锁与 `huajian-ordered-voice-v2:<room>:<seat>` 记录仅协调同源同浏览器同座声音；晚入副页和活跃时间超时都不能越过同局未完成前缀；即使所有旧页已关，后来的新现场事件仍可能带出共享记录中的未完成前缀，可按待播阈值主动略过。只有 CharacterAudio 自然完成的 success 才写成功，失败释放锁给健康副页1200毫秒机会，再转明确失败终态；后续声音不能越过未决头部，终态后不能迟到回播。音频不可用仍可能漏声，不影响权威牌局；缺锁/存储时明确降级页内顺序，不保证跨页去重或恰好一次。
The coordinator projects complete public history and walks the shared baseline-to-segment prefix by room/game/history index. Locks and the version-two room/seat ledger coordinate same-origin/browser/seat audio only; later baselines and activity expiry cannot overtake unfinished same-game prefixes. Even after all old pages close, later live events may bring out that retained prefix; explicit skipping is available at the backlog threshold. Only natural CharacterAudio success records successful completion. Failure releases the lock for a 1200ms eligible-sibling opportunity before explicit terminal failure. Later speech cannot overtake unresolved heads or retry terminal events. Unavailable audio can still be missing without changing game authority. Missing locks/storage degrade to page-local ordering, not guaranteed sibling deduplication or exactly-once.

local 同一前台会话的网络缺口无论多久都不自动清除已收队列/游标；本地待播（含当前段）加 onPendingPrefix 报告的本批外未终态有声前缀达到8才显示主动略过按钮，点击只结束本页媒体并显示最新已收状态，不发送麻将动作。后台、离桌、换局/历史缩短仍取消旧媒体与票据并建立静默基线。已有页面实际新后缀的静音/未解锁资格固定，不能复活已拒绝事件。全新页首次 locked 基线不将已有历史永久拒绝，ticket 仍静默；解锁后下一条新现场事件才可能代副页补共享前缀。旧屏障的五秒静默重连规则仍单独保留。
A foreground local session retains received queues/cursors across any transport-gap duration. Eight local pending segments including the active one plus onPendingPrefix-reported nonterminal voiced events outside the batch expose explicit skip; clicking ends page media and shows latest received state without sending a move. Backgrounding, departure, game/history resets still revoke old media/tickets and establish silent baselines. Receipt-time mute/lock eligibility for established-page new suffixes is frozen and refused events never revive. A new page’s initial locked baseline does not permanently deny existing history, but its ticket stays silent; only a subsequent unlocked live event may recover a sibling’s shared prefix. Legacy five-second silent reconnect rules remain separate.

新局自摸展示隐私同时覆盖房间视图与个人历史，终局解除遮蔽；它不改实体牌区或权威计分。详细边界见 [展示隐私](TILE-VISIBILITY.md)。 / New-game self-draw privacy covers room views and profile records, lifting at finish without changing physical zones or scoring. See the visibility guide.

### 角色池扩展不改变座位生命周期 / Roster expansion does not change seat lifecycles

七个角色在三或四位玩家成功落座时分配，`characterId` 跟随占座身份保存，首局及续局只复制到单局快照。空座不占用角色，后来者只能取剩余角色；离席重连不重抽，真正释放后新落座重新选。旧大厅缺字段确定性补齐，读取不写回，占座变更先固定旧人；旧局参与者沿原映射或旧兜底，替补不能改写原局。规则与隐私不变。合同、资源与测试见 [七角色与三/四座位](SEVEN-CHARACTERS.md)。
Seven roles are assigned on successful seating and saved as occupant characterId; first/next games only copy them into round snapshots. Vacancies reserve no role, late joiners use remaining roles, detach/resume keeps identity and actual reseating selects anew. Legacy lobbies recover deterministically without read writes and freeze existing roles before occupancy changes. Existing game participants keep their map/fallback; replacements cannot rewrite the previous round. Rules/privacy remain unchanged. See [contract, assets and tests](SEVEN-CHARACTERS.md).

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

## 模式不新增一套房间 / Modes reuse room lifecycles

模式在建房固定，一桌续局沿用。准备换三张/定缺应属于成都局内阶段，不能复制房间/身份/观战服务或借用花麻将自动续进代选。房间、局、版本、牌种与展示能力的明确合同见 [模式边界](GAME-MODES.md)。
Room mode is fixed at creation across rounds. Chengdu exchange/dingque belongs inside its game, without duplicating identity/room/spectator services or using Flower continuation to choose for players. See the mode boundary for explicit contracts.

## 成都准备层开发边界 / Chengdu preparation development boundary

[成都准备层](CHENGDU-ENGINE-FOUNDATION.md) 只新增局内 `exchange → dingque → rulesPending`，不复制身份、房间、历史、离席或存储服务。JSON/FileStore恢复不增加轮回、不重发牌、不自动代选。正式引擎未注册，HTTP只允许成都准备房间，仍拒绝正式开局；开发状态不得以花麻将的版本/播放续进处理。
[The Chengdu preparation layer](CHENGDU-ENGINE-FOUNDATION.md) adds game-local exchange/dingque/rule-gate phases without duplicating identities, rooms, history, departure or storage. JSON/FileStore recovery never advances the exchange cycle, redeals or decides for players. HTTP supports preparation rooms only, never starts, and Flower version/presentation behavior must not process these drafts.


## 牌种媒体与玩法隔离 / Tile media versus game modes

界面与声音通过 `src/mahjong-tile-presentation.js` 读取统一的27牌种媒体目录；它只依赖共享身份目录和两个原图定位模块。服务端继续在各模式适配器校验合法范围，花麻将只能0–17，成都仅允许准备房间，正式开局/结算仍拒绝。万牌声音只跟随公开已提交的弃牌事件，沿用原游标、队列、静音和取消；换三张与定缺私有选择不播报。
UI/audio read one 27-identity media catalog depending only on shared identities and atlas-coordinate modules. Server mode adapters retain their own valid ranges: Flower 0–17, with Chengdu preparation rooms only and game start/settlement still rejected. Wan calls follow committed public discards through existing cursors/queues/mute/cancellation; private exchange and dingque choices stay silent.

## 成都开发回合生命周期 / Chengdu development turn lifecycle

独立 `chengdu-play.js` 在最后定缺后原子进入 turn，支持 claim/血战退出/finished，流局规则确认后不再接受旧settlementPending状态。完整回应集合按开启快照重建，结算事件及退款标记保护恢复幂等。仍复用原存储/CAS，无第二套身份、房间或历史服务；生产适配/UI未接。见 [当前成都指南](CHENGDU-ENGINE.md)。
The independent runtime atomically enters turns after dingque, supports claims/retirement/finish and rejects obsolete settlementPending states now that draw rules are confirmed. Opening snapshots reconstruct claim eligibility; settlement/refund records protect recovery idempotence. Existing store/CAS remains, with no separate identity/room/history service or production UI integration. See [the guide](CHENGDU-ENGINE.md).

## 成都正式开局边界 / Production Chengdu start boundary

正式schema 2从完整安全随机牌墙创建，不升级schema 1原型；最后定缺自动进入turn。房间在成功开局CAS时一并保存nextExchangeOrdinal，只在启用换三张局递增。隐私沿用已确认基线并保存明确快照；公开历史重滤幂等，归档摘要不得当完整状态校验。引擎不持有房间身份或存储权限。
Production schema two starts from a complete secure shuffle, never promotes schema-one drafts, and enters turns after final dingque. The room CAS saves the next exchange ordinal only on successful enabled starts. Explicit visibility snapshots and idempotent archive filtering preserve privacy; archived summaries are not full runtime state. The engine owns no room identity or storage authority.

## 立绘反馈生命周期 / Portrait-feedback lifecycle

立绘从实际显示的公开事件派生，独立每座约3秒，既不修改权威状态也不增加动作屏障。普通轮询/飞牌结束不清；后台、换局、历史缩短、换桌、明确略过及卸载清除并使旧计时器失效。完整边界见 [立绘指南](CHARACTER-PORTRAIT-REACTIONS.md)。
Portraits derive from displayed public events and expire independently per seat without authority or action barriers. Lifecycle resets invalidate timers; normal polls/flights do not. See the dedicated guide.

主角立绘现在是手牌与操作下方的独立普通流面板，不再充当牌面背景；花麻将/成都复用原表情，观战不创建本人面板，离桌由原条件卸载。立绘布局不增加订阅、计时器或牌面遮蔽，角色持久化另由上述占座生命周期管理。见 [立绘指南](CHARACTER-PORTRAIT-REACTIONS.md)。
Self art is now a separate normal-flow panel below the hand/actions, not a card background. Flower/Chengdu reuse existing reactions; spectators have no self panel and leaving unmounts it. Portrait layout adds no subscriptions, timers or tile-privacy logic; character persistence belongs to the occupancy lifecycle above.

## 原图动效本地选择生命周期 / Local portrait-motion preference lifecycle

`portrait-motion/settings.js` 与 `PortraitMotionSettings.vue` 独立于房间/局，默认静态；新版本明确true才启用Canvas2D。旧Live2D接受不能迁移成新选择，旧拒绝也不会被自动打开。关闭同步撤销代次/清空覆盖，普通三秒表情暂停复用补丁；同源副页修改/清空新键同步生效，最后消费者卸载移除监听。设置只记版本与开关，不是法律同意，不保存身份或服务器记录。
Portrait-motion settings are independent of rooms/games and default static; only explicit true for the new version enables Canvas2D. Old Live2D acceptance never migrates and old refusal is never automatically enabled. Disabling revokes generations and clears overlays; ordinary reactions pause/reuse patches. Sibling updates/clearing of the new key synchronize, and the last consumer removes listeners. Storage contains only version/switch, not legal assent, identity or server records.

旧Live2D源码/许可记录仍是历史，不删除或修改玩家既有记录；生产不再请求旧SDK，打包排除旧公开资源。已有浏览器中的历史缓存不能被本次更正追溯撤回，也不声称已从浏览器删除。
Retired Live2D source/license records remain historical without modifying users' previous records. Production no longer requests the SDK and build output excludes retired public resources. This correction cannot retroactively recall historical browser caches and makes no claim of deleting them.

## 布局槽位生命周期 / Layout-slot lifetime

进行中的牌桌视窗按玩法/人数/屏宽确定尺寸，内容随已显示快照更新，槽位不随回合或牌河行数增删。可滚动状态留在原DOM中，不写入服务器、浏览器存储或音画队列；开局/终局/换桌仍可明确切换布局。详见 [稳定牌桌布局](STABLE-TABLE-LAYOUT.md)。
Active-table slots are sized by mode/count/width and survive turn/river-row changes. Native scroll state stays in the DOM, not authority, browser storage or presentation queues. Explicit game/navigation lifecycle transitions may still change layout; see [the layout contract](STABLE-TABLE-LAYOUT.md).

主桌面状态/终局/身份页脚只是DOM重排：私有手牌继续受原参与者/观战守卫，终局和重开仍由同一阶段、权限及处理器控制。固定接牌槽在玩家手牌动作附近常驻；观众只有公开页脚提示。大厅身份不随这次局内移动改变位置。没有新增状态、订阅或网络副作用。
The main-table status/finish/identity footer is a DOM rearrangement only. Original participant/spectator guards protect hands, and existing phases, permissions and handlers govern finish/restart. Fixed player claim slots remain by hand controls; spectators get public footer prompts only. Lobby identity stays in place, with no new state, subscriptions or transport effects.

## 自弃限制的生命周期 / Self-discard lock lifecycle

schema3从完整追加历史读取本人最近实际摸牌后的全部弃牌，不持久化第二份锁集合。所有真正弃牌（含手动点过与自动打出）建立限制，任何来源的本人实际摸牌解除之前的限制；碰、胡、抢杠申请和展示暂停不解除。读取旧窗口不回写；已接受回应在精确匹配本窗口时保留结算资格。缺失历史不从牌河猜测，详见[规则纠错](FLOWER-HAND-LOCK-CORRECTION.md)。
Schema three derives locks from committed history instead of persisting a duplicate set. Every actual discard adds an identity, and every actual own draw clears prior identities; non-draw actions and presentation pauses do not. Saved-window reads never rewrite state, accepted responses retain narrow exact-window treatment, and absent history is never guessed from rivers.

## 下一局选择弹层生命周期 / Next-round dialog lifetime

终局选择只是本页展示层。当前房间/单局的现场结束转换登记一次待提示，在音画与规则/邀请弹层完成后打开；首次恢复已结束快照不登记。已提示的局键只留本页内存，不增加存储键、不持久化房间字段、不消费历史或创建游戏。换局/换桌清理待提示与打开状态；原 start CAS、模式固定配置、参与者归档与累计账本完全沿用。真正开局只能来自房主明确点击，观众与其他玩家不能因此开局。
Next-round choices are page-local presentation. A live finish queues one prompt after media and existing modals; initial restoration of a finished snapshot does not. Prompted game keys stay only in page memory, without storage keys, room fields, history consumption or game creation. Game/navigation changes cancel pending/open state; original start CAS, fixed mode settings, participant archives and ledgers remain unchanged. Only explicit host action starts a game.
