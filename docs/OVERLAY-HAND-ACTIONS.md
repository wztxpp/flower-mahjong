# 按需手牌操作浮层 / On-demand hand action overlay

## 范围与权限 / Scope and authority

基线为 `932ae1bcbc7389307a6dc2e5f753c55c6f98c93e`。本次按用户要求取消操作框的常驻流式占位，两玩法仅在存在原有可显示按钮时挂载 `hand-action-dock`。位置仍在手牌右上方，不移动立绘、牌河或本人公开牌的先后顺序，不增加新规则、服务器动作、请求、存储或声音。
The baseline is the commit above. Both modes now mount the dock only when an existing renderable button applies, removing its permanent flow reservation. It remains above/right of the hand without reordering portraits, rivers or own public cards, or adding rules, server actions, requests, storage or audio.

`hasHandActions` 只组合原按钮列表和原展示条件，不使用“轮到本人”推断权限。花麻将保留旧版摸牌、摸打、暗杠/补杠/加杠、接炮、抢杠和胡后必胡；成都保留换三张、定缺、摸打和回应。等待、已回应、已胡退出与观战不产生空操作层。busy/offline/syncing/blocked 和选牌确认仍按原表达式禁用，所有提交处理器未变。
The derived flag combines existing button groups/render conditions, never using own-turn status as authority. Flower retains frozen-version draws, discards, all kong variants, claims, rob-kongs and mandatory wins; Chengdu retains preparation and responses. Idle, answered, retired and spectator views have no empty action layer. Original network/busy/selection guards and submission handlers remain intact.

## 实际空间预算 / Actual space budget

`hand-interaction-area` 始终只由手牌撑高。浮层使用 absolute，左右贴容器，54px高供44px按钮与10px原生横滚条；没有新增等高 padding、min-height 或透明占位。无动作时通过 v-if 撤下整个层，没有不可见点击层。容纳得下时首个项目的 auto 起始边距靠右；超长组从首项起原生横滚，所有按钮不压缩。
The wrapper takes only its hand's flow height. Absolute controls span its width with54px for44px buttons and a10px native horizontal scrollbar. No equivalent padding/min-height/transparent spacer replaces the deleted dock. v-if removes the entire idle layer. A first-item auto start margin right-aligns fitting content and resets on overflow, retaining every unshrunk action and both ends.

- 花麻将沿用原80px公开牌外槽，把实际滚动视窗定为50px（44px普通副露内容+6px牌影预算）。原100/112px手牌不加高，内部 padding 改为28px 4px 6px，删除牌列重复5px底padding。浮层终点为 handTop+24px，选中牌面起点为 handTop+26px。
  Flower retains its80px outer public slot with a50px scroll viewport, budgeting44px ordinary meld content plus6px shadow. Its100/112px hand stays the same height, rebalancing internal padding and removing duplicated inner bottom padding. Actions end at handTop+24px; selected tiles start at+26px.
- 成都沿用48px说明槽，上部24px显示同色/已选数/不可修改或定缺说明。长文仍原生可滚。手牌由112改为114px，恰好容纳34px上沿、64px原牌、6px牌影与10px横滚条；浮层终点为 handTop+30px，选中牌从+32px开始。额外2px是牌/滚动条完整可见预算，不恢复原92/132px操作预留。
  Chengdu retains its48px note slot, using its first24px for complete compact preparation guidance with scrolling for long content. Its hand grows only112→114px to fit34px top space, unchanged64px tiles,6px shadows and a10px scrollbar. The run ends at handTop+30px and selected cards begin at+32px. Those2px prevent tile/scrollbar clipping, not a replacement92/132px action reservation.

公开牌内视窗变小是明确取舍：普通一组碰/一次胡不新增纵滚；长局、多副露、旧版萝卜仍完整遍历，可在原生内视窗滚到末项。牌河、其他公开区、结算摊牌与下一局弹层不改。
The smaller public viewport is an explicit trade-off: ordinary peng/one-win content gains no vertical scrollbar, while long rounds, multiple melds and legacy radishes remain complete and scrollable. Rivers, other public areas, terminal reveals and next-round dialogs are unchanged.

选中/hover上移统一为2px，改用清楚的角色色内描边；键盘焦点内描边不向浮层突出。旧选中小圆点从牌底外移回 bottom:3px，避免落入滚动条。七角色与中性配色沿用既有变量，主/次按钮文字保持4.5:1对比验证。
Selection/hover now lift2px with clear inset role-colored outlines. Keyboard outlines stay inside, and the old selection dot moves inside the card at bottom:3px instead of into the scrollbar. Existing seven-role/neutral palettes and4.5:1 primary/secondary text checks remain.

## 信息与焦点 / Information and focus

“轮到你了”是与按钮同行的12px短提示，仅本人回合显示。他家接牌不占该位置；完整来源、牌名与抢杠状态移到手牌下方既有听牌信息区，与原听口同时保留、可原生滚动和 aria-live 朗读。不重复插入小牌挤占320px普通四回应。观战仍使用原页脚公开提示，不获得私有区域。
The12px own-turn cue shares the button run only on the viewer's turn. Complete source/tile/rob-kong wording remains visible and live-announced in the existing below-hand information region alongside waits, with native scrolling. No duplicate mini tile crowds normal four-response controls at320px. Spectators retain their public footer without private regions.

