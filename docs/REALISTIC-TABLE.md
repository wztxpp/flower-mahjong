# 二维真实牌桌 / Realistic two-dimensional table

## 展示边界 / Presentation boundary

真实桌是独立的本机显示模式，不是新玩法。`App.vue` 的「经典桌 / 真实桌」切换只保存浏览器偏好 `huajian-table-presentation-v1`，不会换桌、重新发牌、提交动作或修改本局规则。默认仍是经典桌，用户选择真实桌后下次恢复。花麻将三个历史引擎及成都引擎、账本、权限、联机协议均继续使用原路径。
Realistic mode is a local presentation, not a rules family. The switch stores only the browser preference and never changes rooms, deals, actions or rule snapshots. Existing engines, ledgers, permissions and network protocols retain their paths.

公开桌面由 `RealisticTable.vue` 绘制；原 `App.vue` / `ChengduTable.vue` 的私有手牌及合法动作通过Vue Teleport搬入其桌内近沿容器，而不是另建一套按钮或固定在屏幕底部。`controls-target`只上报已挂载的DOM目标，`realisticControlsTarget`不含动作权限；目标未就绪时保持原位置。目标销毁时清空引用，反复切换会取得新目标，不把手牌留在脱离文档的旧节点中。原选择、网络、版本校验、禁用与焦点回退路径仍归原组件。
RealisticTable renders the public scene. Vue Teleport moves the original App/Chengdu private controls onto its near table edge instead of duplicating buttons or creating a screen-bottom HUD. The controls-target event carries only a mounted DOM destination, never authority. Missing targets leave controls in place; destroyed targets clear the reference. Original components retain selection, transport, revision checks, disabled states and focus recovery.

本人确有私有控件时，公开场景不再画第二份只读本人手牌；观众和非本局参与者仍按原隐私守卫显示。近沿位置与桌面共用投影/相机计算，拖动和缩放时随桌沿移动，但可点牌及按钮不被场景比例缩小，长手牌和动作保留原生横滚。经典桌关闭Teleport后恢复原布局，原手牌节点、选牌和会话不重建。
When private controls exist, the public scene suppresses the duplicate read-only self rack. Existing spectator/participant privacy gates remain. Controls share the table projection/camera anchor and follow its pan/zoom while keeping native click sizes and horizontal scrolling. Disabling Teleport restores classic layout without rebuilding hand nodes, selection or sessions.

这份当前合同替代旧验收记录中“所有三人视角都空北席”和“屏幕固定手牌HUD”的实现说明；旧QA记录仍描述其当时提交，不作为新视角验收证据。
This contract supersedes the old implementation descriptions of an always-empty north side and screen-fixed private HUD. Historical QA remains evidence for its original revision, not acceptance of the new viewpoint.

## 四方与牌区 / Seats and tile zones

桌面牌区仍使用1000×1000局部坐标。先将绝对座位固定到四个物理方向，再将整桌旋转使本人位于屏幕南侧。0号观察视角下，三人桌是南0/左1/右2/北空，四人桌是南0/左1/北2/右3。三人空位也随桌旋转：1号视角空左、2号视角空右；原1号与2号玩家始终对坐，不能因切换查看者把他们重排成相邻。行牌方向只决定轮次，不重排物理座位。观战锚定公开0号位，但不获得本人身份或暗手。
Tile zones retain a 1000-square local space. Fix absolute seats to four physical sides, then rotate the entire table to place self at screen south. From seat zero, three players occupy south 0 / left 1 / right 2 with north vacant; four occupy south 0 / left 1 / north 2 / right 3. The three-player vacancy rotates too: it is left for viewer 1 and right for viewer 2. Original seats 1/2 remain opposite, never adjacent after a viewer change. Turn direction affects order, not physical seating. Spectators anchor publicly at seat zero without gaining a private hand.

`realistic-table-perspective.js`把整个桌面统一投成近宽远窄的斜向梯形。牌墙、牌河、副露、胡牌区及飞牌继承同一变换；人物和可操作手牌有独立可读尺寸，不把整个人物压扁成桌布。CSS `matrix3d`在这里仅表达二维单应投影，不意味着新增三维引擎、物理牌堆或三维人物。
The perspective helper projects the whole table into a seated trapezoid, wider near the viewer. Walls, rivers, melds, wins and flights inherit one transform. Characters and playable controls retain independent readable sizing rather than being flattened into the felt. CSS matrix3d expresses a 2D homography, not a new 3D engine, physical tile simulation or 3D actor.

