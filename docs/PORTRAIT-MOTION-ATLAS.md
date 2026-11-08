# 多帧供体打包 / Multi-frame donor packing

`scripts/portraits/pack-motion-atlas.mjs` 只将已经由ImageGen生成并审查的供体像素摘取为局部PNG atlas，不生成新画面、不重绘、不缩放、不变形、不做alpha合成。用户原始PNG从不写入。测试为 `tests/portrait-motion-atlas.test.js`，使用独立合成RGBA测试夹具，不作为美术验收证据。
The packer serializes existing reviewed ImageGen donor pixels into local PNG atlases. It does not create artwork, retouch, resize, deform or alpha-blend, and never writes original input PNGs. Its tests use synthetic RGBA fixtures and do not establish visual quality.

## 显式输入 / Explicit inputs

运行 `node scripts/portraits/pack-motion-atlas.mjs request.json`。请求含：
Run the command with a JSON request containing:

- `descriptor`：schemaVersion 2角色描述，含frames表、eyes/hairRegions各自sourceRects映射；所有生成源尺寸和SHA须准确。
  Version-two character descriptor with frame table and per-region source rectangle maps; source dimensions and hashes must match.
- `hairMode:geometry` 发区没有生成供体，打包器仅原样保留其参数并打包眼帧；发区若混入sourceRects则拒绝。几何安全性仍需运行时校验与实际浏览器检查。
  Geometry-mode hair has no generated donor. The packer preserves its parameters and packs eye frames only, rejecting hair sourceRects. Runtime validation and real-browser review still establish geometry safety.
- `frameFiles`：frame ID到完整本地原始生成PNG路径的映射。不会扫描目录、下载素材或猜测文件。
  Explicit frame-ID to full local donor-PNG path map; no directory scanning, downloading or guessing.
- `outputDirectory`：候选输出目录，不自动修改正式catalog。`publicPrefix` 必须为 `/portrait-motion/{id}`。
  Candidate output directory, never an automatic production catalog mutation. The public prefix must match the character.
- 可选 `maxSize` 默认2048，上限4096；`gutter` 默认2像素，只能2–8。
  Optional atlas maximum side defaults to 2048 (maximum 4096); source context gutter defaults to two pixels (allowed two to eight).
- 帧数2–16、ID长度最多32且无下划线，源图与输出atlas都不得超过四百万像素，与运行时下载护栏一致。超预算输出应减小maxSize再打包，不扩大浏览器预算。
  Frame counts are two to sixteen, IDs are at most 32 characters without underscores, and both source and output atlas images stay below four million pixels, matching runtime guards. Reduce maxSize if packing exceeds the budget rather than expanding browser limits.

## 坐标与字节证明 / Coordinates and byte evidence

每个sourceRect可含小数。裁剪范围为其向外取整整数框加周围2像素真实源上下文，并截到源图边界；不创造新采样值。atlas内只平移原sourceRect偏移，保留其小数位置/尺寸。框之间留透明间隔。同一frame的所有眼/发框保持在同张atlas；多个frame共享URL和同一图片SHA/尺寸。
Fractional donor rectangles are enclosed by integer bounds plus two real source-context pixels, clamped to the source edge. Sampling values are not synthesized. Only the source rectangle's offset is translated into the atlas, preserving fractional coordinates and sizes. Crops have transparent separation. One frame's regions stay together; several frame IDs may share one physical image URL/hash/dimensions.

工具先核实原PNG SHA、8位PNG格式、尺寸，拒绝自定义ICC、多页或会隐式改变色彩/位深的输入。复制RGBA后再PNG编码/解码，并逐行与源整数裁剪RGBA比较。输出 `descriptor.json`、`motion-atlas-NN.png` 与 `atlas-report.json`，记录原SHA、原裁剪框、atlas框与RGBA一致结果。输入descriptor和输入PNG保持不变。
The tool verifies input hashes, eight-bit PNG format and dimensions, rejecting custom ICC, multiple pages or implicit color/depth conversions. After copying RGBA and encoding/decoding PNG, it compares each integer crop row with its source. Outputs include an updated descriptor, numbered atlas PNGs and provenance report listing source hashes, source/atlas rectangles and RGBA equality. Inputs remain unchanged.

这只证明打包没有改变供体像素，不证明ImageGen帧保持角色身份、眼睑自然、头发过渡无重影或蒙版安全。每角色仍需实际浏览器原图对照、生成帧逐态/播放检查、ROI外保护与200–300px可感知运动检查；未通过者不能进入正式catalog。
This proves serialization preserves donor pixels, not identity fidelity, eyelid naturalness, hair interpolation quality or safe masks. Every role still requires real-browser original comparisons, fixed/live frame review, outside-ROI protection and perceptibility at 200–300px. Unapproved candidates do not enter the production catalog.
