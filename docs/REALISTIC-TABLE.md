# Three.js 真实牌桌 / Three.js realistic table

## 阅读与权威边界 / Reading and authority

真实桌替换为 Three.js 场景，仍是同一房间的本地显示方式，不是新玩法。`App.vue` 的 `huajian-table-presentation-v1` 偏好及「经典桌 / 真实桌」入口不改；切换不建房、不发牌、不重算积分、不提交动作。花麻将三个规则版本、成都独立规则、保存局、联机和观战继续使用原实现。
The realistic view is now a Three.js scene, still a local presentation of the same room, not another game. Existing preferences and view switching preserve room, deal, scores and action paths. All Flower versions, separate Chengdu rules, saved rounds, networking and spectators retain their authority.

维护文件 / Maintained files:

- `src/RealisticTable.vue`：Vue 与三维场景的生命周期、DOM 工具及原私有控件的 Teleport 目标。 / Vue lifecycle, DOM tools and the destination for original private controls.
- `src/three-table/adapter.js`：从已显示快照构建只读模型，把座位和公开牌区映射到三维区域。 / Adapts the displayed snapshot into a read-only scene model and tile zones.
- `src/three-table/lifecycle.js`：可重复清理与房间/单局/递增帧序号门。 / Idempotent cleanup and room/round/monotonic-frame gates.
- `src/three-table/renderer.js`：Three.js 相机、网格、材质、贴图及渲染资源。 / Three.js camera, meshes, materials, textures and rendering resources.
- `src/realistic-table-layout.js`：沿用的隐私投影、固定物理座位、终局摘要门及完整牌区模型。名称为兼容保留，不代表继续使用旧二维渲染器。 / Retained privacy projection, fixed physical seating, terminal-summary gate and complete tile model; its compatible name does not imply the retired 2D renderer.
- `src/realistic-presentation.js`：原 App FIFO 与公开事件边界。 / Existing App FIFO and public-event boundaries.
- `src/realistic-popover.js`：原私有说明与开局选项的本地弹层，不拥有游戏动作。 / Local diagnostics/start-option popovers, without gameplay authority.

## 隐私与操作 / Privacy and controls

场景只接受已经按查看者裁剪且实际显示的视图；不读完整存档、牌墙身份或未公开回应。隐藏牌即使意外带有牌种也必须丢弃牌种，不得影响纹理、DOM 或读屏文字。未知数量保持未知，不伪造为零。终局摊牌仍只信任同时满足房间/单局 finished、模式一致及座位完整的权威摘要。
Only the viewer-filtered displayed view enters the scene, never full saves, wall identities or pending responses. Hidden identities must not affect textures, DOM or accessible text, even if accidentally attached. Unknown counts remain unknown. Terminal hands still require matching room/game finished phases, mode and complete original-seat summary data.

私有手牌、选牌、胡碰杠过和成都准备控件仍由 App/ChengduTable 的原 DOM 负责。`controls-target` 只传递挂载目标，不传动作权限；卸载清空目标，重复切换不得遗失节点或选牌。Three.js 不监听牌面并另建一条网络动作路径。
Original App/ChengduTable DOM retains private hands, selection, claims and preparation controls. The controls-target event carries only a mounted destination; teardown clears it and repeated switching must preserve nodes and selection. Three.js adds no independent tile-to-network action path.

绝对座位与四个物理方向的对应不变，观察者变化只旋转全桌和空位。三人桌0号视角为南0/左1/右2/北空；四人桌为南0/左1/北2/右3。观众只锚定公开0号视角，不获得本人身份。
Physical seating remains fixed; viewer changes rotate the whole table including its vacancy. Seat-zero views retain south0/left1/right2/north-empty for three players and south0/left1/north2/right3 for four. Spectators use public seat-zero orientation without becoming that player.

## 播放与释放 / Playback and disposal

挂载只建立当前展示帧基线，不补播已有历史。新效果来自 App 已授予的 FIFO 帧，必须匹配房间/单局及递增序号；重复轮询、旧桌回调和 reset 不得复活旧效果。声音和真实规则仍沿原路径推进。换桌、隐藏、卸载和减少动态的行为需要专项回归，不用三维帧率代替播放完成。
Mounting establishes a frame baseline without replaying history. Effects consume App-authorized FIFO frames with matching room, round and increasing sequence; polls, stale callbacks and resets cannot revive old effects. Audio and rules retain their paths. Test interruptions, hidden state, teardown and reduced motion separately from frame rate.

资源清理包含动画请求、监听/观察器、几何、材质、纹理与 WebGL renderer；迟到加载回调不得给已销毁场景加对象。WebGL 不可用时必须保留原私有控件和公开信息的可达性，不能让规则按钮消失。
Dispose animation requests, listeners/observers, geometry, materials, textures and the WebGL renderer. Late loads cannot attach to a disposed scene. WebGL failure must keep original controls and public information reachable.

## 验证与历史 / Validation and history

保留 `realistic-table-layout`、`realistic-presentation`、`realistic-popover`、`ui` 与 `invitation-copy` 的隐私、FIFO、权威和节点连续性回归。Three.js 的模型、资源清理与真实 SFC 测试补充这些边界；完整命令仍为 `npm test`、`npm run lint`、`npm run build`。
Retain privacy, FIFO, authority and node-continuity regressions in the existing suites. Three model, disposal and actual-SFC checks supplement them. Run the full test, lint and build commands.

旧 REALISTIC-SOLID-SCENE、REALISTIC-ROUNDED-TILES、REALISTIC-SEATED-VIEW-QA、REALISTIC-V41-CORRECTIONS 与 qa 中旧报告保留历史证据，不证明 Three.js 版本的像素、触屏、GPU 或移动端验收。资源清理以实际引用为准：共享牌图、原立绘、音频、经典桌、规则、房间和数据不属于废弃范围。
Older realistic scene/tile/seated/v41 and QA reports remain historical evidence, not pixel, touch, GPU or mobile acceptance of Three.js. Cleanup follows actual dependencies; shared tile art, original portraits, audio, classic view, rules, rooms and data are not obsolete.

## 本次清理 / Retired implementation cleanup

删除旧角色拼接组件、局部动作渲染器、CSS实体牌组件、二维投影/飞牌/墙牌几何与专属测试；删除其独占的桌椅、房间底图、旧底姿/腿部/袖片/POV/动作图集。保留18张已批准整身图、目录来源与哈希，供三维场景按视角切换。原共享 portrait-motion 只保留经典原图路径，拒绝已废弃的真实桌动态描述符。所有删除文件仍可从迁移前 Git 历史恢复。
Remove old actor stitching, local actions, CSS tile solids, 2D projection/flights/wall geometry and their exclusive tests/assets. Preserve all eighteen approved full figures, provenance and hashes for camera-driven Three views. Shared portrait motion now rejects retired realistic descriptors while retaining classic paths. Deleted files remain recoverable in pre-migration Git history.

当前专项维护清单：`tests/realistic-character.test.js` 验证保留18张图与身份；`tests/realistic-character-motion-paths.test.js` 验证废弃入口拒绝；`tests/realistic-table-layout.test.js` 验证隐私、座位、旧规则投影和无墙读取；`tests/realistic-table-ui.test.js` 验证实际Vue包装；`tests/invitation-copy.test.js` 保留各版本反复切换与原动作按钮。Three 专项由 `tests/three-table*.test.js` 覆盖。
Current focused suites cover retained art/identity, rejected retired paths, privacy/seat/legacy projections, the actual Vue wrapper, repeated switching and original actions; Three-specific tests cover the replacement renderer.
