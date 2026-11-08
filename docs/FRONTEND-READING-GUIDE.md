# 前端阅读指南 / Frontend reading guide

全局 `PortraitMotionSettings` 提供普通本地显示开关，`portrait-motion/settings.js` 默认静态且不迁移旧SDK许可。`CharacterArtwork` 在两玩法/独立挂载始终显示原img，仅用透明Canvas2D叠审查过的眼睑和发区。见 [原图局部动效](PORTRAIT-MOTION.md)。
Global ordinary settings default static without migrating old SDK assent. Both modes/standalone frames always retain the original img, overlaying only reviewed eyelids and hair regions through Canvas2D.

原 `CharacterPortraitReactions` 仍管理公开胡/放炮约三秒原图，期间暂停并清除局部覆盖；不改变身份、声音或游戏动作。
The existing public win/discard-loss scheduler keeps original three-second reactions and clears overlays without changing identities, sounds or actions.

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

`shared/start-options.js` 提供默认值 50、允许上限和整数校验，浏览器与服务端共用。`bigSingleReadyPoints` 是建房草稿，也供缺创建快照的旧房配置下一局；`gameBigSingleReadyPoints` 是本局已保存规则。0 是合法的“不收取”，因此读取旧字段时使用 `??`，不能用 `||` 把零替换成默认 50。

`shared/start-options.js` supplies the default of 50, the maximum and integer validation shared by browser and server. `bigSingleReadyPoints` is the creation draft and the next-round draft for legacy rooms missing that creation field; `gameBigSingleReadyPoints` is the saved active-game rule. Zero validly disables payment, so legacy field fallback uses `??`, not `||`, which would replace zero with 50.

`v-model.number` 只尝试数值转换，不保证输入必为合法整数。`validReadyPoints` 控制建房提示与提交按钮；`validStartOptions` 仅在旧房金额未固定时检查此草稿，`mutate` 再检查并仅复制未固定字段。服务端独立校验。`applyState` 只在首次拿到牌局或换局时从保存规则初始化草稿，普通终局轮询不会抹掉旧房下一局编辑。换桌恢复默认值；正在提交的新桌草稿在清理会话后保留。

`v-model.number` attempts numeric conversion but does not guarantee a valid integer. `validReadyPoints` controls creation errors and submission; `validStartOptions` checks the draft only for unfixed legacy amounts, and `mutate` copies only missing creation fields. The server validates independently. `applyState` initializes drafts on first game load or a new game; ordinary finished-game polling preserves legacy next-round edits. Changing tables resets defaults, while an in-flight creation retains its submitted draft after session cleanup.

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

## 七角色显示 / Seven-character display

角色选择器从七人列表生成，桌面人数来自本桌三/四人快照。音频与立绘都用服务端绝对座位映射，不用角色列表下标推断玩家数。完整路径、旧局兜底和验证见 [七角色与三/四座位](SEVEN-CHARACTERS.md)。
The selector renders seven characters while table size follows its three/four-player snapshot. Both voices and portraits use absolute server-seat assignments, never roster indexes as player counts. See [paths, legacy fallbacks and verification](SEVEN-CHARACTERS.md).

## 可变牌桌维护入口 / Variable-table maintenance

[可变人数与副数](VARIABLE-TABLES.md) 是3/4人、1–5副、神龙门槛及新计分快照的当前说明，替代本指南早期固定三人/144张/八张上限的默认描述。新增维护测试为 `tests/variable-table.test.js`、`tests/fixtures/variable-table.js` 和 `tests/variable-room-api.test.js`；UI专项并入原测试。旧局和schema1/2不改。
[Variable tables](VARIABLE-TABLES.md) documents snapshot-driven dimensions and scoring, superseding earlier fixed-three/144/eight-copy defaults here. The listed new maintained tests join existing UI coverage; old games and frozen engines remain unchanged.

## 观战扩展 / Spectating extension

观众通过独立只读凭证进入，不占座、不参与个人成绩或播放屏障。前端保留观战/玩家两类缓存，公开动态按各局快照显示名字，所有隐私和生命周期边界见 [观战与名字动态](SPECTATING-AND-NAMED-LOGS.md)。 / Spectators use independent read-only credentials without seats, profile records or presentation gates. Separate browser caches preserve player identities, and event names follow each game's snapshot. See the dedicated guide for privacy/lifecycle boundaries.

