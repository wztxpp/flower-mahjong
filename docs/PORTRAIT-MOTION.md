# 原图局部动效 / Original-preserving portrait motion

旧两帧版本的实际验收见 [原图动效验收](PORTRAIT-MOTION-VALIDATION.md)。该历史结果不自动证明新增多帧素材已通过；本轮各角色是否放行，以新的实际像素、200–300px画面和性能证据为准。图集制作见 [无损图集](PORTRAIT-MOTION-ATLAS.md)。
The linked acceptance record describes the previous two-frame version, not automatic approval of new multi-frame artwork. New roles require actual pixel checks, 200–300px visual review and performance evidence. See the atlas guide for lossless packing.

## 不变的边界 / Unchanged boundaries

这是 Canvas2D 局部合成，不是真正 Live2D。`public/characters/*-scene-base.png` 仍是用户原始睁眼帧，字节不改；`CharacterArtwork` 的原始 img 永远可见，不淡出、不整图平移。生成完整帧或图集仅提供审查通过的眼/发小区像素，不能替换整张生成脸、身体或场景。
This is local Canvas2D compositing, not Live2D. Original open PNG bytes remain unchanged and the underlying img never fades or moves. Generated full frames or atlases supply only reviewed eye/hair ROIs, never a replacement face, body or scene.

原 `CharacterPortraitReactions` 的 win/discardLoss 约三秒原图继续工作：显示反应图时暂停并清空覆盖，结束后复用局部资源。花麻将和成都仍共用同一 `CharacterArtwork` 和原 `portraitPhaseKey`；不读取手牌、不修改动作、规则、声音、服务器或三秒调度。
Existing three-second original win/discardLoss reactions pause and clear overlays, then reuse local resources. Flower and Chengdu still share CharacterArtwork and the original phase key, without reading hands or changing actions, rules, audio, server state or reaction scheduling.

普通本地显示开关默认静态，仅明确启用才加载。旧 `huajian-live2d-consent-v1` 接受/拒绝均不迁移；继续使用 `huajian-portrait-motion-v1`，不是新法律协议。可见、前台、基础表情、非减少动态才绘制。失败始终回原图。
The ordinary local display preference defaults static and loads only after explicit enablement. Neither old SDK acceptance nor refusal migrates. The unchanged portrait-motion key is not a legal agreement. Drawing requires visibility, foreground, base reaction and allowed motion; failures preserve original art.

## 维护入口 / Maintained modules

- `settings.js`、`PortraitMotionSettings.vue`：本地开关与存储事件；不因多帧而新增许可或改变选择。 / Local preference/storage events; multi-frame support adds no permission or preference migration.
- `CharacterArtwork.vue`、`controller.js`：原img与透明canvas等比cover；异步代次、ABA开关/换角、失败和卸载。 / Proportional original/overlay cover; generations, ABA toggles/role changes, failures and unmount.
- `catalog.js`、`public/portrait-motion/catalog.json`：明确角色/版本/来源白名单，缺角色保持静态，不借用其他角色。 / Explicit role/version/provenance allowlist; missing roles stay static without borrowing another role.
- `loader.js`、`renderer.js`：懒加载、验证、局部纹理和蒙版、诊断与实际播放同一路径。 / Lazy loading, validation, local textures/masks and one shared diagnostic/playback compositor.
- `timeline.js`：真实帧选择、稳定座位相位和保留RAF余量的30fps时钟；无DOM、请求或随机状态。 / Real-frame selection, stable seat phases and a remainder-preserving 30fps clock; no DOM, requests or random state.
- `geometry.js`：可选连续原纹理发区候选，固定根/边界、Jacobian校验、显示尺寸场和RGBA双线性反采样。 / Optional continuous original-texture hair candidate with pinned roots/boundaries, Jacobian checks, display-sized fields and bilinear RGBA inverse sampling.
- `images.js`：最多两张并行、同URL在途共享、完成即释放全局完整图引用。 / At most two active images, pending-URL sharing and no completed full-image global cache.

## v2多帧清单 / V2 multi-frame manifest

`schemaVersion:2` 与麻将规则版本无关。原图 `id/sourceUrl/sourceSha256/width/height` 不变；`frames` 为 `{id,url,sha256,width,height}` 列表。同一物理图集可对应多个逻辑帧ID，但URL相同必须有相同尺寸与SHA。路径限本角色目录下PNG；未知版本、无效清单均静态回退。SHA真实字节由资产测试验证，浏览器仅做字段格式与尺寸校验。
Motion schema two is independent of game rules. Original identity/source/hash/dimensions remain unchanged; frames list logical IDs, URLs, hashes and dimensions. Several IDs may share an atlas, provided its metadata agrees. PNG paths are restricted to the same role. Unknown versions and invalid manifests fall back to static. Asset tests check actual hashes; browser validation checks formats and dimensions, not runtime cryptographic integrity.

