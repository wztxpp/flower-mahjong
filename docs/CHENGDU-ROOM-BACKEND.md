# 成都房间接入合同 / Chengdu room integration contract

## 分工 / Responsibilities

`server/game-engines.js` 是唯一模式与版本分发入口。成都正式局只接受 `gameMode: chengdu`、`schemaVersion: 2`、`runtimeKind: production`、`rulesVersion: chengdu-1`，并在任何房间路由副作用前调用正式引擎的完整不变量检查。schema 1 开发准备/回合局、伪造标记或损坏牌墙都拒绝；不向花麻将回退。花麻将缺模式/缺版本兼容及三个独立引擎不变。
The registry is the only mode/version dispatcher. Chengdu production requires the explicit header above and full production invariant validation before room-route side effects. Drafts, forged markers and damaged walls reject without Flower fallback. All three independent Flower engines and missing-field compatibility remain unchanged.

- `server/chengdu-shuffle.js`：27种各4张，108张新数组；Web Crypto 32位拒绝抽样 + Fisher–Yates，不接受客户端种子，不回退 `Math.random`。 / A fresh 108-tile wall with four copies of each identity uses Web Crypto rejection sampling plus Fisher–Yates, with no client seed or insecure fallback.
- `server/api.js`：保留凭证、房主、满员、角色、离席/重连、只读观战和CAS；没有成都第二套身份/房间。 / Existing authentication, host/occupancy checks, characters, departure/resume, spectators and CAS remain authoritative.
- `server/history.js`：按模式投影归档和个人记录；公开 `huCount` 从成都 `won` 派生，不修改权威玩家对象。 / Mode-specific history projections derive public huCount from Chengdu won without changing authoritative players.
- `tests/chengdu-api.test.js`：独立存储和真实本机HTTP专项；不是线上或真实浏览器验收。 / Isolated-store, real-loopback HTTP coverage, not production or browser acceptance.

## 原子开局 / Atomic starts

成都 `start.options` 只能省略或为空对象；四项配置在建房时固定。客户端不能传入新的规则、牌墙、庄家或轮回序号。首局0号庄；后续由成都 `dealerForNextGame` 决定，房主权限不随庄家转移。
Chengdu start options must be omitted or empty; creation fixes all four settings. Clients cannot inject rules, walls, dealers or exchange ordinals. Seat zero deals first; Chengdu determines later dealers independently of host authority.

模式的可选 `startGame({room, rules})` 返回 `{game, roomUpdates}`，不修改传入房间。API将候选牌局和返回的房间字段放入同一次CAS；花麻将保留原有 `createGame({dealerSeat,rules})` 调用路径。`room.chengduExchangeOrdinal` 表示此前成功开启的换三张局数，首局为0；正式引擎返回 `nextExchangeOrdinal`。仅启用换三张的成功开局增加一次，方向循环为顺时针→对家→逆时针。关闭换牌、重复/竞争失败开局、动作、刷新、恢复都不推进。它不是人数、局ID或房间revision。
The optional mode start context returns a candidate game and room updates without mutation. Both commit in one room CAS; Flower retains its existing factory path. The room ordinal counts successfully started exchange-enabled rounds, beginning at zero. Only successful enabled starts advance it, cycling clockwise, opposite, counterclockwise. Disabled rounds, failed/duplicate starts, actions, reads and resumes do not advance it. It is independent of player count, game identity and room revision.

## 隐私和展示 / Privacy and presentation

开局及动作仅返回正式引擎的本人/观众/换座者投影。换三张内容、未公开定缺、对手暗手和摸牌不泄露。按已确认的正式策略，成立暗杠牌面公开，自摸胡牌在进行中仅本人可见、终局公开；这不公开其他暗手。换座者不能继承前任手牌、动作、积分身份或私人准备内容。
Only production player/spectator/replacement projections reach clients. Exchange contents, unannounced dingque, other hands and draws remain private. Confirmed production policy publishes established concealed kongs and reveals self-drawn winning tiles to others only at finish, without revealing unrelated hands. Replacements inherit neither private choices/actions nor predecessor identity.

成都适配器的 `presentation` 为null，没有展示续进，也不写播放页面租约。客户端带花麻将的播放标记不会开启成都屏障、自动换牌/定缺/判过或代打。合法动作来自本人服务器视图；重复和过期请求继续由房间CAS保护。
Chengdu advertises no presentation continuation and stores no player presentation leases. Flower playback flags cannot enable Chengdu gates or automatic decisions. Only server-supplied legal choices may be submitted, under existing stale/duplicate CAS protection.

归档只保留模式版本头、配置、公开分数与白名单事件，不复制墙或手牌。个人历史显式使用“已归档摘要”分发，不要求摘要伪装成完整游戏；现场HTTP永远使用完整校验。再次投影已隐藏事件不能恢复牌面。
Archives contain only mode/version headers, configuration, public scores and allowlisted events, never walls/hands. Profile history explicitly dispatches archived summaries separately from full saved games. Live HTTP always validates complete state. Reprojecting sanitized history cannot restore hidden faces.

## 验证 / Verification

专项覆盖四人创建/入座/开局、换牌/定缺/出牌/接胡/自摸/暗杠、两种终局模式完整流局、查花猪查叫退款结算、血战赢家退出、多人胡统一结算、下一庄、下一局归档、角色/个人记录、重复/竞争CAS、观战越权/隐私、离席/重连/终局换人、FileStore重启与关闭换牌游标。三个花麻将版本及三/四人现有测试继续运行。
Focused coverage includes four-player creation/seating/start, preparation and play decisions, full draw games in both end modes, draw settlement, blood-battle retirement, simultaneous wins, dealer/next-round/archive behavior, characters/profiles, duplicate/concurrent CAS, spectator authorization/privacy, departure/resume/replacement, FileStore reload and disabled-exchange counters. Existing three-version and three/four-player Flower regressions remain active.

最终命令结果由交付报告记录；此文档不把未执行的浏览器、生产或发布验收标为通过。没有push、合并或部署。
The delivery report records final command results. This contract does not claim unrun browser, production or deployment verification. No push, merge or deployment is part of this work.

成都另显式登记`actionGameProof:true`：gameId/gameRevision完整匹配不依赖Flower播放标记；任一证明字段出现就必须两项都正确，不能拿新房间revision掩盖旧游戏版本。未登记能力的Flower继续保留原条件。真实App链路和拒绝无写入HTTP测试共同验证此边界。
Chengdu explicitly advertises actionGameProof:true, decoupling complete matching game proof from Flower playback fields. Any partial/stale proof rejects even with a fresh room revision. Flower retains prior conditions. Actual App integration and HTTP no-write rejection tests cover this contract.
