# 条筒牌面设计说明

## 当前牌面：用户提供的 PNG / Current user-supplied PNG

更新日期：2026-11-07。当前使用用户提供的十八种牌面图集，包含一至九条和一至九筒。原图位于 `public/assets/tiles/mahjong-faces-20261107.png`，1774 × 887，原字节 SHA-256 为 `9a87bb7164b286fe3fb1600b3348c5153c7380cb63a0b592dd601015b91c3333`。没有重画、重压缩或外部热链。
Updated 2026-11-07. The active eighteen-face atlas is the user's original PNG: bamboo 1–9 and dots 1–9, at the path, dimensions and SHA-256 above. The file is not redrawn, recompressed or hotlinked.

`src/mahjong-photo-faces.js` 保存原图矩形，按协议的先条后筒顺序映射。每个视窗为 3:4，等比缩放到 60 × 80；第二排牌身较矮，采用更紧的矩形。视窗去掉牌外汉字标签，但保留图案、颜色和一条鸟形。`MahjongTile.vue` 绑定真实原图尺寸，仍优先绘制背面，保留读屏牌名、选中和禁用状态。
The crop module maps source rectangles into protocol order, bamboo before dots. Every viewport is 3:4 and scales uniformly to 60 × 80; shorter middle-row tiles use tighter crops. Surrounding text labels are excluded while artwork, colors and the bird are retained. MahjongTile binds the actual source dimensions, prioritizes concealed backs and preserves accessible names, selection and disabled states.

所有手牌、牌河、副露、萝卜、胡牌区和动画沿用同一个组件。此次只换展示素材，不改玩法、API、存档、数据库或权限。`tests/mahjong-photo-faces.test.js` 验证原文件、尺寸、十八种映射、等比与边界，UI 测试验证一条、八筒及背面。
Hands, rivers, melds, radishes, winning areas and animations reuse the same component. This change affects presentation only, not rules, APIs, saves, databases or access. Atlas tests check exact bytes, dimensions, all eighteen mappings, proportional scaling and bounds; UI tests cover one bamboo, eight dots and backs.

以下为早期设计的历史说明，不再描述当前图片来源。旧 JPEG 留在仓库中作历史资源，当前组件不再引用。
The sections below document the earlier design, not the active image source. The old JPEG remains as a historical asset but is no longer referenced by the active component.

## 历史设计 / Historical design

更新日期：2026-11-03。文件：`src/MahjongTile.vue`、`src/style.css`。

## 采用的方向

这是一套为花间牌桌重绘的传统条筒 SVG，不是某一厂家牌面的扫描复制，也不声称是“自贡统一标准”。当前没有找到足以确认自贡各桌通用的权威牌面规范；若用户以后提供自家实物牌照片，可以继续按照片调整。

- 八筒使用真正的墨黑色 `#182824`，两列四行，不用蓝色替代。这也是用户明确要求。
- 一条使用原创鸟形，二至九条用带竹节的条纹。三条为上一下二；七条为顶部一条加下部六条；八条为上下相对的折线竹节，不再直接套用筒子的圆点布局。
- 一筒是大圆花纹，二至九筒采用稳定的传统数量布局和红、绿、墨黑三色。图案轮廓加粗，缩小到手机牌河仍可区分数量。
- 保留小号数字和花色辅助标记，牌名同时作为可访问名称，不依赖颜色识别；不增加声音、图片下载或外部字体依赖。

## 查阅来源与适用范围

1. Peter Gregory，《Pictures from a Mah-Jong Set》，2022，尤其第 5 页的条筒套牌、第 12 页的一条鸟形。作者用自己收藏的实物牌照片说明设计，属于原始视觉资料。它支持“一条常见鸟形”“八条有折线排列”和传统圆点排列这些一般视觉习惯；**不能**用来证明自贡规则或当地唯一画法。
   https://mahjongbritishrules.wordpress.com/wp-content/uploads/2022/09/pictures-from-a-mah-jong-set-to-view.pdf
2. Peter Gregory，Equipment，作者提供完整花色图示以及条筒说明。数字角标是辅助设计，不把出口牌图案当成本地标准。
   https://mahjongbritishrules.wordpress.com/equipment/
3. Whistler Public Library 提供的 Mahjong Rules 图解 PDF，条筒示例包含八个黑色圆圈的八筒。作为传统实物牌色彩参考；这份资料不是自贡麻将规则来源。
   https://www.whistlerlibrary.ca/cover-images/mahjongrules.pdf

检索还覆盖了自贡本地牌具相关内容，但没有找到可据以宣称统一标准的可靠来源。外部资料只用于视觉辨识方向，所有 SVG 路径是项目内新绘，没有下载、嵌入或描摹来源图片。

## 新界面的数据边界

- 胡牌区使用服务端 `winPile`，不从历史猜测并制造额外实体牌。`virtual` 牌显示“共胡”标记；牌河中的对应项淡化为记录。显示多少次胡牌，不宣称额外实体牌数量。
- 累计萝卜与最近一次增加分别显示。胡牌增量来自 `history.newRadishes`；杠牌增量来自 `history.radish`，不把累计数量误标成这次翻牌。
- 所有行动来自 `legalActions`，胡牌诊断只读自己返回的 `huDiagnostic`。诊断说明当前状态，不宣称已复原早先无法胡牌的具体牌局。
- 旧规则牌桌继续显示旧规则、手动摸牌，并提供保留当前牌桌的新标签页入口。新桌才启用第二版规则。


## 新增独立万牌图集 / Additional independent wan atlas

18–26通过 `src/mahjong-tile-presentation.js` 选择用户571×109万牌原图，与原条筒图集分别保留；九个3:4裁切等比放入相同60×80视窗。所有使用MahjongTile的展示位置自然支持新牌面，无需复制牌壳、CSS或动画。背面仍优先，读屏名称为1万至9万。只扩展展示，不扩展花麻将合法牌种或开放成都规则。原图字节与裁切详见 [万牌素材](WAN-ASSETS.md)。
Identities 18–26 select the user's separate 571×109 wan atlas through the shared presentation catalog, preserving the original bamboo/dot atlas. Nine proportional 3:4 crops use the same 60×80 viewport; component consumers need no copied tile shell/CSS/animation. Hidden backs remain first and labels say 1万 through 9万. Presentation does not expand Flower legality or enable Chengdu. See asset provenance and crop details.
