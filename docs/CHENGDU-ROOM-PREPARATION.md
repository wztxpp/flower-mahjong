# 成都开房与房间准备 / Chengdu room preparation

**当前本地状态 / Current local status:** 成都正式schema2、独立引擎、HTTP生命周期和专用牌桌已整合；本文其余准备版/媒体阶段描述保留历史时点。最新行为与测试见 [成都牌桌界面](CHENGDU-PLAY-INTERFACE.md)、[房间后端](CHENGDU-ROOM-BACKEND.md)及 [正式集成验收](CHENGDU-PLAY-VALIDATION.md)。这不代表已发布。
Production Chengdu schema2, independent engine, HTTP lifecycle and UI are now locally integrated. Earlier preparation/media-only statements below are historical. Follow the linked current guides/validation; local integration does not imply deployment.


## 当前范围 / Scope

基于 `fa7c82c`，分支 `feature/chengdu-room-ui`。本地实现，未发布。这是建房与联机准备界面，不是完整成都麻将。没有注册可运行成都引擎，不发牌，不执行换三张或定缺，不计分，不启动未确认玩法。
Based on fa7c82c on feature/chengdu-room-ui, locally implemented without publication. This is room creation/network preparation, not playable Chengdu. No runnable engine, dealing, exchange/dingque actions or scoring is enabled.

- 大厅选择花麻将或成都准备房间，两份草稿独立。成都固定四人、27种×4张共108张、必须定缺。 / The lobby chooses Flower or Chengdu preparation with independent drafts; Chengdu fixes four seats, 108 tiles and dingque.
- 明确选择首胡结束/血战到底、换三张开/关、自摸加底/加番、4/5/6番封顶。四项无默认，未选择时不能创建。 / Explicit ending, exchange, self-draw and cap choices, with no invented defaults.
- 建房保存平铺快照 `{playerCount, dingque, endCondition, exchangeThree, selfDraw, fanCap}`。其他模式字段、未知键、错误类型、非四人或关闭定缺都拒绝。 / Creation saves a flat allowlisted snapshot; invalid types/keys and Flower settings reject.
- 房间共享原凭证、座位/房主、角色偏好、邀请、离席、重连与观战。角色仍只在正式开局分配，现在显示的是偏好预览。 / Existing identities, seats/host, preferences, invitations, leave/reconnect and spectating are reused; roles are still assigned at actual game start.
- 成都房间显示建房快照和明确的“暂不能开局”，不出现花麻将神龙、萝卜、喜钱或专属碰杠规则。 / Chengdu shows saved settings and explicit unavailability, never Flower-only rules.

## 双重开局闸门 / Start gates

`server/game-engines.js` 的成都房间策略使用 `currentEngine: null`、空 `engines`，不声明 schemaVersion/legacySchemaVersion。`publicRoom.rulesVersion` 明确为 null，`game` 保持 null。
The room policy has a null current engine and empty versions, with no invented schema/legacy version. Public rulesVersion and game remain null.

UI 的 `canStart` 对成都恒为 false；直接调用 mutate(start) 也不发请求。HTTP `/start` 先保留原房主/人数/版本校验，然后在 `startRules` 抛 `GAME_MODE_UNAVAILABLE`，发生在绑定档案、归档、发牌与保存之前。直接调用其他创建/庄家/配置入口也拒绝。
The UI disables Chengdu start and programmatic mutate(start). HTTP preserves authorization/occupancy/revision checks, then rejects in startRules before profile binding, archival, dealing or persistence; direct creation/dealer/config entries also reject.

`engineFor` 对任意成都保存局/版本继续拒绝；这也保护历史、动作、观战投影，不会因版本号碰巧相同而用花麻将。开发 `createDevelopmentGame` 不经过HTTP暴露。未来启用需要完整独立适配器、隐私与结算验收，不应只删除按钮禁用条件。
All saved Chengdu games/versions still reject through engineFor, protecting actions/history/spectator projections from Flower fallback. Development creation is not exposed via HTTP. Enabling play requires a complete independent adapter/privacy/settlement validation, not merely enabling the button.

## 兼容与可访问性 / Compatibility and accessibility

旧花麻将创建请求继续省略 gameMode；旧桌不回填字段，三代引擎未改。加入/观战不发送配置，不改变房间模式。前端在异步请求前固定模式与参数；重复点击不重复创建，失败保留选项，迟到响应不重开已经离开的页面。
Flower requests still omit gameMode and legacy rooms are not backfilled; all three engines remain unchanged. Joining/spectating sends no configuration. Async submission captures mode/settings; repeated clicks are single-flight, failures retain choices and stale responses cannot reopen departed pages.

使用原生带 label 的 select、必填语义、fieldset禁用、帮助关联、可见焦点、状态提示和窄屏单列。成都规则弹窗独立于花麻将说明，共用原有关闭、Escape与焦点生命周期。
Native labeled/required selects, disabled fieldsets, associated help, visible focus, status messages and a narrow single column preserve accessibility. Chengdu rules help uses the existing dialog close/Escape/focus lifecycle.

## 验证 / Verification

- `npm test`：1043/1043通过，含新增5项房间测试（其中遍历24种配置）与4项真实Vue编译/SSR/交互测试。花麻将三代引擎、既有角色/媒体/观战与模式逐步差分测试继续通过。 / All 1043 tests pass, including five room cases (24 combinations) and four real-component UI cases plus all prior regressions.
- `npm run lint`：0错误，4个原有警告（worker匿名导出、game两个未使用变量、rob-kong测试一个未使用助手）。 / Zero errors, four existing warnings.
- `npm run build`：通过，生成本地Vue/Worker产物，不是发布。 / Local Vue/Worker build passes; this is not publication.
- 真实Chromium桌面：已验证四项必选/禁用、选择完可创建、花/成都往返保留选择、角色偏好、成都建房成功、四席空位布局、固定配置回显、开局按钮禁用。 / Real desktop Chromium verified required choices, readiness, mode round-trip preservation, preference preview, creation, four-seat waiting layout, saved choices and disabled start.
- 真实浏览器未完成：四位同时落座、观战进入/退出、刷新与Back/Forward、窄屏/触屏、语音试听。相关API/模拟UI测试通过不能替代这些真实浏览器项目。 / Full four-player occupancy, spectator entry/exit, reload/history, narrow/touch and audio checks remain unrun in a real browser.

浏览器检查使用独立MemoryStore测试服务。新第4页导航因自动审核无法应用授权而明确未执行，未重试；按父任务要求停止浏览器检查、关闭本次测试页并结束测试服务。早期headless Chromium也因运行环境socket/ptrace限制未启动成功，不计为浏览器通过。没有生产请求、迁移、push、合并或部署。
Browser work used an isolated MemoryStore. A fourth-page navigation did not execute because automatic approval could not apply the authorization; it was not retried. Browser work, created tabs and test services were stopped. Earlier headless launch attempts failed on socket/ptrace runtime restrictions and are not counted as passes. No production requests, migrations, push, merge or deployment occurred.

浏览器验收使用 `index-Sn1mUIMv.js`；之后补了大厅成都文案/万牌装饰和状态/请求代码可读性整理，最终 `index-NM8_Gen7.js` 重新跑完上述自动检查，但没有继续真实浏览器复测。配置截图保存在工作区 `chengdu-config-qa.png`（不纳入源码）；它证明当时配置面板，不是移动端或整局验收。
Browser checks used index-Sn1mUIMv.js. Later lobby copy/wan decoration and readability edits produced index-NM8_Gen7.js, which passed the final automated checks but was not rechecked in the browser. The workspace screenshot records that configuration panel, not mobile or full-game acceptance.
