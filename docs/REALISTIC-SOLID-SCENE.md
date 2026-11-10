> 历史记录：本文件描述已废弃的二维真实桌；当前实现与维护入口见 [Three.js 真实桌](REALISTIC-TABLE.md)。资源名及验收仅对应旧提交。
> Historical record of the retired 2D renderer; asset names and acceptance apply only to that revision. See the current Three.js contract.

# 真实桌整图与实体牌 / Whole-source realistic scene

## 展示边界 / Presentation boundary

这次不改花麻将三个规则版本、成都规则、私有手牌来源、已提交事件队列或真实数据库。牌墙不再绘制，但公开余牌数、发牌/摸牌流程以及原出牌、收牌的路径和650ms节奏保留。This revision changes presentation only. Visible walls are removed; remaining counts and accepted event timing stay authoritative.

## 一张完整来源 / One complete source

每个身份的正、左、右视角有各自完整坐姿PNG。`figure.schemaVersion = 2`与`sourceMode = singleFullBody`明确区别于旧上下身组合；`sourceSha256`绑定文件字节。完整背层与桌前手部遮罩引用同一URL，并共用同一等比矩阵。不能独立移动腿、鞋、手或膝。A full-source figure is uniformly positioned once; occlusion never becomes an excuse to move body parts independently.

`frontOfTablePolygons`只允许完整源内的像素多边形。手自然在膝上的视角可以留空，完整人物自然被桌面遮挡。远家腿脚能看到多少由真实遮挡决定，不再另向前移600px。新整图不复用旧眼发或手臂供体，`motion`与`action`为空。Classic character sources remain unchanged.

## 桌椅注册 / Furniture registration

`public/furniture/catalog.json`登记完整AI桌、正/左/右三张独立椅的PNG尺寸和SHA。桌面可用四角为原图TL(294,153)、TR(1014,153)、BR(1198,629)、BL(111,629)，整图位移(24,120)，没有非等比拉伸。`realistic-table-perspective.js`直接从同一目录计算投影；不能手调另一组牌区角点。The source-pixel registration is manually inspected, not a claim of recovered camera calibration.

椅子使用坐垫中心贴人物seatAnchor，最下椅脚与人物脚底共用地面高度。左右椅是独立来源，不镜像人物或家具。房间背景、桌、椅、人和脚都随同一场景相机移动。

## 牌面与厚度 / Face and thickness

`RealisticTableTile.vue`不创造新牌面，继续调用原`MahjongTile.vue`。四个侧面连接桌面和抬起的牌面；底缘金棕、上层象牙白，并有接触阴影。所有静态牌区继承同一高度方向，厚度不会随玩家换位而转向左右。Face IDs, hidden backs and accessibility labels stay in the canonical component.

`preserve-3d`必须贯穿felt、seat-plane、zone、grid和tile壳；不能在这些中间层加opacity/filter/overflow裁平。飞牌保留已验收的二维淡入/路径，不把其opacity动画套在实体壳上。牌墙空出的空间扩大四家牌河，仍逐区检测旋转后的碰撞和长牌河完整性。

## 私有操作与相机 / Private controls and camera

原App与ChengduTable的DOM仍通过Teleport进入真实桌。只观察其手牌底边的布局坐标，使提示、按钮或手机容器高度改变时，实际手牌仍贴近沿。没有复制手牌、动作授权或选择状态。手牌视觉尺寸随场景比例，极窄屏有18px可读下限，动作按钮不随场景缩小；横向滚动仍由原生容器处理。

三人固定空位、四人全部四方关系沿用已修正物理座位模型。观察者变化不能改变牌的世界尺寸、角色身份或已选手牌。

## 维护与检查 / Maintenance

- `src/RealisticTableTile.vue`：原牌面上的实体壳，不接收合法动作。
- `src/realistic-character-figure.js`：完整源校验、同一人物矩阵、椅座注册。
- `src/realistic-table-perspective.js`：从家具目录取角点、统一投影与相机。
- `tests/realistic-character-figure.test.js`：拒绝混源、越界mask、非等比/独立脚部位移。
- `tests/realistic-furniture-assets.test.js`：实物PNG尺寸、alpha、SHA与独立三视角。
- `tests/realistic-table-ui.test.js`：隐私、无墙DOM但保留余牌、同源图层、原操作目标与生命周期。

纯测试不代替视觉验收。发布前必须看整桌、桌下、三个/四个本人视角、桌面与手机、长牌河、成都换三张/定缺，以及经典切换后的选择保留。Use the isolated synthetic fixture; it blocks every game API call and contains no real room data.

旧 `full-body-audit.json` 与旧下层文件保留为v39历史来源记录，不是当前整图目录；当前运行时只消费 `catalog.json` 中通过v2校验的figure。Legacy audit/files remain historical provenance, not active body composition.

## 本轮验收记录 / Revision verification

- 2026-11-09：1690项测试通过，lint零错误（3项原有警告），本地生产构建通过。
- 正式18张PNG逐一验证尺寸、alpha、SHA和独立来源；四人场景依次查看六角色的正/左/右整图，修掉悬空远手，仅保留实际能接回袖口的同源前景。三张最终整桌图另经独立视觉复核。
- 三人全部3视角、四人全部4视角核对物理席位与空位；相同1280×760视口四方私有牌宽一致为32px。390窄屏从全桌到2倍放大，牌宽按相机从18px可读下限增至约27px，长牌河仍在近沿手牌上方。
- 320×560检查成都定缺原按钮及收到三张牌；1280×420检查花麻将胡/碰/杠/过控件；390宽检查完整桌下、同身份POV与自然鞋部遮挡。成都换三张的三张选择在经典/真实往返后保留。没有真实API请求。
- 新完整图的眼发及人物手动作没有沿用旧坐标，暂时关闭；既有隐藏牌面摸牌飞行、出牌/收牌事件、路径和节奏保持。