### 按快照显示首胡前选择 / Snapshot-aware pre-win rule text

`preHuActionChoice` 与 `concealedKongAfterPungDiscard` 两个computed只读取当前v3局的显式true，分别选择首胡前完整动作与碰后延迟暗杠说明；false/缺字段仍显示旧策略。大厅讲新局默认，schema1/2继续各自独立说明。它们不计算合法动作、不改规则。九种开关组合及冻结版本回归在 `tests/ui.test.js`。
The two computed values read explicit current-schema true flags independently. False/missing preserves old explanations; the lobby describes new defaults and frozen engines retain separate sections. No legal actions or rules are changed. The UI suite covers all nine combinations and old versions.

## 统一建房面板 / Unified room creation panel

`App.vue` 在建房表单一次配置人数、副数、神龙、胡后自动打出和大单吊喜钱，`enterRoom` 在清理旧会话及异步身份请求前复制完整快照。加入/观战不提交配置。所有数字输入都有帮助、错误关联；原生 select、数字框和 switch 保留键盘操作。`tabletop.css` 最后建房区统一米色/墨绿样式、48px控件和可见焦点；440px以下改为单列。
The creation form collects all five settings. enterRoom snapshots them before session reset and asynchronous identity setup; joins/spectators never send settings. Native controls retain keyboard support, linked help/errors and visible focus; the final tabletop.css section unifies styling and stacks below 440px.

房内的 `hasFixedAutoDiscard` / `hasFixedReadyPoints` 逐字段判断保存快照。新桌只读展示且 `start` 提交空 options；缺字段旧桌仍显示原开局草稿，仅提交未固定字段。`canStart` 是房主/阶段权限，`canConfigureStart` 另管旧桌编辑入口，不能把“不可编辑”误当成“不可开局”。`validStartOptions` 对已固定金额不检查无关本地草稿，确保刷新、加入及下一局不受旧输入影响。
Per-field presence selects read-only creation settings versus legacy editable drafts. canStart handles permission/phase, separately from canConfigureStart. Fixed amounts ignore stale local drafts; starts send only missing legacy choices.


## 万牌集成后的阅读路线 / Reading the wan integration

`MahjongTile.vue → mahjong-tile-presentation.js → mahjong-photo-faces.js / mahjong-wan-faces.js`：先严格校验编号，再按花色取对应原图、真实宽高与等比裁切。0–17原图和坐标不变，18–26独立万牌；背面分支不查询牌面且不输出图片、牌名或点数。读屏和title来自共享身份名称，不再把所有九条以上的牌都当筒。
Follow the component to the presentation catalog and its two atlases. Strict IDs select exact source dimensions and proportional crops; 0–17 retain their source/crops and 18–26 use wan. Back faces resolve no artwork and expose no identity. Accessibility and tooltip labels use shared identity names rather than treating every ID above eight as dots.

`character-audio.js` 对已提交弃牌取同一目录的voiceClip，再按原本绝对座位映射选择角色。七角色均支持wan-1至wan-9；没有复制播放器、变更事件游标或引入任何换牌/定缺播报。静态与真实浏览器范围分别列在 [集成验收](CHENGDU-INTEGRATION-VALIDATION.md)，不是成都可玩验收。
Audio reads the same voice key for committed discards and retains absolute-seat persona assignment. All seven personas support wan-1 through wan-9 without duplicating the player, changing cursors or voicing private preparation. See the validation report for separate automated/browser scope, not playable Chengdu acceptance.

## 成都准备房间 / Chengdu preparation rooms

`gameModeDraft` 只控制建房草稿；进入后 `isChengduRoom` 只读取服务器 `state.gameMode`。成都四项草稿与花麻将草稿隔离，异步前固定请求；成都 `canStart` 恒为false，不显示花麻将专属说明。新配置校验在 `shared/chengdu-room-settings.js`，完整范围见 [成都房间准备](CHENGDU-ROOM-PREPARATION.md)。
The mode draft controls creation only; room mode comes from the server. Independent drafts are captured before asynchronous requests; Chengdu cannot start or display Flower-only rules. The shared settings validator and dedicated guide describe the full boundary.

## 成都正式牌桌 / Chengdu production table

