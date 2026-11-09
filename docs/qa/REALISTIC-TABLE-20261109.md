# 写实桌面浏览器验收 / Realistic table browser QA

日期 / Date: 2026-11-09。状态 / Status: 本次不含人物伸手动作的可体验版已完成下列验收，待集成负责人统一检查和授权发布。人物伸手动作明确不在本次版本范围。 / The playable release without character hand actions has completed the checks below, pending integration checks and authorized publication. Character hand actions are explicitly outside this release scope.

## 方法与边界 / Method and boundaries

使用官方 managed preview 与浏览器工具，加载真实 App、ChengduTable、RealisticTable、RealisticCharacter 和生产样式。仅使用合成昵称、积分和牌局展示快照，无真实用户数据。 / Used official managed preview and browser tools with real components and production styles, using synthetic names, scores and game snapshots only.

隔离服务器拒绝全部 API，fixture 阻止出牌、回应、开局、准备、离桌与复制邀请写剪贴板。只操作本地展示切换、滚动、选牌及诊断入口；没有生产写入、部署或规则修改。 / The isolated server rejects all API calls and the fixture blocks gameplay, preparation, departure and clipboard writes. Only local presentation, scrolling, selection and diagnostic controls were exercised; no production writes, deployment or engine changes.

## 已观察通过 / Observed passes

- 三人桌保留空北席及四面牌墙；四人桌保留北家，人物朝桌内，碰杠为玩家左下、胡牌为右下。 / Three-player tables retain empty north and four walls; four-player tables retain north player. Actors face inward, melds are local lower-left and wins lower-right.
- 桌面1280×760、窄屏390×760与成都320×760检查。压缩后桌面三人桌布约388px，高于初版321px；长名字、南家人物在默认视窗内。观战释放原手牌HUD高度。 / Checked desktop 1280×760, mobile 390×760 and Chengdu 320×760. The compact desktop felt is about388px rather than321px initially; long labels and south actor fit. Spectators reclaim private HUD height.
- 拖动释放回正，固定手牌HUD矩形不变；选牌状态跨经典/真实模式切换保留。手机长手牌与动作区各自可横向滚动，成都回应按钮44px高。 / Release resets pan without moving fixed HUD; selection survives mode switches. Long hands/actions scroll independently; Chengdu response buttons are44px high.
- 对手暗手始终背面，合法终局摘要才摊牌；撤销摘要恢复背面。观战不显示私有手牌。静止挂载未重播历史飞牌。 / Opponent hands remain concealed until a valid terminal summary, reverting when removed. Spectators have no private hand. Settled mounts do not replay historical flights.
- 成都进行中显示真实轮次状态，不再错误“等待开局”。修复后320×760定缺HUD bottom743，手牌70px高，收到三张牌区bottom718，无先前47px溢出。换三张说明恢复。 / Chengdu displays active turn status rather than waiting-to-start. Corrected320×760 dingque HUD ends at743, hand height70, received-tile area ends at718, fixing prior47px overflow. Exchange instructions are restored.
- 离线提示在真实桌可见，未点击重连；邀请入口存在，未写剪贴板。 / Offline notice is visible in realistic mode; reconnect was not invoked. Invite entry exists; clipboard was not written.
- 旧版个人萝卜逐席显示，中心明确个人归属，不聚合冒充共享；公开胡次数独立于胡牌区。实际旧引擎合法自摸和牌数守恒回归覆盖v1没有winPile的情况。 / Legacy radishes remain seat-owned rather than a shared center pool; public hu counts are independent of win tiles. Legal legacy-engine hu/conservation tests cover v1 without winPile.
- 测试专用18视角画廊以330px画框加载真实组件：18张底图完整加载、透明背景、正确左右朝向；逐行滚入时均进入motion，离屏回original。本地应用error/warn日志为空。 / The test-only18-view gallery mounts real components at330px: all bases load transparently with correct inward orientations; visible views enter motion and offscreen views return to original. No local application error/warn logs were observed.

## 限制与未完成 / Limits and outstanding checks

- 发布前补验：显式开关修复后，私有诊断与旧桌下一局配置均可Enter打开、点击关闭、Esc关闭。390px旧配置面板x14..361/y91..465，完整保留原选项，没有提交开局。先前click无效还涉及1280px iframe超出1185px宿主视口的工具按钮，不能据此断言浏览器缺少原生popover API；原生open状态复验为true。 / Final pre-release check: explicit handlers allow private feedback and legacy configuration to open with Enter and close with the close button or Escape. The390px configuration panel fits atx14..361/y91..465 with original options and no start submission. Earlier click failures also involved offscreen controls in a1280px iframe inside a1185px host; they do not prove missing native popover support. Native open state was verified true.

- 放大2倍的四边可达性由纯几何回归验证；浏览器验证缩放和拖动释放，但未在持续按下指针时测量四边。 / Double-zoom edge reachability is covered by pure geometry regression; browser checked zoom and release, not all edges during a held drag.
- 画廊截图抽样未见整脸遮罩、明显矩形接缝或背景块，但不能证明18视角每个完整眨眼周期和发丝极值均通过；人物伸手动作及其时序明确未包含在本次可体验版，不将其标作已完成。 / Screenshot samples show no whole-face masks, obvious rectangular seams or background blocks, but do not certify every full blink cycle or hair extreme across all18 views. Character hand actions and their timing are explicitly excluded from this playable release and are not marked complete.
- 默认320px全桌标签很小，不能宣称无需放大即可全部清晰阅读。没有实机触摸、真实联机、语音或OS减少动态设置浏览器验收；生命周期和隐私另由真实SFC测试覆盖。 / Default320px full-table labels are tiny; full readability without zoom is not claimed. Physical touch, live multiplayer, voice and OS reduced-motion browser behavior were not tested; SFC tests cover lifecycle/privacy separately.

专项模型测试30项通过，专项ESLint通过；整体测试、lint、build由集成负责人在最终代码上执行。 / All30 focused model tests and focused ESLint passed; the integration owner runs full tests, lint and build on final code.
