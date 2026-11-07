# 前端阅读指南 / Frontend reading guide

这份指南面向刚接触前端的读者。先理解数据从哪里来、谁有权修改，再看模板与 CSS。代码中的注释采用中文在前、英文在后的顺序；公开字段、存储键、资源路径和规则保持兼容。

This guide is for readers new to frontend development. First understand where data comes from and who can change it, then read templates and CSS. Source comments put Chinese before English; public fields, storage keys, resource paths and rules remain compatible.

## 1. 按什么顺序读 / Suggested reading order

1. `src/main.js`：浏览器入口，导入根组件和两层样式，挂载到 `index.html` 的 `#app`。
   `src/main.js`: browser entry, root component, two style layers, and mounting to `#app` in `index.html`.
2. `src/MahjongTile.vue`、`src/Icon.vue`：小组件，先认识 props、computed、模板绑定和 SVG。
   `src/MahjongTile.vue` and `src/Icon.vue`: small components introducing props, computed values, template bindings and SVG.
3. `src/App.vue` 顶部：区分服务端快照、表单状态、派生值与非响应式控制对象。
   The top of `src/App.vue`: distinguish server snapshots, form state, derived values and non-reactive control objects.
4. `enterRoom → api → applyState`，再读 `mutate` 与 `refresh`：了解联网动作和更新链路。
   Follow `enterRoom → api → applyState`, then `mutate` and `refresh`, to understand requests and updates.
5. `resetRoomContext`、`routeFromLocation`、离席相关函数：理解取消、重连和竞态保护。
   Read `resetRoomContext`, `routeFromLocation` and departure helpers to understand cancellation, recovery and race protection.
6. `src/character-audio.js`：历史游标和独立音频队列。
   `src/character-audio.js`: the history cursor and independent audio queue.
7. `App.vue` 的 `<template>`、`src/style.css`、`src/tabletop.css`：最后对应页面布局和外观。
   Finish with the `<template>` in `App.vue`, `src/style.css` and `src/tabletop.css` to connect behavior to layout and appearance.

## 2. 一次点击如何到达页面 / From a click to the screen

选牌时，`@click="selectHand(...)"` 只更新 `selectedTile` 和显示下标。此时没有向服务端出牌。点击“打出”才调用 `mutate`，携带动作和当前 `revision`。服务端校验、修改牌局并返回本人可见快照，`applyState` 接纳后，Vue 才依据新状态更新页面。

Selecting a tile calls `selectHand` and changes only `selectedTile` and its display index. It does not discard on the server. The discard button calls `mutate` with an action and the current `revision`. The server validates and updates the game, returns a viewer-filtered snapshot, and Vue updates the page after `applyState` accepts it.

其他客户端通过 `refresh` 轮询取得新版本。版本没变时返回的 `unchanged` 不是完整状态，只更新需要变化的在线标记。前端不会自己发牌、判胡、补积分或推算对手手牌。

Other clients receive the revision through `refresh` polling. An `unchanged` response is not a full snapshot; it updates connection flags as needed. The frontend does not deal tiles, judge wins, invent scoring or infer opponent hands.

## 3. Vue 最重要的几个概念 / Essential Vue concepts

- **`ref`：可变状态。** 脚本读写 `name.value`；模板中写 `name`，Vue 自动解包。改变它会让依赖它的界面重新渲染。
  **`ref`: mutable state.** Use `name.value` in script and `name` in templates, where Vue unwraps it. Changes update dependent rendering.
- **`computed`：派生值。** 例如 `game` 从 `state` 取出，`hand` 从本人的手牌复制、排序并分隔摸牌。它会缓存结果，不应承担网络请求或游戏规则修改。
  **`computed`: derived values.** For example, `game` comes from `state`, while `hand` copies, sorts and separates the drawn tile. Results are cached; computed values should not perform requests or mutate rules.
- **`watch`：变化引起的副作用。** 弹窗开启后锁定背景滚动、调整焦点，关闭后恢复。这和“算出一个值”的 computed 不同。
  **`watch`: side effects caused by changes.** Opening a dialog locks background scrolling and moves focus; closing restores them. This differs from computing a value.
