# 写实人物素材状态 / Realistic character asset status

此目录包含六角色×正/左/右共18张已审查透明底姿态，以及每视角真实半闭/全闭眼的局部无损图集。头发沿用有界原纹理几何；地主短发不强行摇帽子。右手动作仍未放行，catalog中action均为null。
This directory contains18 reviewed transparent base poses and losslessly packed real half/closed-eye donors. Hair uses bounded original-texture geometry; the landlord cap is not animated as hair. Right-arm actions are not accepted yet: every catalog action remains null.

## 身份来源 / Identity provenance

以 `../portrait-reactions-manifest.json` 与 `*-scene-base.png` 为原始依据，不使用早期生成的 `{id}.png` 替代用户原图。`source-audit.json` 固定来源哈希和审计范围。
Use the user-supplied scene PNGs and their reaction manifest, not earlier generated `{id}.png` portraits. The audit records source hashes and its scope.

六个视觉角色为 sweet（粉衣邻家）、elegant（紫衣御姐）、landlord（地主）、honest（老实人）、wealthy（富婆）、star（女明星）。排除当前 sunny 黄色双马尾视觉角色；保留已有协议ID，不重分配已经保存的座位。
The six visual identities retain sweet, elegant, landlord, honest, wealthy and star. Exclude the current yellow twin-tail sunny art while preserving saved IDs and seating.

音频旧标签 sweet=萝莉音、sunny=阳光少女音，与后来的用户原图角色身份不一致。本次来源审计不声称完成声音试听，也不凭推测改音频文件。
Historical voice labels differ from the later supplied visual identities. This source audit does not claim an auditory review or alter audio files speculatively.

## 组件合同 / Component contract

`src/RealisticCharacter.vue` receives `character`, `position`, `action`, and `enabled`. `character` is the existing identity/name/portrait/reaction/phase-key object. `position` uses screen seats: left faces right, right faces left, north/south use front. `action` is an already-displayed public `{ type, eventKey }`, never private hand data or an optimistic click. The host owns table layout and public-event pacing.

`src/realistic-character-catalog.js` only admits explicitly approved independent assets. Excluded or unknown identities remain empty without changing the saved role; included roles with a missing view preserve their original `CharacterArtwork`. No mirroring, CSS body floating, or retired Live2D assets are used to claim new action capability.

当前记录包含 `approved`, `baseUrl`, `width`, `height`, `motion` 和 `action`。motion 使用既有 schema2 局部渲染合同并显式标记 realisticView 来源；action 只有袖臂连续性验收通过后才登记，当前均为 null。
Current descriptors provide the fields above. motion uses the existing schema-two local compositor with an explicit realisticView source marker. Action descriptors remain null until sleeve/hand continuity passes review.

## 放行条件 / Acceptance gate

- 对照正式原图检查人物面部、发型、衣服与非对称饰物；左右视角独立绘制，绝不镜像。
  Compare face, hair, outfit and asymmetric accessories to the formal original; author both sides independently.
- 每角度检查全闭合/半闭合眨眼、头发小幅连续运动和解剖学右手动作，不能把左右屏幕坐标当作左右手。
  Review closed/half-closed blinks, subtle hair continuity and anatomical right-hand actions per perspective.
- 在实际200–300px人物尺寸逐帧播放检查注册抖动、手部畸形、脸部漂移、循环跳变和透明边缘。
  Play at actual 200–300px actor size and inspect registration jitter, hands, facial drift, loop seams and alpha edges.
- 必须验证视角切换、换角、旧异步load、前后台、减少动态、离屏和卸载；动作只消费已提交公开新事件。
  Verify perspective/role changes, stale loads, foreground, reduced motion, visibility and teardown; consume committed public new events only.
- 未批准候选放仓库外，不进入 `public` 或部署。专项测试为 `tests/realistic-character.test.js`。
  Keep unapproved candidates outside the repository and deployment. Focused tests live in the named suite.

## 当前维护入口 / Current maintained entry

- `src/RealisticCharacter.vue`: 按已保存角色与屏幕座位选视角；排除角色留空，有底姿态时反应不跳全场景。 / Select saved identity and screen perspective; excluded roles stay empty and reactions retain the pose.
- `src/RealisticCharacterArtwork.vue`: 复用眼发渲染器的生命周期；右手渲染独立，已错过事件不补播。 / Reuse the local eye/hair lifecycle; independently manage hands without missed-event replay.
- `src/realistic-character-actions.js`: 有界右手供体/去臂底板合成准备层，当前无批准素材。 / Bounded right-arm/clean-plate preparation, currently without approved assets.
- `tests/realistic-character*.test.js`: 来源、角色、侧向路径、动作别名、校验与帧时间专项；不等于视觉验收。 / Provenance, identities, perspective paths, action aliases, validation and frame timing, not visual certification.

## Seated full-body layers / 完整坐姿层

All six supported identities now have three reviewed lower-body layers. The original upper PNG and eye/hair coordinates remain unchanged. `body.upperRect` places that original source 1:1 into a possibly wider transparent canvas, while `lowerSourceRect` maps uniformly into `lowerRect`. Optional union `upperClipPolygons` hide only an old incorrect lap, and bounded `sleevePatches` repair cropped sleeve bottoms behind the original upper artwork. `full-body-audit.json` records exact shipped lower-layer hashes. The runtime rejects missing approval, unsafe paths, invalid crops and nonuniform scaling.

六个角色均有独立三视角坐姿下层，保留原头脸、眼发与衣饰身份，不镜像、不拉伸。桌面/桌裙负责遮挡，下层不是一张烘焙桌面背景。本人使用另外制作的第一人称膝腿素材，不把正面坐姿翻转。本人视角覆盖全部六个角色；老实人、清岚、地主、富婆、女明星有坐姿膝腿/裙与鞋，小桃明确仅显示小腿、白袜与穿着的粉鞋，不称膝以上全身。她的该层采用较小等比取景，不借用其他角色或把空鞋当成穿着。六个角色在其他玩家视角的三张完整坐姿照常显示。
