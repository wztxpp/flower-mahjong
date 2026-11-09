# 二维真实牌桌 / Realistic two-dimensional table

## 展示边界 / Presentation boundary

真实桌是独立的本机显示模式，不是新玩法。`App.vue` 的「经典桌 / 真实桌」切换只保存浏览器偏好 `huajian-table-presentation-v1`，不会换桌、重新发牌、提交动作或修改本局规则。默认仍是经典桌，用户选择真实桌后下次恢复。花麻将三个历史引擎及成都引擎、账本、权限、联机协议均继续使用原路径。
Realistic mode is a local presentation, not a rules family. The switch stores only the browser preference and never changes rooms, deals, actions or rule snapshots. Existing engines, ledgers, permissions and network protocols retain their paths.

公开桌面由 `RealisticTable.vue` 绘制，原 `App.vue` / `ChengduTable.vue` 的私有手牌及合法动作组件保持挂载，只通过 `.is-realistic-table` 样式固定在屏幕底部。它们不在可平移场景内，点击目标也不随桌面缩放。关闭真实桌即撤下新场景并恢复原布局，选牌和会话不重建。
The new component renders public zones while the original private hand/action components remain mounted and screen-fixed. Their targets never pan/scale with the scene. Switching back unmounts the new scene and restores the old layout without rebuilding selection or session state.

## 四方与牌区 / Seats and tile zones

桌面局部坐标为1000×1000，南侧为观察者本人；三人桌有南/左/右三席，北面留空，四人桌增加北席。沿用原桌绝对座位合同：seat+1在左，seat-1在右；行牌方向不改变座位身份。观战者锚定公开0号位，但不获得本人身份或私有手牌。
The local table is1000×1000 with self at south. Three players leave north vacant; four use every side. Existing seat+1-left/seat-1-right identity remains fixed irrespective of play direction. Spectators anchor publicly at seat zero without becoming a participant.

每家以自身朝向定义区域：手牌靠桌边、牌墙在手牌前方、牌河朝桌心、碰杠在左下、胡牌在右下。绕桌心旋转整组区域，不能按屏幕左右重新摆放。纯坐标测试比较全部旋转区域的轴对齐边界，防止邻家牌河和角落副露重叠。schema3共享萝卜单独位于桌心；旧v1/v2个人萝卜留在各自右下区，不丢计分归属；成都不显示花麻将萝卜。胡次数独立读取权威huCount，旧v1缺winPile不代表零次。
Each player's local layout places hands nearest the edge, wall ahead, river inward, melds lower-left and wins lower-right. Rotate the complete region around the table rather than reinterpreting screen-left/right. Geometry tests check adjacent-region collisions. Schema-three shared radishes occupy the center; legacy personal radishes retain each owner’s lower-right zone. Hu counts come from authoritative huCount, since v1 has no winPile. Chengdu has no Flower radishes.

公开牌数增长时在原区域内计算等比牌格，不截断长牌河、胡牌记录或扩展杠。非常多牌时会变小，可手动放大再临时拖看；默认倍率让整个场景留在可视区。本人可操作手牌保持独立正常尺寸。
Growing public zones compute proportional tile grids without truncating long rivers, repeated wins or extended kongs. Dense zones become smaller and can be zoomed/panned manually; default zoom fits the complete scene. Private actionable hands retain separate normal sizing.

成都状态沿 `chengdu-table-status.js` 与原桌共享；换三张选择计数、定缺说明、收到的三张牌仍在私有HUD。连接错误/重连始终可见；复制邀请复用原入口；下一局旧配置及本人胡牌判断/结算通过原生popover展示原DOM，不重新创建状态。
Chengdu shares its original status adapter and retains private preparation/receipt information. Errors/reconnect remain visible; invitation uses the original handler. Native popovers expose existing configuration/private diagnostic DOM without reconstructing state.

## 牌墙可知与不可知 / Public wall geometry

三人和四人桌都保留四面墙、上下两层与固定垛位。花麻将总数读取本局公开 `rules.deckCount`（旧局缺省144），成都108；已公开萝卜从墙尾扣除，其余已取出的数量从墙头扣除。消耗后空垛保留位置，不把所有剩余牌重新均分。数量不完整或不自洽时明确退回均分示意，未知数量不显示成零。
Both counts use four walls with fixed two-layer stacks. Public deck size, remaining count and revealed radishes determine front/tail depletion; empty slots remain in place. Inconsistent/incomplete counts use an explicitly approximate fallback, and unknown is never presented as zero.

**原引擎没有骰子、物理开墙口或独立牌墙座标。** 因此起点采用庄家对应边的展示约定，始终保留 `wallIsApproximate:true` 及页面「牌墙按公开余牌示意」说明，不能称已复原真实物理摸牌顺序。任何函数都不访问私有 `wall` 牌种，也不向服务端索取它。
**The engines do not store dice, a physical wall break or wall coordinates.** The dealer-side origin is a visual convention, always labeled approximate. No helper accesses or requests concealed wall identities.

## 动作与生命周期 / Motion and lifecycle

