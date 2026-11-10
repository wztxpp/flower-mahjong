> 历史记录：本文件描述已废弃的二维真实桌；当前实现与维护入口见 [Three.js 真实桌](REALISTIC-TABLE.md)。资源名及验收仅对应旧提交。
> Historical record of the retired 2D renderer; asset names and acceptance apply only to that revision. See the current Three.js contract.

# 圆角厚牌 / Rounded solid tiles

本说明替代 REALISTIC-SOLID-SCENE.md 中“四个侧面”的旧描述，仅改变展示，不修改任何规则、牌值或私有数据来源。
This replaces the older four-side description in REALISTIC-SOLID-SCENE.md. Only presentation changes; rules, tile identities and private-data sources remain unchanged.

## 维护清单 / Maintained files

- `src/RealisticTableTile.vue`：静态实体网格、原图牌面和立起姿态。 / Static solid mesh, canonical face and standing pose.
- `tests/realistic-rounded-tile.test.js`：实际SFC编译/SSR、网格基向量、隐藏牌同一性、3D样式边界。 / Actual-SFC compilation/SSR, mesh basis vectors, concealed-identity invariance and 3D style boundaries.
- 本文档；父级接入仍由 `RealisticTable.vue` 和 `realistic-table.css` 维护。 / This document; parent integration remains in RealisticTable.vue and realistic-table.css.

## 几何 / Geometry

牌厚从牌高的18%改为42%（50px高时21px厚）。四个竖向角的半径为牌高9%，上/下圆边为3.5%。上下各一段斜倒角和中间直边形成三层；每层四段直边和每角三个分片，共48片。18–56px牌高下用紧凑分片限制手机长牌河节点数。每片有真实三维基向量和明确顶点位置；圆角分片用梯形裁切连接不同半径，上下底盖封口。这里的“八角圆”包含下面四角，不是只给上表面加border-radius。
Depth increases from 18% to 42% of height (21px at 50px height). Vertical corner radius is 9%, with 3.5% upper/lower rounding. One sloped bevel at each end plus a straight middle make three bands. Four straight sides and three facets per corner produce 48 panels, bounding mobile long-river node count at 18–56px tile heights. Real 3D basis vectors join adjacent profiles; trapezoid clipping connects differing radii, and two caps close the solid. All eight corners include the lower four, not just the face border radius.

宽、高变量继续独立生效；圆角和厚度随高度等比，直边长度按实际宽高计算。网格在模块加载时只构造一次，没有动画帧循环、ResizeObserver或新增监听器。当前牌宽必须大于牌高18%，现有牌型均满足。
Width and height variables remain independent; rounding/depth follow height, and straight spans use actual dimensions. Geometry builds once per module, without animation loops, observers or listeners. Tile width must exceed 18% of height, as all existing sizes do.

## 立起与隐私 / Standing and privacy

`upright`默认false。true时实体整体绕局部底边旋转-90°，所有实体顶点仍在桌面上方。局部+Y朝持牌人；隐藏背面放在底盖，经过rotateY(180deg)后朝-Y桌心，玩家内侧仅有无字象牙面。父级负责座位平面旋转，不要再把背牌当平躺的暗杠。终局摊牌继续平躺。
Upright defaults false. When true, the whole solid rotates -90° around its bottom edge, keeping vertices above the table. Local +Y faces the player. The concealed back lives on the underside, rotated 180° around Y to face the table center (-Y); the inward face is blank ivory. The parent rotates seats, rather than depicting standing hands as face-down kongs. Terminal public reveals remain flat.

`back`时所有子组件都不接收真实tile编号；两种姿态下不同隐藏编号的完整HTML必须一致。没有推测牌种、额外图集或伪造牌面。公开牌仍只由原MahjongTile裁切原图；另一底盖为装饰，不重复读屏。
Back tiles never pass their identity to children. Different concealed identities must produce identical HTML in both poses. No guessed identity, extra atlas or invented face is introduced. Public faces still use the canonical MahjongTile atlas, and the decorative opposite cap is hidden from assistive technology.

## 验证与限制 / Verification and limits

专项：`node --test tests/realistic-rounded-tile.test.js`。需结合完整test/lint/build及父级隔离浏览器检查。SSR不证明最终像素、手牌遮挡或性能。
Focused command: `node --test tests/realistic-rounded-tile.test.js`. Combine with full test/lint/build and isolated parent browser checks. SSR does not prove final pixels, hand occlusion or performance.

这是CSS分片近似圆面，不是光线追踪；极近距离可能看见分片。每牌48个静态表面比旧四壁更多，需在最长牌河和手机上检查；不要为减节点退回方盒。felt到tile的中间祖先必须preserve-3d，且不能有opacity/filter/overflow裁平。父级投影也必须给Z高度提供可见方向，纯二维单应映射不能自行产生纵向厚度。
This is a faceted CSS approximation, not ray tracing; very close zoom can reveal facets. Each tile has 48 static surfaces, so inspect long rivers and phones. Do not reduce node count by reverting to square boxes. Ancestors from felt to tile must preserve 3D without flattening opacity/filter/overflow. The parent's projection must also give Z a visible screen direction; a purely planar homography cannot invent vertical depth.

### 定位基准回归 / Positioning-reference regression

分片的X/Y由absolute left/top定位；其百分比相对父牌。不能把这些百分比放到translate3d里，因为transform百分比相对分片自己，会把远端角移错并在立牌顶部形成长杆。transform只保留Z位移和16项基向量矩阵。专项测试在18、26、42、50、56px高度及三种宽高比下逐一验证所有裁切后顶点：平躺时在牌宽/高/厚度内，立起时不低于桌面、不高于牌高。
Facet X/Y positions use absolute left/top, whose percentages reference the parent tile. Never move those percentages into translate3d: transform percentages reference each facet itself, displacing far corners into rods above standing tiles. Transforms retain only Z translation and the 16-entry basis matrix. Regression tests check every clipped vertex at heights18/26/42/50/56px and three aspect ratios: inside flat width/height/depth bounds, and between table level and tile height when standing.
