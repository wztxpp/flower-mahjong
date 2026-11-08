# Live2D 重建验收 / Live2D rebuild validation

**历史实现 / Historical implementation:** 当前生产入口已改为 [原图局部Canvas2D](PORTRAIT-MOTION.md)，不执行/公开分发这里的SDK/模型，不显示新的Live2D许可要求。下文保留当时证据，不能作为当前画面验收。
The current production path uses original-preserving Canvas2D, without executing/distributing the SDK/models or asking for new Live2D assent. Evidence below is historical, not acceptance of the current visuals.

日期 / Date: 2026-11-08。基线 / Baseline: `9431753a01064cec14d9e405d9281838d6cdb039`。未推送或发布。
This is an unpublished local rebuild, not a claim that the production site has Live2D.

## 证据层级 / Evidence boundaries

- 真实模型：逐角色 `docs/verification/live2d-models/` 保留原始导出 manifest 与离线视觉报告，测试核对全部 runtime 文件 SHA、当前 idle 驱动 SHA 和能力白名单。离线 Core 视觉不是 WebGL 验收。 / Per-role receipts bind every runtime byte, current driver and capability list; offline Core visuals are not WebGL acceptance.
- 官方 SDK：Core 6.0.1、Framework R5，原字节来源记录在 `docs/verification/live2d-sdk-provenance.json`；无注册、支付或安全开关。 / Official provenance is retained, with no registration, payment or security switches.
- 生命周期：真实 Vue 编译/调度测试与注入 renderer 检查换角、同批表情更新、迟到创建、A→B→A 背景回调、卸载及清理异常。替身只证明控制流，不证明绘制。 / Actual Vue scheduling plus renderer doubles cover lifecycle boundaries, not GPU drawing.
- 实际 R5 shader 类注册248个可用槽，尾部248–250保留槽不是失败；回归执行实际上游注册算法，但成功编译句柄仍是替身。矩阵独立复核6个模型、90个坐标场景，符合 CSS cover，不等同看过GPU边缘。 / Real upstream registration and independent matrix checks do not prove shader compilation or visible edges.

## 实际浏览器 / Actual browser

普通官方 Chromium、本地四个 origin `127.0.0.1:5460–5463`、共享 MemoryStore。测试名与牌局均为合成；不读取生产 FileStore、档案或真实牌局。工具 shell 的 localhost 与浏览器隔离，因此最终在同一云电脑的原生 Terminal 用现有 Node 运行 `tests/browser/live2d-preview-server.mjs`。不安装软件、不修改浏览器安全设置。
The normal Chromium browser used four local origins and synthetic in-memory rooms. The final server ran through the browser computer's native terminal because tool-shell loopback was isolated. No production state, installation or security change was involved.

1. 七角色在实际浏览器载入官方 Core、各自 model3/moc3、全部2048纹理与1254×1050背景，各自一致性1、11项绑定、192有限且变化的帧。原始 DOM 报告：`docs/verification/live2d-browser-core-seven.json`。 / Seven real browser Core/resource audits passed, independently of graphics.
2. WebGL1、WebGL2 普通 `getContext` 均返回 null。原生 creation error 明确 `GL_VENDOR = Disabled, GL_RENDERER = Disabled`、`BindToCurrentSequence failed`。`get.webgl.org` 同样显示 disabled or unavailable。 / Both ordinary context requests failed with the recorded native creation message.
3. 花麻将三席按原UI建房、落座、开局、选择2条并出牌成功。三个大画框回退原图，尺寸340×294、340×294、518×434。本人立绘位于手牌后方正常文档流，未遮挡操作。 / Three-seat Flower started and completed a real local discard; all large frames retained original art without blocking the hand.
4. 按原UI返回大厅换桌，成都四席以血战到底、不换三张、自摸加底、4番封顶建桌开局；四家实际提交定缺万，庄家选择并打出4万，牌墙55→54、下一席摸牌。四个大画框回退原图，297×294、330×294、297×294、518×434；本人画框仍在手牌下方。 / Four-seat Chengdu completed dingque and an ordinary discard through real local APIs, with four intact fallback frames.
5. 独立预览的 sweet 胡牌、landlord 放炮原图分别在两个画框加载且可见。本次真实浏览器没有构造胡/放炮牌型来测三秒定时；这一时间逻辑由既有反应专项与组件生命周期测试覆盖，不能称真实牌局胡牌动画实测通过。 / The original sweet win and landlord discard-loss art visibly loaded in the isolated preview; actual game win/loss timing was not exercised here.

## 仍未验证的画面与用户发布决定 / Unverified visuals and publisher decision

- 实际 WebGL 首帧、眨眼、局部头身/侧发动态、透明边缘/掩膜和四上下文并发尚未验收。原图回退、CPU/Core视频和数值不能替代。 / Actual graphics visibility, motion, masking and multi-context drawing remain unverified.
- 未测真实手机帧率、内存、耗电、长时间切换或低端机；30fps/DPR/画布上限只是策略。 / Mobile performance limits are design targets, not measured results.
- 免费资格已由发行者确认；现采用官方许可全文链接与适用组件保护条款的明确选择，未启用历史七条草稿。默认静态、同意后加载、可撤销与本地版本保存已经实现。见 [许可说明](LIVE2D-LICENSE-REVIEW.md)。此工程方案不是官方模板或法律保证。 / Eligibility is confirmed and explicit scoped official-license opt-in is implemented, without the old seven-clause draft; this is not an official template or legal guarantee.
- 2026-11-08 用户明确选择“我来验收就可以  你先发布”。GPU 与手机验证仍未完成（`webglVerified=false`），由用户承担并自行验收，不再表述为必须先获官方/律师审批或本地GPU通过才能执行发布。 / The publisher explicitly chose publication first and personal acceptance. Graphics/mobile checks remain unverified, not a mandatory official/legal prereview or local-GPU prerequisite.
- 本文代码实现阶段没有注册、付款、启用自拟新协议、推送main或部署；早先独立分支推送未执行成功且未重试。 / This implementation stage did not register, pay, activate a custom agreement, push main or deploy; the earlier denied independent branch push was not retried.

