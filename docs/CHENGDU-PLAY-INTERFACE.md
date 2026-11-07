# 成都正式牌桌界面 / Chengdu production table interface

这是本地集成记录，不是发布记录。此前 [准备房间](CHENGDU-ROOM-PREPARATION.md) 记录的是7fb4ad6时点；本文件说明随后启用独立正式引擎时的界面变化。规则实现见成都引擎文档，HTTP及原子保存见 [房间后端](CHENGDU-ROOM-BACKEND.md)。
This records local integration, not deployment. The preparation guide is historical at7fb4ad6; this guide describes the subsequent production-engine interface. Engine docs own rules; the room-backend guide owns HTTP and atomic persistence.

## 文件责任 / Ownership

- `App.vue`仍负责身份、会话、房间邀请/离席/重连、单飞请求、错误同步、角色/声音与大厅个人记录。以保存的`gameMode`选择界面，成都schema2不能被当成花麻将v2。 / App retains identity, sessions, invitations, leave/reconnect, single-flight requests, uncertainty reconciliation, characters/audio and lobby history. Saved mode, not schema alone, selects the table.
- `ChengduTable.vue`只接收服务端过滤视图、阻断状态、下一局权限与只读角色函数。emit `action`交回原始合法动作，emit `start`请求下一局；不直接fetch、不判胡/算番、不猜对手手牌、不自动选择。 / The dedicated component receives filtered views, blocking/start permission and a read-only character resolver. It emits an original allowlisted action or start intent, never fetching, scoring, inferring hands or auto-selecting.
- `tests/chengdu-ui.test.js`编译真实SFC，验证选择多重集、动作白名单、同步禁用、定缺、退出、掩码、流局账目与座位映射。App两项整合回归留在`tests/ui.test.js`，邀请测试装载器显式包含新组件。 / The dedicated test compiles the actual SFC for multiset selection, allowlists, blocking, dingque, retirement, masks, draw ledger and seat mapping. App integration and invitation-loader coverage remain in their existing suites.

## 交互与隐私 / Interaction and privacy

换三张使用手牌下标区分相同牌。最多选择三张；确认按钮只在选择与服务端`exchangeThree`合法动作完全相等时启用，所以混花色或数量不符无法发送。他人准备动作只提升revision不会清掉本人未提交选牌；自己的手牌、阶段、局号或已提交选择改变才清空。提交后只显示本人收到的三张，不展示其他人换牌内容。
Exchange selections distinguish identical copies by index. At most three tiles can be selected and confirmation requires an exact server action. Other players' revision changes preserve unsubmitted selection; own hand/phase/game/submission changes reset it. Only own exchange receipt is displayed.

定缺按钮完全来自`legalActions`，不提前公开其他人的选择。行牌阶段选手牌后须确认出牌；胡、碰、明杠、暗杠、补杠、过也只显示服务器允许项。任何提交前再检查当前白名单和blocked。动作是纯JSON，复制时移除Vue响应式代理，防止structuredClone抛错。网络失败由App同步，不猜成功、不自动重放。
Dingque and turn controls come exclusively from legalActions. Discards need explicit confirmation. Every emission rechecks current allowlist/blocking; plain-JSON copying strips Vue proxies safely. App synchronizes uncertain outcomes without replaying actions.

观众和终局补位者使用引擎mySeat=null，不把房间you当成手牌权限。没有授权hand就不渲染本人区；null牌显示背面，隐藏日志不拼牌名。公开暗杠和终局自摸可见性由服务端正式投影决定，前端不补数据也不遮改已公开事实。胡过显示退出，合法动作为空；不会套花麻将“胡后固定/继续胡”说明。
Spectators/replacements rely on engine mySeat=null, never room-slot identity for hand access. Missing hands are not rendered; null tiles stay backs and hidden logs omit names. The production projection owns exposed kongs/final self-draw visibility. Retired winners never inherit Flower post-win behavior.

## 方向、布局与开局 / Direction, layout and start

本人位于下方，+1左、+2对、+3右，即屏幕顺时针[0,1,2,3]。摸打逆时针0→3；换牌方向来自本局快照。900px以下两列、560px以下单列；原生button/select保持键盘语义，选牌用aria-pressed，状态用polite live区域，按钮最小44px且有焦点描边。手牌横向滚动，不压缩点击区。
The viewer sits at bottom, with +1 left/+2 opposite/+3 right: clockwise[0,1,2,3]. Turns run counterclockwise0→3 and exchange direction comes from the snapshot. Responsive grids, native controls, pressed states, polite status,44px targets/focus outlines and horizontally scrollable hands preserve accessibility.

成都只在服务端公开rulesVersion=2时允许满员房主开局。旧准备服务端的null继续拒绝；房主/阶段/人数与服务端CAS仍独立验证。成都start发送空options，不发送花麻将喜钱/自动打出或媒体屏障字段。角色分配复用房间，声音只消费已提交事件；花麻将飞牌DOM不应用到成都组件。
Chengdu starts require server rulesVersion2 and a filled-table host; legacy null servers stay gated. Server authorization/CAS remains independent. Start sends empty options without Flower settings/media protocol. Characters reuse room allocation and audio consumes committed events; Flower flight DOM is not reused.

## 历史文案 / History prose

`src/chengdu-event-text.js`为牌桌和大厅个人记录共用的纯文本格式器。它只接受已投影的事件、所属单局名册与公开付款记录，不读取当前房间，隐藏牌不恢复，任意message/text不回显。界面用普通插值自动转义昵称。
The shared plain-text formatter serves live tables and personal history using projected events, that round’s names and public payments only. It never reads the current room, restores hidden identities or echoes arbitrary text; Vue interpolation escapes names.

## 验证边界 / Verification limits

界面专项182/182通过，包括13项组件/文案与4项App新测试。模拟浏览器/SSR不证明真实屏幕布局、多人浏览器同屏或音频听感。此前实际浏览器只验过准备版建房；先前停止浏览器的指示继续有效，本次没有重启浏览器或隔离服务。最终全量、lint、build与提交号见集成完成报告。未发布。
182 frontend-focused checks pass, including13 new component/prose and4 App tests. SSR/mocks do not establish actual layout, multi-browser behavior or listening quality. Prior real-browser evidence covered preparation-only creation; the prior stop instruction remains honored and no browser/service was restarted. Final aggregate checks/commit are reported at integration completion. Not deployed.
