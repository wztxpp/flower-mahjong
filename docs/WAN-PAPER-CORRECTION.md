# 万牌纸色统一 / Wan paper normalization

用户要求成都一至九万不再泛白，Three.js万牌与花麻将项目现有原画一致。保留571×109原PNG及九个3:4裁切，不替换红黑文字，也不改条筒像素、牌种或玩法。
The requested correction unifies Chengdu wan paper and uses the same original artwork for Three.js. Preserve the571×109 PNG and nine3:4 crops, original red/black ink, bamboo/dots, identities and rules.

维护文件：`src/mahjong-wan-faces.js`、`src/MahjongTile.vue`、`tests/wan-paper.test.js`，原图哈希继续由`tests/wan-assets.test.js`保护。
Maintained files are the shared wan module, tile component and paper regression suite; the existing asset test protects source bytes.

`normalizeWanPaper`按sRGB最小通道计算clamp((min−200)/40,0,1)，向RGB(255,245,223)混合，保留alpha。深色、饱和红墨迹不变；纸色边缘渐变避免硬阈值。SVG用三个灰度通道的darken合成相同蒙版，独立useId避免多牌区引用冲突，只应用万牌。Canvas的`createWanDisplayAtlas`只建内存副本，Three.js可通过`paintWanFace`复用九个裁切。资源所有者负责纹理释放，不增加游戏生命周期或网络状态。
The sRGB minimum channel gives clamp((min−200)/40,0,1), blending toward(255,245,223) while retaining alpha. Dark/saturated ink remains intact with a smooth paper threshold. SVG darkens three channel masks and uses per-instance IDs only for wan. The canvas helper creates an in-memory display copy; the painter shares all nine crops with Three.js. Texture owners retain disposal responsibility; no game lifecycle or network state is added.

已直接查看原PNG并采样九窗左上(3,3)：原纸色从(244,249,253)到(253,255,255)，统一到象牙色。离线测试验证这些像素、过渡、墨迹、alpha、裁切及原PNG哈希。浏览器SVG与WebGL实际像素验收应单独报告，不把此单元测试当作视觉验收。
The original PNG was inspected and all nine crop-local(3,3) samples ranged from(244,249,253) to(253,255,255), now unified to ivory. Offline tests cover these samples, transitions, ink, alpha, crops and source hash. Browser SVG/WebGL visual acceptance remains a separate check.