上述“成都准备房间”描述保留旧提交时点；正式版本改为服务端rulesVersion=2时允许开局。`App.vue → ChengduTable.vue`分别负责房间/网络与独立牌桌；模式判断先于版本。新组件按合法动作提供换三张、定缺、摸打、碰杠胡/过、退出及终局，不复用花麻将后胡/萝卜规则。详细责任、隐私和交互见 [成都牌桌界面](CHENGDU-PLAY-INTERFACE.md)。
The preparation section above is historical. Production starts require server rulesVersion2. App owns room/network concerns and the new component owns Chengdu presentation, checking mode before version. See the dedicated interface guide for action, privacy and accessibility contracts.

## 用户立绘表情 / User portrait reactions

`presentWins → CharacterPortraitReactions → characterForPlayer`仅把已显示的公开胡事件转成每座约3秒的基础/胡牌/放炮图。local接收不提前换脸，成都共用角色呈现但不复用花麻将飞牌。资产、三响、隐私及清理边界见 [用户立绘表情](CHARACTER-PORTRAIT-REACTIONS.md)。
The portrait path maps displayed public wins to per-seat three-second reactions. Local receipts never reveal future queue events; Chengdu shares character rendering without Flower flights. See the dedicated guide for assets, triple wins, privacy and cleanup.

## 独立角色画框 / Separate character frames

画框只显示立绘，不再叠加角色名称或在本人图下显示角色/声线名片；成都身份栏也不重复角色名。玩家昵称与座位标记仍在身份栏，角色选择器和图片alt仍保留名称。维护时不要把角色名片与真实玩家身份混为一谈。
Frames show art without role-name overlays or own-art name/voice captions, and Chengdu identity rows no longer repeat role names. Player nicknames and seats remain in identity rows; selectors and image alternatives retain character names. Do not confuse decorative role nameplates with real player identity.

花麻将及成都对手的 `character-portrait` 使用240–340px桌面、180–240px手机高画框，原图等比cover。`own-player-area` 内的真实手牌保留在桌面，`own-character-display` 作为手牌后方的普通流figure独立显示主角；`own-character-art` 按1254/1050原图比例预留空间并裁切图片动画。人物不再作为手牌背景，不绝对定位到操作区，没有跨控件遮罩。观众无本人图/私有手牌，窄屏仍仅手牌内横向滚动。
Both modes use tall opponent frames (240–340px desktop, 180–240px phone) with proportional cover. Actual own cards stay on the board; a normal-flow figure after the hand shows the main character separately. The original image ratio reserves space and clips image motion. Art is never a hand background or an absolute-positioned control overlay. Spectators have no own art/private hand; narrow scrolling stays within cards.

`characterForPlayer(seat, forOccupant)` 区分牌局快照与当前占座人：默认读取本局game.characters，保持成都/观战的原参赛者身份；占座身份面板传true，结束后的替补不继承旧人的角色。大厅先读服务端seats[].characterId，偏好只作旧响应兜底。落座分配和续局合同见 [七角色](SEVEN-CHARACTERS.md)，本次验证见 [角色落座与画框验收](CHARACTER-SEATING-VALIDATION.md)。
The character helper distinguishes game snapshots from present occupants. Game/Chengdu/spectator panels retain original participants; occupant panels explicitly opt into replacement identity after finish. Lobbies prefer the server's saved characterId and use preferences only for legacy responses. See the assignment contract and validation report.

## 局内稳定视窗 / Stable in-game viewports

参见 [稳定牌桌布局](STABLE-TABLE-LAYOUT.md)：`App.vue` 和 `ChengduTable.vue` 把条件内容放在游戏期间常驻槽位中；`tabletop.css` 最后覆盖固定可视高度及滚动条占位。维护时不要把 `v-if` 移到空槽父级、只留下 max-height，或添加整页滚动补偿。长内容必须保留可命名、可聚焦的原生滚动入口。
See [stable table layout](STABLE-TABLE-LAYOUT.md): conditional content lives inside game-long slots, with final CSS fixing visible heights/gutters. Do not move conditionals onto empty parents, restore max-height-only growth or add document-scroll compensation. Long content requires named, focusable native scrolling.

