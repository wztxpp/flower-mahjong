# 稳定牌桌验收 / Stable table validation

2026-11-08；基线 `527c22b690d120dd2934e4b1f5505c0ac4326f7a`；分支 `stabilize-table-layout-20261108`。本地验收，未发布。实现说明见 [稳定牌桌布局](STABLE-TABLE-LAYOUT.md)。
November 8, 2026; baseline/branch above. Local validation, not deployment. See [the layout contract](STABLE-TABLE-LAYOUT.md).

## 结论 / Result

真实浏览器中的花麻将/成都、旧schema与观战矩阵全部通过；非零页面滚动起点下，两模式的scrollY、手牌顶部和文档高度变化均为0。桌面花麻将4人/成都4人及390px两模式截图已目视：红框三类组件已删除，固定槽无覆盖，动作可达。
All real-browser mode/version/spectator matrices pass. Both modes also preserve scrollY, hand top and document height with zero deltas from nonzero scroll positions. Desktop four-seat and390px screenshots confirm the three removals, no overlapping slots and reachable actions.

隔离预览编译真实App/成都组件与原CSS，只替换测试初始化/网络，使用合成已过滤快照；不加载API/存储/数据库，阻断API请求及真实动作点击。没有向真实游戏发送任何动作。
The isolated preview compiles actual components/CSS with test-only initialization/transport and synthetic filtered views. It loads no API/store/database and blocks API traffic/game actions. No real-game actions were sent.

## 证据 / Evidence

每组从空视图经历13次变化：一行/多行/增长牌河、摸打、接牌、公开牌、历史、长昵称/分数、提示、busy、syncing、offline、恢复。比较基线及前一步，容差1px。
Each case applies thirteen changes covering river rows/growth, discard, claim, public cards, history, long names/scores, hints, busy/syncing/offline and restoration, compared with baseline and previous state at1px tolerance.

| 记录 / Record | 范围与结果 / Scope and result |
|---|---|
| [browser-six.json](verification/stable-table/browser-six.json) | 花麻将3/4人、成都4人，各1280×760及390×760；6组、78次变化全部通过。 / Six cases,78 changes, all pass. |
| [browser-compat.json](verification/stable-table/browser-compat.json) | 花麻将旧schema1/2及两模式观众，各1280/390宽；8组、104次变化全部通过。 / Frozen versions/spectators: eight cases,104 changes, all pass. |
| [browser-scroll-flower.json](verification/stable-table/browser-scroll-flower.json) | 390px花麻将，从scrollY1656开始13次变化；scrollY、手牌顶部、文档高度差全部0。 / Thirteen changes from scrollY1656; all three deltas zero. |
| [browser-scroll-chengdu.json](verification/stable-table/browser-scroll-chengdu.json) | 390px成都，从scrollY3173开始13次变化；上述差全部0。 / Thirteen changes from scrollY3173; the same zero deltas. |
| [ssr-view-fixtures.json](verification/stable-table/ssr-view-fixtures.json) | 7类×14阶段，98幅真实组件SSR完成；仅离线辅助证据，不替代浏览器。 / All98 SSR frames complete; supplemental offline evidence only. |

资源就绪、局部中段/底部回看保留及实际overflow末端可达均通过。末端判据仍严格检查client边界，未扩大容差。SSR报告里的浏览器不可用说明只适用于早先诊断时点，后来已完成上述浏览器验收。
Resource readiness, retained local browsing and overflow endpoints pass, retaining strict client-bound checks. The SSR report's browser-unavailability note applies only to its earlier diagnostic run, before the browser checks above.

## 原生按键与诊断页 / Native keys and diagnostic page

- 实际390px花麻将手牌：3次ArrowRight到120，再8次到305＝614−309；末牌right334＜容器right343，完整可见。 / Actual Right-arrow input reaches the305 maximum and fully exposes the final tile.
- 实际牌河PageUp：599→473，ArrowDown→513，焦点保留。这是原生按键观察，不只检查tabindex属性。 / Native Page Up/Down changes scroll positions while retaining focus, beyond attribute-only checks.

诊断页渲染约1.8MB JSON全文pre期间出现临时AX读取超时；没有浏览器栈，不能认定唯一原因。为消除已量化的大段布局/AX负担，现仅显示≤24KiB摘要，完整数据留在非渲染JSON节点。只改报告展示，快照/测量/容差未变；之后两模式非零scrollY的13变化均重新通过，对应上方两份scroll报告。
A temporary AX read timeout occurred while the diagnostic page rendered roughly1.8MB of report text; no browser stack established a sole cause. To remove this measured layout/AX burden, visible output is capped at24KiB while complete data remains in a non-rendered JSON node. Measurements/tolerance are unchanged; both nonzero-scroll audits passed again afterward.