两个组件用真实DOM refs及Vue更新前watch捕获浮层内焦点，同时观察busy/offline/syncing或成都blocked。DOM提交后，仅旧节点已撤下或禁用、仍同桌/同局/同座且焦点仍落旧节点/body、没有新弹层接管时，才以 preventScroll 回到持续存在的手牌region。不会聚焦下一动作、自动选牌或调用提交；同tick较新焦点、换局、观战、离桌均不被抢占。
Real refs and pre-patch watchers capture focused dock nodes, including busy/offline/syncing or Chengdu blocked changes. After commit, only a removed or disabled node in the same room/round/seat can return to the persistent hand region with preventScroll, when focus remains on the old node/body and no dialog owns it. Recovery never selects, submits or focuses a next action; newer same-tick focus and navigation/viewer changes always win.

## 验证入口与边界 / Verification and boundaries

- `tests/hand-action-dock.test.js`：真实SFC/CSS、按需挂载、absolute/无替代占位、54/44px预算、2px选择与牌内小点、完整横滚及角色对比度。
  Real SFC/CSS, conditional mount, no replacement reservation, dimensional contracts, selection/dot and palette checks.
- `tests/ui.test.js`、`tests/chengdu-ui.test.js`：真实组件SSR的版本/阶段/动作/阻断/准备/观战矩阵，真实引擎必胡/抢杠，原终局与隐私。
  Actual-component SSR matrices and real-engine mandatory-win/rob-kong cases preserve old terminal/privacy behavior.
- `tests/invitation-copy.test.js`：同一真实组件实例的浮层region/按钮撤下、保留pass、较新焦点/弹层、换局/观战，以及原结算摊牌撤销回归。另模拟busy/offline/syncing禁用失焦后撤层，及同tick新焦点接管。内存DOM不冒充浏览器原生disabled失焦证据。
  Mounted-component focus/removal/replacement/lifecycle tests and existing terminal-reveal regression, plus modeled busy/offline/syncing blur/removal and newer same-tick focus ownership. In-memory hosts are not evidence of native disabled-button blur.
- 现有纯视图预览新增可见“操作层焦点撤下检查”“选中手牌并检查安全间距”。前者在iframe内先聚焦实际节点再切合成快照，另测busy禁用后撤下；后者仅调用真实本地选牌。动作确认、准备提交、开局与离桌继续封锁，客户端fetch边界、服务端所有API方法403及AST隔离数量不变。
  Visible preview controls exercise actual in-frame focus, including busy-disable removal, and local selection. All confirmations/starts/departures remain blocked with unchanged client/server/AST isolation.

独立Chromium纯视图实测的页面高度：花麻将1280px为2768→2676（省92px），390px为3925→3793（省132px），320px为3931→3799（省132px）；成都分别3824→3734（省90px）、4539→4409（省130px）、4530→4400（省130px）。普通四回应在有效宽度下无需横滚，普通牌与浮层4px间距、选中后2px，手牌无额外纵滚。完整最终浏览器记录由对应QA报告提供，不以源码断言替代。
Independent Chromium synthetic-view measurements show those actual page-height reductions: Flower92/132/132px and Chengdu90/130/130px at1280/390/320px. Normal four-response groups fit, ordinary/selected cards have4/2px clearance, and hands have no extra vertical overflow. Final browser reports own full evidence; source assertions are not pixel evidence.

独立浏览器验收范围为17组配置各13次局内变化，并检查回看位置和滚动末端可达；另含两玩法320px各9项原生焦点检查、420px短视口、选牌、成都准备、抢杠和长动作。最终逐组结果随QA交付，不把测试中的合成快照计作真实联机或实体手机。
Independent browser coverage comprises17 configurations with13 in-round transitions each, scroll-position retention and reachable endpoints, plus9 native focus checks per mode at320px, a420px-tall viewport, selection, Chengdu preparation, rob-kongs and long action runs. Per-case outcomes accompany QA delivery; synthetic snapshots do not count as live multiplayer or hardware-phone validation.

2026-11-08本地最终检查：`npm test` 1564/1564通过（无跳过），`npm run lint` 0错误（3项既有警告），`npm run build` 通过，`git diff --check` 通过。独立Chromium在320px的花麻将/成都各9项同实例焦点检查通过，包括busy禁用后回到手牌且不落body。花麻将超长动作行实测clientHeight与scrollHeight均44px；真实ArrowRight可达末按钮，Shift+Tab返回首动作。没有通过隐藏滚动条消除溢出。
Final local checks on2026-11-08: all1564 tests pass without skips, lint has no errors and3 existing warnings, production build passes, and diff whitespace checks pass. Independent320px Chromium checks pass all9 same-instance focus cases in both modes, including busy recovery to the hand instead of body. Flower's long action run measures44px for both client and scroll height; real ArrowRight reaches the last control and Shift+Tab returns to the first. Scrollbars remain native and visible.

没有真实房间提交、推送或部署。未验证实体手机触控、Safari/Firefox或真实多人联机。原生焦点专项与全量test/lint/build最终结果另随交付列出，不能用前述几何结果代替。
No real-room action, push or deployment occurred. Hardware-phone touch, Safari/Firefox and live multiplayer are unverified. Final native-focus and aggregate test/lint/build results are reported separately from geometry.