## 复现 / Reproduce

使用锁文件安装依赖，运行 `npm test`、`npm run lint`、`npm run build`。浏览器测试在仓库根运行 `node tests/browser/live2d-preview-server.mjs`，打开 `/tests/browser/live2d-preview.html`，按“检查实际浏览器 Core”按钮读取结果；真实App在 `/`。这些辅助页不进入生产构建，结束后停止自己的服务器。
Install from the lockfile, run the aggregate checks, then start the isolated server and use its visible audit control or real app. Preview helpers are excluded from production; stop the server after testing.


测试结束后已在原生Terminal按Ctrl+C，实际看见shell提示符，5460–5463测试服务已停止。早期工具shell服务也已停止。
After testing, native Terminal Ctrl+C visibly returned to its shell prompt, stopping all four servers. Earlier tool-shell attempts were also stopped.


## 同意设置加入前的自动检查 / Automated checks before opt-in settings

七人最终代码执行 `npm test`：1240/1240通过，零失败/跳过；`npm run lint`：零错误、4条基线已有warning及pages目录提示；`npm run build` 与 `git diff --check` 通过。独立目录按原锁文件 `npm ci --ignore-scripts --no-audit --no-fund --cache <scoped-cache>` 完成710包的新安装，再用这套依赖完成以上全测；没有修改锁文件或依赖版本。首次未指定缓存路径的尝试因工具环境没有可写默认缓存目录失败，指定当前任务内缓存后成功。
The final seven-role code passed 1,240 tests with zero skips/failures, lint with zero errors and four existing warnings, build and whitespace checks. A fresh 710-package lockfile install (lifecycle scripts disabled, task-scoped cache) supplied the tested dependencies. No lockfile or dependency version changed; the initial default-cache-path failure was resolved by using a writable task-local cache.

同意设置加入前的客户端构建：`index-CdPWaq4_.js`、`renderer-B_mRY3oG.js`、`index-CQKVUQM4.css`。`dist/client` 无 tests 目录。服务端、shared规则、原角色PNG、音频、package与锁文件对基线均无差异。没有对未运行的全项目TypeScript检查声称通过。
The listed final client assets contain no test directory. Server/shared rules, original portraits, audio, package and lockfile remain unchanged from baseline. No passing claim is made for an unrun repository-wide TypeScript check.

## 官方许可选择加入后的最终检查 / Final checks after official-license opt-in

2026-11-08，基于本地 `fcd9864d003d585351c656b126a1946aff0a875b` 的本次选择设置修改，最终执行 `npm test`：**1252/1252 通过**，零失败、跳过、取消；`npm run lint`：**零错误、4条基线warning**（仍有既有pages目录与npm环境提示）；`npm run build` 和 `git diff --check` 通过。全项目 TypeScript 检查未运行，不声明通过。没有新增依赖或修改锁文件。
The opt-in worktree passed all 1,252 tests with zero failures/skips/cancellations, lint with zero errors and four existing warnings, production build and whitespace checks. Repository-wide TypeScript checking was not run. Dependencies and the lockfile are unchanged.

新增覆盖包括：未知/旧版/损坏记录、拒绝与读取失败的默认静态、同版本持久化、写入失败提示及清理、同源撤销、默认 SDK 加载入口的双重门禁、Core 等待中撤销、真实设置按钮与重复选择、兄弟画框、独立挂载成都四画框、两玩法 App 入口、停用时在途实例失效、同角色跨tick和同批关闭再打开的新画布身份、旧背景事件失效。旧切桌测试只限制切桌控件保持同标签，不再错误禁止官方许可外链新标签。
Coverage includes strict persisted versions, static defaults, persistence/errors, sibling withdrawal, dual loading gates, Core-startup cancellation, actual settings controls, repeated choices, standalone Chengdu's four frames, both App modes, pending-instance invalidation, fresh canvases across normal and same-batch restarts, and stale background events. Room navigation remains same-tab while official license links open independently.

最终客户端入口为 `index-RJtKAWL8.js`、`index-C8nT6E01.css`，按需 renderer 为 `renderer-C45e7ea6.js`。生产 HTML 没有 SDK/renderer 预加载，`dist/client` 无测试目录。模型、官方 SDK/许可证、idle 驱动、renderer、目录白名单、服务端/shared规则、原角色图、音频、package 和锁文件对本次修改前 HEAD 均无差异。
The final entry and lazy renderer are listed above. Production HTML has no eager SDK/renderer preload and output has no test directory. Models, original SDK/licenses, idle driver, renderer, catalog, server/rules, art, audio and dependency files are unchanged from the pre-opt-in HEAD.

本次真实浏览器许可/网络/回退验收由父任务执行，证据见 [浏览器许可选择报告](verification/live2d-consent-browser.md)、[资源路径日志](verification/live2d-consent-network.jsonl)、[七角色Core结果](verification/live2d-browser-core-consent.json)。这些结果不代表 GPU/移动端通过；用户选择本人验收，`webglVerified=false` 保留。本实现任务未提交、推送或部署；后续发布应单独记录实际提交与发布结果。
The parent ran actual browser consent/network/fallback checks, linked above. They do not establish GPU/mobile acceptance; the publisher will check personally and webglVerified remains false. This implementation task did not commit, push or deploy; subsequent publication requires its own exact-commit/result record.
