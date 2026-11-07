# 麻将模式与版本边界 / Mahjong modes and version boundaries

**当前本地状态 / Current local status:** 成都正式schema2、独立引擎、HTTP生命周期和专用牌桌已整合；本文其余准备版/媒体阶段描述保留历史时点。最新行为与测试见 [成都牌桌界面](CHENGDU-PLAY-INTERFACE.md)、[房间后端](CHENGDU-ROOM-BACKEND.md)及 [正式集成验收](CHENGDU-PLAY-VALIDATION.md)。这不代表已发布。
Production Chengdu schema2, independent engine, HTTP lifecycle and UI are now locally integrated. Earlier preparation/media-only statements below are historical. Follow the linked current guides/validation; local integration does not imply deployment.


## 当前交付范围 / Current scope

成都目前可创建**仅准备房间**，不是可玩的成都实现。四人落座、角色偏好、邀请、观战和重连复用原房间生命周期；没有发牌、换牌、定缺动作或计分。`currentEngine: null`、`engines: {}`，`rulesVersion: null`。正式 `/start` 与任何成都引擎读取仍返回 `GAME_MODE_UNAVAILABLE`，不能借用花麻将。
Chengdu currently supports **preparation rooms only**, not playable games. Four seats, character preferences, invitations, spectating and reconnect reuse the existing lifecycle without dealing, exchange/dingque actions or scoring. Null current engine/rules version and an empty engine map keep starts and game reads fail-closed, never borrowing Flower.

建房须明确选择 `endCondition`、`exchangeThree`、`selfDraw: addBase | addFan`、`fanCap: 4 | 5 | 6`；固定 `playerCount: 4`、`dingque: true`。`shared/chengdu-room-settings.js` 分别调用准备选项与计分选项校验器，不发明未确认默认值。完整UI/接口合同与验收见 [成都房间准备](CHENGDU-ROOM-PREPARATION.md)。
Creation requires four explicit choices plus fixed four-seat/dingque constraints. The shared room-settings module composes the preparation/scoring validators without invented defaults. See [room preparation](CHENGDU-ROOM-PREPARATION.md) for the current UI/API contract and verification.

## 两个独立维度 / Two independent dimensions

- `gameMode` 表示玩法家族，目前目录包含 `flower`、`chengdu`。 / gameMode identifies a rules family: Flower or Chengdu in the current catalog.
- `schemaVersion` 表示该玩法自己的存档/规则版本。成都未来的1版不等于花麻将1版。 / schemaVersion identifies a version within that family; future Chengdu v1 is not Flower v1.
- 只有 `gameMode === undefined` 才兼容花麻将；null、空串、错误拼写不自动回退。读取不向任何旧对象补写字段。 / Only an undefined mode means legacy Flower; null/empty/misspelled modes do not fall back, and reads never backfill objects.
- 花麻将缺 `schemaVersion` 仍走冻结的1版，2/3分别走各自模块。字符串版本及未知版本明确拒绝。 / Missing Flower schema remains frozen v1; v2/v3 stay independent. String and unknown versions are rejected.
- 房间模式在建房固定，单局保存相同模式；房间和当前局的明确模式冲突会报错。不得用下一局、重连或动作请求切换一桌玩法。 / Room mode is fixed at creation and copied into each game; conflicts reject. Starting another game, resuming or acting cannot switch the room's rules family.

## 文件与依赖 / Files and dependencies

