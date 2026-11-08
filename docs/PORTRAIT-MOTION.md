# 原图局部动效 / Original-preserving portrait motion

最终实际验证范围见 [原图动效验收](PORTRAIT-MOTION-VALIDATION.md)，包含浏览器像素、缩放归零、四实例测量和双玩法冒烟测试。
See the linked acceptance record for real-browser pixels, scaled cleanup, four-instance timings and both-mode smoke tests.

## 当前契约 / Current contract

这是 Canvas2D 局部合成，不是真正 Live2D。`public/characters/*-scene-base.png` 仍是用户原始睁眼帧，字节不改；`CharacterArtwork` 的原始 img 永远可见，不淡出、不整图平移。生成闭眼完整帧只作为两只眼的小范围供体，不能拿整张生成脸替换原图。头发仅在已审查的内部发区采样原图纹理，脸、嘴、身体、背景和画框位置不驱动。
This is local Canvas2D compositing, not Live2D. Original open PNG bytes remain unchanged and the underlying img never fades or moves. Generated closed images supply only two small eye regions, never a replacement face. Hair samples original texture only inside reviewed internal hair masks; face, mouth, body, background and framing are not driven.

原 `CharacterPortraitReactions` 的 win/discardLoss 约三秒原图继续工作：显示反应图时暂停并清空透明覆盖，结束后复用已准备资源。花麻将和成都都引用同一 `CharacterArtwork`，角色/绝对座位相位来自现有 `portraitPhaseKey`，不读取手牌、不写动作、规则、声音或服务器状态。
The existing three-second original win/discardLoss reactions pause and clear overlays, then reuse prepared resources. Flower and Chengdu share CharacterArtwork and the existing role/absolute-seat phase key without reading hands or changing actions, rules, audio or server state.

## 阅读顺序 / Reading order

1. `src/PortraitMotionSettings.vue` 与 `src/portrait-motion/settings.js`：普通本地显示开关，默认静态，只有新开关明确启用才动画。旧 `huajian-live2d-consent-v1` 许可接受/拒绝均不迁移，新键为 `huajian-portrait-motion-v1`，不是法律协议。
   The ordinary local display preference defaults static and requires a new explicit enable. Neither old license acceptance nor refusal migrates; the new storage key is not a legal agreement.
2. `src/CharacterArtwork.vue`：原图与等比透明 canvas 两层，cover 和 focus-y 一致；基础原图路径必须匹配素材来源。可见、前台、非减少动态才运行。
   Original img and proportional transparent canvas share cover/focus. The base path must match provenance; motion requires visibility, foreground and no reduced-motion request.
3. `src/portrait-motion/controller.js`：独立代次、加载、暂停、失败、换角、关开及卸载。异步返回后检查代次与节点，清理出错也保留原图；同角色损坏不无限重试。
   Independent generations cover loading, pause, failure, role changes, toggling and unmount. Late results recheck generations/nodes; cleanup failure still preserves original art and a damaged role does not retry indefinitely.
4. `src/portrait-motion/catalog.js` 与 `public/portrait-motion/catalog.json`：审查通过角色的原图/闭眼帧路径和 SHA-256、尺寸、眼区及发区。缺角色默认静态，不能替换其他角色或旧模型。
   The reviewed catalog specifies source/closed paths and hashes, dimensions and local regions. Missing roles stay static, never borrowing another role or old model.
5. `src/portrait-motion/loader.js`、`renderer.js`：仅懒加载 Canvas2D 模块，准备局部纹理和内羽化蒙版；原睁眼/零摆幅时透明层不绘制任何像素。
   Only Canvas2D code is lazily loaded. Local textures and inward-feathered masks are prepared once; open/still controls draw no overlay pixels.

## 素材坐标和保护 / Asset coordinates and protection

`eyes[].targetRect` 为原图整数 `[x,y,width,height]`，`sourceRect` 为生成闭眼完整帧坐标，允许小数以保留精确比例；`maskPolygon` 为原图全局坐标的简单非自交多边形。只在该多边形内使用闭眼供体，外围两像素向内羽化。`openLidY/closedLidY` 是素材记录，不能把它们当作经过验证的完整连续眼睑曲线。
Eye target rectangles use original integer pixels; fractional source rectangles preserve precise mapping to generated image dimensions. Mask polygons are simple, non-self-intersecting original-image coordinates. Closed donors appear only inside these polygons with two-pixel inward feathering. Recorded lid heights are asset notes, not verified continuous lid curves.

眨眼只使用两个真实端点：原始睁眼PNG和ImageGen闭眼小蒙版。每4.8–6.4秒按稳定座位相位闭眼约120ms，其余完全透明；不做alpha混合，不压缩虹膜，也不声称有连续自然半闭帧。诊断 `blink < 0.5` 使用睁眼、`blink >= 0.5` 使用闭眼，0.5是端点阈值而非半闭。如果以后需要半闭，应另生成并审查真实中间帧。
Blinks use two real endpoints only: the original open PNG and ImageGen closed-eye masks. Stable seat phases close for about 120ms every 4.8–6.4 seconds. There is no alpha crossfade, iris compression or claim of continuous natural half-closure. Diagnostic values below 0.5 are open and at/above 0.5 are closed; 0.5 is a threshold, not a half-closed frame. Future half-closure requires an additional generated and reviewed frame.

