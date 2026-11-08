# 紧凑牌桌与下一局选择验收 / Compact table and next-round checks

基线为 `f7adf21590e8592351fd6ee51a8c022ae5b76236`。只修改客户端展示、弹层生命周期、测试和文档，不改服务器规则、计分、建房参数或角色资源。
Baseline: the commit above. Changes affect client presentation, dialog lifecycle, tests and documentation only; server rules, scoring, room settings and character assets remain unchanged.

## 高度量测 / Height measurements

真实 Chromium 中以相同合成普通牌局比较：每人一组公开牌、花麻将一次胡牌、十三张共享萝卜及每席十八张牌河。使用原 Vue 模板/CSS，真实 iframe 宽度为1280、390、320px，高760px。
Real Chromium measurements use identical ordinary synthetic snapshots, the real Vue/CSS and actual iframe widths, not screenshot scaling.

| 玩法 / Mode | 1280px 页面减少 / Page reduction | 390px | 320px |
| --- | ---: | ---: | ---: |
| 三人花麻将 / Three-player Flower | 186px | 160px | 160px |
| 四人花麻将 / Four-player Flower | 231px | 212px | 212px |
| 成都 / Chengdu | 191px | 190px | 190px |

花麻将手牌操作面板由531px降至456px（桌面）、576至520px（390）、596至540px（320）；成都457/445px降至386px。角色图、手牌尺寸、常规公开牌/账本容量不缩小。牌河标题与条数删除，但原牌河容量和完整记录保留。
Flower hand/action panels shrink by75px on desktop and56px on phones; Chengdu by71/59px. Character images, tile dimensions, ordinary public-card/ledger capacity and complete river records are retained.

## 浏览器覆盖 / Browser coverage

- 17组配置、221次阶段切换通过：三/四人花麻将、成都、两个旧版本和两种观战在桌面/390px，另三种玩家模式320px。固定手牌位置、页面尺寸、回看位置保持和长内容末端可达均通过。320px三种模式从实际非零页面滚动位置1368/2045/2898px开始审计。
- 21组操作栏测量：所有可容纳的单/多按钮组距操作栏内右缘4px；按钮高度44px。普通成都四回应在320和390px不再横滚；超长花麻将动作从左4px开始且原生横滚，实际方向键到达末端。
- 两玩法结束弹层在1280/390/320px均完整位于视口内，两个主按钮44px高。最窄屏无弹层内部滚动。关闭看结算、房主继续和返回大厅入口保留。
- 成都320px普通接牌提示实际 `clientHeight=scrollHeight=64px`，不再产生常态竖向滚条；被打出的原尺寸牌、来源人和可访问等待描述均保留。

Seventeen configurations and221 stage changes passed. Twenty-one action-row samples confirm right alignment and overflow origin. Actual arrow-key scrolling reaches the end of a long action group. End-choice dialogs fit all three widths in both modes. Detailed numeric evidence is in `compact-table-browser-20261108.json`.

## 自动与独立审查 / Automated checks and review

- 最终 `npm test`：1416/1416通过，无跳过。
- `npm run build`通过。`npm run lint`为0错误、3条既有警告，另有已有Next pages目录配置提示。
- 下一局专项使用实际编译组件/处理函数：自动提示仅同局现场结束一次，首次加载/重连已结束局不重复弹；仅房主能按原流程开局；观众手动弹层经完整轮询保持、无开局权限；忙碌防重复请求，失败/未知结果留层内；ESC、焦点圈和焦点恢复有回归。
- 独立只读审查发现的大厅样式范围、忙碌失败后容器焦点、观众轮询关闭三项均已修复并复核。

Final tests:1416 passed, build passed, lint has no errors and three pre-existing warnings. Independent review findings were fixed and regression-tested.

## 范围与限制 / Scope and limits

浏览器是阻止全部API的纯视图合成夹具，没有真实房间或玩家动作；没有实际发起新局或离席请求。弹层键盘、权限、请求重复和失败路径由组件模拟测试覆盖，不冒称浏览器端到端联机通过。没有实体手机/触摸设备验收。长牌河、完整手机手牌、超长动作/姓名/历史继续允许具名可聚焦局部滚动，未裁掉数据。保留固定空槽以避免打牌中跳动，因此并非所有状态都零留白。
The browser fixture blocks all APIs and submits no real game actions. Dialog event/permission/failure behavior is covered by component simulation, not a live multiplayer end-to-end claim. No physical phone/touch testing was performed. Long content remains accessible through local scrolling; stable reserved slots intentionally retain some empty space.

一次源码仍在编辑时的预览动作样本丢失DOM，已排除；代码稳定后刷新重新完成21组。原始量测记录明确保留该范围说明。截图仅用于目视检查，不包含在报告或备份中。
One action run lost its DOM during active editing and was excluded; a fresh stable-code run completed all21 samples. Screenshots were used only for visual inspection and are not included in reports or backups.

## 发布前焦点时序补丁 / Pre-release focus timing patch

独立发布审查发现关闭watcher早于DOM提交恢复旧入口，新局同tick移除它后焦点落回body。补丁将恢复移动到nextTick之后，并保留epoch/弹层接管、连接与禁用守卫。新增三项真实Vue renderer调度回归：新局移除入口、同tick禁用入口、另一弹层接管。独立复核仅在内存换回58dbf87旧App时三项全部失败，修复后全部通过；没有靠预先断开测试节点掩盖时序。
Independent release review found that restoring before the DOM flush could focus a soon-removed trigger. Restoration now follows nextTick with epoch/modal-ownership and connected/enabled guards. Three real Vue renderer regressions cover removal, same-tick disabling and replacement-modal takeover; all three fail against the old App and pass after the fix.

补丁最终全测1419/1419通过，无跳过；build通过，lint0错误/3条既有警告。本补丁不改模板/CSS/玩法，未重新声称浏览器联机验证。
Patch verification:1419/1419 tests passed without skips, build passed, and lint reports no errors and three existing warnings. The patch changes no template, CSS or game behavior and makes no new live-browser multiplayer claim.