## 最终检查与复现 / Final checks and reproduction

- `npm test`：1323/1323通过，0失败、0跳过。 / All1323 pass; no failures/skips.
- `npm run lint`：0错误、4条既有warning（Worker默认导出、game两处未用变量、rob-kong未用passAll），另有既有Next pages目录提示。 / No errors; four existing warnings plus the existing Next pages-directory notice.
- `npm run build`：通过，45模块。 / Passes,45 modules.
- `git diff --check`：通过。 / Passes.

专项命令：`node --test tests/stable-table-layout.test.js tests/stable-table-fixture.test.js tests/ui.test.js tests/chengdu-ui.test.js tests/portrait-layout.test.js`。预览：`node tests/browser/stable-table-preview-server.mjs 5518`，只监听127.0.0.1；使用页面可见控件运行矩阵，先滚至手牌再验非零scrollY。本次预览服务已停止。
The focused command above covers layout/fixture/UI suites. Start the loopback-only preview with the listed command and use its visible controls; scroll to the hand before nonzero-scroll audits. This validation's preview service has been stopped.

## 限制 / Limits

- 390px是真实iframe响应式宽度，不是实体手机/触摸硬件验收；未验其他浏览器、读屏语音、设备声音听感或网络多人同步。 / Real390px responsive frames, not physical phones/touch hardware; other browsers, spoken screen readers, listening quality and multiplayer networking remain untested.
- 不承诺切玩法/人数/视口、开局/终局或主动展开全局设置后等高；以上检查也不代表全仓TypeScript检查通过。 / Explicit layout/lifecycle/settings changes are outside the stability guarantee; no repository-wide TypeScript pass is claimed.
- `shared/`、`server/`、`public/`、`src/portrait-motion/`、依赖清单/锁文件无diff。未push、合并或部署；证据不含真实牌局/个人记录。 / Rules/server/assets/motion/dependencies are unchanged. No push, merge or deployment, and no real-game/personal records in evidence.

## v32操作按钮位置修正 / v32 action alignment correction

基线 `ac10fa3`。截图指向花麻将“选牌后打出”按钮：稳定布局的flex-start使单个按钮贴左。只给动作行首尾元素添加自动行内边距，放得下时居中，超宽时边距归零从起点滚动；68px高度、动作权限和成都原有对齐不变。
Baseline `ac10fa3`. The screenshot identifies Flower's discard button: the stable flex-start row left-aligned a lone action. Auto inline margins on the first/last elements center fitting groups and collapse on overflow, retaining the reachable start. Height, permissions and Chengdu alignment are unchanged.

[本轮浏览器数据](verification/stable-table/action-alignment-browser.json)：桌面1280及390px的两玩法六组78次变化通过；花麻将1280/390/320px的单按钮与四按钮组中心偏差均为0。320px五动作压力视图的scrollWidth488/clientWidth244，首按钮在起点内，8次右键到244，末按钮完整可见；8次左键回0，首按钮恢复，行高始终68px。320px从scrollY1813起的13次布局变化也通过。
[Browser evidence](verification/stable-table/action-alignment-browser.json): all six mode/width groups and78 changes pass. Flower's single/four-action groups have zero center offset at1280/390/320px. The five-action stress row reaches its244px horizontal maximum with Right arrows and returns to zero with Left arrows; both endpoints remain visible and height stays68px. Thirteen changes from scrollY1813 at320px also pass.

自动检查1326/1326通过，lint零错误/4条既有warning，构建通过。320px仅作额外动作压力测试，原320px页面最小宽度在经典滚动条下仍可能产生整页横向滚动，不把它称为全页无溢出验收。测试工具任意跨人数中局切换曾出现Vue卸载错误，可能涉及旧v-memo缓存碰撞，未确认线上影响；失败路径未计通过。正式矩阵及重载后的独立对齐检查正常。未执行真实游戏动作、未发布。
All1326 tests pass, with zero lint errors/four existing warnings and a successful build. The320px stress check does not claim page-wide overflow freedom: the existing minimum width can exceed the classic-scrollbar client area. Arbitrary mid-game player-count replacement in the fixture produced a Vue unmount error, possibly involving old v-memo cache collisions; production impact is unconfirmed and that failed path is not counted as a pass. The standard matrix and independent alignment checks after reload pass. No real-game actions or publication occurred.

## 本轮完整界面修正 / Complete current UI correction

