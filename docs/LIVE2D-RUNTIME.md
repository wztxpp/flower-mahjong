# Live2D 展示层 / Live2D presentation

**历史实现 / Historical implementation:** 当前生产入口已改为 [原图局部Canvas2D](PORTRAIT-MOTION.md)，不执行/公开分发这里的SDK/模型，不显示新的Live2D许可要求。下文保留当时证据，不能作为当前画面验收。
The current production path uses original-preserving Canvas2D, without executing/distributing the SDK/models or asking for new Live2D assent. Evidence below is historical, not acceptance of the current visuals.

## 当前状态 / Current status

这是从 `9431753a01064cec14d9e405d9281838d6cdb039` 重建的集成分支，不是已发布版本。当前七个独立角色 `sweet`、`sunny`、`elegant`、`star`、`wealthy`、`honest`、`landlord` 已恢复真实模型、官方 Core 绑定检查及八秒192帧离线视觉证据，目录允许进入浏览器验收。不能用一套皮肤代替七个角色。官方 SDK 已恢复，当前官方许可选择和用户自行承担 GPU 验收的决定见 [许可审查](LIVE2D-LICENSE-REVIEW.md)。
This integration is rebuilt from the exact main baseline and is not released. Seven distinct roles now have restored model bytes, official Core binding checks and eight-second/192-frame offline visual evidence, enabling browser acceptance work. One skin cannot stand in for multiple roles. Official-license opt-in is implemented; the publisher chose personal GPU acceptance after publication, without claiming a graphics pass.

`available:true` 只表示该角色有已核对的本地资产和离线证据，不表示 GPU、移动端或发布通过；浏览器仍须逐实例通过真实首帧像素检查才能隐藏原图。七人各自仅开放清单实证的11项头部、身体、呼吸、双眼与左右侧发能力。前发、后发、嘴部、旧物理及模型情绪没有放行，胡/放炮继续使用原PNG约三秒。
Availability means audited local assets/offline evidence, not GPU, mobile or release acceptance. Each browser instance still needs a real nonempty first frame before hiding original art. Each role enables only its own eleven evidenced head/body/breath/eyes/side-hair bindings. Front/back hair, mouth, old physics and model emotions remain disabled; original reaction PNGs still last about three seconds.

## 阅读顺序 / Reading order

1. `src/live2d/catalog.js`：固定目录、逐角色能力白名单和资源可用性。 / Fixed catalog, individually audited capabilities and availability.
2. `src/live2d/consent.js`、`src/Live2DSettings.vue`：当前官方许可版本、本地选择、非阻塞设置及存储错误降级。 / Current official-license version, local choice, nonblocking settings and storage fallback.
3. `src/CharacterArtwork.vue`：原图、静态背景、透明画布三层；跟踪视口、前台与减少动态。 / Original art, static background and transparent canvas; visibility, foreground and reduced-motion lifecycle.
4. `src/live2d/portrait-controller.js`：代次、加载、暂停、降级、卸载。 / Generations, loading, pause, fallback and unmount.
5. `src/live2d/loader.js`：本地 Core 按需启动，原生版本接口就绪后才导入 Framework。 / Local Core on demand; Framework follows native-version readiness.
6. `src/live2d/renderer.js`：官方模型/WebGL 渲染及资源所有权。 / Official model/WebGL rendering and resource ownership.
7. `src/live2d/idle-motion.js`、`cleanup.js`：纯参数曲线、稳定相位及容错释放。 / Pure parameter curves, stable phase and fault-tolerant cleanup.

## 兼容边界 / Compatibility boundaries

- App 增加不影响牌局的可选设置，并仅增加公开 `portraitReaction` 与 `portraitPhaseKey` 展示字段。角色分配、声音、三秒 `win`/`discardLoss` 原图、旧规则、服务端、存档和隐私不变。 / Only optional local settings and public presentation fields are added; assignment, audio, original three-second reactions, rules, authority, saves and privacy are unchanged.
- 大立绘才使用模型；小头像仍是原图。本人画框保持手牌下方正常文档流，观众无本人画框。 / Only large art uses models. Own art stays below the hand; spectators have no own frame.
- 切反应只暂停同一实例，返回基础状态再用，不反复创建纹理。后台、不可见与减少动态时不启动绘制，未见角色不预加载。 / Reactions pause/reuse instances. Hidden/reduced-motion views do not draw; unseen roles are not preloaded.
- 原图不会因为 JSON 下载、Core 数值更新或 canvas 存在就隐藏；模型必须完成真实非空首帧，静态背景也须就绪。 / JSON, Core updates and canvas existence cannot hide art; an actual nonempty first frame and background readiness are required.
- 不自动加载未验收的动作、表情、物理或口型；参数存在不证明绑定。 / Unverified motions, expressions, physics and lip sync are not loaded; declared parameters do not prove binding.

