# Three.js 接入验收 / Three.js integration validation

2026-11-10，从 GitHub main `5b3ca6e8dbe81bbe9f899faae2dd2a30dfe834ff` 开始，接入 Three demo v5 的实体桌牌表现，替换旧二维真实桌。既有规则、服务端、数据库迁移和共享原始牌图/角色/声音不变；不显示牌墙。成麻和 Three 万牌共用原图及近白纸色校正。
Starting from the indicated main baseline, this release replaces the old 2D realistic table with Three demo-derived solid tiles/table. Rules, server code, migrations and shared originals stay unchanged; no tile walls are rendered. Chengdu and Three wan faces share original artwork and paper correction.

## 自动检查 / Automated checks

- `npm test`: 1685/1685 passed, no skipped tests. Retired renderer-only suites were replaced; rule/version/privacy, original controls, FIFO, retained assets and new Three lifecycle tests pass.
- `npm run lint`: no errors; three existing warnings in server/worker.js, shared/game.js and tests/rob-kong.test.js. The inherited Next pages-directory diagnostic remains.
- `npm run build`: passed. Three is lazy-loaded. Vite reports the expected 528.97 kB renderer chunk warning; no build failure.
- `git diff --check`: passed. No changes under shared/, server/, db/ or drizzle/.
- 85 obsolete tracked files, about 71.4 MB, removed. Eighteen approved figure PNGs and original shared assets remain. Original PNG and voice hash tests pass.

## 真实浏览器范围 / Actual browser coverage

使用隔离合成牌局夹具，不读取生产牌局或建立公开房间。
Used isolated synthetic fixtures, without reading production games or creating public rooms.

- WebGL initialization failure returns to usable classic mode without a stuck loader.
- Three repeated mode switches at 390px remain usable.
- Flower at 390×760: selection, action separation and keyboard access to the final hand tile pass.
- Chengdu at 320×420: fallback, selectable hand and action separation pass.
- Narrow page widths remain within the viewport. Temporary preview configuration was restored and preview stopped.

## 未验证与素材边界 / Unverified scope and art limits

浏览器报告 GL_VENDOR/GL_RENDERER Disabled，因此不能验证真实三维像素、GPU光影、相机/专注视角和三维动画稳定性。自动测试使用真实 Three 几何/材质及模拟 GPU 宿主验证释放、隐藏牌和失败路径，不代替 GPU 视觉验收。本次未进行真实多人设备联机或扬声器声学验收。
The browser disables WebGL, so 3D pixels, lighting, camera/focus views and 3D animation stability are unverified. Actual Three geometry/materials with a fake GPU host test cleanup, concealment and failures, not GPU appearance. No physical multi-device multiplayer or speaker acoustic acceptance was performed.

角色仍是目录批准原画的2.5D曲面，不是完整3D骨骼。六个已批准角色使用前/左/右整身原图；未批准身份不借用其他人物，缺背面原画时不镜像出脸。人物摸牌动作继续暂停。发布记录须另外核实 GitHub main 和 Sites 部署结果，不以本报告代替已发布证明。
Characters remain approved 2.5D original-art surfaces, not full 3D rigs. Six approved roles use front/left/right figures; unsupported roles never borrow another identity, and missing rear art never mirrors a face. Character draw motion remains paused. Verify GitHub main and the Sites deployment separately; this report is not publication evidence.
