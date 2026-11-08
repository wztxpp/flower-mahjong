# 测试阅读指南 / Test reading guide

当前原图动效测试为 `tests/portrait-motion-{settings,controller,component,renderer,build}.test.js`，浏览器诊断入口为 `tests/browser/portrait-motion-preview.{html,js}`、`portrait-motion-preview-server.mjs`、`tests/helpers/portrait-motion-browser-audit.js`。前者验证真实逻辑/组件/构建合同，后者才验证Canvas2D像素和实际屏幕。旧 `live2d-*` 剩余套件保留离线历史，不代表生产使用SDK。完整范围见 [原图局部动效](PORTRAIT-MOTION.md)。
Current portrait-motion suites verify real logic/components/build contracts; the browser preview/audit helpers verify actual Canvas2D pixels and screens. Remaining old Live2D suites are offline history, not evidence of SDK use in production.

## 先理解测试在做什么 / What a test does

测试不是第二套业务代码。它准备输入，调用真实入口，然后用断言比较实际值与约定值。`test('英文标题', callback)` 注册一个场景；标题保持不变，便于比较历史运行记录，紧邻的中文注释解释同一个场景。循环注册的模板标题会产生多个独立用例，所以源码中的标题数不等于运行报告的测试数。
Tests are not a second implementation. They arrange inputs, call real entry points, then assert actual values against the contract. `test('English title', callback)` registers a scenario. Titles remain stable for historical reports; adjacent Chinese comments explain the scenario. Parameterized loops register multiple cases, so source title counts differ from executed test counts.

按以下顺序读一个场景：
Read each scenario in this order:

1. **准备 / Arrange**：夹具、固定种子、玩家身份、旧状态副本。知道哪些条件刻意不同，才能理解为什么结果不同。 / Fixtures, seeds, identities and reference snapshots reveal which conditions are intentionally varied.
2. **执行 / Act**：`applyAction`、HTTP 请求、组件方法或音频事件。`await` 等待这个异步操作，不保证别的在途操作也结束。 / An engine action, HTTP request, component method or audio event. `await` waits for that operation, not every other pending operation.
3. **断言 / Assert**：`equal` 比单个值；`deepEqual` 比数组/对象结构；`throws` 比同步拒绝；`rejects` 比异步拒绝；`match` 比文本模式。断言失败会使测试失败，不能删掉断言来“修好”测试。 / Equality, structural equality, synchronous/asynchronous rejection and text matching protect different contracts. Removing assertions is not a fix.
4. **清理 / Cleanup**：`t.after`、`after`、`afterEach`、`finally` 关闭临时服务/数据库并恢复全局对象。它们同样要在失败路径执行。 / Hooks and finally blocks close temporary services/databases and restore globals, including failure paths.

一个场景可能多次重复“执行 → 断言”，以验证完整生命周期，不能只读最后一行。`before = structuredClone(game)` 常用于证明失败操作没有偷偷修改输入。通过 `JSON.parse(JSON.stringify(...))` 重建状态模拟 JSON 存档往返，不是深复制所有 JavaScript 类型的通用工具。
A scenario may repeat act/assert phases to cover a lifecycle. A cloned `before` snapshot often proves rejection leaves inputs untouched. JSON round trips simulate persisted JSON state; they are not a universal JavaScript deep-copy technique.

## 推荐路线与全部文件 / Reading route and inventory

### 1. 规则与守恒 / Rules and conservation

- `tests/game.test.js`：当前 schema 3 的主契约；发牌、动作、计分、隐私、完整确定性对局。 / Current schema-three core: dealing, actions, scoring, privacy and complete deterministic games.
- `tests/v2-game.test.js`：冻结 schema 2；保留旧听牌锁和个人萝卜等差异。 / Frozen schema two, including its saved wait-lock and personal-radish behavior.
- `tests/legacy-game.test.js`：最早引擎及手动摸牌；不能跟随新引擎一起改期望。 / Original engine/manual drawing; do not modernize its expectations alongside the current engine.
- `tests/fixtures/post-hu-kong.js`：共享胡后必杠夹具。 / Shared mandatory post-win kong fixture.
- `tests/post-hu-win.test.js`、`tests/fixtures/post-hu-win.js`：已胡必胡的三类自摸/接胡、旧窗口恢复、拒绝所有备选动作、多人统一结算及冻结版本边界；夹具保证实体守恒。 / Mandatory post-win draw/claim variants, restored windows, rejected alternatives, atomic multi-winner settlement and frozen-version boundaries, using a conserved fixture.
- `tests/peng-upgrade-regression.test.js`：碰后先打一次牌，之后正常操作窗口可用已持有第四张补杠，不要求刚摸到同牌；同时覆盖 v0.7.0 错误 false 的纠正、抢杠和旧规则时机。 / Discard once after peng, then permit a held fourth copy in a later normal window without requiring a matching new draw; cover the v0.7.0 false correction, rob-kong and preserved older timing.
- `tests/fixtures/pung-upgrade.js`：共享真实碰牌夹具，分别控制已持有第四张与后续墙头，避免把这两个条件混为一谈。 / Shared real-peng fixture with independent held-fourth-copy and later-wall-head controls.
- `tests/extended-kong.test.js`：五至八张扩杠、补牌来源与付款方。 / Five-to-eight-tile extensions and replacement payer provenance.
- `tests/rob-kong.test.js`：未提交的加杠、抢杠窗口、回应顺序和原子结算。 / Uncommitted upgrades, rob windows, response order and atomic settlement.
- `tests/deferred-radishes.test.js`：首次胡牌前累计杠萝卜，首次胡时一次翻出。 / Accrue pre-first-win kong radishes and reveal them once.
- `tests/special-patterns.test.js`：特殊牌型、首胡冻结信息、扩展听牌和重复胡。 / Special patterns, frozen first-win metadata, expanded waits and repeat wins.
- `tests/big-single-ready.test.js`：稳定听牌付款、每家可配置 0–100000 整数喜钱、默认 50、仅收一次与旧局缺金额的兼容。 / Stable-ready payment with configurable integer 0–100000 points per opponent, default 50, exactly-once charging and missing-amount compatibility.
- `tests/dealer.test.js`：首位已提交胡牌者决定下局庄家。 / First committed winner determines the next dealer.
- `tests/counterclockwise.test.js`：所有座位排列的逆时针优先级，以及旧顺时针存档。 / Counterclockwise priority across seats and saved clockwise games.