每家以自身朝向定义区域：手牌靠桌边、牌墙在手牌前方、牌河朝桌心、碰杠在左下、胡牌在右下。绕桌心旋转整组区域，不能按屏幕左右重新摆放。纯坐标测试比较全部旋转区域的轴对齐边界，防止邻家牌河和角落副露重叠。schema3共享萝卜单独位于桌心；旧v1/v2个人萝卜留在各自右下区，不丢计分归属；成都不显示花麻将萝卜。胡次数独立读取权威huCount，旧v1缺winPile不代表零次。
Each player's local layout places hands nearest the edge, wall ahead, river inward, melds lower-left and wins lower-right. Rotate the complete region around the table rather than reinterpreting screen-left/right. Geometry tests check adjacent-region collisions. Schema-three shared radishes occupy the center; legacy personal radishes retain each owner’s lower-right zone. Hu counts come from authoritative huCount, since v1 has no winPile. Chengdu has no Flower radishes.

公开牌数增长时在原区域内计算等比牌格，不截断长牌河、胡牌记录或扩展杠。非常多牌时会变小，可手动放大再临时拖看；默认倍率优先框住桌面和人物上身；完整房间另保留可拖入视野的桌下空间。本人可操作手牌保持独立正常尺寸。
Growing public zones compute proportional tile grids without truncating long rivers, repeated wins or extended kongs. Dense zones become smaller and can be zoomed/panned manually; default framing prioritizes the table and upper bodies while retaining a larger, pannable under-table room. Private actionable hands retain separate normal sizing.

成都状态沿 `chengdu-table-status.js` 与原桌共享；换三张选择计数、定缺说明、收到的三张牌仍在桌内原私有操作区。连接错误/重连始终可见；复制邀请复用原入口；下一局旧配置及本人胡牌判断/结算通过原生popover展示原DOM，不重新创建状态。
Chengdu shares its original status adapter and retains private preparation/receipt information. Errors/reconnect remain visible; invitation uses the original handler. Native popovers expose existing configuration/private diagnostic DOM without reconstructing state.

## 牌墙可知与不可知 / Public wall geometry

三人和四人桌都保留四面墙、上下两层与固定垛位。花麻将总数读取本局公开 `rules.deckCount`（旧局缺省144），成都108；已公开萝卜从墙尾扣除，其余已取出的数量从墙头扣除。消耗后空垛保留位置，不把所有剩余牌重新均分。数量不完整或不自洽时明确退回均分示意，未知数量不显示成零。
Both counts use four walls with fixed two-layer stacks. Public deck size, remaining count and revealed radishes determine front/tail depletion; empty slots remain in place. Inconsistent/incomplete counts use an explicitly approximate fallback, and unknown is never presented as zero.

**原引擎没有骰子、物理开墙口或独立牌墙座标。** 因此起点采用庄家对应边的展示约定，始终保留 `wallIsApproximate:true` 及页面「牌墙按公开余牌示意」说明，不能称已复原真实物理摸牌顺序。任何函数都不访问私有 `wall` 牌种，也不向服务端索取它。
**The engines do not store dice, a physical wall break or wall coordinates.** The dealer-side origin is a visual convention, always labeled approximate. No helper accesses or requests concealed wall identities.

## 动作与生命周期 / Motion and lifecycle

`realistic-table-events.js` 只处理App已取得播放权的 `presentationFrame`；`realistic-presentation.js` 把无声摸牌前缀及尾部附到原声音FIFO，不能在第一段声音时把完整快照的后续历史全播完。初次挂载、换模式不补演当前帧；后台、略过、换局与取消发送reset帧，清理动作及等待。摸牌始终是牌背，隐藏事件即使带异常牌种也不能流入动画。碰/杠走向左下副露区，胡牌走向右下胡牌区；不把待决抢杠当成已成立杠。
Events come only from App-authorized presentation frames. Silent draws are attached to the original audio FIFO, never replayed early from full snapshot history. Mounting/switching modes baselines the current frame; backgrounding, skipping, round changes and cancellation reset animations and waits. Draws/hidden events stay backs. Melds and wins target their correct zones; pending rob-kong proposals never become committed kong motion.