| 文件 / File | 职责 / Responsibility |
|---|---|
| `shared/tile-sets.js` | 深冻结的18/27牌种目录，只有身份、花色、点数、标签，不生成实体牌墙。 / Frozen identity catalogs, not physical walls. |
| `shared/game-modes.js` | 模式名称、对应牌种集合，以及缺模式字段的只读兼容解释。 / Mode definitions and read-only absent-field compatibility. |
| `shared/chengdu-options.js` | 已确认选项的独立严格校验，拒绝关闭定缺和额外计分键。 / Strict confirmed choices, rejecting disabled dingque and extra scoring keys. |
| `server/game-engines.js` | 唯一可运行注册表，建房/开局策略、版本解析、动作解析、投影与展示能力。 / Runnable registrations, room/start policy, version/action parsing, projections and pacing. |
| `server/flower-visibility.js` | 原花麻将公开事件与观战投影，按原规则遮蔽，不处理成都。 / Existing Flower event/spectator projections, never Chengdu. |
| `server/spectators.js` | 观战凭证签发/验证，保留旧 spectatorGameView 导出以兼容调用者。 / Spectator credentials with the former projection export retained for compatibility. |
| `server/history.js` | 参与身份、归档、个人/本桌账本；公开事件与配置交给模式适配器。 / Participation/archives/ledgers, delegating public events/configuration to modes. |
| `server/api.js` | 共用鉴权、座位、房主、角色分配、revision/CAS、只读观战与请求路由。 / Shared auth, seats/host, characters, revision/CAS, read-only viewers and routing. |

依赖方向是 API/历史 → 引擎注册器 → 纯引擎及花麻将投影 → 共享只读助手。投影不再反向导入历史，因此没有“历史→注册器→观战→历史”的循环。新增模式不应重新引入这种循环，也不应让共享目录导入服务器或 Vue。
Dependencies flow from API/history to registrations, then pure engines/Flower projections and shared read-only helpers. Projections no longer import history, avoiding a history→registry→spectator→history cycle. New modes must preserve this direction; shared catalogs must not import server or Vue modules.

## 引擎适配器合同 / Engine adapter contract

每个不可变适配器提供以下内容。HTTP 和历史只调用登记的入口，不能因为版本号相同就调用花麻将。
Each immutable adapter provides these entries. HTTP/history call registered functions rather than selecting Flower merely because a version number matches.

- `gameMode`、`schemaVersion`、`tileSet`：该版本身份及合法牌种集合。 / Family, version and tile catalog.
- `parseAction(input)`：只复制该模式允许的字段，校验牌种/数组/花色等传输格式；不代表动作合法。花麻将保留原 type/tile 白名单、0–17范围和忽略额外字段的行为。 / Mode-specific field/type validation, not move legality. Flower keeps type/tile, 0–17 and historical ignored-extra-field behavior.
- `apply(game, seat, action)`：纯状态转换，失败不改变输入；实际动作白名单、守恒、零和及规则由独立引擎负责。 / Pure transition; rejection leaves input intact, with legality/invariants/zero-sum checks inside the engine.
- `view(game, seat)`：当前参与者的私有视图。 / Current participant's seat-authorized projection.
- `formerParticipantView(game, seat)`：座位已经换人时的投影，不能暴露前任手牌、选牌、听牌或未公开选择。 / Replacement-occupant projection with no predecessor-private tiles/selections/waits.
- `spectatorView(game)`：从权威状态直接建立只读白名单；不能冒充一个玩家座位，再猜哪些字段需要删除。 / Direct allowlisted spectator projection, never a guessed cleanup of an impersonated seat view.
- `publicEvents(game, viewerSeat, participantNames)`：历史及账本的公开/本人可见事件，必须保护换三张、定缺、摸牌、待回应等未公开信息。 / Public/seat-visible history events, protecting unrevealed preparation, draws and pending responses.
- `presentation`：不支持则为 null；支持则提供 `apply` 与 `continue`。continue 只能续进已提交动作，不能替玩家选牌/定缺/过牌。 / Null when unsupported, otherwise paced apply/continue. Continuation never chooses a player's exchange, suit or pass.