### 2. 接口、身份与存储 / API, identity and storage

- `tests/api.test.js`：本机真实 HTTP 客户端、鉴权、非法输入、版本竞争、各规则的 HTTP 回归。 / Real loopback HTTP clients, authentication, invalid inputs, revision races and HTTP rule regression.
- `tests/d1.test.js`：内存 SQLite 模拟 D1，检查 SQL CAS、读写次数与凭证哈希。 / In-memory SQLite D1 simulation for SQL CAS, read/write counts and credential hashes.
- `tests/room-switch-integration.test.js`：身份历史、离席恢复、房主转移、重启、旧座位不能被新玩家继承。 / Identity history, leave/resume, host transfer, restarts and replacement-seat isolation.
- `tests/table-scores.test.js`：累计已结算分加本局临时分，不能重复归档或按昵称继承。 / Settled plus provisional totals, without duplicate archives or nickname-based inheritance.
- `tests/character-assignment.test.js`：偏好组合、精确随机分支、落座唯一分配、首局/续局稳定、旧房兼容、终局换人及 FileStore 重启。 / Preference/RNG enumeration, unique seated roles, first/next-round stability, legacy recovery, replacements and FileStore reloads.

`revision` 是房间状态版本，不是时间戳。两个请求携带同一旧版本时最多一个可以提交；另一个冲突后要读取新状态。SQLite 替身能检验这里使用的 SQL 和存储契约，但不模拟 Cloudflare 的全部运行环境或真实多地域延迟。
A room revision is not a timestamp. At most one competing write with the same old revision commits; a conflict requires a new read. SQLite checks the SQL/storage contract used here, not all Cloudflare runtime or cross-region behavior.

### 3. 前端、声音与素材 / Frontend, audio and assets

- `tests/ui.test.js`：编译真实 SFC，SSR HTML 和模拟浏览器中的请求/导航/状态。 / Real SFC compilation, SSR HTML and simulated browser request/navigation/state handling.
- `tests/invitation-copy.test.js`：内存 Vue renderer 执行真实复制按钮，覆盖 Clipboard API、旧复制方式和手动复制反馈。 / An in-memory Vue renderer exercises actual copy controls and clipboard/manual fallback feedback.
- `tests/character-audio.test.js`：不真正播放音频，验证播报身份、队列、中断、超时、去重与静音。 / Silent substitutes verify event identity, queues, interruption, expiry, deduplication and mute.
- `tests/mahjong-photo-faces.test.js`：十八种牌的行列/花色映射、等比裁切边界、用户 PNG 原字节及尺寸、隐藏牌约定。 / Eighteen-face row/suit mapping, proportional crop bounds, exact user PNG bytes/dimensions and concealed-tile contracts.
- `tests/voice-assets.test.js`：本地音频/头像存在、文件格式和清单路径，不生成或下载素材。 / Local voice/portrait presence, formats and manifest paths, without generating/downloading assets.

浏览器替身仅实现当前用例需要的接口。真实组件编译/SSR 通过不等于真实浏览器布局、触屏手势、权限弹窗和音频设备通过。测试中 `onMounted` 等生命周期有意被替换，以隔离网络和定时器；不能据此推断生产生命周期没有作用。
Browser substitutes implement only the APIs needed by these scenarios. Real-component compilation/SSR does not prove browser layout, touch gestures, permission dialogs or audio hardware. Some lifecycle hooks are deliberately replaced to isolate networking/timers; this does not mean those production hooks do nothing.

## 夹具为什么也要守恒 / Why fixtures must conserve tiles

完整引擎夹具从十八种牌、每种八张开始，共 144 张。把手牌、副露、萝卜、已经移出的实物牌和固定墙头/墙尾逐一扣除，余量才进入牌墙。超过八张必须失败；缩短牌墙要把移出的实物牌记入正确区域，不能直接删掉。`assertGameInvariants` 是夹具构造后的保护线。
Complete engine fixtures start with eighteen kinds, eight copies each, totaling 144. Debit hands, melds, radishes, retired physical tiles and fixed wall ends, then place remaining copies in the wall. More than eight copies must fail; shortening a wall must account for removed tiles. `assertGameInvariants` guards the result.

