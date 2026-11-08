# 稳定牌桌布局 / Stable table layout

## 目标与原因 / Goal and causes

2026-11-08 按用户截图移除对手画框的声线类型、牌河下方“花间 / 自贡花麻将”装饰横栏，以及本人手牌上方整条角色说明。玩家姓名、角色名/头像、我/房主/庄家标记、规则、虚拟积分、原图局部动画与角色语音保持原有来源和权限。
The November 8 screenshot request removes opponent voice-style labels, the decorative strip below the rivers, and the own-hand role-description strip. Player/character identity, badges, rules, virtual scores, original-art motion and voice retain their original sources and permissions.

原牌河只有 min-height 和 max-height，达到上限之前仍会每多一行增长；公开碰杠、胡牌、萝卜、接牌提示、动作按钮和结算说明又会插入或换行。窄屏侧栏历史和总账也会增长。这些真实布局变化会改变文档高度，并触发浏览器滚动锚定，不是“每次轮询重挂载整桌”。
Previously, min/max-height allowed rivers to grow until their cap. Melds, wins, radishes, claims, action buttons and settlement messages added rows, as did stacked narrow-screen history and ledgers. These real layout changes altered document height and browser scroll anchoring; polling did not remount the entire table.

## 实现与阅读顺序 / Implementation and reading order

1. `src/App.vue` 给条件内容加游戏期间稳定的父槽：`opponent-public-cards`、`claim-slot`、`own-public-cards`、`hand-feedback`、`room-notices`。自己的私有手牌仍受原参与者/观战条件保护。 / Stable parent slots contain conditional content. Original participant/spectator guards still protect private hands.
2. `src/tabletop.css` 最后“稳定牌桌视窗”覆盖原有 min/max 规则，按视口宽度固定可视高度。牌河、共享萝卜、身份状态、手牌、听牌、操作、动态及总账分别内部滚动。 / Final overrides fix viewport heights at each width; rivers, public cards, identity/status, hands, waits, actions, history and ledgers scroll internally.
3. `src/ChengduTable.vue` 使用独立的公开牌/牌河/接牌/说明/换牌结果槽，准备阶段到普通回合、胡后退出都不靠插入整行推动本人手牌。仍由服务端合法动作驱动按钮。 / Independent Chengdu slots stabilize preparation, normal turns and retirement. Server legal actions still drive every button.

`.stable-scroll` 或 `data-stable-scroll` 表示有名称、可 Tab 聚焦的局部滚动区。原生方向键、Page Up/Down、触摸和滚轮读取溢出内容；按钮与手牌仍保留原生焦点和至少44px动作按钮。`scrollbar-gutter: stable` 预留经典滚动条宽度，避免滚动条刚出现就让内容再次换行。超高内容从可访问的起点排布，不能用不安全居中把首行挤到负坐标。
The class/attribute identifies named, keyboard-focusable local viewports. Native keys, touch and wheel expose overflow while real buttons retain focus and existing action targets. Reserved scrollbar gutters avoid rewrapping when classic bars appear. Overflow starts at a reachable origin, not a negatively centered position.

纯横向、单行的手牌、副露牌组、暗手占位与工具/动作条单独使用 `scrollbar-gutter: auto`。它们不需要防止纵向滚动条引起换行；空竖沟槽反而会令 Chromium 的 scrollWidth/clientWidth 差值与实际横向终点不同，并让末牌进入该空白边带。该例外不改固定高度、overflow 或 Tab；牌河、公开牌、历史等纵向区仍预留 stable 沟槽。
Single-row horizontal hands, meld groups, concealed placeholders and tool/action strips use automatic gutters. They do not need protection from vertical-bar rewrapping; an empty vertical gutter instead makes Chromium's width difference disagree with the actual horizontal endpoint and places the final tile in that empty strip. This exception changes no heights, overflow or focus, while vertical rivers/public cards/history retain stable gutters.

没有添加整页 scrollTo、scrollIntoView、滚动位置重置、自动跟随或裁短牌河数组。手动回看不会被新快照强制拉回底部，所有牌河记录仍在 DOM 中。局部视窗过长时请在该区域内滚动；浏览器原生锚定可能保留当前可见条目。原飞牌和胡牌字幕已经是覆盖层，不改其完成时序或声音等待。
No document scroll compensation, scroll reset, automatic following or river-array truncation is added. New snapshots do not force manual browsing to the bottom and every river record remains mounted. Scroll within a long zone; native anchoring may preserve its visible item. Existing win flights/captions were already overlays, so their completion and audio timing remain unchanged.

## 范围与验证 / Scope and verification

保证目标是相同玩法、人数和视口宽度下，进行中的局在空/多行牌河、碰杠胡、接牌提示、操作数量、动态增长和连接状态变化时保持外部布局。主动改变屏宽/缩放、展开全局设置、开局/终局、换桌等明确界面切换仍可重排，不承诺全站永远等高。
The target is stable outer layout during an active game at a fixed mode, player count and viewport width across river rows, public cards, claims, action counts, history and connection changes. Explicit resizing/zooming, global settings expansion, game start/finish and table navigation may still reflow.

`tests/stable-table-layout.test.js` 编译真实模板与CSS并验证稳定空槽、键盘入口、完整记录、原隐私绑定及无整页滚动补偿。现有 UI、成都、画框测试继续验证合法动作、角色和私有视图；已胡必胡测试仅将容器查找改为接受新增可及性属性，并额外检查 tabindex/标签，没有放宽动作断言。
The new suite compiles actual templates/CSS to verify persistent empty slots, keyboard access, complete records, privacy bindings and no document-scroll compensation. Existing suites retain action/identity/privacy assertions. Mandatory-win container matching accepts new attributes and now asserts tabindex/labels without weakening action checks.

编译/SSR不是像素测量。真实浏览器应比较桌面及390px窄屏下的牌桌高度、本人手牌顶部、document scrollHeight、scrollY，验证增加牌河行不会移动它们；另检查聚焦牌河后方向键能滚、手动回看保持、所有按钮可达、无页面横向溢出。只能使用隔离合成已过滤快照，不向真实牌局发请求。最终实测范围与证据见 [稳定牌桌验收](STABLE-TABLE-VALIDATION.md)。
Compilation/SSR is not pixel measurement. Browser QA compares table height, own-hand top, document scrollHeight and scrollY on desktop and 390px layouts, plus keyboard river scrolling, preserved manual browsing, action reachability and no page-wide horizontal overflow. Use isolated synthetic filtered views only, never real-game requests; [the validation report](STABLE-TABLE-VALIDATION.md) records measured scope and evidence.