外层模式登记还有 `engines`、`currentEngine`、`legacySchemaVersion`、`roomSettings(input)`、`startRules(input)`、`createGame(options)`、`dealerForNextGame(previousGame)` 和 `gameConfiguration(room)`。`legacySchemaVersion` 只为真实存在的缺版本历史提供解释；成都首版不应凭空声明旧格式。`gameConfiguration` 只白名单公开实际快照，不复制完整 rules 中未来可能新增的私密字段。
The outer registration provides the version map, current engine, optional real-legacy fallback, room/start validators, game/dealer creation and public configuration snapshot. A legacy fallback requires actual historical saves; Chengdu must not invent one. Configuration projection must allowlist actual public settings rather than spreading potentially private future rules.

房间仍需要引擎提供共同的 `phase`、`revision`、`players` 和公开 `history`，终局为 `phase: finished`。准备阶段也属于同一局的进行中阶段，不是重新建房。成都的专属公开字段应经明确投影和 UI 分支接入，不能伪造萝卜/神龙等花麻将字段来套旧界面。
Rooms require the common phase/revision/players/public-history envelope, with finished marking completion. Preparation remains part of the active game, not another room. Chengdu-specific public data needs explicit projections/UI branches, not fabricated Flower radish/dragon state to satisfy the old interface.

## HTTP 与历史兼容 / HTTP and history compatibility

`POST /api/rooms` 新增可选顶层 `gameMode`。旧请求省略时，存储与响应均保持缺字段；显式 `flower` 保存到 room，并由开局复制到 game/gameMeta，归档和个人记录保留。网页建房提供花麻将/成都准备房间选择，加入或观战不提交模式。`gameMode` 不是 settings 中的规则开关，不接受嵌入 settings；start/action 中的额外顶层值不会改变保存模式。
Room creation adds optional top-level gameMode. Omission preserves absent fields in storage/responses; explicit Flower propagates through room, game, metadata, archives and profile records. The creation form selects Flower or Chengdu preparation; joining/spectating submits no mode. Mode is not a settings flag: nested settings reject it, and extra start/action values cannot change the saved mode.

原 settings 的默认、false/0、旧房逐字段兼容与 start.options 校验不变。人物偏好/抽签、座位凭证、匿名档案、观战签名、断线恢复、换人、CAS与播放节奏仍由原生命周期处理；只有具体麻将状态转换与投影分发。观众仍可无副作用离开/恢复，不能执行玩家动作。
Existing settings defaults, false/zero, partial legacy snapshots and start-option validation remain unchanged. Character assignment, seat/profile identities, spectator signatures, reconnect/replacements, CAS and pacing retain existing lifecycle handling. Viewers may leave/resume without effects but cannot perform player actions.

历史存档不补模式、不重算旧分、不重新分配角色。花麻将引擎三份文件、原牌面/音频、前端、数据库列与迁移均未修改。模式错误在被支持的实际写入路径提交前拒绝；新模式绝不因为版本号碰巧为3就使用花麻将的续进。
Old history receives no mode backfill, score recalculation or rerolled characters. The three Flower engines, existing art/audio, frontend, database columns and migrations remain unchanged. Mode errors reject supported write paths before committing; a new mode cannot borrow Flower continuation merely by using schema three.

## 成都后续接入顺序 / Chengdu integration sequence

1. 确认玩法细节后实现独立纯引擎和守恒/零和测试，不复制花麻将旧局规则。 / Confirm details, then implement an independent pure engine with conservation/zero-sum checks.
2. 实现本模式建房/动作验证、私人/换座/观战/历史投影与公开配置。先补交换三张/定缺的隐私测试，再登记可运行版本。 / Implement validators and all projections/configuration; test preparation privacy before enabling a runnable registration.
3. 确认房间共同字段、终局归档、继续下一局、角色和播放能力。准备阶段玩家决定不能被自动续进跳过。 / Verify the common envelope, archival/next games, characters and pacing; never skip human preparation decisions.
4. 单独扩展 UI/牌面/音频。18–26固定对应一万至九万，语音名约定 `wan-1` 至 `wan-9`；素材文件位置由素材交付清单决定，不由目录猜测。旧0–17音频/原图字节不变。 / Extend UI/art/audio separately: identities 18–26 map to wan-1 through wan-9. Use verified asset manifests, preserving old media bytes.
5. 全量回归原模式及新模式，再做真实浏览器、多设备及角色/声音验收；没有明确发布授权不推送、不合并、不部署。 / Run all old/new regressions, browser/device/audio acceptance, and publish only with explicit authorization.