以下结果以 `ac10fa3` 为基线，包含操作居中、普通内容预留、移除角色名片及信息置底，取代上节“320px整页仍可能横滚”的阶段性限制。它不包含独立的规则修复，也未发布。
These results cover action alignment, normal-content capacity, removed role nameplates and bottom information from baseline `ac10fa3`. They supersede the earlier320px page-overflow limitation, exclude independent rule fixes and do not indicate publication.

- [最终浏览器记录](verification/stable-table/table-usability-browser.json)：花麻将3/4人、成都4人，1280/390px共6组78次变化通过；旧schema1/2与两模式观战共8组104次变化通过。所有资源、局部回看保留和长内容末端判据均通过。 / Final browser evidence: six player cases/78 changes and eight compatibility cases/104 changes pass, including resource, retention and endpoint checks.
- 30幅常态/普通公开牌画面涵盖两模式玩家和观众、1280/390/320px。整页宽度分别等于1265/375/305px可用宽度；桌面无局部溢出，手机短局只需手牌横滚，18张牌河超出容量时仍保留局部滚动。普通四人账本、一组碰杠加一张胡牌、13张共享萝卜均无需额外滚动。 / Thirty normal/public-card frames fit the available document widths. Desktop regions fit; phone hands and rivers beyond capacity remain locally scrollable. Ordinary ledgers, one meld plus one win and thirteen shared radishes fit.
- 成都换三张、定缺及收到三张牌另验6幅画面，三项定缺动作在320px也完整显示。15幅终局玩家/观众画面确认页脚在牌区/本人立绘之后，结束按钮未超出容器；观众无私有手牌或本人摘要。 / Six preparation frames retain complete instructions/receipts and all three missing-suit buttons at320px. Fifteen finished views put status/results below play/art, with contained controls and no spectator private hand/own summary.
- 所有30幅画面的可见角色名片数为0，实际玩家昵称3/4个仍在。原PNG及动画、语音代码未修改。 / All thirty frames have zero visible role nameplates and retain three/four player nicknames. Original images, animation and audio code are unchanged.
- 普通折叠反馈在1280/390/320px分别使用80/120/140px，scrollHeight与clientHeight相同。长诊断曾实测120px视窗内432px内容，End到312、Home回0，最后结算完整可读；该专项在后续名片/页脚移动前完成，反馈本身样式此后未变。主动展开时手牌文档位置与页面总高不变，原生焦点滚动可有1px取整差。 / Normal feedback has no overflow at80/120/140px. Earlier long-feedback native-key checks reached both ends of432px content within120px; subsequent changes did not alter feedback CSS. Explicit expansion preserved document geometry, with a1px native-focus rounding difference.
- [最窄动作复验](verification/stable-table/narrow-action-final.json)：四动作行229px内完整居中，偏差0；五动作压力行480px，右键到251最大值，末按钮right224.55位于229px视窗内。保留68px高度和按钮尺寸。 / Final narrow controls: four actions center with zero offset in229px; five-action stress reaches its251px maximum and exposes the last button, preserving height/target sizes.
- 非零起点专项：320px花麻将scrollY1716、390px成都scrollY3035各13次变化通过，文档高度、手牌位置与scrollY无布局漂移。 / Thirteen changes pass from nonzero scroll positions1716 and3035, without geometry/scroll drift.
- 最终自动检查：`npm test`1340/1340，0失败/跳过；lint0错误、4条既有warning及既有Next pages提示；build通过45模块；diff-check通过。两SFC的script setup与基线逐字节一致，规则、服务端、依赖和素材无diff。 / Final checks: all1340 tests pass, lint has zero errors/four existing warnings, build/diff checks pass, and both SFC scripts exactly match baseline. Rules, server, dependencies and assets are unchanged.

浏览器使用隔离合成夹具，没有真实出牌、开局或返回大厅请求。预览服务已停止。本轮不验证实体手机/触摸、真实多人网络或动画听感；本地预览曾提示开发态public目录JSON导入限制，故不据此宣称动画播放验收。长局牌河/公开牌、历史、长名单、展开诊断及手机完整手牌仍可滚动，不隐藏或截断它们。旧的任意跨人数中局替换夹具异常仍保留为未确认线上影响的独立限制。
The isolated fixture sent no real game/start/navigation requests and its server is stopped. This run does not validate physical touch devices, multiplayer networking or animation/audio playback; a development-only public-JSON import warning prevents claiming animation acceptance from this preview. Long rivers/public zones/history/ledgers, expanded diagnostics and complete phone hands remain accessible, not clipped. The earlier arbitrary player-count replacement fixture issue remains a separate unconfirmed-production limitation.
