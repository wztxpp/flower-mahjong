# 项目术语与命名 / Project terminology and naming

本字典解释“同一个词在代码里具体指什么”。中文优先用下列名称；英文标识保留既有对外字段，通过作用域和类型区分，不强改存档键。
This dictionary defines each concept in code. Prefer the Chinese terms below and consistent English names. Preserve existing external keys and distinguish them by scope/type rather than migrating saved state for style.

## 身份与容器 / Identity and containers

| 中文 | 英文/标识 | 唯一含义与边界 / Meaning and boundary |
|---|---|---|
| 页面/应用实例 | page / App | 当前浏览器标签页中的 Vue 实例，不是服务器。 / The Vue instance in this browser tab, not the server. |
| 大厅 | lobby | 未进入某桌的前端画面；房间公开视图的 `phase: 'lobby'` 则表示该桌等待开局，两个作用域要写清。 / The frontend no-room view; the public room-view phase lobby separately means waiting to start. |
| 房间/牌桌 | room | 可连续玩多局的服务器容器，用房间号查找。UI 可称牌桌，代码对象统一 room。 / A persistent server container for multiple games, located by room code. |
| 房间号 | roomCode / room.id | 可分享的八位定位码，不是身份或权限。HTTP 保留 `id` / `room` 等既有键。 / A shareable eight-character locator, never identity or authorization. |
| 座位 | seat | `0`、`1`、`2`，是位置编号；显示给人时才加一。不是永久玩家 ID。 / A zero-based position, not a permanent player identifier. |
| 座位占用者 | occupant / room.seats[seat] | 当前占用房间位置的人及其落座凭证摘要。离席标记不总等于移除。 / Current room-seat occupant and credential digest; marking departure does not always remove them. |
| 单局参与身份快照 | participant / gameMeta.participants[seat] | 开局时保存该座位的昵称及凭证摘要，决定历史归属；不同于引擎手牌状态。 / Start-of-game name/credential snapshot defining historical ownership, separate from engine tile state. |
| 玩家规则状态 | player | 规则引擎中一个座位的 hand/melds/score 等。 / Per-seat state inside the engine. |
| 匿名个人档案 | profile | 跨桌个人记录身份；不是昵称账号、不是某个座位。 / Anonymous cross-room record identity, not a nickname account or a seat. |
| 座位会话 | session | 浏览器持有的房间号、座位凭证等连接信息。 / Browser-held room/seat connection information. |
| 座位凭证 | token / seat token | 授权访问该房间座位的秘密；不同于房间号。服务器只存摘要。 / Secret authorizing one room seat; the server stores a digest. |
| 个人凭证 | playerToken | 访问本人跨桌记录的秘密；不同于座位凭证。 / Secret authorizing personal cross-room records, separate from the seat token. |
| 凭证摘要 | tokenHash / playerHash | SHA-256 后的服务器索引，不向客户端公开。 / Server-side SHA-256 indexes, not public client fields. |
| 本人座位 | seat / you / mySeat | 内部参数 `seat`；房间公开响应 `you`；游戏视图 `mySeat`。这是协议映射，不是三个概念。 / Internal parameter, room-view key, and game-view key for the same requesting seat. |
| 显示昵称 | name | 展示文本，不能用来验权或合并账本。 / Display text, never authorization or a ledger identity. |

## 局与阶段 / Games and phases

