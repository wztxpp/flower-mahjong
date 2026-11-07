# 建房参数与样式验收 / Room settings validation

## 范围与基线 / Scope and baseline

本次从 `64a04e3` 开始，在独立 `feature/room-settings` 分支完成。把胡后自动打出和大单吊喜钱前置到建房表单，与人数、副数和神龙门槛一起保存；统一米色/墨绿控件、帮助文字、错误和窄屏布局。没有修改三个规则引擎、计分公式、媒体资产、数据库迁移或依赖。
This change starts at `64a04e3` on the isolated `feature/room-settings` branch. Auto-discard and ready-bonus choices now join the three existing creation settings. Cream/jade controls, help, errors and narrow layouts share one form system. Engines, scoring formulas, media, migrations and dependencies are unchanged.

## 保存与兼容 / Persistence and compatibility

- 新桌完整保存 `playerCount/deckCount/dragonStartCount/autoDiscardAfterHu/bigSingleReadyPoints`，默认仍是 `3/2/6/true/50`。显式 `false` 和 `0` 不被默认值覆盖。创建、首局和续局均由服务端校验、保存和读取。
  New rooms save all five fields with unchanged defaults. Explicit false/zero survive validation; the server owns creation and subsequent game snapshots.
- 已保存字段优先于旧客户端的开局选项；新界面开局只提交空 `options`，房间内只读展示。缺少一项或两项字段的旧房仍保留相应每局草稿，不回填旧房、旧局或历史。
  Saved fields override valid legacy start options. New UI starts submit empty options and show a read-only recap. Missing legacy fields retain their per-round drafts without retrofitting rooms, games or history.
- 建房参数在清理旧会话和等待身份请求前复制。重复点击不重复创建；明确失败不自动重试，保留本次关闭开关/自定义金额供用户重试。加入和观战不提交创建设置。
  Creation copies the settings before reset and asynchronous identity setup. Repeated clicks do not duplicate requests. Explicit failures retain the draft without automatic retries; join/watch requests omit creation settings.

## 自动检查 / Automated checks

- `npm test`：930 通过，0 失败、跳过或待办。 / 930 passed; no failures, skips or todos.
- `npm run lint`：0 错误，4 条既有警告，位于 `server/worker.js`、`shared/game.js`、`tests/rob-kong.test.js`。 / No errors; four existing warnings in the listed files.
- `npm run build`：通过；生产客户端产物为 `index-DCJ-ejNh.js` 和 `index-egqa7VHT.css`。 / Production build passed with the listed client assets.
- `git diff --check`：通过。 / Passed.

专项覆盖放在现有 `tests/ui.test.js` 和 `tests/variable-room-api.test.js`：五项创建默认/非法值/范围边界，false/0，自定义金额，身份请求期间快照，重复点击与明确失败，固定规则首局/续局，部分旧房字段，恢复和归档，房主/非房主/观众权限，观众无私有手牌。旧房开局用例仍在 `tests/api.test.js`；展示和观战预期明确区分新房固定默认与旧房每局草稿。全部回归包括现有旧版本引擎测试，但本次未修改其代码。
Focused cases extend the existing UI and API suites, covering defaults, invalid/range edges, false/zero, custom values, async snapshots, duplicate/failure handling, first/next starts, partial legacy fields, restore/archive and role/privacy boundaries. Existing legacy-start and frozen-engine regressions remain included; those engines were not edited.

## 真实浏览器验收 / Real-browser acceptance

使用本地生产构建、真实 API 和仅含合成数据的 MemoryStore。隔离服务基于现有浏览器测试助手，视觉验收时移除了助手额外插入的调试文字层，避免该层影响页面宽度；应用产物未改写。未连接正式牌桌，验收服务已停止。
The production build ran locally against the real API and a synthetic-only MemoryStore. The isolated helper's injected debug text overlay was removed for layout measurements; application assets were unchanged. No production rooms were accessed, and the test server was stopped afterward.

- 桌面 Chromium：1180px CSS 视口，页面可用宽度和滚动宽度均为 1165px。检查五项参数、单位、开关、选项模式及一致样式；表单字体 16px，主要控件至少 48px 高。
  Desktop Chromium at a 1180px CSS viewport had matching 1165px client/scroll widths. All five controls, units, switch and entry modes were inspected; form controls use 16px text and primary controls are at least 48px tall.
- 窄屏 Chromium：普通浏览器缩放 300%，形成 393px CSS 视口，可用/滚动宽度均为 388px。440px 以下的单列布局已目视检查，数字、金额和开关无横向溢出。此项不是实体手机或移动 Safari 验收。
  Normal 300% browser zoom produced a 393px CSS viewport with matching 388px client/scroll widths. The below-440px single-column layout was visually inspected without horizontal overflow. This is not a physical-phone or mobile-Safari test.
- 实际输入 `-1`，显示金额错误并禁用创建；`0` 和 `100000` 可接受。神龙门槛超过牌数显示提示。键盘空格能切换胡后自动打出，焦点可见；帮助和错误有对应的可访问性关联。
  Negative bonus input showed an error and disabled creation; zero and the maximum were accepted. The unreachable dragon threshold showed a warning. Space toggled the switch with visible focus; help/errors have linked accessibility semantics.
- 创建/加入模式切换保留已填草稿；使用合成身份成功创建 `4人/2.5副/9张/关闭/0分`，房内只读摘要和刷新后结果一致。玩法说明正确显示建房固定及当前 0 分，不再宣称新房可以每局修改。
  Entry-mode changes retained draft values. A synthetic user successfully created a 4-player, 2.5-deck, 9-tile, manual/zero-bonus room. The read-only recap survived refresh, and rule help correctly described creation-time settings and zero points.

首局/续局的固定值和旧房兼容由真实 API 与 Vue 自动测试覆盖，本次浏览器没有打完整牌局。没有进行实体设备、读屏软件、系统强制色彩、生产部署或完整项目类型检查；不得把这些列为已验收。
Real API and Vue tests cover first/next-game immutability and legacy behavior; this browser pass did not play a whole game. Physical devices, screen-reader software, OS forced colors, production deployment and a full project typecheck were not performed.

## 发布状态 / Publication status

仅本地实现与验收，未推送、合并或部署。发布需要单独明确授权并遵循 [发布流程](RELEASE-WORKFLOW.md)。
Implemented and verified locally only: no push, merge or deployment. Publication requires separate explicit authorization and the release workflow.