## 本次验证 / Foundation validation

- 基线为 `abd50f1`；工作分支 `feature/mahjong-mode-foundation`。 / Baseline abd50f1; branch feature/mahjong-mode-foundation.
- 新增 `tests/game-modes.test.js` 27项：目录/边界/选项/错误/适配器、16场跨三代完整逐步差分、展示与投影。 / 27 unit cases including 16 full versioned differential games, dispatch, catalogs, choices and projections.
- 新增 `tests/game-mode-api.test.js` 14项：建房拒绝、缺/显式模式、下一局、FileStore重启、角色、观战权限、CAS重复拒绝、展示续进、四类旧局、个人/归档记录，以及不支持存档的写入前拒绝。 / 14 HTTP/persistence cases covering lifecycle, privacy, CAS, pacing, legacy saves and records.
- `npm test`：971/971通过（原930 + 新41）。`npm run lint`：0错误，原有4警告；`npm run build`：通过。 / All 971 tests pass; lint has zero errors and four existing warnings; production build passes.
- 未做真实浏览器/设备/语音试听；本次没有改前端或素材，也没有可玩的成都模式，不能把基础层通过说成成都玩法验收通过。 / No real-browser/device/listening run; no frontend/media changes or playable Chengdu, so foundation checks are not Chengdu gameplay acceptance.
- 未运行数据库迁移、未接触生产牌局、未发布。 / No migrations, production-room access or publication.

## 成都准备层原型补充 / Chengdu preparation prototype

独立原型现位于 `shared/chengdu-game.js`，仅供开发准备阶段，正式 `createGame` 与 `settleGame` 均失败关闭。注册表只有成都准备房间条目，没有可运行版本；这里“正式开局未开放”仍然有效。确认细则与接口范围见 [成都引擎准备层](CHENGDU-ENGINE-FOUNDATION.md)。不能因其开发 schemaVersion 为1就当成可恢复的正式成都局。
An independent development preparation prototype now exists, but its production creation/settlement fail closed. Only a preparation-room registration exists; playable Chengdu remains unavailable. See [confirmed details and interfaces](CHENGDU-ENGINE-FOUNDATION.md); development schema one is not a released Chengdu save version.


## 已接入的媒体不开放玩法 / Integrated media does not enable gameplay

MahjongTile和角色声音现已通过只读展示目录支持万牌18–26；全部旧牌图和语音保持原样。媒体整合时未开放成都；当前准备房间可创建，正式开局/引擎读取仍拒绝，纯准备原型仍停在rulesPending。牌面/语音可用不代表已确认番型、杠分或流局付款。整合结果见 [集成验收](CHENGDU-INTEGRATION-VALIDATION.md)。
The tile component and audio now support wan 18–26 through a read-only catalog, preserving prior media. Media integration did not enable gameplay. Preparation rooms can now be created, while starts/game reads remain blocked and the pure prototype stops at rulesPending. Available media does not settle patterns, kong scores or exhaustion payments. See the integration validation.

## 成都开发回合补充 / Chengdu development runtime

独立回合/计分/流局计划现可在显式策略的开发局中测试，但注册表仍没有成都，正式createGame仍拒绝。不能因纯引擎可跑到终局就宣称HTTP、网页和历史适配已就绪。当前规则和测试入口见 [成都开发引擎](CHENGDU-ENGINE.md)。
Turns/scoring/draw plans now run in explicit-policy development games, but Chengdu remains unregistered and production creation rejects. A pure engine reaching finish does not establish HTTP/UI/history readiness. See [the development guide](CHENGDU-ENGINE.md).
