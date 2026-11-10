# Three.js 角色原画 / Three.js character art

当前保留六角色各正、左、右三视角共18张已批准整身PNG。`catalog.json` 保留每图尺寸、来源SHA-256、身份及三维展示需要的figure资料。`src/realistic-character-catalog.js`只查询已有身份，不重分配座位，不镜像原图。Three.js根据相机方向选择图像，属于静态2.5D，不是3D骨骼或摸牌人物动画。
Six roles retain eighteen approved full-figure PNGs across front/left/right views. The catalog records dimensions, source hashes, identity and figure metadata. The lookup preserves saved identity without mirroring; camera-selected imagery is static 2.5D, not a skeletal model or draw animation.

旧底姿、眼发图集、腿部、袖片和本人POV已从当前发布资源移除。source-audit.json 与 full-body-audit.json保留历史来源证据；它们提到的废弃图片可从Git历史恢复，不代表当前运行依赖或新版本像素验收。
Retired bases, motion atlases, lower bodies, sleeve donors and POV images are removed from the current distribution. Source/full-body audits remain historical provenance; removed images are recoverable from Git and are not current runtime dependencies or visual acceptance.

共享原立绘、用户原图清单、语音和经典 portrait-motion 不在此清理范围。当前合同见 `docs/REALISTIC-TABLE.md`；保留资产的哈希和独立视角由 `tests/realistic-character.test.js` 验证。
Shared original portraits, user manifests, audio and classic portrait motion are preserved. See the current table guide and retained-art hash/view regression tests.
