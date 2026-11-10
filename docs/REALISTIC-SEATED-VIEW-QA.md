> 历史记录：本文件描述已废弃的二维真实桌；当前实现与维护入口见 [Three.js 真实桌](REALISTIC-TABLE.md)。资源名及验收仅对应旧提交。
> Historical record of the retired 2D renderer; asset names and acceptance apply only to that revision. See the current Three.js contract.

# Seated-view acceptance / 坐桌边视角验收

2026-11-09, successor to the v38 presentation. This is presentation-only: no rules, scoring, room protocol, database or production game actions changed.
2026-11-09，在v38展示上修复；不改玩法、计分、房间协议、数据库，也未通过真实房间提交验收动作。

## Physical seats / 物理座位

Three-player seat 0 sees self south, seat 1 left, seat 2 right. Seat 1 sees self south, seat 0 right and seat 2 north. Seat 2 sees self south, seat 0 left and seat 1 north. The same fourth physical vacancy rotates with the viewer. Four-player rotation remains consistent in all four viewpoints. Pure tests cover every viewer, pairwise relations, zones and wall slots. The visible isolated fixture verified all seven viewer configurations against actual DOM positions.
三人桌0号视角：本人下、1号左、2号右；1号视角：本人下、0号右、2号对面；2号视角：本人下、0号左、1号对面。固定空位随观察者旋转，不能每个人都强制空对面。四人四视角同样验证。

## Real components / 真实组件

- One continuous 2D homography projects felt, walls, hands, rivers, melds, wins and committed-event flights into a narrower far edge and wider near edge. Character faces are not skewed; no 3D engine is introduced.
- Original Flower/Chengdu private controls are teleported onto the near edge after the real target mounts. Repeated switches retain selection and node identity. There is no second bottom control panel or duplicate self rack. Original server-action and privacy guards remain.
- Browser inspection covered desktop 1280×760, phone 390×760 and short 320×420 frames. On the smallest frame the hand scrolls horizontally and the preparation panel vertically; the exchange confirmation remains reachable. Selecting three tiles, switching classic and back preserves all three selections. No real submission was made.
- Real pointer dragging followed by release restored the default camera. The stable under-table button and Full table button, key handling, resize and preserved Teleport target are component-tested. Background, table, chairs and actors follow one scene camera. First-person foreground stays cropped at the viewport bottom when the entire room fits a tall phone.

以上对应统一二维梯形、原私有控件搬到近沿、窄屏可滚动与选牌保留；真实拖动松手回正。所有浏览器快照都是合成玩家，API被客户端与隔离服务器双重封锁。

## Assets and coverage / 素材与覆盖

All 18 independent seated body views were inspected in the actual four-player UI at full-table and under-table framing. The original upper artwork, identity, accessories and eye/hair coordinates remain unchanged. Lower PNGs are transparent and uniformly scaled. Expanded dress canvases preserve hems and shoes. Reviewed upper masks hide old incorrect laps; the landlord front has two bounded sleeve-bottom repairs. The apron correctly occludes the far waist seam while feet remain visible below it. A separate empty tea-room background contains no baked players, table, tiles or controls.

Six identities have separately approved first-person assets. Honest, elegant, landlord, wealthy and star show their own seated lap/legs and footwear. Sweet deliberately shows only lower shins, white socks and worn pink-white shoes, at a smaller uniform scale. It does not imply a knee/thigh view. The rejected empty-shoe candidate is not shipped.

18张坐姿、6个身份本人近景均已逐项组合验收；小桃仅膝下，不与其余五角范围混称。不镜像、不拉腿、不用其他角色代替。素材构建门检查实际PNG尺寸、alpha、hash、裁切、原上身尺寸与身份绑定。未批准或非法元数据不渲染；网络图片加载失败尚无专门的事件降级状态。

Character reaching animations remain separate work. No hand-action sequence is claimed complete by this release.
人物右手摸打动作仍是单独工作，本次不把飞牌或眨眼当成人物伸手完成。
