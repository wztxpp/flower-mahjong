# 原图动效验收 / Original-preserving motion acceptance

日期 / Date: 2026-11-08. 基线 / Baseline: `17c8825e3fd93b77a82bd6a7e68fb5d4ea43d5de`.

## 已验证 / Verified

- 七个角色均使用用户原始睁眼立绘，21张基础/胡牌/放炮PNG与基线逐字节一致。原img始终显示；新Canvas只覆盖经审查的眼部和内部发束。
  All seven original open portraits and all 21 base/win/loss scene PNGs match the baseline byte-for-byte. The original img remains visible; Canvas covers reviewed eye/internal-hair regions only.
- 真实Chrome Canvas2D诊断运行七人各6个固定帧（睁眼中性、闭眼、闭合阈值、发正负极值、组合），全部通过：中性原图0变化、透明层0像素；其他帧允许区域外0变化。sweet最终发幅另重跑6帧，全部通过。数据见本目录 `verification/portrait-motion/browser-{seven-endpoint,sweet-final}-audit.json`。
  Actual Chrome Canvas2D ran six fixed frames per role, all passing. Neutral frames had zero original-image changes/overlay pixels; all other changes stayed inside allowed regions. Six additional sweet frames cover its final amplitude. Reports contain real native pixels, not call doubles.
- 七人睁/闭端点与放大眼区均在实际浏览器目视核查；未见旧虹膜/外睫毛残留或矩形贴片边缘。sunny闭眼上方亮线来自ImageGen闭眼供体的折线高光，不是蒙版白缝。sweet在300px本人/240px对手框与正负极值未见新条带撕裂。美观仍以用户验收为准。
  All seven actual-browser endpoint portraits and eye crops were visually reviewed without observed retained iris/lash ghosts or rectangular patch edges. Sunny's upper crease highlight exists in the generated donor. Sweet's final extremes and 300/240px component views showed no observed new strip tearing. User acceptance remains the aesthetic standard.
- 真实生产缩放另跑7角色×4种CSS尺寸/DPR组合，共28组。每组绘制后回中性、正负摆发后归零、stop后归零均alpha像素0，见 `browser-scaled-clear.json`。不是只在源分辨率验证，也不是把初始空白当清理成功。
  Twenty-eight real display-scale cases cover four size/DPR combinations for each role. Closed-to-neutral, sway-to-neutral and stop-to-neutral each leave zero alpha, testing actual cleanup after drawing rather than initial blankness.
- 四个可见200px sweet实例独立运行8秒，其他预览实例卸载；每实例161次真实绘制，约20.12次/秒，平均0.47–0.61ms，P95 0.60–0.80ms，最大5.60ms，无报告错误。每实例观察到2–5个闭眼绘制帧。见 `browser-four-instance.json`。24fps是节流上限，不是实测帧率承诺；此为云Chrome短测，不是手机/低端设备/长期内存测试。
  Four visible 200px instances ran alone for eight seconds: 161 draws each, about 20.12 draws/s, 0.47–0.61ms mean and 0.60–0.80ms P95 per draw, maximum 5.60ms, no reported errors. Each produced 2–5 closed-eye draws. The 24fps setting is a cap, not a promised measured rate. This is a short cloud-Chrome test, not mobile, low-end or long-duration memory validation.
- 真实组件验证win/discardLoss回到原始反应PNG、启停、刷新保留启用/关闭、换角、卸载再建；失败/迟到/后台/减少动态的边界由真实Vue调度及控制器专项覆盖。没有把测试替身当实际视觉证据。
  Real components verified original reaction PNGs, toggles, persisted on/off reload, role switches and remounting. Real Vue/controller tests cover late, failed, hidden and reduced-motion lifecycle paths; test doubles are not visual evidence.
- 隔离MemoryStore实际UI回归：花麻将三人入座、开局、选牌、打出；成都四人入座、开局、四家定缺、合法缺门牌打出及下家摸牌。两玩法角色布局可见，离开可视区的动画回原图。没有读取或变更生产牌局。所有七角色在两次测试桌与诊断页均覆盖。
  Isolated MemoryStore UI smoke tests covered three-player Flower seating/start/select/discard and four-player Chengdu seating/start/all dingque/legal missing-suit discard/next draw. Layouts rendered and offscreen motion returned to original art. No production state was accessed or changed.
- 全量 `npm test` 1275/1275通过；`npm run lint` 0错误、4条基线警告；`npm run build`通过。完整dist递归检查无SDK、moc3或model3产物，打包护栏含任意目录/大小写扩展名回归。原规则、服务器、声音未修改。静态资源请求无旧SDK/模型、无HTTP错误，见 `source-and-resources.json`。
  Full tests passed 1275/1275; lint had zero errors and four baseline warnings; build passed. Recursive production checks found no SDK/moc3/model3 output and extension guards cover arbitrary paths/case. Rules, server and audio remain unchanged. Static request evidence contains no legacy SDK/model requests or HTTP errors.

## 效果边界 / Effect limits

这是原图局部Canvas2D，不是Live2D。最终眨眼只使用原睁眼/ImageGen闭眼两个端点，闭合约120ms；已删除会产生灰眼/双线的alpha叠化，没有连续半闭帧。头发保守地只动内部纹理，最大sweet横向3/2.5源像素、纵向0.25/0.20；其他角色0.5–1.8横向源像素，不是大幅发型轮廓摆动。默认静态，玩家在普通显示设置启用，不沿用旧SDK许可选择，不显示新法律协议。
This is local original-art Canvas2D, not Live2D. Blinks use only original-open and generated-closed endpoints for about 120ms. Gray-eye/double-line alpha blending was removed; no continuous half-closed frame is claimed. Internal hair texture movement is conservative: sweet uses 3/2.5 source-pixel horizontal and 0.25/0.20 vertical amplitudes; others use 0.5–1.8 horizontal pixels. This is not large silhouette sway. Static is default; an ordinary visual setting enables motion without migrating old SDK consent or presenting a new legal agreement.

本轮未验证真实手机/各浏览器、长时间内存和发热、全局直到结算或每种胡牌组合。现有规则回归继续提供覆盖；此记录不扩大短测范围。本轮只形成发布候选，没有push或部署。
This round does not establish real-phone/cross-browser behavior, long-duration memory/heat, full matches through settlement or every win combination. Existing rule regressions remain in force. This record is a release candidate only, with no push or deployment.

## 素材恢复 / Asset recovery

素材恢复包单独保存在用户 Space 中，公开验收文档不记录其私人标识或存储元数据。
The recovery archive is kept separately in the user’s Space; private identifiers and storage metadata are omitted from this public validation record.