拖动仅改变本页二维房间相机偏移，不新增三维相机。边界按完整房间和当前视窗/倍率计算；默认视窗与完整房间高度不同，上下可移动范围不要求对称。桌下区域可临时拖入视野；有已批准全身素材的角色才可能显示实际腿脚，平移能力不等于缺失素材已经完成。松手、取消、丢失指针捕获、焦点离开、窗口失焦、切后台、缩放、resize、换局及卸载都回正。定时器、ResizeObserver、媒体查询和监听器成对清理。系统「减少动态」停止装饰动画，牌局仍正常运行。
Dragging changes only the page-local 2D room camera. Bounds follow the complete room, viewport and zoom; default framing and room height differ, so vertical reach may be asymmetric. The under-table area is pannable, but actual legs require approved full-body art. Camera reach does not establish asset completion. Release, cancel, lost capture, focus loss, backgrounding, zoom, resize, round changes and unmount all reset. Timers/observers/listeners clean up symmetrically. Reduced motion stops decorative effects without changing play.

“桌下”按钮提供不用一直按住鼠标的稳定查看位置，适用于触屏和键盘；普通快照更新不重置该位置。之后拖拽从当前偏移开始，松手仍回正；“全桌”恢复默认倍率与偏移，resize、失焦、切后台和换局继续执行原清理。它仅控制本机观看位置，不提交游戏动作。近沿手牌目标在这些相机变化中保持同一DOM节点，私有手牌/动作上的箭头键及触摸滚动不启动桌面拖拽。
The under-table button holds a view without requiring a pressed pointer, including touch and keyboard use. Ordinary snapshots preserve it. A later drag starts from the current offset and still springs home on release; Full table restores default zoom/pan, while resize, focus loss, backgrounding and round changes retain cleanup. It changes local viewing only, never game actions. Camera changes preserve the same control destination, and private arrow/touch scrolling never starts a table drag.

## 角色与皮肤 / Characters and skins

当前六个视觉身份为 `sweet/elegant/landlord/honest/wealthy/star`；当前用户原画的黄色双马尾角色是 `sunny`，暂不在新选择器和随机新落座中提供。七个稳定ID、旧客户端明确偏好及旧保存身份继续兼容，不能因暂停角色而替换旧玩家。真实桌遇到该旧角色显示明确的不可用提示，不偷偷换成其他人物。
Six current visual identities omit sunny's yellow twin-tail art from new selection/random seats. All seven stable IDs, explicit legacy requests and saved identities remain compatible. The realistic scene does not silently substitute another identity for an unavailable old role.

新视角以用户 `*-scene-base.png` 为唯一身份来源，正面/左右独立制作，不水平镜像；饰物、背包、扣子等按人物解剖左右审核。候选素材在仓库外审核，只有批准目录会进入构建。动态图集能力与实际验收结果以角色文档和清单为准，不把静态回退称为完整动作。
Independent front/left/right art derives from the supplied scene originals and is never mirrored. Review anatomical accessory sides. Candidates remain outside the repository; only approved assets enter builds. Do not describe static fallback as completed animation.

`realistic-character-body.js`只把显式批准、尺寸及裁切有效的下半身资料组合到同一角色画布中；上身仍沿原组件的图像/眼发坐标绘制，不拉长半身图来冒充腿。缺资料、未批准或非法路径/矩形返回半身降级。椅子锚点和各层遮挡仍需逐角色逐视角看实际像素；`data-body-status`描述当前可用表示，不是全目录完成证书。最终人物位置与全景、腿脚可见性以最新浏览器和素材审查为准，不在此固定尚在校正的坐标。
The body helper composes explicitly approved, valid lower-body metadata onto one actor canvas. Original upper-art/motion coordinates remain unchanged; stretching a half-body image never substitutes for legs. Missing, unapproved or malformed data falls back to half-body. Chair anchors and layer occlusion require per-role/per-view pixel inspection. data-body-status describes the current representation, not completion of the entire catalog. Final placement and leg visibility require current browser/art review; this guide does not freeze coordinates still being adjusted.

本人采用第一人称视角，不在南侧额外放一个朝向镜头的本人正面小人。只有本人身份对应的 `view.pov`被明确批准，且PNG路径、源尺寸与裁切有效时才显示第一人称腿；缺失就不显示，不能借其他角色衣鞋或倒转正面图补齐。观众没有本人身份，南侧公开角色仍保留。`upperClipPolygons`使用原上身局部坐标联合裁切，必须至少三点且全部有限、在原上身范围内；它不是整幅画布坐标，也不改变脸及眼发动效原坐标。
Self uses a first-person view instead of an extra front-facing miniature at south. First-person legs render only from that identity's explicitly approved view.pov with valid PNG path, source size and crop. Missing data stays absent rather than borrowing another role's clothing or rotating front art. Spectators retain the public south actor. Upper clip unions use upper-art local coordinates, require at least three finite in-bounds points and preserve original face/motion coordinates.