`eyes[]` 保留原图整数 `targetRect` 和全局 `maskPolygon`；`sourceRects` 按帧ID映射到供体/图集内的小数矩形。`hairRegions[]` 使用原图 `rect/maskPolygon` 和同样的 `sourceRects`。多边形必须简单、不自交且在矩形内；单眼矩形最多原图1.2%，所有目标矩形合计最多12%。每区所有供体、原纹理、蒙版和输出合计另受400万像素预算限制。
Eyes retain integer original-image target rectangles and global mask polygons; sourceRects map IDs to fractional donor/atlas rectangles. Hair regions use original-image rect/maskPolygon with the same source mapping. Polygons must be simple, non-self-intersecting and bounded. Each eye rectangle is at most 1.2% of the original; all target rectangles total at most 12%. All donor/original/mask/output ROI canvases also share a four-million-pixel budget per renderer.

眼区固定向内羽化2源像素。发区可用 `featherPx:2..16` 缓和供体色差，缺省仍2；羽化只削弱多边形内部alpha，绝不能扩大允许范围。发丝摆动涉及原发位置与新发位置之间的小背景区域时，必须由素材审查确认该扫过区域，不可自动扩张蒙版。
Eyes use two-source-pixel inward feathering. Hair may explicitly use featherPx from two to sixteen for donor seams, defaulting to two. Feathering only reduces alpha inside the polygon and never expands it. Any small background swept by a moving strand requires asset review of that region, not automatic mask expansion.

`blinkSequence` 为有序 `{frameId:null|id,durationMs}`。null表示原图，非null必须有两只眼的完整来源。生产只切换真实供体，不做眼alpha叠化、虹膜压缩或生成伪中间帧。目标五形态为原睁眼与20/50/80/100%闭合四张真实图。首个候选为9阶段、360ms，含40ms中间态与60ms闭眼；休息3.6–5.8秒按角色/座位稳定错开。
Blink sequences list frame IDs/null and durations. Null means original art; non-null states require both eye sources. Playback switches real donors without eye alpha crossfades, iris compression or invented intermediates. The target has five shapes: original-open plus four real 20/50/80/100% closure donors. The first candidate uses nine stages over 360ms, including 40ms intermediate states and a 60ms closed hold, with stable role/seat-offset rests of 3.6–5.8 seconds.

`hairSequence` 为按 `position:-1..1` 严格递增的 `{frameId:null|id,position}`，0必须是null原图。发区存在时，两端必须覆盖-1/+1；计划五姿态为左极值、左半摆、原图、右半摆、右极值。眼-only候选可用空hairRegions与单个null/0序列，不代表已完成头发验收。`hairInterpolation` 默认discrete，仅显式linear候选允许在相邻发区纹理之间混合，仍须实际检查静态旧发双影、过渡鬼影及脸部保护。
Hair sequences sort IDs/null by positions from minus one to one, with null original at zero. Active hair regions require both endpoints. The planned five poses are left extreme, half-left, original, half-right and right extreme. Eye-only candidates may have no hair regions and one null/zero entry, which does not establish completed hair acceptance. Interpolation defaults discrete; only explicit linear candidates blend adjacent hair textures and still require real checks for old-hair doubling, transition ghosts and face protection.

## 可选连续原纹理发区 / Optional continuous original-texture hair

`hairMode:'geometry'` 明确选择连续原图采样；不是ImageGen头发帧，不跨姿态alpha混合。默认/frames分支与v1保持可测试，但不能把失败的生成头发或离散几何供体描述成已通过。geometry清单的frames仅含眼供体，发区sourceRects须省略或为空，hairSequence可省略或仅null/0；拒绝linear混合。实际效果仍需真实浏览器检查。
Geometry mode explicitly selects continuous original-art sampling, not ImageGen hair frames or pose alpha blending. Default/frames and v1 remain testable without presenting rejected generated/baked donors as approved. Geometry manifests contain only eye donor frames, no nonempty hair sourceRects, and no hair sequence beyond optional null/zero. Linear mixing is rejected. Real-browser visual review remains required.