`winPile` 的逻辑记录不一定是新的一张实物牌。多人同时胡同一弃牌时，要区分唯一实物与 `virtual` 引用。测试的零和积分表示所有玩家之和为零，不表示每个人分数都为零。UI 快照可能只含当前玩家手牌、`wallCount` 和合法动作；这是裁剪后的展示数据，不应强行送入完整引擎校验。
A win-pile record is not necessarily another physical tile. Simultaneous winners distinguish one physical discard from virtual references. Zero-sum scores mean the sum is zero, not that every player scores zero. UI snapshots contain filtered presentation data, not necessarily complete engine state.

固定种子只使测试可重放，不可拿来生产洗牌。旧版本夹具故意选择已保存的规则；“字段缺失”“明确 false”“明确 true”可能走不同兼容路径，不能统一补默认值。
Seeds make tests reproducible and must not replace production randomness. Saved-rule fixtures intentionally distinguish absent fields, explicit false and explicit true; do not backfill them indiscriminately.

## 行为测试与源码断言 / Behavioral versus source assertions

行为测试调用真实函数、HTTP 或组件事件，比较返回状态、数据库内容或渲染结果。源码断言直接读取文件，再用字符串/正则寻找结构。例如牌背组件的源码匹配能保护隐藏牌模板约定，但不会实际点击或渲染浏览器。
Behavioral tests invoke functions, HTTP or component events and compare results, stored state or rendered output. Source assertions read files and match strings/regexes. A hidden-tile template source check protects a structural contract without actually clicking/rendering a browser.

重排空格、引号或注释可能让过度严格的源码匹配失败，但不能直接删除这个断言。先确认它原来保护的契约，再改为不依赖无意义空白的解析/匹配，并保留行为覆盖；不要放宽到错误实现也能通过。HTML 文案、正则、测试标题、协议字段和夹具数值在可读性工作中应保持原义。
Formatting can break overly strict source matches. Identify the original contract before replacing a match with whitespace-insensitive parsing/matching and retain behavioral coverage; never loosen it until incorrect code also passes. Preserve HTML copy, regex semantics, test titles, protocol keys and fixture values during readability work.

## 本地运行与性能安全 / Local execution and benchmark safety

基础运行需要项目要求的 Node 版本（package.json 当前要求 >=22.13.0）和已安装依赖。`node:sqlite` 可能打印实验性 API 提示，这本身不是测试失败。
Use the project’s required Node version (currently >=22.13.0) and installed dependencies. An experimental `node:sqlite` warning alone is not a failed test.

```sh
npm test
node --test tests/game.test.js
node --test tests/api.test.js tests/room-switch-integration.test.js
node --test tests/ui.test.js tests/invitation-copy.test.js
npm run lint
npm run build
```

`npm test` 只运行 `tests/*.test.js`。下面的脚本不在默认测试里，必须有意识地单独运行：
`npm test` runs only `tests/*.test.js`. The following scripts are separate, explicit operations:

- `tests/smoke/room-lifecycle.mjs`：`node tests/smoke/room-lifecycle.mjs local` 可启动临时回环服务；传 URL 会在那个服务注册身份、建新桌、离席恢复、打完一局并结算。它不是只读探测。脚本保留了既有 `health.version === '0.4.2'` 断言，与当前 `0.7.0` 服务不匹配；因此当前本地冒烟会在该旧验收断言停止。修改应另行确认版本验收意图，不能假称此脚本通过。 / local starts an ephemeral loopback service; URL mode creates identities/rooms and plays/settles games on that service. It is not read-only. Its preserved old health-version assertion expects 0.4.2 rather than the current 0.7.0 and stops the current local run there; do not claim it passes.
- `tests/performance/benchmark-api.mjs`：要求 URL、标签、输出 JSON 路径。它建合成房间，执行多次 HTTP 动作、三客户端刷新和未变化轮询。只对明确获准的隔离目标运行，不对线上地址随手压测。报告写测量元数据，不写原始 token 或私有手牌；网络请求本身仍真实改变目标数据。 / Requires URL, label and output path; creates a synthetic room and performs actions, three-client refreshes and unchanged polls. Use only an authorized isolated target. Reports omit tokens/private hands, but requests genuinely mutate the target.
- `tests/performance/benchmark-presentation.mjs`：读取本地 Git 基线和当前源码，用内存 Vue renderer 比较选牌和快照更新；基线提交不存在会失败，不会自动 fetch。预热、交替顺序和样本数在源码中列出；结果不是浏览器绘制、图片解码、音频或网络时延。 / Reads a local Git baseline/current source and compares in-memory Vue updates. Missing baseline objects fail without fetching. Warmups/order/sample counts are explicit, and results exclude browser paint, image decoding, audio and network.
- `tests/performance/presentation.html`：在本地 Vite 下打开 `/tests/performance/presentation.html`。它拦截相对 `/api/` 请求并注入合成视图，其他资产仍通过本地服务加载。按钮模拟重置、单胡、双胡，基准只统计状态到 `nextTick` 的 DOM patch。使用隔离测试浏览器，避免影响真实账号存储；不要把真实玩家数据贴进去。 / Open through local Vite; relative API requests are mocked while assets still load locally. Buttons simulate reset/single/double wins. Timing ends at nextTick DOM patch, not paint. Use an isolated test browser and synthetic data.