## 官方许可选择 / Official-license choice

默认静态，页眉下的“动态角色 · 设置”可随时打开。只在点击同意或恢复同一版本的已保存同意后，画框的可见/前台/基础表情/非减少动态条件才允许加载。拒绝/关闭后仍完整可玩，不自动反复询问。`CharacterArtwork` 自身读取共享选择，故独立挂载的 `ChengduTable` 也不能绕过；默认 loader 再次检查，诊断页 Core 按钮也遵守门禁。
Static is the default. The persistent settings entry allows an explicit choice; exact-version saved assent can restore it. All existing visibility/reaction/reduced-motion conditions still apply. Declining keeps full gameplay, without repeated prompts. Frames gate themselves, including standalone Chengdu tables, and the default loader and diagnostic Core button check again.

仅保存版本和开关，不新增服务器身份记录。存储不可读保持静态；写入失败允许本页选择并明确提示。撤销立即销毁实例/取消模型与纹理请求、使 SDK 迟到结果失效；已获准下载/缓存的字节无法撤回，Core 未完成期间撤销则不继续导入 Framework。静态原图、胡/放炮反应、声音、规则和服务端状态均不变。
Only version and switch persist, never server identity records. Unreadable storage defaults static; failed writes show page-only behavior. Withdrawal immediately disposes/aborts model work and invalidates late creation. Already-authorized downloaded/cached bytes cannot be recalled, but Framework is not imported after withdrawal during Core startup. Original art, reactions, audio, rules and authority remain unchanged.

## 异步与资源 / Async and ownership

角色变更使用独立 keyed canvas。关闭时同步递增 canvasGeneration，画布和背景 key 均含角色/代次；同批关闭再打开也触发 post watcher，绝不复用已丢失 GL context 的节点。统一 post watcher 等待 DOM 更新；SDK Promise 返回后再次核对代次、角色和节点。背景事件核对节点身份，覆盖 A→B→A。错误只降级当前画框。清理逐项容错，不让 shader program `0` 阻止回退；共享 Framework 不得误清其他画框。
Role changes use distinct keyed canvases. Withdrawal synchronously increments canvasGeneration in both canvas/background keys and the post watcher, so same-batch disable/re-enable also creates new nodes rather than reusing a lost context. A unified post watcher waits for DOM updates; generation, role and node are rechecked after SDK readiness. Background callbacks compare node identity, including A→B→A. Failures affect only their frame. Cleanup tolerates individual errors and must not clear sibling contexts.

## 测试分层 / Validation layers

`live2d-controller.test.js` 与 `live2d-component.test.js` 证明生命周期和真实 Vue 调度，不证明 GPU。`live2d-renderer.test.js` 的替身也不是可见验收。模型恢复后必须逐个执行官方 Core 一致性、绑定变化、掩膜、完整自然动作序列和实际浏览器首帧/动态/多画框测试。移动端帧率与内存须单独实测，不能从目标 30fps 或纹理预算推断通过。
Lifecycle, Vue scheduling and renderer-double tests do not prove GPU rendering. Recovered models need official Core, binding, mask, full idle and actual browser/multi-frame checks. Mobile performance requires measurement, not inference from target frame rates or budgets.


## 七角色资产与证据 / Seven-role assets and evidence

`public/live2d/<id>/` 保留每人的整个已审计 runtime，逐文件字节数和SHA-256以 `docs/verification/live2d-models/<id>.json` 为准；对应 `<id>-visual.json` 绑定同一 moc3 和正式 `idle-motion.js` 的SHA，不能混用重建前的报告。五个新接入角色共31个 runtime 文件，17,553,016字节；既有 sweet 资产未改。目录的能力数组逐人从 `verifiedCoreBindings` 抄录，不根据参数名存在而推断支持。
Each complete audited runtime lives under its own public directory. Per-role manifests pin every file size/hash, and visual reports bind the same moc3 and production idle-driver hash rather than earlier reconstruction evidence. The five added roles contribute 31 files totaling 17,553,016 bytes; existing sweet assets remain unchanged. Catalog capabilities are copied from each role's own verified bindings, never inferred from parameter names.