| 中文 | 标识 | 含义 / Meaning |
|---|---|---|
| 单局/牌局 | game | 从发牌到终局的一局；房间的当前 `game` 可被下一局替换，旧摘要先归档。 / One deal through finish; archive its record before replacing the room’s current game. |
| 局 ID | game ID | 历史去重的稳定标识；不等于房间号或 revision。 / Stable history-deduplication identity, not room code or revision. |
| 规则版本 | schemaVersion | 选择 v1/v2/v3 引擎；同版本还可能有开局规则开关。 / Selects an engine; rules flags can differ within one schema version. |
| 开局规则快照 | rules | 该局开始时固定的规则对象；新默认值不覆盖旧对象。 / Frozen-at-start rule choices; later defaults do not overwrite them. |
| 房间阶段 | room view.phase | API 从 room.game 派生：`lobby` 等待、`playing` 进行、`finished` 结束，不是独立持久字段。 / API-derived from room.game, not an independent persisted field. |
| 引擎阶段 | game.phase | `turn` 当前座位行动、`claim` 他家回应、`finished` 终局。 / Active turn, claim responses, or finished. |
| 回合步骤 | turnStep | `draw` 等待摸牌、`discard` 已能行动/出牌；非 turn 时通常为 null。 / Draw or discard step inside a turn, usually null outside it. |
| 当前行动位 | currentSeat | 当前 turn 所属座位，不代表所有阶段只有他能发请求。 / Owner of the active turn; responders may act in claim phase. |
| 庄家 | dealerSeat | 本局起手十四张并先行动的座位；下一局选择独立计算。 / The seat dealt fourteen tiles and acting first. |
| 摸牌来源 | drawKind / lastDraw.source | `normal` 自然摸牌、`replacement` 杠后补摸、`continuation` 胡后补摸；首发牌记录用 `initial`。 / Natural, kong replacement, hu continuation, or initial dealer tile. |
| 接牌窗口 | claim | 一张弃牌/抢杠牌引起的回应集合，含 eligibleSeats、options、responses。 / Response window for one discarded/offered tile. |
| 有资格回应位 | eligibleSeats | 本次有可用接牌动作的座位；只等待这些人。 / Seats with options in this specific claim window. |
| 待决回应 | responses | 服务器保存的选择；处理完成前不把他家具体选择公开。 / Pending choices stored privately until resolution. |
| 合法动作 | legalActions | 引擎根据权威状态返回的 type/tile 白名单；不是前端猜测。 / Engine-generated authoritative action allowlist. |
| 房间修订号 | room.revision | 并发 compare-and-swap 用的房间版本，包括落座等非出牌变化。 / CAS version including non-game room changes. |
| 引擎修订号 | game.revision | 每次成功 applyAction 增一；一个动作内可记录多个自动事件。 / Increments per accepted action; one action can produce several events. |
| 请求代次 | epoch / generation | 仅浏览器本地的过期响应/动画保护计数，不写服务器 revision。 / Local stale-response/presentation guard, not a server revision. |

## 牌与动作 / Tiles and actions

- `PHOTO_FACE_CROPS`：用户 PNG 中的十八个原图矩形，顺序与 tile 协议一致；只裁切显示，不是新牌种或规则。 / Eighteen source rectangles in the user PNG, in protocol tile order; presentation crops, not new tile types or rules.
- `tile`：牌种编号，不是每张实体牌的唯一 ID。0–8 对应一至九条，9–17 对应一至九筒；每种八张。 / A tile identity, not a unique physical-copy ID; eight copies of each identity.
- `wall`：剩余实体牌墙；`wallCount` 是只读公开数量。 / Physical remaining wall; wallCount exposes only its size.
- `hand` / `handCount`：本人真实手牌 / 对外公开张数。`handIndex` 是当前排序后的数组位置，不是牌种。 / Concealed tile list / public count; a hand index is a sorted-array position, not an identity.
- `meld` / `melds`：已经成立的一组 / 多组碰杠；同牌碰两次仍是两组。 / One or several established meld groups; two pengs of the same identity stay separate.
- `peng`：碰，三张一组。`mingGang`：明杠，从弃牌成四张；`anGang`：暗杠。 / Peng is a three-copy meld; mingGang is a discard-claimed kong; anGang is concealed.
- `buGang`：补杠，把三张碰补成四张。`addGang`：加杠，把已成立的四至七张杠增加一张。两者不可混称。 / buGang upgrades peng to four; addGang extends an already established kong. They are different actions.
- **补杠时机的已确认意图**：碰后到本人打出一张牌前不能立即补杠；完成该次出牌后，后续正常合法操作窗口可以补杠，不要求新摸到的牌刚好是补杠牌。`pungUpgradeAfterDiscard` 启用此策略；v0.7.0 的旧 `allowPungUpgrade:false` 也按此纠正解释，旧字段不重写，旧账不变。 / **Confirmed intent**: no immediate upgrade before the peng claimant discards; after that discard, later legal windows may upgrade without requiring the newly drawn tile to match. pungUpgradeAfterDiscard enables this policy; saved v0.7.0 allowPungUpgrade:false receives the same authorized correction without rewriting fields or scores.
- `hu` / `huCount`：胡牌动作 / 本局已胡次数；本游戏允许多次胡，胡过不等于已结束或离席。 / Hu action / number of wins in this game; a winner may continue playing.
- `mustHu`：前端只读提示，表示 schema 3 本人已胡且服务端动作白名单仅含胡；不自动提交。已胡者能胡必须胡，不能过、出牌、碰或杠。 / A UI-only derived label for a schema-three prior winner with a hu-only server allowlist; never an autoplay command.
- `pass`：放弃当前可选动作；胡后手动模式还表示确认打出新摸牌。 / Pass on available options; in post-hu manual mode it also confirms release of the drawn tile.
- `discard` / `discards`：出牌动作 / 弃牌记录；被接走的记录仍留用于历史，但不重复计入实体牌。 / Discard action / river records; claimed records remain historical references, not extra physical tiles.
- `winPile`：逻辑胡牌区。`virtual` 表示一炮多响中的额外逻辑引用，不能增加实体牌。 / Logical winning-tile records; virtual entries refer to a shared physical tile.
- `retiredTiles`：自摸等移出的实体牌归档区，与逻辑 winPile 不重复计实体。 / Physical retired tiles, not additional copies of logical win records.
- `waitTiles` / `lockedWaits`：当前可胡牌种 / 保存的听口。`huLockActive` 是历史兼容字段，具体效力看对应引擎，不能仅看名字判断新版仍阻止重复胡。 / Current waits / saved waits; huLockActive is version-specific compatibility state.
- `radishes` / `sharedRadishes`：实际翻出的萝卜及服务端 getPlayerView 派生的共享汇总，后者不是单独持久字段。`pendingKongRadishes` 只是待翻数量，还没有取走实体牌。 / Revealed radishes / server-derived shared projection, not a separately persisted field; pendingKongRadishes is a count of deferred reveals, not removed tiles.

