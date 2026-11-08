# 场景立绘满框验收 / Full-frame scene validation

## 范围 / Scope

基线：GitHub main `71103a674a46199e3783a6b7c0332a446dae9660`。独立工作分支 `work/fill-character-frames`；未推送、合并或部署。
Baseline is the stated main commit, on an isolated local work branch. No push, merge or deployment was performed.

- 七组21张1254×1050用户原图按原字节接入；身份/三态映射、SHA-256与尺寸全部核验。
  All 21 original 1254×1050 scenes are mapped and byte/dimension verified.
- 花麻将对手顶部原框满铺，本人身份＋手牌合用场景背景。保留响应式牌尺寸、横向滚动与原操作条件。
  Flower opponent frames fill edge to edge, and own identity/hand share a scene while preserving responsive tile sizes, scrolling and action conditions.
- 亮色背景提示使用独立深底。背景及遮罩忽略指针，不替代牌或按钮。
  Text gets independent dark backing; scene and overlay ignore pointer input rather than replacing tiles/buttons.
- 服务端、引擎、规则、隐私、记录和声音文件未改；成都的本人牌区只调整展示容器并使用相同新素材/上层桌毡。
  Server, engines, rules, privacy, records and audio remain unchanged; Chengdu only rearranges the own display container and shares scene URLs/felt styling.

## 自动检查 / Automated checks

- `npm test`：1185/1185通过，无跳过，包含新增5项场景结构/生命周期/减少动态回归。
  All 1185 tests passed without skips, including five new scene structure/lifecycle/reduced-motion regressions.
- `npm run lint`：0错误，4条基线warning；保留平台pages目录提示。
  Zero errors, four baseline warnings and the existing platform pages-directory notice.
- `npm run build`：Vue客户端与Worker本地生产构建通过。
  Local Vue client and Worker production builds passed.
- `git diff --check`通过。未运行全仓TypeScript检查、全多人实战或人工语音试听。
  Whitespace checks passed. No repository-wide TypeScript check, full multiplayer match or subjective audio listening was performed.

## 浏览器检查 / Browser checks

真实浏览器使用 `tests/browser/portrait-preview-server.mjs` 的隔离MemoryStore服务，不读取生产牌局；390px页面由 `portrait-preview-narrow.html` 的真实iframe触发媒体查询，不用缩放图片冒充手机布局。
Real-browser QA uses isolated MemoryStore servers with no production records. A real 390px iframe triggers responsive styles, rather than scaling a screenshot.

- 真实Chromium约1165px桌面与390px iframe均满铺，没有白边。已实看sweet/elegant/star，眼睛与脸保留，顶部头发有正常裁切。
  Actual Chromium desktop and 390px frames fill without gaps. Sweet/elegant/star faces remain visible with normal upper-hair cropping.
- 本人身份＋手牌连续背景；窄屏只在手牌内部横向滚动，不撑宽整页。
  Own identity/hand share continuous art; narrow hand scrolling does not widen the page.
- 真实点击选中2条并打出，手牌14→13，公开动态出现对应弃牌；装饰背景没有挡住操作。
  A real tile-selection/discard click changed the hand from 14 to 13 and produced the expected public event, confirming the background does not block input.
- 最后深底文字修复在桌面/390px均复查，提示与副露标签可读。测试服务已停止；截图只在工具结果展示，未保存持久文件。
  The final dark text backing was rechecked at both widths; test services were stopped. Screenshots were shown in tool output only, without persisted files.
- 所有角色/胡牌/放炮浏览器组合未逐一验收；相同尺寸/原字节、三态映射与事件生命周期有自动回归，不把它们称作全量浏览器通过。
  Every role/reaction browser combination was not individually exercised; automated asset/mapping/lifecycle coverage is not exhaustive browser coverage.

复用方法：仓库根目录运行 `node tests/browser/portrait-preview-server.mjs`，在5380–5382端口使用合成玩家建桌；手机页访问 `/tests/browser/portrait-preview-narrow.html?room=<本次合成房号>`。退出后停止自建服务，不上传或部署这些测试页面。
To reuse, run the preview server from the repository root and create a synthetic room on ports 5380–5382. Pass that room to the narrow preview URL, then stop the servers. Do not publish the test pages.


## 追加网页动画 / Added web animation

只对场景PNG做低幅CSS呼吸/轻晃，文字与全部控件静止；系统减少动态时静止，胡/放炮切换仍保留。无新增脚本循环或网络请求。真实浏览器已采样确认图片transform变化，而提示/按钮的坐标尺寸和transform保持不动；系统减少动态偏好未实机切换，只由源码与自动回归验证。
Low-amplitude CSS breathing/drift affects only scene PNGs. Text/controls stay still; reduced motion disables movement while win/loss swaps remain. No script loops or requests are added. Real-browser samples confirmed changing image transforms with stationary hint/button geometry. Reduced motion was verified in source/automated checks only, without toggling a system preference.


## 手牌同桌追加需求 / Own hand on the shared table

花麻将 `own-player-area` 位于 `table-surface` 内，成都同区域位于 `chengdu-board` 内，真实手牌在共用 `character-hand-table` 桌毡上。主角图片z0、明暗遮罩z1、手牌与全部文字/按钮z2。本人图有3%永久裁切余量，遮罩多覆盖1px，修复窄屏动画底部亮边；观众与非本局参与者仍无私有手牌。
Both modes place the own area inside their real table. Image, shading and controls use explicit layers 0/1/2; a shared felt layer supports real cards above the character. Permanent overscan and edge shading fix the narrow animated lower edge. Spectators and nonparticipants still receive no private hand.

`tests/portrait-layout.test.js` 直接遍历Vue原模板AST验证两模式父子层级/守卫，UI测试另检验裁切余量和层级顺序。两模式桌面与390px最终追加实看通过，详情如下。
The new AST tests verify ancestry and guards in both actual templates; UI tests check overscan and layer order. Final desktop and 390px checks passed for both modes, as detailed below.


## 最终追加复查 / Final integrated browser recheck

- 花麻将桌面和390px：角色＋桌毡手牌已收进主桌；真实选1条并打出成功，14→13张。
  Flower at both widths places the own area inside the table; real one-bamboo selection/discard reduced the hand from 14 to 13.
- 成都桌面和390px：角色、状态和手牌在同桌；真实定缺、选7条和确认出牌成功，绿底米白字/金底深字按钮可读。
  Chengdu at both widths keeps the character/status/hand on one table; missing-suit selection and a seven-bamboo discard succeeded with readable buttons.
- 窄屏亮条最终由 `overflow: clip` 修复。只有overscan/z-index仍会出现；clip不再形成可程序滚动的装饰容器，选牌后scrollTop保持0且两模式亮条消失。
  The final edge fix is overflow:clip, not overscan/stacking alone. It removes the programmatically scrollable decorative container; scrollTop remains zero after selection and the bright strip is absent in both modes.
- 私有手牌仍有独立横向滚动：390px实测牌区309px、内容625px，主桌没有被撑宽。全部实际动作只发生于隔离MemoryStore，服务已停止。
  The private hand keeps its own horizontal scrolling (309px viewport, 625px content in the narrow check), without widening the table. All actions used isolated MemoryStore rooms; servers were stopped.
