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