- **`nextTick`：等待 DOM 更新。** 改 ref 并不保证下一行就能测到新元素。飞牌动画与弹窗聚焦先等待 Vue 更新 DOM。
  **`nextTick`: wait for DOM updates.** Changing a ref does not guarantee the next line can measure new elements. Flights and dialog focus wait for Vue to update the DOM.
- **`onMounted` / `onUnmounted`：生命周期。** 挂载后注册键盘、在线、历史导航和可见性事件；卸载时成对移除，并取消计时器、请求及音频。
  **`onMounted` / `onUnmounted`: lifecycle.** Register keyboard, online, navigation and visibility listeners after mount; remove them and clean up timers, requests and audio on unmount.
- **`defineProps`：组件输入。** `MahjongTile` 接收牌种、背面、大小、选中与禁用状态，只负责显示；它不是第二个麻将引擎。
  **`defineProps`: component inputs.** `MahjongTile` accepts tile type, back, size, selection and disabled state. It displays them; it is not another Mahjong engine.

## 4. 模板语法速查 / Template syntax reference

- `{{ value }}` 插入转义文本，不把字符串当 HTML 执行。
  `{{ value }}` inserts escaped text rather than executing a string as HTML.
- `:disabled="busy"` 是动态属性绑定；不带冒号的值通常是字面字符串。`small` 是布尔 prop 简写。
  `:disabled="busy"` dynamically binds an attribute; an unprefixed value is usually literal text. `small` is shorthand for a boolean prop.
- `:class="{ selected: condition }"` 按条件开关 CSS 类；不会改变服务端状态。
  `:class="{ selected: condition }"` toggles CSS classes without changing server state.
- `@click="handler"` 绑定事件；`@submit.prevent` 阻止原生表单整页提交；`@click.self` 只响应元素本身，不响应子元素冒泡而来的点击。
  `@click="handler"` binds an event; `@submit.prevent` prevents native page submission; `@click.self` ignores clicks originating from child elements.
- `v-model` 把输入框或复选框与本地状态双向绑定；不会自动发送 API。
  `v-model` binds an input or checkbox to local state in both directions; it does not automatically call an API.
- `v-if / v-else-if / v-else` 选择分支。`v-else` 需要紧随对应条件分支，不能插入无关元素。
  `v-if / v-else-if / v-else` choose branches. `v-else` must follow its conditional branch without unrelated intervening elements.
- `v-for` 渲染列表，`:key` 告诉 Vue 哪一项还是原来的那一项。座位用绝对座位 key；累计账目用参与者 ID；相同牌种的重复牌还需下标区分。
  `v-for` renders a list; `:key` tells Vue which item retains its identity. Seats use absolute seat keys, cumulative records use participant IDs, and duplicate tile types also need indices.
- `v-memo` 缓存子树，依赖数组中的值变化才重渲染。牌河依赖必须包含认领、最新弃牌和胡牌高亮状态，不能漏掉。
  `v-memo` caches a subtree until its dependency values change. Discard dependencies must include claims, latest-discard status and win highlights.
- `ref="modalRef"` 获取实际 DOM 元素，而不是游戏数据；`aria-*` 提供读屏语义；`data-*` 提供查找动画源和目标的定位信息。
  `ref="modalRef"` accesses a DOM element, not game data. `aria-*` supplies accessibility semantics; `data-*` locates animation sources and targets.

## 5. 哪些状态归谁管 / State ownership

**服务端权威数据**：`state`、`state.game`、`legalActions`、分数、手牌、历史、当前座位与规则版本。`session` 是访问本桌的凭证，不是房间号本身。不要在前端直接修改分数来“让页面先动起来”。

**Server-authoritative data:** `state`, `state.game`, `legalActions`, scores, hands, history, turn seat and rule version. `session` holds room access credentials, not just a room code. Do not edit client scores merely to make the interface respond optimistically.