`realistic-table-events.js` 只处理App已取得播放权的 `presentationFrame`；`realistic-presentation.js` 把无声摸牌前缀及尾部附到原声音FIFO，不能在第一段声音时把完整快照的后续历史全播完。初次挂载、换模式不补演当前帧；后台、略过、换局与取消发送reset帧，清理动作及等待。摸牌始终是牌背，隐藏事件即使带异常牌种也不能流入动画。碰/杠走向左下副露区，胡牌走向右下胡牌区；不把待决抢杠当成已成立杠。
Events come only from App-authorized presentation frames. Silent draws are attached to the original audio FIFO, never replayed early from full snapshot history. Mounting/switching modes baselines the current frame; backgrounding, skipping, round changes and cancellation reset animations and waits. Draws/hidden events stay backs. Melds and wins target their correct zones; pending rob-kong proposals never become committed kong motion.

拖动仅改变本页二维偏移，不做视差或三维相机。放大后的边界按实际场景尺寸扩展，四边均能临时拖入视野。松手、取消、丢失指针捕获、焦点离开、窗口失焦、切后台、缩放、resize、换局及卸载都回正。定时器、ResizeObserver、媒体查询和监听器成对清理。系统「减少动态」停止装饰动画，牌局仍正常运行。
Dragging changes only page-local two-dimensional translation. Bounds expand with actual zoomed scene dimensions so all four edges remain reachable. Release, cancel, lost capture, focus loss, backgrounding, zoom, resize, round changes and unmount all reset. Timers/observers/listeners clean up symmetrically. Reduced motion stops decorative effects without changing play.

## 角色与皮肤 / Characters and skins

当前六个视觉身份为 `sweet/elegant/landlord/honest/wealthy/star`；当前用户原画的黄色双马尾角色是 `sunny`，暂不在新选择器和随机新落座中提供。七个稳定ID、旧客户端明确偏好及旧保存身份继续兼容，不能因暂停角色而替换旧玩家。真实桌遇到该旧角色显示明确的不可用提示，不偷偷换成其他人物。
Six current visual identities omit sunny's yellow twin-tail art from new selection/random seats. All seven stable IDs, explicit legacy requests and saved identities remain compatible. The realistic scene does not silently substitute another identity for an unavailable old role.

新视角以用户 `*-scene-base.png` 为唯一身份来源，正面/左右独立制作，不水平镜像；饰物、背包、扣子等按人物解剖左右审核。候选素材在仓库外审核，只有批准目录会进入构建。动态图集能力与实际验收结果以角色文档和清单为准，不把静态回退称为完整动作。
Independent front/left/right art derives from the supplied scene originals and is never mirrored. Review anatomical accessory sides. Candidates remain outside the repository; only approved assets enter builds. Do not describe static fallback as completed animation.

桌布使用局部CSS变量定义松石绿、午夜蓝、暖陶棕，`skin`只改变色彩、不改布局或游戏数据。后续新增背景、材质或人物，只扩展展示目录，不修改引擎。
Local CSS variables define jade, night and clay skins without affecting layout or game data. Additional artwork/backgrounds extend presentation catalogs rather than engines.

## 验证与发布 / Validation and release

专项：`tests/realistic-table-layout.test.js`（隐私、四墙数量/固定垛位、旋转碰撞、格子适配）、`tests/realistic-table-events.test.js`（区域目标与事件隐私）、`tests/realistic-table-ui.test.js`（编译真实Vue组件、指针/焦点/减少动态/清理）。这些不是浏览器像素验收。
Focused tests cover projection/privacy, four-wall counts/fixed slots/collisions, authorized presentation-frame baselines/cancellation, and real compiled Vue lifecycle behavior. They are not browser pixel acceptance.

本地浏览器预览沿用隔离 `tests/browser/stable-table-preview-server.mjs`，API全部拒绝，只有本机显示控制/选牌可用。实际浏览器是否通过、素材动作是否完成以及最终全量测试、main SHA和Site版本，必须以最终验收记录为准。未通过的项目不能标记完成或发布。
The isolated preview rejects all API actions. Final acceptance must separately record actual browser evidence, media completion, full checks, remote main SHA and Site version. Failed/unverified stages are never labeled completed or published.

## 本次体验版范围 / This playable release scope

2026-11-09用户明确选择先发布不含人物伸手动作的版本，并要求继续制作动作。此版本包括二维桌面、四方牌区、固定手牌、拖动回正、桌面飞牌、18个独立角色视角和眼发局部动态。所有 `view.action` 仍为null；失败的手部候选不进入仓库或构建。人物摸打碰杠的伸手序列另行验收、另行发布，不把已有飞牌或眨眼称为人物伸手动作。
On2026-11-09 the user chose a playable release without character reaching motions while that work continues. This version includes table presentation, fixed controls, tile flights,18 independent views and local eye/hair motion. All view.action entries remain null. Rejected hand candidates never enter source/builds; reaching sequences require separate acceptance and publication.

本机弹层维护模块为 `src/realistic-popover.js`（及同名测试）：原生API显式打开既有DOM；缺API时退回固定面板并支持关闭、Esc及外部点击。浏览器回归保留真实原生路径证据，不能把代理读取不到方法误称浏览器不支持。
Local overlays use realistic-popover.js and its tests: explicitly open the existing native DOM, with dismissible fixed panels when APIs are absent. Browser evidence verifies the native path; limited proxy introspection is not proof of missing browser support.