不得因为“只是测试”就使用生产凭证、修改真实房间、运行线上压测、执行数据库迁移、push 或部署。测试通过只说明执行过的断言成立，报告必须列明未运行的浏览器、冒烟和性能项目。
Testing is not permission to use production credentials, mutate real rooms, benchmark production, migrate databases, push or deploy. Passing means the executed assertions passed; report unrun browser, smoke and performance checks explicitly.

## 本次规则纠正与配置回归 / Corrected timing and configurable bonus

新局保存 `allowPungUpgrade: true` 和 `pungUpgradeAfterDiscard: true`。真实碰牌会进入 `pendingPungDiscard` 窗口，必须先打出一张；暗杠及其补摸不能代替这次打牌。之后正常操作窗口若已有第四张即可补杠，不要求这张刚摸进来。保存的 v0.7.0 `allowPungUpgrade: false` 是已纠正的错误意图，缺新标记时通过历史判断是否仍欠一次碰后打牌；读取不能为了兼容而重写旧历史。更早明确保留的补杠时机由独立用例继续保护。
New games save allowPungUpgrade and pungUpgradeAfterDiscard as true. A real peng enters pendingPungDiscard until an actual discard; a concealed kong/replacement draw does not satisfy it. A later normal window may upgrade an already-held fourth copy without a fresh matching draw. Saved v0.7.0 false is the corrected mistaken policy; missing markers require history-based pending-discard detection without rewriting old history. Separate cases preserve earlier timing contracts.

喜钱是每个对手各付的虚拟积分，房主仅开局前可改。HTTP 用例检查权限、边界值、并发只提交一次、局中拒绝改值和 FileStore 重载；界面用例检查数字输入、无效值禁用、请求发出时取快照、轮询保留编辑、只读规则和历史标签。0 表示不收取喜钱，不表示移除一次性已付标记，也不改变之后胡牌的独立计分。
The ready bonus is virtual points per opponent, editable by the host only before starting. HTTP cases cover authorization, bounds, single concurrent commit, rejection of midgame edits and FileStore reload. UI cases cover numeric validation, disabled starts, request-time snapshots, preserved draft edits, read-only rules and history labels. Zero means no ready charge, not removal of the paid-once marker or a change to later hu scoring.

## 音画顺序回归 / Presentation ordering regressions

- `tests/presentation-game.test.js`：分段推进与原即时引擎状态/历史完全一致、连续自动打出、手动模式、碰杠/抢杠及多人胡。 / Exact staged/immediate state-history parity, chained automatic discards, manual mode, claims/kongs/rob-kong and simultaneous wins.
- `tests/presentation-api.test.js`：多座位回执、同座位播放归属竞争、CAS、过期 ID、四十秒超时、离席、重启、混合客户端和隐私。 / Multi-seat receipts, same-seat ownership, CAS, stale IDs, expiry, departure, restart, mixed clients and privacy.
- `tests/ui.test.js` 与 `tests/character-audio.test.js` 新场景分别验证音画两个完成顺序、无音频、取消、丢包重试与音源停止。 / Added UI/audio cases validate both completion orders, unavailable audio, cancellation, lost acknowledgements and stopped sources.

设计和执行边界见 [音画节奏](PRESENTATION-PACING.md)。浏览器替身测试不等于真实设备音响或全平台验收。
See [presentation pacing](PRESENTATION-PACING.md). Browser substitutes do not constitute audio-hardware or cross-platform acceptance.

同座位组合回归同时实例化两个 App，覆盖后台、空基线及未解锁副页更早收到事件，验证前台胡牌画面和声音均完成以后才发出唯一完成回执；另覆盖认领在途转后台释放、独立后台会话的截止恢复。
Two-App same-seat regressions cover earlier hidden, baseline-only and locked siblings, requiring the foreground win visuals/audio to both finish before a unique receipt. Additional cases cover hiding during acquisition and bounded background-only recovery.

前台租约回归另覆盖：同座位独立记录、可发声优先、后台座位连续多段不等四十秒、未知发现窗口、已开始媒体不受后台副页/租约失效打断、慢媒体结束后下一段仍被选中、遥测版本差异与严格动作证明。ui 测试还用真实 API 与四个 App 实例验证隐藏座位不阻挡、前台慢语音仍阻挡真实引擎。
Lease regressions additionally cover independent sibling records, audible priority, hidden-seat short recovery across gates, discovery, owner protection, slow-media next-gate readiness and strict game proofs. A real API plus four App instances verifies that a hidden seat does not hold the table while foreground slow audio still holds the actual engine.