每区 `geometry` 仅接收 `amplitudeX`（绝对值≤24源像素）、`envelope`（vertical/horizontal，默认vertical）、可选 `motionScale`（0<值≤1，默认1）及 `pinStart/pinEnd`（源坐标，默认rect对应轴两端）。根线可以反向，但各自必须在rect轴范围内且间隔至少1像素；区间外不动。其他geometry字段拒绝，不静默缩幅。
Each region accepts only amplitudeX up to 24 source pixels in magnitude, vertical/horizontal envelope (vertical by default), explicit optional motionScale in (0,1], and source-coordinate pinStart/pinEnd defaulting to the rectangle's axis endpoints. Reversed pin order is allowed, but both pins must remain within the rectangle with at least one-pixel separation. Outside the pin interval stays fixed. Unknown fields are rejected without silent amplitude reduction.

位移为 `dx=A×position×motionScale×sin²(πt)×smoothstep(clamp(d/(2|A|),0,1))`，dy为0；d是目标点到真实mask边的内部距离，t沿指定轴的根线区间。根线、末端和mask边界归零；反采样取x-dx。距离的Lipschitz界与smoothstep导数给出逆映射Jacobian保守下界 `1-scale×(0.75+horizontal项)`，horizontal项为 `|A|π/|pinEnd-pinStart|`，vertical项为0；低于0.05拒绝，防止局部折叠。无缩幅vertical的下界为0.25。单独数值验证不代表视觉自然。
Horizontal displacement uses amplitude, control, explicit scale, a squared-sine pin envelope and a smooth boundary ramp over twice the amplitude. Vertical displacement is zero; roots, ends and polygon edges stay fixed. Inverse sampling uses x-dx. Lipschitz/derivative bounds give a conservative Jacobian of one minus scale times 0.75 plus the horizontal envelope derivative term. Horizontal adds amplitude magnitude times pi divided by pin span; vertical adds zero. Bounds below 0.05 are rejected to prevent folds; unscaled vertical has a 0.25 bound. Numerical validity alone does not establish natural appearance.

准备时每个发区只getImageData一次，含1px真实源图护边，随后释放临时canvas与完整Image引用。保存原ROI RGBA；resize按实际画布像素格准备小位移/alpha/坐标场和输出ImageData，不重读原图。每帧复用该小输出，双线性采同一原图四个邻点；透明源使用预乘alpha插值，不混合两种姿态。外部alpha严格为0，零控制直接不绘制覆盖。预设canvas尺寸与目标相同仍准备首次场，重复相同resize不重建。
Preparation performs one getImageData per hair ROI with a one-pixel original-art sampling apron, then releases temporary canvases/full Image references. Cached RGBA feeds small displacement/alpha/coordinate fields and output ImageData aligned to actual canvas pixels on resize, without source rereads. Frames reuse that output and bilinearly sample four neighbors from the same original, using premultiplied alpha for transparent sources rather than pose mixing. Outside alpha is zero; neutral control emits no overlay. A preset matching canvas size still initializes its first field, while repeated unchanged resize does not rebuild it.

400万RGBA等价像素预算同时覆盖source数组、位移/alpha/坐标场、输出ImageData和小canvas，含护边的保守系数为每区6倍像素。`renderer.geometryMemory` 报实际source/field/output typed-array byteLength与canvas RGBA等价总量，不含浏览器/GPU/对象开销，不是整个标签页内存。释放时数组与场置空，canvas缩到1×1。30fps、DPR1.5及生产35万输出像素限制不变。
The four-million-RGBA-equivalent-pixel budget covers source arrays, displacement/alpha/coordinate fields, output ImageData and local canvases using a conservative six-times-apron-area estimate. geometryMemory reports actual typed-array byte lengths and canvas RGBA equivalents, excluding browser/GPU/object overhead; it is not total tab memory. Disposal nulls arrays/fields and shrinks canvases. The 30fps, DPR 1.5 and production 350000-output-pixel limits remain unchanged.

## 时钟、诊断与兼容 / Timing, diagnostics and compatibility

`renderFrame({blinkFrameId,hairFrameId})` 强制指定真实固定帧，null清空该通道；未知ID也只显示原图。自动发区使用 `hairPosition:-1..1`，显式hairFrameId优先。`lastControls` 记录实际blinkFrameId、hairFromFrameId/hairToFrameId/hairMix供诊断，不增加生产调试全局或游戏状态。
Explicit blinkFrameId/hairFrameId controls select real fixed frames, with null or unknown IDs restoring the original channel. Automatic hair uses hairPosition; explicit hairFrameId takes precedence. lastControls records actual eye and hair selections/mix for diagnostics without global debug hooks or game state.

