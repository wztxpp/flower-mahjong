# v41 验收修复 / Acceptance corrections

本轮仅改展示、输入手势与隔离验收工具，不改规则、积分、服务端、动画事件路径或音画节奏。新 Three.js 原型在独立项目，不并入旧站点。
This revision changes presentation, gestures and isolated QA only, never rules, scores, server behavior or accepted-event timing. The independent Three.js prototype is not imported here.

- 场景左右键拖动取消浏览器选字/拖图，松手与取消仍回正；私有控件保持原生交互。Scene panning cancels native image/text selection while private controls retain normal behavior.
- 对手暗手竖立，牌背朝桌心，人物侧仅绘制无牌值的安全空白；终局公开牌平摊。Concealed racks stand with backs inward and safe blank opposite surfaces; public terminal hands remain flat.
- 实体牌壳、八角圆润与深度见 [圆角牌壳](REALISTIC-ROUNDED-TILES.md)。Rounded solid geometry is described in the linked guide.
- 东南西北采用显式网格位置；它们是空间方位，不发明座风/庄风规则。Compass labels use explicit spatial grid areas, not new wind rules.
- 私有操作外层不再形成第二个滚动容器，牌行按牌高加完整阴影预算，横向仍保留长内容可达性；手牌恢复圆角与绿色厚底。The outer private overlay stops creating duplicate scrollbars; the actual rack retains necessary horizontal access and enough vertical room for the full rounded base.
- honest/right 同源前景遮罩沿真实手指、前臂和卷袖收紧，不再带出手下衬衫；不改原图像素、身份与来源哈希。The honest/right foreground mask follows the original hand, forearm and cuff, excluding the shirt beneath without editing source pixels.

## 验证 / Verification

自动测试、构建与实际浏览器能力分别记录。浏览器输入/截图超时不算通过，合成内存DOM测试不替代像素验收。参考图全部已逐张读取，人物比例和整体构图不能仅凭数值判为验收完成。
Automated checks and browser limits are separate. Browser input/screenshot timeouts are not passes; synthetic DOM tests do not replace pixel inspection. References were inspected, but global proportions/composition require actual visual review.

- 2026-11-10 最终检查：`npm test` 1697/1697；`npm run lint` 零错误、3项原有警告；`npm run build` 通过。Final automated checks passed, with three pre-existing lint warnings.
- 浏览器实际DOM已读取到正确的四方格位、无外层双滚动、暗手立牌；一张可用旧渲染发现侧面锚点错误，已改为父牌相对的left/top，并增加所有顶点边界回归。Actual DOM measurements verified placement/overflow structure. An initial rendered image exposed facet anchoring; parent-relative positioning and vertex-bounds regression now cover it.
- 新标签页、官方会话重置和原生窗口重绘均未恢复更新后的像素/输入：页面截图持续protocolTimeout，原生窗口仍显示先前URL。不能把旧画面作为最终验收。Official session reset, fresh tabs and native window repaint did not restore current pixels or input. Stale frames are not final visual evidence.
- 未完成：按完整参考图校正人物/桌子整体比例，以及修复后圆角立体牌、男角色右侧遮挡的最终像素复核。人物比例参数仍是v40原值。Remaining: composition/proportion tuning and final pixel review of rounded solids and honest/right occlusion. Figure sizing remains at v40 values.
- 遵循“全部改完自己看过再发布”：本批仍为待验收工作副本，未推GitHub main，也未保存/部署Site新版。No main push or Site release until the remaining visual review is complete.

## 用户自行验收版 / User-reviewed release

2026-11-10 用户随后明确要求先发布当前修复，由用户自行完成画面验收。因此本次发布不再以受阻的浏览器像素复核为前置，但仍先核实并推送 GitHub main，再用同源代码构建和部署。
On 2026-11-10 the user explicitly requested publication of the current fixes and took over visual acceptance. The blocked browser pixel review is therefore no longer a release prerequisite; verified GitHub main remains the required source before build and deployment.

发布范围限于上述已实现修复。人物/桌子整体比例仍为 v40 参数，未宣称完成参考图比例调整；圆角厚牌及男角色右侧遮挡需由用户检查实际效果。此前浏览器故障和未验收记录仍有效。
This release contains only the implemented fixes listed above. Figure/table proportions retain the v40 parameters and are not claimed to match the reference. The user will inspect rounded tile depth and the honest/right overlap; the earlier browser failure and incomplete visual-review record still apply.