再开局回归在 `tests/presentation-api.test.js`：真实规则耗尽合成牌墙后，三位玩家轮询和切换可见性不能使开局版本失效；在 start 读取与 CAS 之间插入读取仍只开局一次。验证归档旧账、开局选项、新局租约恢复，并保留房主、满员、真实过期和并发重复开局拒绝。测试仅使用 MemoryStore，不访问真实房间。
Another-round regressions in `tests/presentation-api.test.js` exhaust a synthetic wall through real rules. Three-player polling and visibility changes must not stale start revisions; a read inserted between start load and CAS still permits exactly one start. Coverage retains archived results, options, resumed active-game leases, and host/full-seat/real-stale/concurrent-start guards. Tests use MemoryStore only, never real rooms.


组合回归串联“胡后最后一张必胡 → 三位播放器完成 → 真正终局 → 三方空闲轮询 → 同桌下一局”，验证不能过或提前开局，旧回执不影响新局，旧账只归档一次，新局仍保留音画屏障。
The combined regression chains mandatory post-hu final-tile winning, all three media completions, actual finish, three idle polls and another round. It rejects passes/early starts, isolates late old receipts, archives once and retains new-game presentation gates.

## 平滑播放修复维护清单 / Smooth-playback maintenance inventory

`src/App.vue` 新增接收/展示分离和本地FIFO；`src/character-audio.js` 的 enqueueOrdered 返回逐事件真实结果；`src/shared-playback.js` 负责完整公开前缀、同座位成功记录及有界失败接力；`server/api.js` 支持 local 节拍及GET竞争重读。新增维护测试为 `tests/ordered-audio.test.js`、`tests/shared-playback.test.js`、`tests/presentation-network.test.js`；`tests/browser/isolated-server.mjs` 与 `tests/browser/README.md` 仅服务隔离合成浏览器验收。不得连接真实牌局或把此辅助服务发布到生产。完整协议见 [音画节奏](PRESENTATION-PACING.md)。
App adds received/displayed separation and a local FIFO; audio reports per-event outcomes; shared-playback coordinates complete public prefixes, same-seat success records and bounded sibling retries; the API adds local cadence and safe read-contention handling. New maintained audio/network suites join npm test. The browser server/readme are isolated synthetic acceptance helpers only, never production endpoints. See the pacing guide.


### 可靠播放的专项边界 / Reliable-playback test boundaries

`tests/ordered-audio.test.js` 实例化真实 CharacterAudio，仅替换浏览器设备与网络，验证自然结束才成功、下载/播放上限失败、取消不悬挂、双胡分别报告和旧 live 返回 void。`tests/shared-playback.test.js` 实例化真实协调器，覆盖晚基线补全前缀、健康副页接力、1200毫秒后失败终态禁止倒序、静音资格不复活、首次 locked 基线解锁后新现场事件可补前缀、只计本批外未终态有声前缀、略过与降级页内串行。`tests/ui.test.js` 验证前台长网络缺口不清队列、本地加共享前缀计数的待播8段按钮及用户主动略过。这些是逻辑回归范围，不是音响听感、跨设备恰好一次或正式环境验收承诺。
Ordered-audio tests use real CharacterAudio with substituted browser/network dependencies to verify natural-end success, bounded failure, settled cancellation, separate winner outcomes and legacy void results. Shared-playback tests exercise the real coordinator's late-baseline prefixes, sibling recovery, 1200ms terminal ordering, frozen mute eligibility, initial locked-baseline recovery on subsequent unlocked live input, nonterminal voiced-prefix counts outside the batch, explicit skip and page-local fallback. UI tests cover long foreground gaps and the explicit-skip threshold combining local and shared-prefix backlog. These logical regressions do not establish acoustic quality, cross-device exactly-once or production acceptance.

- `tests/action-choice.test.js`：首胡前自摸胡与三种自身杠并列、接炮胡/碰/明杠/过并列、已胡必胡、碰后禁止暗杠及出牌后恢复、旧局缺字段/false 保持时机；所有夹具守恒且验证非法动作不改输入。 / Pre-win draw/claim choices, mandatory post-win hu, post-peng concealed-kong restriction and release, missing/false saved-flag compatibility, conserved fixtures and immutable rejection.

- `tests/tile-visibility.test.js`：新局暗杠公开；本人/两家对手的自摸胡牌、实体引用、事件与计分隐私；HTTP、个人历史、重连、终局、旧快照及计分不变。真实 Vue 展示回归在 `tests/ui.test.js`。 / New-game public kongs; owner/opponent win, retired-tile, event and score privacy; HTTP/profile/reconnect/finish/legacy and unchanged scoring. Real Vue display regression lives in ui.test.js.

### 七角色回归 / Seven-character regressions

原角色分配测试现穷举512种偏好组合；七人池与三座位分离、三版本旧局读取、全角色音频路径及三视角Vue渲染都有专项断言。资产测试要求7张独立PNG、161条当前语音和3条旧胡，不会因制作未完成而跳过。`tests/fixtures/original-voice-hashes.json` 锁定原72条静态音频；真实语音审计另有来源和ASR限制，参见 [七角色说明](SEVEN-CHARACTERS.md)。
The assignment suite enumerates 512 preference combinations, with dedicated fixed-seat/roster, three-engine legacy, all-character audio and three-viewer Vue checks. Asset tests require seven distinct PNGs, 161 active calls and three legacy hu clips and do not skip unfinished production. The original-voice fixture locks the 72 public baseline files; actual voice audits retain provenance and ASR limitations. See [the character guide](SEVEN-CHARACTERS.md).