## 积分与展示 / Scores and presentation

- `fan`（番）不等于 `points`（分），`fanToPoints` 负责映射。`score` 是本局净变动，`payments` 是一次事件的零和明细。 / Fan and points are different units; score is a game delta and payments are one event’s zero-sum transfers.
- `bigSingleReadyPoints` 是每个对手支付的喜钱金额，整数 0–100000；0 不收费但仍记录已处理标记与事件，旧局缺金额按 50。 / Per-opponent ready bonus, integer 0–100000; zero creates no transfers but still records processing/event state; missing saved amounts retain fifty.
- `pendingPungDiscard` 是本座位仍欠碰后一次出牌的状态；只有实际出牌清除，暗杠/补摸不能清除。 / Per-seat post-peng discard obligation; only an actual discard clears it, not a kong/replacement draw.
- `bigSingleReadyPayment` 是是否启用大单吊听牌喜钱的规则开关；`bigSingleReadyPaid` 是本玩家本局是否已经处理的状态。不要把配置与已支付标记混用。 / The rule switch and one-game processed marker are distinct.
- `tableScores` 是本房间跨局总账视图；个人 `records` 是匿名档案跨房间的记录，不能混在同一个总分里。 / Table totals belong to one room; profile records span rooms.
- `history` 在引擎里指本局事件；房间归档是 `archivedGames` 等持久记录结构；前端 `personalHistory` 是个人记录响应。阅读时带上对象前缀。 / Engine history means game events; room archives and personalHistory are separate structures. Read qualified names.
- `ActionVoiceCursor` 跟踪已消费的权威事件；`presentationGeneration` 保护动画；`voiceVisibilityEpoch` 防止切后台后补播。它们不影响麻将规则。 / Audio/presentation cursors guard playback and animation, not game rules.

## 内部助手命名对照 / Internal helper naming

三个引擎的同义私有助手已统一：`cloneSerializable`、`sortTiles`、`tileLabel`、`countTiles`、`tilesInMelds`、`sameTileList`、`removeTilesFromHand`。状态转换使用 `beginDrawStep`、`drawTile`、`discardTile`、`declareKong`、`resolveClaimWindow`、`finishGame`；试算使用 `calculateHuScore` 和 `canDeclareKong`，提交积分使用 `transferPoints`。
The engines use consistent private helpers for serialization, sorting, labels, counts, tile removal, transitions, and scoring. Calculation and mutation names are deliberately different. Public exports and saved keys remain unchanged.

## 展示同步 / Presentation coordination

- `game.presentation`：引擎暂停的续进标记，不是新玩法、待决玩家选择或计分事件。 / An engine continuation marker, not a rule, player choice or score event.
- `room.presentation`：旧模式的持久化全桌展示屏障，包含局/展示 ID、requiredSeats、completedSeats、owners 和 expiresAt；公开响应另给 remainingMs。 / Legacy persisted table gate with game/gate IDs, required/completed seats, owners and expiry; public responses add remaining time.
- `presentationClientId`：本页面实例的非秘密 ID；旧屏障模式用它识别同座位播放拥有者。不能替代原座位凭证。 / A non-secret page-instance ID; legacy gates use it to identify the seat playback owner. It never replaces seat credentials.
- `presentationEnabled`：gameMeta 的本局展示能力，不能放入或回填 rules。 / A per-game presentation capability in metadata, not a rules migration.

