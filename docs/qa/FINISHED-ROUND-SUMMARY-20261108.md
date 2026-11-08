# 终局总览验收 / Finished-round summary acceptance

## 范围 / Scope

本轮在 `fe7f9ac` 的无框居中手牌与角色动作带候选上新增终局总览，未发布。真实数据和隐私合同见 [终局完整摘要](../FINISHED-ROUND-SUMMARY.md)。原有同桌再开、返回大厅、房主权限、单弹层和焦点恢复流程保留。
This adds a terminal overview on the frameless-hand/action-dock candidate, without publication. The linked contract defines authority and disclosure. Existing restart/departure, host permissions, single-modal ownership and focus restoration remain.

## 自动检查 / Automated checks

- 最终源码 `npm test`：1469/1469 通过，无跳过或失败。新增20项服务端专项及展示/组件/夹具回归，覆盖实际终局动作、读取、重连、FileStore重启、观战、替补、下一局、缺记录和跨局去重。
  Final source: 1469/1469 tests, no failures or skips. Server and presentation regressions cover actual terminal transitions, reads/resumes, restart, viewer/replacement roles, subsequent games, incomplete records and ledger deduplication.
- `npm run lint`：0错误，3条已有警告，位于 worker 默认导出、game 的 wasRepeat 和旧抢杠测试 passAll。`npm run build` 和 `git diff --check` 通过。
  Lint reports zero errors and three existing warnings. Production build and diff checks pass.
- 独立复核发现并修复：神龙每家付款字段接线、缺失旧参与者身份造成的部分累计、次要文字对比度、杠后接炮标签。复核无遗留问题；17场真实规则引擎终局及1809个进行中状态探针补充验证隐私门与精确手牌/积分。
  Independent review corrected dragon-field wiring, partial totals from missing historic identity, text contrast and a source label. Additional real-engine probes cover 17 terminal games and 1809 live states; no unresolved findings remain.
- 发布前追加审查修复了估计旧身份归档后被误计为可靠累计的问题。花麻将/成都原归档续局两项及重复顺序一项回归，修前均失败、修后均通过；独立原复现也通过。只增加摘要资格检查，不改规则、账本或任何前端文件，因此下述浏览器证据仍对应未变化的展示源码；没有将后端修复冒称为新一轮浏览器验收。
  A pre-release audit found estimated archival identity incorrectly treated as a reliable subsequent total. Two real-engine archival/next-round regressions plus duplicate-order coverage failed before and passed after the fix, as did the independent original reproduction. Only summary eligibility changed, not rules, ledgers or frontend files. Browser evidence below still targets unchanged display source; the server patch is not presented as a new browser run.

## 实际浏览器 / Actual browser

使用真实 Vue 模板/CSS 的隔离纯视图，服务端拒绝所有API，开局/离桌按钮不提交。全部姓名、牌和积分均为合成数据。可复现入口为 `tests/browser/stable-table-preview-server.mjs` 与 browser README；[脱敏测量JSON](finished-round-summary-browser-20261108.json)记录已测源码哈希和结果，不保存浏览器截图。
The isolated view compiles real Vue/CSS and rejects APIs and game mutations. All identities, cards and scores are synthetic. The browser README documents reproduction; the JSON records measured source hashes and results without screenshots.

- 35个终局配置：当前三/四人花麻将、成都、两代旧花麻将、两模式观战，1280/390/320px；另测560/420px短屏、长记录、缺字段和整体摘要缺失。全部弹框及底部操作在视口内，摘要内横向溢出0。
  Thirty-five configurations cover current/legacy modes, spectators, three widths, short heights, long/missing records. Dialogs and footer actions fit the viewport with no horizontal content overflow.
- 手机手牌自然换行；长记录仅在一个纵向区域滚动。320×420时长记录区域约150px高，底部操作终点386.19px；24条胡牌展开及20张副露可完整滚到末端。320px六位正负积分保持单行，未截断。
  Phone hands wrap naturally. At 320×420 the long-results body remains about 150px high with the footer ending at 386.19px. Expanded 24-win records and twenty-tile melds remain reachable. Six-digit signed scores fit one line.
- 两玩法实际键盘检查：Tab末端回首、Shift+Tab首端回末、Ctrl+End抵达最后玩家、Escape关闭并恢复原“下一局选择”入口。展开胡牌记录不覆盖底部操作。移动端按钮至少44px高。
  Actual keyboard checks in both modes confirm focus loops, end-of-content access, Escape and trigger restoration. Expanded details do not cover footer controls; action buttons retain at least 44px height.
- 四种玩家/观战场景各6步，共24次终局生命周期变化：关闭后轮询不重开、玩家现场结束提示、观众不自动提示、手动打开后同局轮询保留、新局清除旧摘要。
  Twenty-four transitions verify player/spectator prompt behavior, dismissal/polling, manual persistence and removal on a new game.
- 三/四人花麻将与成都×1280/390的6组行牌回归：78次阶段变化、12组牌河回看位置检查全部通过，牌桌/手牌/页面滚动量测差异最大0px；内容末端可达。
  Six live-layout cases pass 78 transitions and twelve river-retention groups, with zero measured geometry/page-scroll drift and reachable content ends.
- 源码冻结后复测全部受影响检查。探索时发现旧预览进程缓存和开发热更新重置合成页面，均重启/重载后排除，不作为产品故障或通过证据。
  A cached preview adapter and development hot reload were excluded, then affected checks were repeated on frozen source.

## 限制 / Limits

这是桌面 Chromium 的真实窄视口与键盘验收，不是物理手机触控、Safari/Firefox或真实多人联机验收。长终局信息有意保留一条纵向滚动条，320px两个主操作纵向排列。旧版没有可靠神龙明细、身份或分数时明确“未记录”，成都神龙为“不适用”。没有发布、真实玩家操作、规则/计分修改或手牌永久归档。
This is real desktop Chromium at narrow viewports, not physical touch-device, Safari/Firefox or live multiplayer acceptance. Long results intentionally retain one vertical scrollbar; 320px stacks primary actions. Missing legacy records stay unknown and Chengdu dragons are not applicable. No publication, live-player mutation, scoring change or permanent hand archive was performed.
