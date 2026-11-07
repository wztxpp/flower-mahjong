# 观战与名字动态 / Spectating and named logs

## 入口与权限 / Admission and authorization

大厅增加“进入观战”，只需朋友分享的房间号，不要求落座名。未开局、满员、进行中与终局均可进入。房间号仍仅是入场定位码，原玩家 GET、动作与个人历史的凭证验证不变；同源策略、既有限流及托管平台认证继续生效。没有新增房间列表或公开搜索。
The lobby adds Spectate, requiring only an invited room code, not a player name. Lobby, full, active and finished rooms admit viewers. The code locates admission; existing player reads/actions/profile history retain credential checks, same-origin checks, rate limits and platform authentication. There is no room listing or public search.

`POST /api/rooms/:id/spectate` 发放独立 `watch.<nonce>.<signature>` HMAC-SHA256 凭证。每桌仅保存一个 `spectatorKey` 服务端秘密，不建立无限增长的观众集合。新桌插入时生成；旧桌首次观战只补此字段，通过 CAS 提交，明确未写入的冲突最多重读四次。观战不修改座位、房主、开局参与者、牌局、个人索引或积分。密钥和签名不进入任何 state、URL、日志或页面文案。
POST spectate issues a separate HMAC-SHA256 capability. One private spectatorKey per room avoids an unbounded viewer list. New rooms generate it at insert; old rooms add only that field on first admission using at most four proven-nonwrite CAS attempts. Spectating does not change seats, host, participants, game, profile indexes or scores. Keys/signatures never enter state, URLs, logs or prose.

观战凭证只可 GET 同一房间、resume 与无副作用的 leave。join/start/action/presentation 明确返回 403；伪造、跨桌与缺少 Bearer 格式返回 401。未知规则版本仍拒绝。读取不更新任何玩家心跳或展示租约，也不发播放回执、不触发引擎续行。凭证在房间存在且签名密钥保持时可重连；退出只停止本地观战，不是逐凭证吊销机制。
The capability permits same-room GET, resume and no-op leave. Player mutations return 403; forged/cross-room/malformed-bearer credentials return 401. Unknown rule versions remain unsupported. Reads never update player presence/leases, acknowledge presentation or advance the engine. Credentials remain resumable while the room/key exists; leaving stops the local viewer rather than individually revoking capabilities.

## 投影与兼容 / Projection and compatibility

`server/spectators.js#spectatorGameView` 独立构建白名单视图，不借用第 0 席私有视图。三套引擎和权威存档不改。所有版本观战都不返回暗手、牌墙、当前摸牌、听口、锁听、胡牌诊断、未决回应、完整计分输入或凭证。进行中的自摸胡牌在玩家摘要、胡牌区、实体引用、事件和文字中均隐藏；老局未开启玩家遮牌选项也不能给新观战权限泄露牌面。
The spectator view is built independently from an allowlist, never from seat zero's private view. All three engines/saves are unchanged. Every version omits hands, walls, current draws, waits, locks, diagnostics, pending choices, complete scoring inputs and credentials. Active self-draw wins are masked in player summaries, win piles, retired references, events and prose, including legacy games whose player view opted out of masking.

公开弃牌、已成立公开副露、萝卜、积分、付款人和金额保留。旧暗杠按原公开策略保持遮牌。终局恢复公开胡牌与实体胡牌引用，不公开暗手或完整计分输入。`payments`、`dragons`、`kongSource` 与计分摘要也进行嵌套白名单过滤。公开积分仍可能支持推理，不承诺阻止数学推断。
Public discards, public melds, radishes, scores, payers and amounts remain visible. Legacy concealed kongs retain masking. Finish reveals public winning tiles/retired win references, not hands or complete score inputs. Nested payment, dragon, kong-source and score fields are allowlisted too. Public scores may support inference; this does not prevent mathematical deduction.

## 浏览器生命周期 / Browser lifecycle

响应增加 `viewerRole`，观战 `you`/`mySeat` 为 null；前端不把 null 退化为座位 0。所有座位均以公开面板显示，没有“我”、本人手牌或房主操作。集合按当前席位长度生成，投影/展示测试覆盖第四席，但观战提交本身不实现四人规则；整合版由可变牌桌配置明确启用。
Responses add viewerRole with null you/mySeat for spectators. The browser never coerces this to seat zero. All seats use public panels without self/private/host controls. Collections derive from current seat count; fourth-seat projection/UI tests exist, while the original spectator commit does not implement four-player rules. The integrated build enables them through explicit variable-table settings.

