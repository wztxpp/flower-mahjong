# 测试阅读指南 / Test reading guide

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
- `tests/character-assignment.test.js`：偏好组合、精确枚举随机分支、唯一分配与重启稳定性。 / Preference combinations, exact RNG-branch enumeration, unique assignment and restart stability.

`revision` 是房间状态版本，不是时间戳。两个请求携带同一旧版本时最多一个可以提交；另一个冲突后要读取新状态。SQLite 替身能检验这里使用的 SQL 和存储契约，但不模拟 Cloudflare 的全部运行环境或真实多地域延迟。
A room revision is not a timestamp. At most one competing write with the same old revision commits; a conflict requires a new read. SQLite checks the SQL/storage contract used here, not all Cloudflare runtime or cross-region behavior.

### 3. 前端、声音与素材 / Frontend, audio and assets

- `tests/ui.test.js`：编译真实 SFC，SSR HTML 和模拟浏览器中的请求/导航/状态。 / Real SFC compilation, SSR HTML and simulated browser request/navigation/state handling.
- `tests/invitation-copy.test.js`：内存 Vue renderer 执行真实复制按钮，覆盖 Clipboard API、旧复制方式和手动复制反馈。 / An in-memory Vue renderer exercises actual copy controls and clipboard/manual fallback feedback.
- `tests/character-audio.test.js`：不真正播放音频，验证播报身份、队列、中断、超时、去重与静音。 / Silent substitutes verify event identity, queues, interruption, expiry, deduplication and mute.
- `tests/mahjong-photo-faces.test.js`：牌面图集映射、原图字节以及组件源码约定。 / Tile atlas mapping, original image bytes and component source contracts.
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