## 可变牌桌维护入口 / Variable-table maintenance

[可变人数与副数](VARIABLE-TABLES.md) 是3/4人、1–5副、神龙门槛及新计分快照的当前说明，替代本指南早期固定三人/144张/八张上限的默认描述。新增维护测试为 `tests/variable-table.test.js`、`tests/fixtures/variable-table.js` 和 `tests/variable-room-api.test.js`；UI专项并入原测试。旧局和schema1/2不改。
[Variable tables](VARIABLE-TABLES.md) documents snapshot-driven dimensions and scoring, superseding earlier fixed-three/144/eight-copy defaults here. The listed new maintained tests join existing UI coverage; old games and frozen engines remain unchanged.

## 观战与名字 / Spectating and names

`tests/spectators.test.js` 验证观战入场/签名/越权/持久化、各版本隐私、四席投影及旧局名字归属；`tests/ui.test.js` 追加真实 Vue 的只读操作、缓存分离、重复/迟到入场和历史导航。浏览器实测范围见 [观战文档](SPECTATING-AND-NAMED-LOGS.md)。 / The spectator suite verifies admission, signatures, authorization, persistence, versioned privacy, four-seat projection and historical names; UI tests cover actual Vue controls/caches/concurrency/navigation. See the spectating guide for browser scope.

## 角色、变人数与观战联合验收 / Combined feature verification

[联合验收报告](FEATURE-INTEGRATION-VALIDATION.md) 记录三/四人玩家和观众的集成边界、真实浏览器与全量检查结果。新增联合场景位于现有 `tests/spectators.test.js`、`tests/ui.test.js`，未弱化媒体资产门槛。
The integration report records player/viewer boundaries, real-browser coverage and aggregate checks. Combined cases extend the existing spectator/UI suites without relaxing media contracts.

建房参数前置与统一样式沿用现有 `tests/ui.test.js`、`tests/variable-room-api.test.js`，覆盖创建默认/非法/零值、异步请求快照、重复点击、新房只读续局、部分旧房字段、恢复/观战/权限及旧局不回填。`api`、`presentation-api`、`spectators` 测试明确区分新房固定设置与旧房每局草稿。真实视觉范围见 [建房验收](ROOM-SETTINGS-VALIDATION.md)。
Creation-setting tests extend existing suites with defaults, invalid/zero input, async snapshots, repeated clicks, fixed-room starts, partial legacy fields and read-only/restore boundaries. Browser scope is documented separately.

## 模式基础层回归 / Mode-foundation regressions

- `tests/game-modes.test.js`：模式与版本隔离、冻结18/27牌种目录、成都已确认选项、16场跨三代完整逐步差分、投影与展示能力。 / Mode/version isolation, immutable catalogs, confirmed choices, 16 full differential games and projection/pacing capabilities.
- `tests/game-mode-api.test.js`：真实HTTP处理器、缺/显式模式、旧局恢复、下一局/归档、FileStore重启、角色、观战权限、CAS重复拒绝与历史归属。 / Real HTTP handler, absent/explicit modes, legacy restore, next rounds/archives, persistence, characters, spectator rights and CAS/history.

这些测试不开放成都玩法，不把已确认的选项目录当成规则引擎验收。范围、命令和未验证项见 [模式边界](GAME-MODES.md)。
These tests do not enable Chengdu or mistake option validation for engine acceptance. The mode boundary records commands and limitations.

## 成都未开放准备层 / Disabled Chengdu preparation coverage

`tests/chengdu-engine.test.js` 使用完整108张合成牌墙验证准备动作、隐私、多种顺序与24种子守恒、JSON/FileStore恢复、缺门优先出牌、牌型结构和自摸封顶数学；正式启动/结算与模式注册仍应拒绝。详见 [成都准备层](CHENGDU-ENGINE-FOUNDATION.md)。这不是碰杠胡/查叫/退杠完整验收，不是HTTP多人或真实浏览器验收。
The Chengdu test suite uses complete synthetic 108-tile walls for preparation actions/privacy/order independence, 24 seeded conservation runs, JSON/FileStore recovery, missing-suit discard priority, shapes and self-draw cap arithmetic. Production start/settlement/registration must reject. See [scope](CHENGDU-ENGINE-FOUNDATION.md); this is not full peng/kong/hu/draw-refund, multiplayer HTTP or real-browser acceptance.
万牌素材：`tests/wan-assets.test.js` 核对原PNG哈希/尺寸、九个等比矩形及18–26编号；`tests/voice-assets.test.js` 新增七角色63条实际万牌、音频来源/ASR/声学审计和 `fixtures/pre-wan-voice-hashes.json` 的旧164文件保留检查。自动检查不代替人工试听或整合牌桌视觉验收。
Wan assets: the atlas suite checks original bytes/dimensions, nine proportional crops and identities18–26. Voice assets check all63 files, provenance/ASR/acoustic evidence and the pre-wan fixture's164 original hashes. Automated checks do not replace subjective listening or integrated table visual QA.