- `presentationClients`：占座者内部的各页面可见性/音频/事件基线短租约，只在进行中的局登记，大厅/终局不续租；不公开其他记录。 / Private per-occupant visibility/audio/baseline leases, registered only during active games and not renewed in lobbies or finished rounds.
- `preferredClients`：本段尚未开始播放的优先前台页面 ID，不是身份凭证；不能抢走已开始的 owner。 / Preferred foreground page IDs for unstarted playback, not credentials and never a way to displace an existing owner.
- `gameId/gameRevision` 动作证明：精确匹配当前单局与引擎版本，区分遥测房间版本变化和真正过期动作；部分或错误证明不可回退放行。 / Exact game/engine-version proof distinguishing telemetry from stale moves; partial/wrong proof cannot fall back to acceptance.

## 本地保序模式 / Ordered local mode

- `presentationMode: 'local'`：本局传输展示能力，不是 rules；服务端段按固定短节拍续进，不等音频回执。 / Per-game transport capability, not a rule; server cadence does not wait for audio receipts.
- `receivedState`：最新已接受的本人权威视图，用于轮询版本；不保证已显示完。 / Latest accepted private view and polling revision, not necessarily displayed yet.
- `state`：页面当前实际展示视图，队列未完成时可能落后 receivedState。 / Displayed view, potentially behind received authority while media drains.
- 本地播放队列 / local presentation FIFO：权威新事件按 eventKey 去重后逐段播放；明确取消时才清理，不被普通新快照替换。 / Ordered fresh authoritative events, cleared only by explicit lifecycle cancellation rather than newer snapshots.
- `eventKey`：`room:game:historyIndex` 的精确公开事件身份，不是牌种、批次或最大已播下标。 / Exact public-event identity, not a tile, batch or maximum played index.
- `SharedPlaybackCoordinator`：`src/shared-playback.js` 的同源同浏览器同座声音协调器；按完整公开 history 前缀逐事件处理，不锁服务端或每页画面。 / Same-origin/browser/seat audio coordinator walking complete public history prefixes, never locking authority or per-page visuals.
- `floor`：共享本局历史起点；新副页不能用较晚基线或活跃时间超时跨过同局未完成前缀；只有新局/首次无记录建立共享基线，明确旧模式边界可前移。 / Shared game-history baseline; later siblings and activity expiry cannot jump past an unfinished same-game prefix; new games/missing ledgers establish baselines, and explicit legacy boundaries may advance them.
- `outcomes`：按历史下标保存的播放结果记录；`success` 才表示自然完成，`pending` 给健康副页1200毫秒接力，`terminal` 表示成功或明确失败/跳过后禁止再播，不等于成功。 / Indexed outcome ledger; success means natural completion, pending allows 1200ms sibling recovery, and terminal forbids replay after success or explicit failure/skip, not success alone.
- `enqueueOrdered` 结果：`{ events: [{ eventKey, status }] }`，status 为 success/failed/cancelled/skipped；Promise 完成不等于声音成功。旧 enqueueLive 仍返回 void。 / Per-event ordered outcome; promise settlement is not successful audio. Legacy enqueueLive still returns void.
- `audioEligible` / ticket：接收时固定的本页声音资格；已有页面静音/锁定期间实际新后缀不因解锁复活；首次 locked 基线不是新入队，不永久 deny 旧前缀，其 ticket 仍静默。播放前仍复核当前状态。 / Frozen receipt-time eligibility; established-page muted/locked suffixes never revive; an initial locked baseline is not new input and does not permanently deny the prefix, while its ticket remains silent. Playback still rechecks readiness.
- `pendingPresentationCount`：本地当前/待播段加本批之外未终态有声共享前缀计数，达到8时提供玩家主动略过入口；不是服务端段数或自动删除阈值。 / Active/queued local segments plus nonterminal voiced shared-prefix events outside the current batch; eight enables explicit user skipping, not automatic eviction or a server count.
- `page-local`：缺锁、缺存储或共享设施失败后的页内顺序与记录降级，跨页可能重复；不承诺恰好一次。 / Page-local ordering/records when shared facilities are missing or fail; sibling duplication is possible, with no exactly-once guarantee.

- `onPendingPrefix`：协调器报告本批之外待补有声前缀数量，App 写入 sharedPendingPrefixCount 并与本地计数合并；结束/取消清零，不把已终态或本批事件重复计入。 / Coordinator callback reporting outstanding voiced recovery outside the current batch; App merges it with local counts and clears it on completion/cancellation, excluding terminal and current-batch events.