RAF每次最多绘制一个当前帧，30fps时钟保留不足一帧的余量，而不是把lastTime重置到实际回调时间。稳定60Hz下可经过40ms眼态；前台100ms卡顿仍可能跳过一个阶段，不能保证每次眨眼所有帧都显示。后台、停止或恢复时不追赶旧动画，不因补帧延长动作。
Each RAF draws at most one current frame. The 30fps clock retains fractional remainder instead of resetting to callback time. Stable 60Hz sampling can visit 40ms eye states; a 100ms foreground stall can still skip a stage, so every blink is not guaranteed to show every frame. Hidden/stopped/resumed playback never replays a backlog or extends motion to catch up.

缺版本或 `schemaVersion:1` 保留已验证的旧两端点和原纹理小发摆，仍受原矩形/8源像素上限约束；数字 `{blink,hair}` 诊断兼容保留。不能给缺中间供体的旧素材套上新多帧眼形，也不能悄悄回退到其他人物或旧Live2D脸。
Missing-version/schema-one descriptors retain the original verified two endpoints and small original-texture hair motion, with the original rectangle/eight-source-pixel limits. Numeric diagnostic controls remain compatible. Old assets lacking intermediates do not acquire invented eye shapes or silently fall back to another role or old Live2D face.

## 内存与生命周期 / Memory and lifecycle

每个renderer先把原图所需ROI摘到小canvas，再按唯一物理URL顺序加载供体，立刻摘取所有相关帧ROI；不使用Promise.all同时持有整套完整PNG。全局仅共享在途Promise，最多两张图片活跃，开始下载后15秒超时，成功/失败都删除全局引用；关闭某座位不取消兄弟座位的共用请求。卸载后迟到图片不接纳，也不继续发起后续供体。
Each renderer extracts original ROIs first, then loads unique donor URLs sequentially and immediately crops all relevant state ROIs. It never uses Promise.all to retain a full PNG set. Only pending promises are globally shared, with two active images and a 15-second timeout starting at download. Success/failure removes global references; disposing one seat does not cancel a sibling's shared request. Disposed renderers reject late images and start no later donor loads.

常驻资源只有小ROI及透明画布；失败/关闭/换角/卸载时先把局部canvas缩到1×1，再释放引用。反应、隐藏、离屏、减少动态只暂停并清空覆盖，可复用已准备资源。DPR上限1.5，显示画布最多350000像素且不超过原图。ResizeObserver重配透明缓冲及可选几何显示场，不重新下载/读取源图；每帧无全图readback或整图运动。
Resident resources are small ROIs and the transparent output. Failure/disable/role change/unmount shrinks ROI canvases to one pixel before releasing references. Reactions, hidden/offscreen states and reduced motion pause and clear overlays while retaining reusable patches. DPR is capped at 1.5 and output at 350000 pixels/original resolution. ResizeObserver rebuilds output and optional geometry fields without downloading/rereading source art; frames use no full-image readback or whole-image motion.

## 构建与测试 / Build and verification

旧 `src/live2d/**`、设置、vendor与模型仅保留历史/离线测试，不在生产依赖图。构建移除旧公开目录，验证器检查client与完整dist，拒绝残留SDK/模型目录、运行时代码及任意路径下的 `.moc3` / `.model3.json`，不依赖JS是否引用。新多帧不改变此边界。
Retired Live2D code/settings/vendor/models remain history/offline tests only. Build cleanup removes old public directories; verification checks client and full dist for SDK/model directories, runtime code and model files anywhere, independently of JavaScript references. Multi-frame support preserves this boundary.

`tests/portrait-motion-{settings,controller,component,renderer,timeline,geometry,build}.test.js` 覆盖开关隔离、真实Vue与成都四实例、原图保留/三秒反应、ABA/错误/卸载、多帧校验/ROI/羽化、图集加载共享、释放、时钟和28角色座位的稳定采样。原始资产SHA、角色反应、声音、两玩法和服务器回归继续运行。测试替身和数值顺序不等于真实像素、美观或手机性能通过。
The maintained suites cover preference isolation, real Vue/four Chengdu instances, preserved art/reactions, ABA/failure/unmount, multi-frame validation/ROIs/feathering, shared atlas loads, release, clock timing and stable sampling across 28 role/seat keys. Original hashes, reactions, audio, both games and server regressions remain active. Doubles and numerical sequences do not establish pixel quality, appearance or phone performance.
