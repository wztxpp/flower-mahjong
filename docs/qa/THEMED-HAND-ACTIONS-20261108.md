# 无框手牌与右上操作验收 / Frameless hand and upper-right action acceptance

基线为 `58d45d2ebcd9fb70a45e5e30ac223e18e2fab7fd`。本轮只改展示模板、样式及测试/文档，两份SFC脚本、原42个事件节点的处理器/禁用条件、规则、网络、头像和动画资源均不变。没有推送或部署。
The baseline is the commit above. This change is presentation-only: both SFC scripts, all42 original event-node handlers/guards, engines, transport and media remain unchanged. No push or deployment was performed.

## 结果 / Results

- 两玩法手牌底框、阴影与底色移除；实际牌组能容纳时居中，超宽时从可达起点横滚。回合提示和动作在手牌上方右侧的常驻普通流区域，不覆盖牌。七角色分别使用原画对应配色，待机不重复显示等待文案。
  Both modes remove rack decoration, center fitting hands, and preserve reachable overflow. A persistent normal-flow upper-right dock keeps prompts/actions above tiles, with seven artwork-matched palettes and no repeated idle prose.
- 本人摸打、他家接炮、抢杠、胡后必胡、成都换三张/定缺及观战/退出边界保留；提示条件不包裹合法动作。触控按钮至少44×44px，键盘焦点可见。
  Own turns, out-of-turn claims, rob-kong, mandatory wins, Chengdu preparation and spectator/retirement boundaries remain. Prompt conditions never gate actions; buttons retain44×44px targets and visible focus.
- 与基线比，花麻将本人手牌/操作面板桌面456→420px，390px屏520→502px，320px屏540→522px；成都386→316px桌面、386→356px手机。固定空槽仍保留，避免轮到本人或接牌时跳动。
  Flower's own panel saves36px desktop and18px at both narrow sizes; Chengdu saves70px desktop and30px narrow. Empty slots intentionally remain stable across turns.

## 验证 / Verification

- 最终独立执行 `npm test`：1430/1430通过，无跳过；`npm run lint`：0错误、3个已有警告及原Next pages提示；`npm run build`、`git diff --check`通过。
  Final independent tests passed1430/1430 without skips; lint had zero errors and three existing warnings plus the existing Next pages notice; build and diff checks passed.
- 真正Chromium浏览器编译生产Vue模板/CSS；1280/390/320px下三/四人花麻将及成都，加旧schema1/2和两玩法观战，共17组。221次阶段切换、34次牌河回看保持检查及长记录末端可达均通过，最大被测几何/滚动位置差为0px。
  Real Chromium rendered production Vue/CSS across17 mode/width/compatibility configurations. All221 stage transitions,34 river-position retention checks and long-content reachability checks passed with0px maximum measured geometry/scroll delta.
- 另39个动作/手牌画面覆盖等待、摸打、接炮、抢杠、短手牌、多暗杠及成都准备；所有按钮在牌面上方，能容纳的牌组中心偏差0px，页面横溢和手牌额外竖滚均为0。两玩法320px普通四回应无需横滚。
  Another39 snapshots covered idle/turn/claims/rob-kong/short hands/multiple kongs/preparation. Buttons stayed above tiles; fitting lists centered exactly with no page overflow or extra vertical hand scroll. Ordinary four-response groups fit both modes at320px.
- 七角色×两玩法14组实际主题渲染检查，均保留四回应及44px下限；CSS对比度专项覆盖主渐变两端、次按钮与中性兜底，达到4.5:1。
  Fourteen actual role/mode renders retained four responses and44px targets; contrast tests cover both gradient endpoints, secondary surfaces and fallback at4.5:1.
- 实际键盘左右键验证：花麻将320px手牌滚动0→392→0，成都0→468→0，首尾牌完整可见；长动作组末按钮也可达。保留焦点轮廓是无障碍反馈，不是装饰托盘框。
  Actual arrow keys reached both hand ends: Flower0→392→0 and Chengdu0→468→0 at320px, with full end tiles; the extended action group's final control was reachable. Focus outlines are accessibility feedback, not restored rack decoration.
- 独立代码复核确认两个脚本字节不变、42个事件节点契约不变；专项248/248及额外12个SSR场景通过，最后窄屏/夹具增量62/62通过。
  Independent review verified unchanged scripts/event contracts,248 focused checks and12 additional SSR scenarios, followed by62 final narrow-layout/fixture checks.

机器可读摘要与受测源文件SHA见 [浏览器记录](themed-hand-actions-browser-20261108.json)。所有牌局均为无凭证合成数据；客户端、预览服务端和动作入口封锁真实API。跨不同fixture case重挂只用于开始独立测试；同case阶段审计保留原DOM。中途热更新的未完成运行不计入通过结果。
The linked report records measurements and source hashes. All snapshots were synthetic and credential-free; client/server/action boundaries blocked real APIs. Case changes remount only independent fixtures; same-case audits preserve DOM. Interrupted hot-reload runs are excluded.

## 范围与限制 / Scope and limits

未验证实体手机触控、Safari/Firefox或真实多人网络对局。本轮没有点击任何真实出牌/开局。超长手牌与多个暗杠动作仍保留具名原生横滚，不缩小牌或裁掉内容；状态/反馈固定占位不因为空而消失。
No hardware-phone touch, Safari/Firefox or live multiplayer verification is claimed. No real game action was submitted. Long hands and extended kong groups retain named native scrolling rather than shrinking or clipping content; stable status/feedback capacity remains even when empty.