桌布使用局部CSS变量定义松石绿、午夜蓝、暖陶棕，`skin`只改变色彩、不改布局或游戏数据。后续新增背景、材质或人物，只扩展展示目录，不修改引擎。
Local CSS variables define jade, night and clay skins without affecting layout or game data. Additional artwork/backgrounds extend presentation catalogs rather than engines.

## 验证与发布 / Validation and release

专项：`tests/realistic-table-layout.test.js`（隐私、各席固定物理关系、四墙数量/固定垛位、旋转碰撞、格子适配）、`tests/realistic-table-perspective.test.js`（同一投影、相机及完整房间可达边界）、`tests/realistic-character-body.test.js`（已批准元数据、合法裁切与半身降级）、`tests/realistic-table-events.test.js`（区域目标与事件隐私）、`tests/realistic-table-ui.test.js`（编译真实Vue组件、指针/焦点/减少动态/清理）。这些不是浏览器像素验收。
Focused tests cover projection/privacy, four-wall counts/fixed slots/collisions, authorized presentation-frame baselines/cancellation, and real compiled Vue lifecycle behavior. They are not browser pixel acceptance.

本地浏览器预览沿用隔离 `tests/browser/stable-table-preview-server.mjs`，API全部拒绝，只有本机显示控制/选牌可用。实际浏览器是否通过、素材动作是否完成以及最终全量测试、main SHA和Site版本，必须以最终验收记录为准。未通过的项目不能标记完成或发布。
The isolated preview rejects all API actions. Final acceptance must separately record actual browser evidence, media completion, full checks, remote main SHA and Site version. Failed/unverified stages are never labeled completed or published.

## 先前体验版范围与后续工作 / Earlier playable scope and subsequent work

此前2026-11-09用户明确选择先发布不含人物伸手动作的版本，并要求继续制作动作。该先前版本包括二维桌面、四方牌区、当时的固定手牌、拖动回正、桌面飞牌、18个独立角色视角和眼发局部动态。所有 `view.action` 仍为null；失败的手部候选不进入仓库或构建。人物摸打碰杠的伸手序列另行验收、另行发布，不把已有飞牌或眨眼称为人物伸手动作。
On 2026-11-09 the user chose a playable release without character reaching motions while that work continues. That earlier version included table presentation, the then-fixed controls, tile flights,18 independent views and local eye/hair motion. All view.action entries remain null. Rejected hand candidates never enter source/builds; reaching sequences require separate acceptance and publication.

本机弹层维护模块为 `src/realistic-popover.js`（及同名测试）：原生API显式打开既有DOM；缺API时退回固定面板并支持关闭、Esc及外部点击。浏览器回归保留真实原生路径证据，不能把代理读取不到方法误称浏览器不支持。
Local overlays use realistic-popover.js and its tests: explicitly open the existing native DOM, with dismissible fixed panels when APIs are absent. Browser evidence verifies the native path; limited proxy introspection is not proof of missing browser support.

### 桌内操作回归 / On-table control regressions

`tests/invitation-copy.test.js`编译真实组件，验证花麻将schema1/2/3及成都反复切换时原节点不复制、选牌不丢、观众/离桌撤下私有内容，并从桌内原按钮走原mutate请求。传输被替换为合成响应，不冒称真实服务端验收。出牌须选牌确认，成都换三张/定缺、接炮/抢杠、断网与重复点击守卫均保留。`ui.test.js`的积压音频替身必须在clear时完成取消，避免永不resolve的假Promise占住Node Web Lock并污染后续测试。
The real-component patch tests cover repeated switches across Flower schemas 1/2/3 and Chengdu, preserved node/selection identity, spectator/departure withdrawal and original mutate requests from table controls. Mock transport is not server acceptance. Selection/confirmation, Chengdu preparation, claims/rob-kongs, offline and repeated-click guards remain. Backlog audio mocks must finish on clear instead of leaking a Node Web Lock through an unresolved promise.

隔离预览新增“本人座位”可见选择器。`stableTableSeatSnapshot`仅复制虚构私有手牌给指定席位，不旋转公开座位、不读取对手手牌；换到其他席位时清空合成合法动作，观众保持无私有牌。它用于几何/隐私观察，不证明另一席位真实可操作。原API封锁仍保留。
The isolated preview adds a visible viewing-seat selector. Its helper copies only an invented private rack to that seat, preserving public seating and never reading opponent hands. Other-seat actions are cleared; spectators retain no private rack. This is geometry/privacy inspection, not proof of another seat's actionable authority. API blocking remains.