主牌桌底部信息由 `table-info-footer` / `chengdu-table-footer` 承载：状态、终局控制及花麻将本人身份在真实DOM中排到手牌/立绘后；成都还排在账本/动态后。玩家接牌槽紧邻手牌动作，观众公开提示在页脚。大厅身份保持原位置；不要把该移动误解为身份、私有手牌或合法动作权限变化。细节和回归见 [稳定牌桌布局](STABLE-TABLE-LAYOUT.md)。
Main-table footers place status, finish controls and Flower own identity after hand/art in real DOM order; Chengdu additionally follows its ledger/history. Player claims stay by hand actions, while spectator claims live in the footer. Lobby identity stays in place. These moves change no identity, private-hand or action permissions; see the layout guide and regressions.


### 紧凑牌区与动作靠右 / Compact play areas and right-aligned actions

两玩法不再显示重复手牌框标题；花麻将完整状态仍在手牌可访问描述和原页脚，当前回合徽章在手牌上方动作带右侧。共享萝卜是无标题的牌优先条，读屏名称保留归属/总数，动态增加和待翻仍可见。成都简化顶部玩法条与手牌说明，但保留换牌选中数量、定缺、回合和接牌。`tabletop.css`及成都组件样式用首个动作的单侧auto边距靠右，溢出时回到可达起点；不要恢复旧尾部auto边距。固定槽、原SFC脚本、服务端动作与立绘不变，详见[布局契约](STABLE-TABLE-LAYOUT.md)。
Both modes remove repeated hand-box titles. Flower retains complete status in the hand's accessible description and existing footer, with its turn badge in the upper-right action dock. Shared radishes use a tile-first strip with accessible ownership/count and visible changes/pending information. Chengdu simplifies its top strip and hand guidance while retaining exchange progress, missing suit, turn and claims. A start-only auto margin on the first action right-aligns controls and resolves to a reachable overflow origin; do not restore the old trailing auto margin. Fixed slots, SFC scripts, server actions and portraits remain unchanged; see the layout contract.

牌河标题和记录数量也不再可见；花麻将 `discard-label` 整块删除，成都原本无此标题。牌河容量、座位key/排列和每张弃牌保留，归属通过原具名可访问区域读取。手机成都动作只收紧gap/左右内边距以容纳普通四回应，不缩小字、44px按钮高度或删除长动作的滚动入口。
River headings/counts are also no longer visible: Flower removes `discard-label`, while Chengdu already had none. River capacity, seat keys/order and every discard remain, with ownership in the original named accessible regions. Phone Chengdu actions compact gaps/inline padding to fit four ordinary responses without shrinking text,44px height or removing long-group scrolling.

## 终局后的下一局选择 / Next-round choices after settlement

`App.vue` 的 `showNextRound` 和 `activeModal` 共用规则/邀请的唯一弹层。玩家在本页看到同一局由进行中变为 `finished` 后，等本机音画及已有弹层结束再自动提示一次。首次读到已结束局（刷新、重连、重新进房）不自动提示；花麻将/成都页脚的“下一局选择”可手动打开。观众不自动弹，手动打开也没有开局权限。关闭/X/ESC返回结算，两个主选项为“同桌再来一局”和“返回大厅”。
`showNextRound` and `activeModal` reuse the single rules/invitation modal. A live same-game finish prompts players once after local media and existing dialogs finish. Loading an already finished game after refresh/re-entry does not prompt; both modes expose a manual footer trigger. Viewers never auto-prompt or gain start authority. Close/Escape reveals settlement; the two primary choices restart the same table or return to the lobby.

`startNextRound` 仍调用 `mutate(null, true)`，房主、满员、断线、同步、音画和旧房金额守卫不变；`leaveFinishedTable` 走原 `newTable` 离席路由。没有玩法/参数编辑，没有全员准备或投票。开局请求中暂不能关闭/离桌，错误留在层内，未知结果先同步，不重发。新局/换桌会清掉旧弹层，普通轮询不重复弹。键盘圈跳过禁用控件，全禁用时聚焦容器；关闭恢复原控件，原控件已移除/禁用则回到选择入口或牌桌工具。
`startNextRound` delegates to the original start request and guards; `leaveFinishedTable` uses original departure. There are no rule editors, ready votes or new permissions. In-flight starts retain the dialog and errors; uncertain outcomes synchronize without retrying. New games/navigation clear it; polling never reopens it. Focus skips disabled controls, falls back to the container while all are disabled, and restores to the trigger/table tools when the former control no longer works.