`hairRegions[].rect/maskPolygon` 限制原纹理采样和输出，`amplitudeX/Y` 为原图像素而非屏幕像素。发根/两端按高度衰减，蒙版边缘固定。运行时拒绝超过8源像素的安全上限；目前各角色使用更小幅度，实际可见程度需按缩小后的屏幕验收。`phase` 字段保留素材信息，本版每个角色按座位使用一条稳定相位，不声称左右发区独立摆动。
Hair rectangles/polygons bound original-texture sampling/output. Amplitudes are source pixels, not screen pixels. Height falloff fixes roots/ends and masks fix boundaries. The runtime rejects values beyond an eight-source-pixel safety cap; actual catalog amplitudes are smaller and must be assessed at display size. Region phase is retained asset information; this version uses one stable role/seat phase rather than independent side phases.

身份/路径/SHA格式、生成尺寸、区域边界、多边形有效性及总ROI面积均校验；单眼矩形不超过图面积1.2%，总区域不超过12%。SHA真实文件匹配另由自动资产测试验证，不把字符串校验描述成浏览器下载时做了密码学校验。
Identity/path/hash format, generated dimensions, bounds, polygon validity and aggregate ROI area are validated. Each eye rectangle is at most 1.2% and all regions at most 12% of the image. Actual file hashes are checked by automated asset tests; format checks are not described as runtime cryptographic validation.

## 性能和失败 / Performance and failure

最多24fps绘制；DPR上限1.5，画布面积预算350000像素，不高于原图分辨率。ResizeObserver只重配透明缓冲，不重新下载或计算蒙版。每帧仅清理/绘制局部ROI，没有全图getImageData、全图重采样或重复帧下载。每页各角色的源图/闭眼图共享解码Promise，15秒超时后清理失败缓存。关闭某一座位不取消其他座位正在用的共用加载。
Rendering is capped at 24fps, DPR 1.5 and 350000 canvas pixels, never exceeding original resolution. ResizeObserver adjusts only the transparent buffer. Frames clear/draw ROIs without full-image readback/resampling or repeated downloads. Roles share source/closed-image decode promises per page, with a 15-second timeout and failed-cache cleanup. Disposing one seat cannot cancel shared work owned by another.

系统减少动态、隐藏页面或离开视口都停止帧时钟并清空覆盖；关闭设置、换角色/相位、卸载失效旧代次并释放画布。Canvas2D缺失、图片错误/尺寸不符、配置错误和清理异常都只影响装饰，原图不依赖任何动态资源。存储受限仍允许当前页面选择，提示不保证下次恢复。
Reduced motion, hidden pages and offscreen frames stop the clock and clear overlays. Disabling, role/phase changes and unmount revoke generations and release buffers. Missing Canvas2D, image/dimension/configuration errors and cleanup failures affect decoration only; original art depends on no motion resources. Blocked storage permits page-local choices with an explicit persistence warning.

## 打包与历史边界 / Distribution and history

旧 `src/live2d/**`、`src/Live2DSettings.vue`、官方vendor和模型仅保留历史/离线测试，不在新生产依赖图。构建后明确移除 `dist/client/live2d`、`dist/client/vendor/live2d`，`scripts/verify-portrait-motion-build.mjs` 先检查client再对完整dist递归复核，拒绝SDK/模型目录或运行时代码，并在任意路径拒绝`.moc3`、`.model3.json`文件（不区分扩展名大小写），不依赖JS引用。新界面不要求旧SDK许可，不以旧GPU验收结果冒充当前Canvas2D效果。
Retired Live2D source/settings, official vendor bytes and models remain only for history/offline tests, outside the production graph. Build cleanup removes both retired public directories and a real-output verifier checks client output and then the complete dist tree. It rejects remaining directories/runtime code plus `.moc3` and `.model3.json` files at any path, case-insensitively and independently of JavaScript references. The new UI does not ask for SDK terms or substitute old GPU evidence for current Canvas2D results.

## 测试边界 / Verification boundary

`tests/portrait-motion-{settings,controller,component,renderer,build}.test.js` 覆盖新选择/旧记录隔离、真实Vue调度与成都四实例、原图永远可见、反应暂停、异步代次/卸载/重启/错误、区域/参数/蒙版边界、源字节、缓存、节流和构建合同。原 `character-portraits`、角色分配、音频、双玩法规则和服务器测试继续运行。
The new suites cover preference isolation, real Vue scheduling and four Chengdu instances, always-visible art, reaction pause, async lifecycle/error handling, bounds/controls/masks, exact source bytes, caching, throttling and build contracts. Existing reactions, assignments, audio, both rule engines and server tests remain active.

真实浏览器诊断页使用同一个renderer的 `sourceResolution:true`，对源分辨率合成检查原帧全图零差及眼/发蒙版外零差；该参数仅诊断使用。参数/调用替身测试不等于实际像素或自然度通过。真实画面、窄屏、各角色闭眼及动效观感的最终结果由独立验收记录列明，不能在未检查时宣称通过。
Browser diagnostics use the same renderer with exact source resolution to check zero whole-frame neutral differences and zero changes outside eye/hair masks. That option is diagnostic-only. Parameter/call doubles do not prove actual pixels or natural appearance; a separate acceptance record must distinguish real visual/mobile/character results from untested claims.