schema 3 已胡且可胡时，服务端只给胡按钮；`mustHu` 由该白名单派生明确提示，不在前端重复判胡或自动点击。接炮、抢杠与自摸均使用此显示。详见 [胡后必胡纠错](POST-HU-WIN-CORRECTION.md)。
For an available schema-three post-hu win, the server supplies hu alone. mustHu derives accurate wording from that allowlist without judging wins or clicking automatically, across discard, rob-kong and self-draw states. See [mandatory-win correction](POST-HU-WIN-CORRECTION.md).

**纯展示数据**：选牌下标、弹窗、提示、复制反馈、胡牌字幕和飞牌。`winningEvents` 与 `winningFlights` 不持有新的实体牌；local 客户端等待本页音画结束再开放本机最新操作；只有旧屏障路径向服务端确认媒体完成。已经成立动作的即时积分不依赖播放再次结算。

**Presentation-only data:** selection indices, dialogs, notices, copy feedback, win captions and flights. `winningEvents` and `winningFlights` do not create physical tiles. Local clients wait for page media before enabling their latest controls; only legacy gates acknowledge server media completion; committed immediate scores are never settled again by playback.

**非响应式控制数据**：计时器句柄、`AbortController`、`epoch`、Promise 与 Map/Set。它们用于控制生命周期，不直接显示，因此不必全改成 ref。

**Non-reactive control data:** timer handles, `AbortController`, `epoch`, promises and maps/sets. They control lifecycle rather than rendering, so they do not all need refs.

## 6. 座位、身份与牌种 / Seats, identities and tiles

服务端座位为 `0 / 1 / 2`。`mySeat` 是本人绝对座位；`opponents` 用取模从本人视角排列对手。角色仍按绝对座位和服务端角色分配选择，所以不同观察者看到同一个人的角色一致。房主控制开局，庄家决定本局开局位置，两者不是同一个概念。

Server seats are `0 / 1 / 2`. `mySeat` is the viewer’s absolute seat; `opponents` uses modulo for viewer-relative arrangement. Characters still follow absolute seats and server assignments, so all viewers agree. The host controls starting; the dealer determines the opening position. They are different roles.

牌河 `riverPlayers` 复用 `opponents[0]`（左）、`me`（中）、`opponents[1]`（右），三位观察者分别看到 `[1,0,2]`、`[2,1,0]`、`[0,2,1]`。桌面与窄屏沿用同一三列网格，不改变绝对座位 key、弃牌归属或记录顺序。`tests/ui.test.js` 覆盖三种视角、三个规则版本及终局。

River columns reuse `opponents[0]` (left), `me` (center), and `opponents[1]` (right). Viewers zero, one and two see `[1,0,2]`, `[2,1,0]`, and `[0,2,1]`. Desktop and narrow layouts retain the same three-column grid without changing absolute keys, discard ownership or record order. The UI suite covers all viewpoints, all engine versions and finished games.

`seats` 合并房间占座信息与本局参与者信息；终局 `scoreSeats` 优先本局参与者名单。本桌总积分使用参与者 ID，不能按昵称或座位号把新玩家与离桌玩家合并。

`seats` merges occupancy with current-game participant data; after finishing, `scoreSeats` prefers the game’s participant list. Table totals use participant IDs, not nickname or seat-number merging between new and departed players.

牌种 `0–8` 是一至九条，`9–17` 是一至九筒。`null` 用于隐藏牌或空白，不等于牌种零。对手手牌只有张数，前端画背面占位；共胡虚拟牌是记录副本，不是新增实体牌。

Tile types `0–8` are one through nine bamboo, and `9–17` are one through nine dots. `null` means hidden or blank, not tile zero. Opponent hands expose counts and render backs; shared-win virtual copies are records, not additional physical tiles.

## 7. epoch、取消与“不知道是否成功” / Epochs, cancellation and uncertain outcomes

`epoch` 是本页当前房间任务的代数。一个请求出发时记住 `currentEpoch`；用户切桌或开始新的操作后代数改变，旧响应即使回来也不能更新新页面。`AbortController` 尽力中断网络，而 epoch 负责逻辑上拒绝迟到结果，两者不能互相替代。