## 万牌运行时集成 / Wan runtime integration

`tests/tile-presentation.test.js` 核对27个只读展示记录、旧18牌映射、非法输入与规则闸门。`tests/ui.test.js` 实际编译MahjongTile，逐一验证九万的大/小牌、按钮状态、背面/非法值隐私及旧18牌全部裁切。`tests/character-audio.test.js` 验证七角色×四座×27牌路径、准备阶段静音与重连游标去重。素材哈希与原有模式/成都准备测试仍全量运行，详见 [集成验收](CHENGDU-INTEGRATION-VALIDATION.md)。
The catalog suite checks 27 immutable records, preserved old media, invalid inputs and rule gates. Compiled-SFC UI tests check all nine wan faces at both sizes, button states, concealed/invalid privacy and all 18 original crops. Audio tests cover seven personas across four seats and 27 identities, silent preparation and reconnect deduplication. Asset-hash and existing mode/preparation suites continue in full. See the validation report.

## 成都准备房间 / Chengdu preparation rooms

`tests/chengdu-room.test.js` 验证24种明确配置、失败前不写入、固定四席、开局失败关闭、观战只读及FileStore重启/换人。`tests/ui.test.js` 新增四项检查原生必选表单、模式草稿隔离、请求快照/重复点击、房间回显、开局阻断与迟到响应。原“禁止建立成都房间”断言改为“禁止创建成都game/运行引擎”，并保留每个实际启动与隐私入口的拒绝断言。
The new room suite covers all choices, fail-before-write validation, fixed seats, closed starts, read-only viewers and restart/replacement. Four UI cases cover forms, draft separation, captured/single-flight requests, room presentation and stale navigation. Former room-rejection assertions now protect actual game creation/engine reads, retaining all start/privacy gates.


## 成都开发回合验收 / Chengdu runtime acceptance

新增 `tests/chengdu-scoring.test.js` 与 `tests/chengdu-play.test.js`，覆盖已确认计分、完整回合、抢杠、多胡/过胡、流局计划和未决阻断、幂等、隐私/重启/CAS及24种子完整回放。审查发现的五个边界均新增回归。完整范围及没有运行的真实浏览器/发布验收见 [成都指南](CHENGDU-ENGINE.md)。
New scoring/play suites cover confirmed scoring, full turns, robbery, multi/passed wins, draw plans/gates/idempotence, privacy/restart/CAS and 24 full seeded replays. Five review findings have explicit regressions. Scope and unrun browser/release acceptance appear in [the guide](CHENGDU-ENGINE.md).

成都后续确认已加入现有 `tests/chengdu-play.test.js`：三种杠金额不可覆盖、查叫/退杠不可选反规则、缺门未清的碰杠、单胡/自摸/多响接摸、跳过退出者与花猪退杠且不重复查叫。首胡流局的未决整批阻断继续有测试。
Follow-up Chengdu confirmations extend the existing play suite: fixed kong prices and settlement choices, pre-clearance melds, single/self/multiple-win continuation, retired-seat skipping, and offender refunds without duplicate ready penalties. Atomic pending first-win draw handling remains covered.

成都后续确认回归：`chengdu-engine.test.js` 验证固定顺时针起点、只按启用局推进及纯重试；`chengdu-play.test.js` 验证首胡流局和血战相同结算、原付款人退杠及重复结算不入账，并继续覆盖胡者退出和单胡/多响续摸。
Subsequent Chengdu confirmation tests cover fixed clockwise origin, enabled-only advancement and pure retries, identical first-win/blood-battle draw settlement, original-payer refunds and idempotence, retaining winner-retirement and continuation coverage.

### 成都界面 / Chengdu interface

`tests/chengdu-ui.test.js`直接编译真实组件，12项覆盖：重复牌三张选择、非同色拒绝、轮询保留与换手清除选择、提交后锁定、定缺白名单、缺门出牌、反应窗口、同步阻断、观众/补位无私有手牌、已胡退出/隐藏牌、流局账目、公开日志及座位方向。`ui.test.js`另覆盖正式开局空options及schema2不落入花麻将v2。它们是SSR/响应式交互测试，不是真实浏览器布局或声音验收。
The dedicated real-SFC suite covers exchange multisets, selection lifecycle, preparation/turn allowlists, blocked input, read-only privacy, retirement, settlement, event masking and seat direction. App tests cover empty-options production starts and mode/version separation. These are SSR/reactive interaction tests, not browser-layout/listening acceptance.

`tests/chengdu-production.test.js` 是正式schema 2专项：拒绝原型/混合标记/缺快照，固定逆时针和启用局换牌轮回，单胡/自摸退出与多响炮家接摸，准备隐私、暗杠公开、自摸终局公开、归档重复过滤、四种模式整局JSON恢复。不访问真实房间；后端CAS和浏览器另测。
Production tests cover draft/mixed/incomplete-save rejection, fixed direction/exchange cycle, winner retirement/continuation, preparation privacy, public established kongs, finished self-draw disclosure, archive idempotence and four-mode full-game JSON recovery. No real rooms are used; backend CAS/browser coverage is separate.