同一房间的玩家缓存仍用原房间键；观战缓存使用 `watch:<roomId>`，避免覆盖正在进行的原座位。URL 只增加 `view=spectator` 模式，不携带凭证。重复点击、迟到入场响应、刷新、换桌、Back/Forward 仍使用既有 epoch 失效保护。退出观战不向玩家 leave 路由发送离席。
Existing player cache keys remain intact; spectator keys use watch:roomId to preserve the original seat. URLs add only view=spectator. Existing epochs protect repeated clicks, late admissions, reloads, room switches and history navigation. Spectator exit never sends player departure.

## 名字与历史归属 / Names and historical ownership

`shared/event-names.js#nameEvent` 在公开投影时一次性替换 `1号位` 等所有座位引用，支持同条消息多名参与者和第四席；昵称里的座位字样、美元符号或 HTML 均不再解释。Vue 插值继续转义，不使用 v-html。
nameEvent replaces all numbered-seat references once during projection, including multiple participants and a fourth seat. Seat-like strings, dollar signs and HTML inside names remain literal. Vue interpolation escapes them; no v-html is used.

房间事件使用 `gameMeta.participants` 当局快照，个人记录使用每个 entry.meta 的名单；不能拿当前占座者给旧局改名。归档继续保存原公开事件，不重写历史或账本。旧局没有任何名单时才保留可知的座位标识，不猜昵称。新离席日志先保存离席者姓名，再释放座位，避免下一任继承日志。
Room events use their game participant snapshot; profile records use each entry's own metadata. Current occupants never rename prior games. Archives preserve original public events without ledger rewrites. Missing historical identities retain known seat labels rather than guesses. New lifecycle entries capture the departing name before freeing the seat.

## 验证与范围 / Validation and scope

新增 `tests/spectators.test.js` 覆盖入场、满员/进行中、签名与越权、跨域/跨桌、并发旧桌补字段、FileStore 重载、schema1/2/3、全部自摸引用、嵌套字段、终局、四席投影及历史名字。真实 Vue 测试覆盖只读界面、两种缓存并存、重复入场/迟到响应、刷新/后退和四席面板。已有 API/隐私断言仅同步名字投影预期。
The new spectator suite covers admission, full/active rooms, signature/privilege checks, origins/rooms, concurrent legacy-key creation, FileStore reload, all schemas, self-draw references, nested fields, finish, four-seat projection and historical names. Real Vue tests cover read-only controls, separate caches, repeated/late admission, restoration/history navigation and four-seat panels. Existing API/privacy assertions only update their name-projection expectations.

2026-11-07 使用官方 Chromium 与隔离 MemoryStore 服务（5360–5362）实测：只填房间号的观战、1/3保持不占座、三人加入/开局后仍可观战、真实玩家出牌/摸牌以名字显示、刷新重连、返回大厅/浏览器后退，以及另一观众在满员进行中入场。观战可见各家牌背，没有本人动作。服务已通过原终端 Ctrl+C 停止；未读生产数据、未发布。此浏览器轮次使用 `index-DKTpNf0r.js`，后续加强服务端严格鉴权/白名单，并补正终局落座数与观战失效缓存清理（均有自动回归）；合并其他功能后须重新构建验收。
Official Chromium with isolated MemoryStore origins 5360–5362 verified room-code-only admission, unchanged 1/3 occupancy, three players joining/starting alongside a viewer, real named discard/draw updates, reload, lobby/Back and another viewer joining an already-full active game. Public hand backs appeared without own actions. The terminal server was stopped with Ctrl+C; no production data or publication. This browser pass used index-DKTpNf0r.js; later changes tightened server authorization/allowlists and corrected finished occupancy and expired-viewer cache cleanup, with automated regression coverage. Rebuild and retest after integrating other features.

未在真实浏览器自然打到终局/自摸或完成移动端验收；这些隐私分支由守恒夹具和真实组件自动测试覆盖，不冒充浏览器实测。未声明全项目 TypeScript 检查通过。角色扩展与四人规则需要在各自分支合并后做联合回归。
This browser pass did not naturally play through self-draw/finish or validate mobile layout; conserved fixtures and actual-component tests cover those privacy cases. No repository-wide TypeScript success is claimed. Character/four-player integration requires combined regression after merging those branches.

最终独立分支检查：`npm test` 821/821；`npm run lint` 0 错误、4 个既有警告；`npm run build` 与 `git diff --check` 通过。最终前端构建为 `index-CtvJgkWb.js`；不要把早先浏览器构建和最终构建混称为同一轮实测。 / Final standalone checks: 821/821 tests, lint with zero errors and four pre-existing warnings, successful build and diff whitespace check. Final browser asset is index-CtvJgkWb.js; the earlier browser run and final build are distinct verification stages.
