# 手机横屏桌 / Mobile landscape table

## 使用与边界 / Usage and boundaries

开局后在页眉选择“横屏桌”。它是经典桌、横屏桌、真实桌中的独立本机显示偏好，沿用 `huajian-table-presentation-v1`，新增值 `landscape`。旧 `realistic` 偏好原样恢复，非法值回到经典桌。横屏桌不调用方向锁定/全屏，不改变服务器玩法、版本、规则或合法动作。
After a game starts, choose Landscape in the header. This third local view reuses the existing preference key with the new landscape value. Existing realistic choices restore unchanged, and invalid values fall back to classic. No orientation lock/fullscreen or server mode/version/rule/action changes occur.

横向且宽度至少560px时启用动态视口高度的一屏布局；竖屏及更窄视口继续用原可滚动排版并提示转向。切换模式、展开详情和旋转均不重新建房、不重置已选牌。各模式沿用同一份手牌/动作节点；Teleport仍仅由真实桌条件开启。
Fit one dynamic-height viewport when landscape and at least560px wide; portrait/narrow viewports keep the scrollable original layout and a rotation hint. Mode/detail/orientation changes never recreate rooms or reset selection. Original private controls remain single instances; only realistic mode enables Teleport.

## 排版合同 / Layout contract

- 横屏工具条可横向滚动，按钮至少44px高；状态条保留本人/观战身份、余牌及原状态。成都直接复用 `chengduTableStatus`，不另判准备/回应状态。 / The scrollable toolbar keeps44px buttons; status retains identity, wall count and existing wording. Chengdu reuses its existing status helper rather than inventing preparation/claim logic.
- 花麻将对手公开区在上，萝卜与有归属名字的牌河居中，本人手牌和动作在底部。暗手只折叠重复牌背，数量仍在身份行；终局牌面仍来自原摘要守卫。 / Flower places public opponents above radishes/named rivers and own controls below. Only redundant concealed backs collapse, with counts retained; terminal hands retain original summary guards.
- 成都四家公开区同列，保留定缺/已胡状态、碰杠及牌河；换三张、定缺、接牌和出牌仍调用原组件。 / Chengdu aligns four public seats with missing-suit/win status, melds and rivers; preparation/claim/discard controls remain the original component.
- 手牌44×56px，不缩成整页比例；窄屏原生横滚至末张。按钮44px，独立46px动作带不遮牌；无动作时不挂载按钮节点，保留底部布局稳定。 / Tiles are44×56px with native overflow, not a scaled page. Buttons remain44px in a separate46px band; absent action nodes leave stable hand geometry.
- 错误/离线仍显示。观众原接牌页脚在有公开回应窗口时保留，抢杠来源及牌面不能因其尚未在牌河而消失；观众无私有手牌和动作。 / Errors/offline remain visible. Spectator claim footers retain public rob-kong sources/faces before those tiles reach rivers, without private controls.
- “详情 / 积分”恢复原页面的规则、账本、记录、完整立绘、私有诊断、状态和结算。横屏终局工具条也可直接打开原“本局结算 / 下一局”。 / Details restores original rules, ledgers, history, art, private diagnostics and settlement. The terminal toolbar also opens the existing summary/next-round dialog.

## 维护入口 / Maintenance map

`src/App.vue` 管理展示偏好、详情开关和只读状态；`src/main.js` 最后导入 `src/landscape-table.css`。所有新CSS选择器必须以 `.is-landscape-table` 开头，紧凑规则还受 `:not(.landscape-details-open)` 与横屏媒体条件约束。
App owns local preference/details/read-only status; main imports landscape CSS last. Every new selector must start with its independent root class, with fitted rules additionally guarded by closed-details and landscape media conditions.

`src/RealisticTable.vue`、`src/realistic-table.css`、`src/realistic-*`、`src/three-table/**`、`src/ChengduTable.vue`、所有规则引擎、API、存储、音频和资产均不修改。
Realistic components/styles/adapters/renderers, the Chengdu component, rules engines, API, storage, audio and assets remain unchanged.

## 验证 / Validation

- `tests/landscape-table.test.js`：独立CSS根类、横屏条件、安全区、触控尺寸声明、真实桌/Teleport隔离及状态/观战合同。 / CSS scope, media conditions, safe areas, declared hit targets, realistic/Teleport isolation and status/spectator contracts.
- `tests/ui.test.js`：真实SFC setup/SSR的模式往返、选牌/会话/权威快照保留、零API、详情清理、保存偏好与非法值恢复。 / Real SFC setup/SSR verifies mode round trips, preserved selection/session/snapshots, no API, details cleanup and saved/invalid preferences.
- 隔离入口 `tests/browser/stable-table-preview.html` 增加显示模式、六个横向宽度和短屏高度。“只调整视口”不重设快照，专门检查旋转保留选牌。网络与游戏提交仍由原双重边界阻断。 / The isolated fixture adds presentation/landscape dimensions and a viewport-only resize control that retains selection. Existing network/action denial boundaries remain.

真实浏览器尺寸与验证限制见 [验收记录](qa/LANDSCAPE-TABLE-20261110.md)。源码/内存DOM测试不证明物理触屏、iOS Safari或WebGL像素通过。
See the acceptance record for measured browser results/limits. Source and memory-DOM tests do not establish physical touch, iOS Safari or WebGL pixel validation.