`epoch` identifies the current room task generation. A request captures `currentEpoch`; navigation or a new mutation advances it, so a late response cannot update the new page. `AbortController` attempts transport cancellation, while epoch rejects stale results logically. Neither replaces the other.

`applyState` 还检查房间 ID 和 `revision`，拒绝别桌快照与倒退版本。`historyGeneration` 独立保护个人记录；`presentationGeneration` 保护动画回调；`voiceVisibilityEpoch` 保护可见性切换前后的语音。它们关注不同问题，不应合并成一个“万能版本号”。

`applyState` also checks room ID and `revision`, rejecting other rooms and older revisions. `historyGeneration` protects personal history, `presentationGeneration` protects animation callbacks, and `voiceVisibilityEpoch` protects audio across visibility changes. They solve different problems and should not be collapsed into one universal version.

HTTP 409 表示冲突，具体原因看错误 code：可能是修订号过旧，也可能是满员、已开局或其它业务冲突。没有 HTTP 状态的网络失败更微妙：服务端可能已经执行，只是返回包丢了。`mutate` 会进入待同步状态，读取新快照，而不是重发同一个动作。取消请求也不保证服务端没有提交。

HTTP 409 indicates a conflict; inspect the error code to distinguish stale revision from a full room, active game, or another business conflict. A transport failure without an HTTP status is subtler: the server may have committed while the response was lost. `mutate` waits for synchronization instead of replaying the action. Cancelling a request likewise does not prove the server did not commit it.

`queueLeave` 先保存离席意图，再去通知；同一房间共用在途 Promise。`scope: 'leave'` 不随切桌取消，失败意图保存在本标签页，刷新后继续确认。主页没有 `room` 参数时永远大厅，有明确链接且有该房间凭证才自动重连。详见 [房间生命周期](ROOM-LIFECYCLE.md)。

`queueLeave` persists departure intent before notifying and shares one in-flight promise per room. `scope: 'leave'` survives navigation cancellation; failed intent remains in this tab for recovery after refresh. The root without `room` always opens the lobby; auto-resume requires an explicit room link and matching credentials. See [Room lifecycle](ROOM-LIFECYCLE.md).

## 8. 音频为何不直接写在按钮事件里 / Why audio is not attached directly to actions

点击“胡”只表示申请，不能证明最终已胡。`ActionVoiceCursor` 读取服务端已提交历史，以房间 ID、局 ID、历史长度和版本建立游标。第一次进入、刷新、换局或静默同步只建立基线，不把旧历史补播出来。

Clicking a win button is a request, not proof that a win committed. `ActionVoiceCursor` reads committed history, tracking room ID, game ID, history length and revision. Initial entry, refresh, new games and silent synchronization establish baselines without replaying old events.

`CharacterAudio` 负责声音机制：用户手势解锁、Promise 缓存、下载取消、串行播放、静音和销毁。旧 enqueueLive 现场入口优先胡牌、只保留最新普通公开动作；当前 local 使用 enqueueOrdered 保留全部顺序事件。加载完成后再次检查取消代数和时效，避免离桌后突然发声。音频失败不会更改牌局。

`CharacterAudio` handles audio mechanics: gesture unlocking, promise caching, download cancellation, serial playback, muting and disposal. Legacy enqueueLive prioritizes wins and keeps only the latest ordinary public action; current local mode uses enqueueOrdered to retain every ordered event. After loading, it rechecks generation and freshness to avoid speech after departure. Audio failures do not change the game.

## 9. CSS 层叠与牌面绘制 / CSS cascade and tile rendering

`main.js` 先导入 `style.css`，再导入 `tabletop.css`。前者定义基础布局、响应式、状态样式；后者提供实体牌桌皮肤及进一步断点覆盖。不能按类名排序、去掉重复规则或交换文件顺序来“整理”，否则可能改变最终外观。

`main.js` imports `style.css` before `tabletop.css`. The former supplies base layout, responsiveness and state styling; the latter supplies the physical-table skin and additional breakpoint overrides. Do not sort by selector, remove repeated rules or swap imports as a cleanup: those changes may alter appearance.