关闭分支先捕获并清空 `previousFocus`，然后 `await nextTick()` 等实际DOM提交，再校验 `epoch` 和 `activeModal`。新局可能在同一tick删除入口或禁用按钮；若另一弹层接管，旧回调不能抢焦点。只有连接且启用的旧控件可恢复，否则查询当前启用的选择入口/桌面工具。
The close branch captures and clears `previousFocus`, then awaits the actual DOM flush before checking `epoch` and `activeModal`. A new game can remove or disable the trigger in that tick, and a replacement modal must keep focus. Restore only a connected, enabled old control; otherwise query a current enabled choice trigger or table tool.


### 无框手牌与上方动作带 / Frameless hand and upper action dock

`hand-action-dock` 在两玩法模板里真实排在手牌前，空闲也常驻；只让回合提示条件显示，不能用本人回合条件包住接炮/抢杠合法动作。原事件/禁用表达式和两组件脚本不改。手牌实体列表按内容定宽加auto边距，足宽居中、超宽起点可达。七角色class只选择固定调色变量，不接受自由CSS。完整高度、手机侧边留白、测试与纯视图入口见 [稳定布局](STABLE-TABLE-LAYOUT.md#无框居中手牌与角色动作带--frameless-centered-hands-and-themed-actions)。
Both real templates place a persistent hand-action-dock before tiles. Condition only the prompt, never the claim/rob-kong allowlist container. Original events/disabled expressions and both scripts remain unchanged. Intrinsic-width lists with auto margins center when fitting and keep a reachable overflow origin. Seven enum classes select fixed palette variables, never arbitrary CSS. See the stable-layout guide for capacities, phone spacing, tests and isolated preview controls.

## 下一局弹层中的终局总览 / Finished overview inside the next-round dialog

`App.vue → round-summary.js → RoundSummary.vue → MahjongTile.vue` 是新的阅读路线。App 的 `finishedRoundSummary` 只读取当前已显示快照的 `game.roundSummary`；纯展示适配要求房间和游戏同时为 `finished`，且摘要玩法匹配。它不访问当前占座人的累计账、不从历史数胡或神龙，也不把已隐藏的玩家牌区拼成对手手牌。服务端合同见 [终局摘要](FINISHED-ROUND-SUMMARY.md)。
The new reading path leads from App's displayed authoritative summary through a pure adapter to tiles. Both room/game must be finished and modes must match. The adapter never uses current occupants' totals, reconstructs hu/dragon counts from history, or infers concealed hands. See the server contract.

每位本局参与者分别显示胡牌次数、神龙组数、本局净分、本桌累计和结束时手牌。副露与胡牌引用另列；成都自摸记录显示“已含在手牌”，不能再向手牌添加第14张。神龙细节的 `pointsPerOpponent` 显示为“每家付”，不是本人的神龙净收益。旧记录缺失显示“未记录”，成都神龙显示“不适用”；零分、零胡、零组不与缺字段混淆。当前占座者换人不重命名原局参与者。
Each original participant has hu count, dragon groups, round net, table total and exact terminal hand. Melds and win references remain separate; Chengdu self-draw references say they are already in hand. Dragon amounts are charged per opponent, not net dragon income. Missing records, inapplicable Chengdu dragons and known zero values remain distinct, and replacements do not rename original participants.

整个总览只有一个具名、可聚焦的纵向滚动区，手牌、副露自然换行，不新增每玩家横向滚动条。超过四张胡牌记录默认收进原生 `details`，仍保留每张牌；`summary` 显式 `tabindex="0"` 加入现有焦点圈。底部同桌/大厅控制在滚动区外。新样式只在组件和 `next-round-dialog` 内生效，不改变此前无框手牌和上方动作带。
One named focusable vertical viewport contains naturally wrapping hand/meld tiles. More than four win references initially collapse in native details without dropping cards; explicit summary tabindex integrates with the existing focus loop. The footer controls remain outside the scroll area. Scoped styling preserves the existing frameless hands and action dock.

`showNextRound`、`openNextRound`、`startNextRound`、`leaveFinishedTable`、请求/同步守卫和关闭后的 `await nextTick()` / epoch 焦点恢复逻辑均沿用。没有新增网络、存储键、监听或游戏动作。只读总览测试与真实浏览器测量应分别报告，SSR不证明320px布局或实际键盘焦点通过。
Existing modal state, actions, guards and post-flush epoch-protected focus restoration remain intact. The overview adds no network, storage, listeners or game actions. Report SSR and browser results separately; SSR does not establish narrow layout or actual keyboard focus.