离线证据覆盖三次完整双眼闭合、192帧同源驱动、200/340px画框与角色专项检查。elegant 的两侧耳饰合并在一个 `ArtMeshLayer` 并随头XYZ运动，不是独立 `EarwearL/R`；这些自动骨架仍是原型级资产，仅接受已测试的小幅待机，不扩大到任意极角、口型或独立耳饰物理。
Offline evidence covers three complete bilateral blinks, the full production-driver sequence, 200/340px portraits and character-specific checks. Elegant's earrings share one ArtMeshLayer following head XYZ, not separate EarwearL/R bindings. These automated rigs remain prototype-quality and approved only for tested subtle idle, not arbitrary extreme angles, lip sync or independent earring physics.

`tests/live2d-core.test.js` 加载固定原字节 Core6.0.1与各人真实 moc3，核对整个 runtime、能力、掩膜索引和192帧有限输出。它还防止重复 moc3、错用驱动版本或过期视觉报告。`tests/live2d-sdk.test.js` 使用真实R5注册算法验证可达shader与三个保留空位，只模拟GL句柄，不能声称真实编译通过。`tests/helpers/live2d-core-audit.js` 为Node和隔离浏览器提供同一Core检查。
The real-Core suite loads pinned Core6.0.1 and each actual moc3, checking the complete runtime, bindings, mask indexes and 192 finite frames. It also rejects duplicate moc3s, mismatched driver versions and stale visual reports. The R5 suite exercises actual registration and its three reserved slots with mocked GL handles, not actual shader compilation. The shared Core helper serves Node and isolated browser checks.

## 六人接入阶段自动检查 / Six-role integration checks

本阶段执行实际Core/固定SDK专项8项、完整 `npm test` 1239项，全部通过、无跳过；`npm run lint` 零错误、保留4条既有warning和平台pages提示；`npm run build` 及 `git diff --check` 通过。新SDK测试的局部 CommonJS 容器改名为 `moduleRecord` 以满足既有 lint，不修改官方源码或放宽规则。这里没有完成或宣称浏览器GPU、多画框移动端性能或发布验收；后续结果须以新的明确报告补充。
This stage passed eight focused actual-Core/pinned-SDK checks and all 1,239 aggregate tests with no skips. Lint has zero errors, four existing warnings and the platform pages notice; build and whitespace checks pass. A test-local CommonJS container was renamed to satisfy existing lint, without changing vendor code or weakening rules. Browser GPU, simultaneous-frame mobile performance and release acceptance are not claimed here and require separate evidence.


## 七人最终本地检查 / Final seven-role local checks

地主最终6文件、3,630,515字节按同一清单逐SHA复制；当前七人共43个runtime文件、24,997,056字节，98个drawable、8张2048纹理（sunny两张，其余各一张）。每人11项实证能力，无额外情绪/口型绑定。七人真实浏览器Core报告和准确失败边界见 [验收报告](LIVE2D-VALIDATION.md)。这些数字不是实际GPU内存测量。
Landlord's six files were hash-verified before copying. The final seven-role runtime contains 43 files, 24,997,056 bytes, 98 drawables and eight 2048 textures (two for sunny). Each role enables eleven audited bindings, with no additional emotion or lip-sync claims. These counts are not GPU memory measurements; see the validation report for actual browser scope.


最终七人fresh依赖验收为1240/1240测试、lint零错4既有warning、build及diff-check通过，实际浏览器七人Core通过但普通WebGL不可用；完整范围见 [最终报告](LIVE2D-VALIDATION.md)。
Final seven-role checks with freshly installed dependencies passed all 1,240 tests, lint with four existing warnings, build and diff-check. All seven browser Core checks passed, but ordinary WebGL remains unavailable; see the final report for precise scope.

## 当前官方许可选择检查 / Current official-license opt-in checks

最小官方引用选择已实现，旧七条草稿不实施。最终自动检查1252/1252、lint零错4既有warning、build与diff-check通过；两玩法、独立成都四画框及同批重新启用的新canvas均有回归。真实浏览器同意前/拒绝后0动态请求、持久化和回退有独立证据，GPU仍未验证且由用户自行验收。完整当前记录见 [验收报告](LIVE2D-VALIDATION.md)。
Minimal official-reference opt-in replaces the unimplemented draft. All 1,252 tests, lint (four existing warnings), build and whitespace checks pass, including both modes, standalone Chengdu and same-batch canvas replacement. Real browser gating/persistence/fallback evidence is separate from still-unverified GPU acceptance by the publisher; see the report.