一般情况下先看 `!important`、再看选择器优先级、最后看同等优先级的源码顺序。`.in-game .hand-panel` 比 `.hand-panel` 更具体。多个 `max-width` 媒体查询可能同时生效；后面的窄屏规则不是另一套独立页面。组件的 `<style scoped>` 会由 Vue 加作用域标记，不是所有全局 CSS 都被隔离。

In the ordinary rules used here, check `!important`, selector specificity, then source order for equal specificity. `.in-game .hand-panel` is more specific than `.hand-panel`. Several `max-width` queries may match simultaneously; later narrow-screen rules are not a separate page. Vue adds scope markers for `<style scoped>`; this does not isolate all global CSS.

`MahjongTile` 根据 `interactive` 选择原生 button 或 span；牌面来自用户 2026-11-07 提供的原始 PNG。`PHOTO_FACE_CROPS` 记录十八种牌的原图矩形，`photoFaceTransform` 等比缩放并平移到 60 × 80 的 SVG 视窗，排除图外文字标签。矩形、中心、尺寸与底色都是显示数据，不是麻将规则；牌种编号和隐藏牌分支不变。见 [牌面设计](TILE-DESIGN.md)。

`MahjongTile` chooses a native button or span from `interactive`. Faces use the user's original 2026-11-07 PNG. `PHOTO_FACE_CROPS` stores eighteen source rectangles; `photoFaceTransform` scales uniformly and translates each into a 60 × 80 SVG viewport without surrounding text labels. Rectangles, centers, dimensions and underlay colors are presentation data; tile IDs and concealed rendering remain unchanged. See [tile design](TILE-DESIGN.md).

## 10. 安全修改与自测 / Safe edits and checks

- 改文字先找到模板或格式化函数；改颜色先查最终命中的皮肤和断点；改规则请去服务端，不在按钮条件里另造规则。
  For wording, find the template or formatter; for colors, inspect the winning skin and breakpoint rules; change rules on the server, not by inventing new button conditions.
- 可以改善局部变量名称，但保留 API 字段、组件 props、导出名、CSS 类、存储键和事件字段。字段名看起来不够漂亮也可能是兼容契约。
  Improve local identifiers while preserving API fields, component props, exports, CSS classes, storage keys and event fields. An awkward field name may still be a compatibility contract.
- 对数组排序或倒序前复制；不要让展示逻辑就地修改服务端快照。不要把 `??` 随便改成 `||`：零号座位和零号牌种都是合法值。
  Copy before sorting or reversing; do not let rendering mutate server snapshots. Do not casually replace `??` with `||`: seat zero and tile zero are valid values.
- 自测包括：主页进入大厅、邀请重连、连续点按钮、请求中换桌、前进后退、断网重连、切后台回来、静音、弹窗 Escape/Tab、窄屏和减少动态效果。
  Test lobby entry, invitation resume, repeated clicks, navigation during requests, Back/Forward, reconnects, visibility changes, mute, dialog Escape/Tab, narrow screens and reduced motion.
- 运行 `npm test` 与 `npm run build`。有些测试读取源码并做正则匹配；仅格式化可能导致断言失败，必须区分测试写法脆弱与真实行为变化，不能为了过测试删除安全保护。
  Run `npm test` and `npm run build`. Some tests match source text with regular expressions, so formatting can break brittle assertions. Distinguish that from behavior changes and never remove safety guards merely to pass a test.

命名提示：`snapshot` 表示一次完整状态快照；`revision` 是服务端版本；`epoch/generation` 是客户端失效代数；`credential` 是访问凭证；`seat` 是绝对座位；`tileIndex` 是列表位置，不是牌种；`meld` 是碰杠副露；`claim` 是待回应接牌阶段。

Naming glossary: `snapshot` is one complete state view; `revision` is a server version; `epoch/generation` invalidates client work; `credential` grants access; `seat` is absolute; `tileIndex` is a list position, not tile type; `meld` is a pung/kong group; `claim` is a response phase.