正式整合新增真实App→API→MemoryStore换三张/定缺/首次出牌回归，捕获并修复动作版本证明不应依赖Flower播放字段的问题。`chengdu-api.test.js`补齐无媒体字段证明、缺字段、错误/过期版本与重复请求无写入；历史文案测试证明旧局名字与隐藏牌保持不变。 / Integration now exercises actual App/API/MemoryStore preparation and first discard, guarding mode-owned action proofs independent of Flower media, rejected-proof no-write semantics and private-safe historical prose.

## 立绘反应 / Portrait reactions

`tests/character-portraits.test.js`验证公开事件映射、三/四座、三响、隐藏牌零读取、独立定时器/过期回调、素材兜底、预热与用户PNG哈希。`tests/ui.test.js`实际编译App验证local队列时机、重复/旧快照、重连/后台/换局/换桌清理、成都玩家/观众、自摸隐私、三响及明确略过。见 [立绘指南](CHARACTER-PORTRAIT-REACTIONS.md)。
The new unit suite covers public mapping, seat bounds, triple wins, no concealed-tile reads, independent/stale timers, fallbacks, preloads and supplied PNG hashes. Compiled-App tests cover FIFO timing, deduplication, restore/cancellation, Chengdu players/spectators, self-draw privacy, triple wins and skip.

`tests/browser/portrait-preview-server.mjs` 使用共享MemoryStore提供三个隔离本机端口5380–5382；`portrait-preview-narrow.html` 将真实App置于390px iframe。运行与当前结果见 [落座身份与立绘验收](CHARACTER-SEATING-VALIDATION.md)，原 [场景验收](CHARACTER-SCENE-VALIDATION.md) 保留为历史记录。测试结束须停止自建进程；不用于生产桌或真人记录。
The portrait preview server supplies three local origins backed only by MemoryStore; its narrow page hosts the actual App in a 390px iframe. See the current seating/portrait validation (the older scene report is historical) and stop these test processes afterward; never use production rooms/records.

`tests/portrait-layout.test.js` 遍历真实Vue模板AST验证花麻将/成都手牌位于同一桌面、独立主角位于手牌之后与私有守卫；不复制界面、不运行生产请求。
The portrait-layout suite inspects the real Vue template AST for both modes' shared-table ancestry, a separate portrait after the hand and private guards, without duplicating UI or making production requests.

- [落座身份与立绘验收](CHARACTER-SEATING-VALIDATION.md) 记录联合验证；角色矩阵覆盖花麻将3/4席和成都4席，直接调用真实 API、真实文件存储与合法引擎动作，不访问生产牌局。 / The joint validation records Flower three/four-seat and Chengdu four-seat role coverage using real APIs, file storage and legal engine actions, never production games.


## 历史Live2D离线回归 / Historical offline Live2D regression

- `tests/live2d-consent.test.js`：严格版本、默认静态、明确选择、读写失败、副页撤销，以及直接 SDK 入口与启动中撤销门禁。这些是历史模块单测，不是当前组件或GPU验收。 / Strict versions, default static, explicit choice, failed storage, sibling withdrawal and direct/mid-startup loader gates remain historical module tests, not current components or GPU rendering.

- `tests/live2d-controller.test.js`：公开展示状态、代次、暂停/恢复、失败回退和销毁。 / Public presentation state, generations, pause/resume, fallback and disposal.
- 原 `tests/live2d-component.test.js` 已迁移为 `tests/portrait-motion-component.test.js`，检验当前真实Vue组件而非已退役模型组件。 / The old component suite migrated to the portrait-motion component suite, exercising the current Vue component rather than retired model UI.
- `tests/live2d-renderer.test.js`：明确的DOM/Framework/GL替身验证URL、相位、真实首帧门槛的分支和资源所有权；不是GPU证据。 / Explicit doubles cover URLs, phase, first-frame gate branches and ownership, not GPU evidence.
- `tests/live2d-core.test.js` 与 `tests/helpers/live2d-core-audit.js`：原字节官方Core6.0.1、各角色真实moc3、逐参数几何/透明度绑定、完整192帧及资产/离线报告哈希一致性。 / Actual official Core/moc3, geometry/opacity bindings, complete idle and matching asset/offline-evidence hashes.
- `tests/live2d-sdk.test.js`：内存转译原字节官方R5注册算法，确认三个保留尾空位和可达程序失败分支；GL编译句柄仍是替身。 / Transpiled unchanged R5 registration, reserved trailing slots and reachable-program failures; compilation handles remain mocked.

运行 `node --test tests/live2d-core.test.js tests/live2d-sdk.test.js` 单独验证真实Core和固定SDK兼容，再运行 `npm test`、`npm run lint`、`npm run build`。只有available角色参与真实模型测试，当前七人各有独立moc3及当前驱动的完整离线放行。这些历史结果不能代替当前Canvas2D真实像素/多画框/移动端验收，也不会新增GPU批准门槛。源码与证据路径见 [Live2D指南](LIVE2D-RUNTIME.md)。
Run the focused Core/SDK command and then the standard aggregate checks. Only available roles participate in real-model tests; all seven currently have distinct moc3s and complete current-driver offline approval. These historical results do not replace current Canvas2D pixel/multi-frame/mobile acceptance or introduce a new GPU approval gate.
