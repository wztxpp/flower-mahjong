# 角色落座与独立画框验收 / Seated identity and standalone portrait validation

## 范围与基线 / Scope and baseline

基线为已发布v27的main提交 `c75dadef8ecf68abad76560d5dd89f08a4bf93d3`，本地分支 `work/refine-portrait-seats`。本次仅本地修改及验证，未push、合并或部署。
The baseline is the published v27 main commit, on the stated isolated local branch. This revision has not been pushed, merged or deployed.

- 主角不再作为手牌背景。花麻将和成都的真实手牌仍在桌面，主角独立figure以普通文档流排在手牌操作区下方，保持1254/1050原图比例。
  Own art is no longer a hand background. Both modes retain cards on the board, followed by a separate normal-flow figure at the source ratio.
- 对手框从旧92–124px横条改成桌面240–340px、手机180–240px高画框；成都增加相同独立对手图。原21张PNG、表情及声音文件未改。
  Opponent frames grow from old short strips to tall responsive frames; Chengdu receives the same separate opponent art. The 21 PNGs, reactions and audio bytes are unchanged.
- 修复根因：原大厅只显示偏好/默认图，start又调用随机分配。现在创建/加入时将实际characterId存入占座记录；start/续局只复制到gameMeta.characters。新来者偏好被占用时选剩余角色，不重抽已落座者。
  The old lobby preview was not persisted and start assigned again. Occupancy now saves the actual role, which starts only copy to the round snapshot. Conflicts allocate an unused role to the newcomer without rerolling seated players.
- 旧局角色快照、规则/算分/隐私不改；旧大厅确定性恢复缺失角色，合法写入时固定。结束后替补身份与原游戏/观战身份分开。
  Existing round mappings, rules/scoring/privacy stay unchanged. Legacy lobbies derive stable missing roles until an authorized room write persists them. Replacement and original game/spectator identities remain separate.

## 自动检查 / Automated checks

所有源码冻结后完整复验：
Final aggregate verification after source freeze:

- `npm test`：1205/1205通过，无失败/跳过；含角色专项33项。
  All 1205 tests passed with no failures/skips, including 33 assignment cases.
- `npm run lint`：0错误、4条基线warning（Worker匿名导出、game.js两个未用变量、rob-kong.test.js未用辅助函数），保留原pages目录提示。
  Zero errors, four baseline warnings and the existing platform pages-directory notice.
- `npm run build`：Vue客户端与Worker本地生产构建通过。
  Vue client and Worker local production builds passed.
- `git diff --check`通过；只有后续验收文档增补，不再修改源码。
  Whitespace checks passed; subsequent edits only finish this validation document.

专项覆盖：原批量分配公平性接口、落座保存、偏好冲突、三/四人花麻将与四人成都、刷新/断开恢复、FileStore重启、合法终局后下一局、并发加入/开局、旧映射及替补隐私；真实Vue渲染/AST覆盖独立主角次序、双方高画框、观战隐藏、三版本与成都操作守卫。CSS断言覆盖只动图片及减少动态偏好。
Focused cases cover assignment compatibility, seated persistence, conflicts, both modes/counts, reconnect/restart, legal next rounds, concurrency, legacy mappings and replacement privacy. Compiled Vue/AST tests cover independent art ordering, tall frames, spectators and action guards; CSS assertions cover image-only/reduced motion.

## 真实浏览器 / Real browser

使用 `tests/browser/portrait-preview-server.mjs` 的隔离MemoryStore与实际App；390px由真实iframe触发断点。只创建合成测试身份/牌局，不接触线上房间、凭证或数据。
QA uses isolated MemoryStore and the actual App, with a true 390px iframe for breakpoints. Only synthetic local players/rooms are created.

- 花麻将桌面实测对手框295px，390px iframe为187.19px；人物清晰。
  Flower frames measured 295px desktop and 187.19px narrow, with clear faces.
- 主角figure位于手牌下方，间距桌面18px/手机12px；图片position:static，操作区没有角色背景或遮罩。页面不横向溢出，桌面实际选牌/出牌通过。
  Own art follows the hand with 18px/12px gaps, static image positioning and no hand background/overlay. No global horizontal overflow; desktop selection/discard passed.

- 花麻将390px实际滚动手牌到右侧7筒、选牌并确认出牌成功，14→13张，牌河/动态同步；横向滚动只发生在手牌内部。
  Flower narrow QA scrolled to and discarded seven dots, reducing 14 to 13 tiles with matching public river/history; horizontal scrolling stayed inside the hand.
- 冻结后重启预览服务，成都四席大厅→开局→刷新维持地主/女明星/富婆/小桃，没有重抽。
  After restarting with frozen source, Chengdu retained all four roles across lobby, start and reload.
- 成都桌面/390px三位对手框实测295px/187.19px，主角在手牌下方18px/12px间距，无页面横向溢出，脸部清楚。
  Chengdu desktop/narrow frames measured 295px/187.19px, with own art 18px/12px below controls, clear faces and no global overflow.
- 成都390px通过真实手牌滚动选2/3/4万并确认换三张，显示已提交并禁用后续选择。
  Real narrow Chengdu selection/scrolling submitted two/three/four characters for exchange, then showed committed status and disabled further selection.
- 截图在浏览器工具结果中留证，未保存为持久文件或对外附件。减少动态没有可用单页模拟能力，未切换系统/浏览器全局设置；此项仅源码自动断言通过。
  Screenshots were emitted in browser tool results, not persisted as files/attachments. Per-page reduced-motion emulation was unavailable; global settings were not changed, so that preference has automated-source coverage only.

- 冻结后重启的花麻将随机落座→开局→刷新保持富婆/小桃/晴禾；成都四席也全部采用随机偏好。偏好冲突组合通过自动测试，不冒充浏览器穷举。
  Fresh frozen-source Flower random assignments stayed wealthy/sweet/sunny across lobby/start/reload. Chengdu also used random preferences; conflict combinations have automated, not exhaustive browser, coverage.
- 两模式验证完成，隔离服务已Ctrl+C停止，并确认返回shell。未对线上发出写请求。
  Both modes completed acceptance; the isolated servers were stopped and shell return verified. No production write requests were sent.

## 验证边界 / Limits

不把自动检查或截图当作完整多设备/所有21态验收。未运行全仓TypeScript检查、线上写入、完整多人实机对局或人工语音试听。减少动态仅自动断言；未实机切换偏好。
Automation/screenshots do not claim exhaustive device/21-state coverage. No full-repository TypeScript check, production writes, full manual multiplayer match or subjective audio review was run. Reduced-motion has automatic assertions only, without manual preference switching.