## 11. 喜钱配置与碰后补杠 / Ready-bonus configuration and pung upgrades

`shared/start-options.js` 提供默认值 50、允许上限和整数校验，浏览器与服务端共用。`bigSingleReadyPoints` 是房主下一局的可编辑草稿；`gameBigSingleReadyPoints` 是本局已保存规则。0 是合法的“不收取”，因此读取旧字段时使用 `??`，不能用 `||` 把零替换成默认 50。

`shared/start-options.js` supplies the default of 50, the maximum and integer validation shared by browser and server. `bigSingleReadyPoints` is the host’s editable next-round draft; `gameBigSingleReadyPoints` is the saved active-game rule. Zero validly disables payment, so legacy field fallback uses `??`, not `||`, which would replace zero with 50.

`v-model.number` 只尝试数值转换，不保证输入必为合法整数。`validReadyPoints` 控制提示与开局按钮；`mutate` 再检查一次并把草稿复制到请求。服务端独立校验。`applyState` 只在首次拿到牌局或换局时从保存规则初始化草稿，普通终局轮询不会抹掉房主正在编辑的下一局数值。换桌恢复默认值。

`v-model.number` attempts numeric conversion but does not guarantee a valid integer. `validReadyPoints` controls errors and start buttons; `mutate` rechecks and copies the draft into the request. The server validates independently. `applyState` initializes the draft from saved rules only on first game load or a new game; ordinary finished-game polling does not erase next-round edits. Changing tables resets the default.

规则与历史显示区分“未启用，不补收”、主动设为 0 与实际每家付款金额。`bigSingleReady` 历史事件标注“听牌喜钱”，不冒充即时杠分。这里的文字解释服务端结算，不在模板里计算或收取分数。

Rules and history distinguish unavailable payments, explicit zero and the actual per-payer amount. `bigSingleReady` events are labeled as ready bonuses rather than immediate kong payments. These labels explain server settlement; templates neither calculate nor collect points.

`pungUpgradeAfterDiscard` 表示碰后必须真实打出一张，之后符合其他合法条件时可以补杠，不是永久禁补，也不要求同牌恰好刚摸到。暗杠补摸不能代替这次出牌。前端依据保存规则解释时机，实际按钮仍只读取服务端 `legalActions`；抢杠字幕用通用“杠牌”，避免错误猜测补杠或加杠来源。

`pungUpgradeAfterDiscard` means an actual discard must follow the pung before later upgrading under other legality conditions. It is not a permanent ban and does not require a freshly drawn matching tile. A concealed-kong replacement draw cannot substitute for that discard. The frontend explains saved timing rules while buttons still follow server `legalActions`; rob-kong captions use the generic kong label rather than guessing the upgrade source.

## 12. 本地保序与服务端节拍 / Local ordering and server cadence

当前默认 local 模式把 receivedState 与页面 state 分开，所有新公开事件进本机 FIFO；音频及原动画都完成后才开放本机最新按钮，慢设备不会锁全桌。`src/shared-playback.js` 使用 Web Locks、完整公开前缀和逐事件结果记录协调同源同浏览器同座声音。普通409仅同步，不冒充断网。详见 [音画节奏](PRESENTATION-PACING.md)。
Local mode separates received authority from displayed state and queues all new public events. Local controls wait for real media, but slow devices do not block the table. SharedPlaybackCoordinator uses Web Locks, complete public prefixes and per-event outcome records to coordinate same-origin sibling audio. Ordinary 409s synchronize without claiming a disconnect. See the pacing guide.

### 旧屏障兼容 / Legacy barrier compatibility

详见 [音画节奏](PRESENTATION-PACING.md)。`syncTurnPresentation` 按 ID 去重，`beginPresentation` 先原子认领同座位播放权，`playTurnPresentation` 等待字幕、动画 finished 和语音完成，`acknowledgePresentation` 只确认当前局当前屏障。服务端所需座位全部完成以前，按钮和回合高亮保持关闭。
See [presentation pacing](PRESENTATION-PACING.md). These helpers deduplicate gate IDs, claim same-seat playback ownership, await media completion, and acknowledge only the current gate/game. Actions and turn highlights remain disabled until the required seats finish.

后台或重连空基线不发送 begin；各页面通过请求头独立上报前台/音频/事件准备状态，按服务端 preferredClients 认领，取消旧的固定让位延时。认领在途失去可见性时，releasePresentation 归还归属，不发送空媒体完成。只有后台的未开始座位不拖住全桌；未知页面使用 1.5 秒短发现。四十秒仅保护已开始但失联的媒体。
Hidden/baseline-only pages never begin. Independent presence headers and server preferredClients replace fixed client-side yielding. Hiding during acquisition releases ownership without false completion. Known background-only seats do not hold unstarted playback; unknown pages get 1.5-second discovery. Forty seconds remains only for owned media that disconnects.


### 读懂共享声音结果 / Reading shared audio outcomes

沿 `applyState → registerSnapshot → queueLocalPresentation → playThrough → enqueueOrdered` 阅读：每次快照（含空事件基线）登记完整公开前缀，批次保存接收时 `audioEligible`。先取得共享锁，再从共享 floor 处理到该批末端；不能只比较最大已播下标，也不能取得锁就记已播。enqueueOrdered 返回逐 eventKey 的 success/failed/cancelled/skipped，仅 success 写成功终态。失败头部有1200毫秒同座健康页接力窗口，超时转明确失败终态后才让后续前进，避免迟到倒序。已有页面实际静音/锁定期间新后缀不因解锁复活；全新页首次 locked 基线不是新入队，不永久拒绝旧前缀，ticket 仍静默，解锁后下一新现场事件才可代副页补齐。缺锁/存储时降级页内串行并调用 onDegraded，可能跨页重复；不承诺每条声音可用或跨页恰好一次。
Follow applyState → registerSnapshot → queueLocalPresentation → playThrough → enqueueOrdered. Every snapshot, including empty baselines, registers its complete public prefix; batches retain receipt-time audioEligible. Under the lock, process from the shared floor through the batch end, never using only a maximum index or marking success on lock acquisition. Ordered audio reports exact-key success/failed/cancelled/skipped outcomes, and only success records terminal success. A failed head allows 1200ms eligible-sibling recovery before explicit terminal failure releases later speech without late inversion. Established-page muted/locked suffixes never revive on unlock. A new page’s initial locked baseline is not newly queued input and does not permanently deny the prefix; its ticket stays silent, and only a later unlocked live event may recover a sibling’s prefix. Missing locks/storage invoke onDegraded and fall back to page-local ordering with possible sibling duplication, not guaranteed available speech or exactly-once.

local 前台长短网络缺口均保留队列和游标；`pendingPresentationCount` 合计本地当前/待播段及 onPendingPrefix 的本批外未终态有声共享前缀（不重复计本批），总数达到8才显示“略过并看最新牌面”，玩家点击 `skipLocalPlayback` 后取消本页媒体并登记已知历史为略过。不能按五秒阈值自动丢队列。隐藏、离桌和换局仍走取消/静默基线，旧屏障继续保留其独立重连语义。详见 [音画节奏](PRESENTATION-PACING.md)，最终测试结果见独立验收记录。
Local foreground gaps of any length preserve queues/cursors. pendingPresentationCount combines active/queued local segments with onPendingPrefix’s nonterminal voiced recovery outside the current batch, avoiding current-batch double counting. At eight, explicit skip invokes skipLocalPlayback to cancel page media and mark known history skipped. There is no automatic five-second queue drop. Hide, leave and game changes still cancel/baseline; legacy barriers retain separate reconnect semantics. See the pacing protocol and separate final validation record.

新局对手自摸胡牌用 `tile: null, hidden: true` 表示。App 胡牌区、字幕、悬停和读屏保持隐藏，同时仍播放自摸声音与高亮；终局重新拿到牌面。见 [展示隐私](TILE-VISIBILITY.md)。 / Opponent self-draw wins use tile null/hidden true. App hides faces/captions/tooltips/accessibility text while retaining audio and highlights; finish reveals the tiles.
