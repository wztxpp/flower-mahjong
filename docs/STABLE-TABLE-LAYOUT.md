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

花麻将操作条在放得下时整组居中（包括单个禁用“选牌后打出”、等待或同步提示），只给首/尾元素设置 inline 方向 auto 外边距。Flex 在有剩余空间时平分两端空白，溢出时自动外边距归零，仍从 flex-start 起点滚动；不依赖不安全的 center，也不添加包裹层或修改动作条件。固定68px高度、手牌位置与成都独立操作条保持原样。
Flower actions center as a group when they fit, including a lone disabled discard button or waiting/busy message. Only first/last elements receive inline auto margins: flex divides spare space between them and resolves them to zero on overflow, retaining the flex-start scrolling origin. No unsafe center, wrapper or action-condition change is needed. The fixed68px height, hand position and independent Chengdu bar remain unchanged.

没有添加整页 scrollTo、scrollIntoView、滚动位置重置、自动跟随或裁短牌河数组。手动回看不会被新快照强制拉回底部，所有牌河记录仍在 DOM 中。局部视窗过长时请在该区域内滚动；浏览器原生锚定可能保留当前可见条目。原飞牌和胡牌字幕已经是覆盖层，不改其完成时序或声音等待。
No document scroll compensation, scroll reset, automatic following or river-array truncation is added. New snapshots do not force manual browsing to the bottom and every river record remains mounted. Scroll within a long zone; native anchoring may preserve its visible item. Existing win flights/captions were already overlays, so their completion and audio timing remain unchanged.

## 范围与验证 / Scope and verification

保证目标是相同玩法、人数和视口宽度下，进行中的局在空/多行牌河、碰杠胡、接牌提示、操作数量、动态增长和连接状态变化时保持外部布局。主动改变屏宽/缩放、展开全局设置、开局/终局、换桌等明确界面切换仍可重排，不承诺全站永远等高。
The target is stable outer layout during an active game at a fixed mode, player count and viewport width across river rows, public cards, claims, action counts, history and connection changes. Explicit resizing/zooming, global settings expansion, game start/finish and table navigation may still reflow.

`tests/stable-table-layout.test.js` 编译真实模板与CSS并验证稳定空槽、键盘入口、完整记录、原隐私绑定及无整页滚动补偿。现有 UI、成都、画框测试继续验证合法动作、角色和私有视图；已胡必胡测试仅将容器查找改为接受新增可及性属性，并额外检查 tabindex/标签，没有放宽动作断言。
The new suite compiles actual templates/CSS to verify persistent empty slots, keyboard access, complete records, privacy bindings and no document-scroll compensation. Existing suites retain action/identity/privacy assertions. Mandatory-win container matching accepts new attributes and now asserts tabindex/labels without weakening action checks.

编译/SSR不是像素测量。真实浏览器应比较桌面及390px窄屏下的牌桌高度、本人手牌顶部、document scrollHeight、scrollY，验证增加牌河行不会移动它们；另检查聚焦牌河后方向键能滚、手动回看保持、所有按钮可达、无页面横向溢出。只能使用隔离合成已过滤快照，不向真实牌局发请求。最终实测范围与证据见 [稳定牌桌验收](STABLE-TABLE-VALIDATION.md)。
Compilation/SSR is not pixel measurement. Browser QA compares table height, own-hand top, document scrollHeight and scrollY on desktop and 390px layouts, plus keyboard river scrolling, preserved manual browsing, action reachability and no page-wide horizontal overflow. Use isolated synthetic filtered views only, never real-game requests; [the validation report](STABLE-TABLE-VALIDATION.md) records measured scope and evidence.

## 常规反馈预留 / Normal feedback reservation

反馈槽原72px还叠加诊断12px外边距/10px内边距和结算10px外边距/10px内边距，折叠诊断加普通上次结算也会出现滚动条。现在仅在该槽内把诊断间距改为0/6px、结算改为6/6px；始终预留桌面80px、≤640px时120px、≤360px时140px，给窄屏付款方与加番说明换行留位。空内容也保留同样高度，不根据 details 开关或结算有无改变高度。展开诊断、特殊听牌和超长文字仍可在原有具名可聚焦区域内部滚动，成都与动作居中规则不变。
The previous72px feedback slot also inherited12/10px diagnostic margins/padding and10/10px settlement spacing, causing overflow even with collapsed diagnostics and normal settlement. Scoped spacing is now0/6px and6/6px respectively. The slot always reserves80px on desktop,120px at≤640px and140px at≤360px for wrapped payer/bonus text, even when empty. Details state and settlement presence cannot change its height. Expanded diagnostics, special-hand notes and unusually long text remain reachable through the original named, focusable scroll region. Chengdu and action centering are unchanged.

手动合成场景 `normal-feedback` 与 `long-feedback` 使用真正模板读取的诊断、番数、加番和胡牌付款字段；不连接牌局、不运行结算，也不加入原六组自动矩阵。分别用于核对普通折叠内容无滚动条及超长展开内容末端可达。像素结果须由浏览器实测，结构测试不代表浏览器通过。
Manual synthetic stages `normal-feedback` and `long-feedback` populate the actual template's diagnostic, fan, bonus and hu-payment inputs. They neither connect to games nor execute scoring, and leave the original six-case automatic matrix unchanged. Check normal collapsed fit and expanded long-content reachability separately. Structural tests do not substitute for browser pixel measurements.

## 普通内容容量 / Ordinary-content capacity

原168px账本在普通三人总账约207px、四人总账276px、四人本局名单约183–187px时也会滚动。现在本局名单始终200px、总账始终288px，不因记录数量改变；超过容量的离桌参与者、长名字与多位积分仍完整保留并可滚动。成都≤560px标题固定104px、状态固定88px，容纳手机普通标题和两行状态；桌面保留88/66px。不是隐藏滚动条，也不删除内容。
The former168px ledger overflowed with ordinary three-player cumulative rows (about207px), four-player cumulative rows (276px), and four-player round rows (about183–187px). Round/cumulative viewports now stay200/288px regardless of record count. Longer departed-participant lists, names and scores remain fully scrollable. At≤560px Chengdu reserves104px for its heading and88px for status, fitting normal phone headings and two-line statuses; desktop keeps88/66px. No scrollbar hiding or record deletion is introduced.

手动 `chengdu-exchange` 和 `chengdu-dingque` 分别补齐换三张说明与定缺/收到三张牌，使用真正组件的准备字段，只能用于成都玩家视图，不暴露对手私有换牌，不运行真实动作，也不改变14阶段自动矩阵。浏览器还应实测这些准备说明、结果牌和三个定缺按钮，不能把普通回合通过当作准备阶段也通过。
Manual `chengdu-exchange` and `chengdu-dingque` add exchange instructions and missing-suit/received-tile views using the component's real preparation fields. They are Chengdu-player-only, reveal no opponent exchange data, execute no game action, and leave the fourteen-stage automatic matrix unchanged. Browser QA must also measure these instructions, received tiles and three missing-suit buttons; passing ordinary turns does not imply preparation phases pass.

≤360px局内通过 `body:has(.app-shell.in-game)` 单独解除body原320px最小宽度，让320px视口扣除经典滚动条后的305px内容区可正常响应；大厅下限不变，不用横向隐藏掩盖超宽内容。须重验两玩法在真实clientWidth下的页面宽和按钮/末牌可达性。手动 `finished` 供两玩法及兼容观战视图检查终局/再开入口；不执行再开，也不将终局纳入局中等高保证。
At≤360px, `body:has(.app-shell.in-game)` releases only the in-game body's former320px minimum, allowing a320px viewport's305px content area after classic scrollbars to respond normally. The lobby floor is unchanged and horizontal overflow is not hidden. Recheck both modes' document width and action/final-tile reachability at the actual client width. Manual `finished` views expose finish/restart controls across modes and compatible spectator views without executing a restart or extending the in-game stability guarantee to finished games.

`ordinary-public` 另测普通公开牌容量：花麻将每人一组碰、一次胡、全桌十三张萝卜，成都每人一组碰；每人十八张牌河、短名单和空历史。该场景不混入自动压力场景的四副露/十二次胡，不能用极限内容的合理滚动替代普通内容验收。手机完整手牌和实际多行牌河仍允许内部滚动。
`ordinary-public` separately measures ordinary public-card capacity: Flower has one peng and one win per player plus thirteen shared radishes; Chengdu has one peng per player. Both retain eighteen discards per seat, short ledgers and empty history. Unlike the automatic four-meld/twelve-win stress views, this isolates ordinary content rather than treating its overflow as necessary long-content scrolling. Full phone hands and genuinely long rivers may still scroll locally.

普通公开牌浏览器量测显示：桌面对手公开内容约93px，比旧92px多1px也会出条，因此桌面槽固定96px，手机维持98px。十三张共享萝卜加标题和说明约114px，手机牌面换成两行后约143px；共享池固定桌面120px、≤640px时152px。全部记录、滚动入口和长局溢出保留，不隐藏这几个滚动条来掩盖容量不足。
Browser measurements found ordinary opponent public content around93px, causing a scrollbar even at just1px beyond the previous92px slot. Desktop now reserves96px while phones keep98px. Thirteen shared radishes plus heading/note need about114px, or143px when phone tiles wrap to two rows; the shared pool now stays120px on desktop and152px at≤640px. Every record, scroll entry point and long-game overflow remains intact rather than hiding undersized viewports' scrollbars.

成都≤360px动作按钮只将左右内边距从18px收至12px，让经典滚动条后的233px动作视窗容纳三个定缺短按钮；保留原字体、至少44px按钮高度及超长动作组横向滚动。准备说明和换牌结果槽未再增高。
At≤360px Chengdu action buttons reduce only inline padding from18px to12px so all three short missing-suit choices fit the233px action viewport left after classic scrollbars. Text size, the44px minimum button height and horizontal scrolling for longer action groups remain unchanged. Preparation instructions and exchange-result slots are not made taller.

花麻将≤360px动作行仅将gap改为3px：320px经典滚动条下可用229px，四个常用回应加原5px间距约234px；三个间距各省2px后约228px。按钮文字、大小、内边距及68px行高保持，390px和桌面不变，五动作等超长组仍保留横向滚动与首尾可达。
At≤360px Flower changes only its action-row gap to3px. With a320px viewport and classic scrollbar, four ordinary responses need about234px with the former5px gaps against229px available; saving2px across each of three gaps reduces the group to about228px. Button text, dimensions, padding and68px row height stay unchanged, as do390px/desktop layouts. Five-action and other long groups retain horizontal scrolling and reachable endpoints.

## 主牌桌信息置底 / Main-table information footer

按第二张截图的红框反馈，花麻将的状态/余牌、终局提示与下一局/换桌按钮、本人昵称/身份/积分移到 `table-info-footer`，位于全部公共牌区、私有手牌、动作及独立立绘之后。它们在DOM中真正置后，不用CSS order伪装顺序，原桌面侧栏仍能并列。大厅没有手牌/立绘，唯一的本人摘要仍紧接大厅中心，保留原 `own-player-area` 外观；观众不渲染本人摘要。各来源、条件和点击处理器不改。
Following the second screenshot, Flower status/wall count, finish/restart/change-table controls and own identity/score now occupy table-info-footer after all public tiles, private hand/actions and separate art. Actual DOM order matches reading/focus order, and the desktop sidebar still sits alongside. Without a lobby hand/art area, the unique own summary stays directly after the lobby center with its original own-player-area styling; spectators receive no own summary. Original bindings, guards and handlers remain unchanged.

玩家的固定接牌槽移到手牌之后、合法动作之前，回应时可以同时查看待接牌与碰杠胡/过；空槽仍保持原高度。观众没有私有手牌，只有页脚保留同一公开接牌提示。成都同样把状态与终局结算放在全部牌区、手牌、累计和动态后的 `chengdu-table-footer`，玩家接牌槽紧邻动作，未授权手牌仍不会渲染。状态区域保留原live语义、固定高度、具名/可聚焦滚动；终局按钮不隐藏、不复制。
Players' fixed claim slots move after the hand and before legal actions so the offered tile stays beside responses. Empty slots retain their height. Spectators instead read the same public claim in the footer without receiving private hands. Chengdu status and final settlement likewise follow its board, hand, totals and history; player claims stay by actions and private-hand guards remain intact. Status keeps live semantics, fixed capacity and keyboard scrolling; finish controls are neither hidden nor duplicated.

结构回归验证两个页脚及接牌槽的真实顺序、唯一身份/终局块、原按钮与余牌绑定，并保留旧版本、观众和大厅SSR检查。终局合成场景 `finished` 由浏览器另验页脚位置与按钮可达，不点击请求。新布局不修改任一SFC脚本、规则、计分、历史或联机协议。
Structural regressions verify actual footer/claim order, unique identity/finish blocks and unchanged action/wall bindings, alongside legacy, spectator and lobby SSR coverage. Browser QA uses the synthetic finished stage to check footer placement/control reachability without submitting requests. No SFC script, rule, score, history or transport protocol changes are made.

手机（≤640px）的花麻将终局页脚让图标与首段说明先占整行，下一局/换桌按钮自然换到后面，避免长说明被两按钮挤成四五字宽的竖列。该覆盖仅匹配 `finished-banner` 首段，进行中固定槽、高度、按钮事件和桌面布局不变；终局本来允许自然重排。
On phones up to640px, Flower's finish icon/text occupy a row before restart/change-table controls, preventing those controls squeezing the explanation into a narrow column. The override targets only the finished banner's first span; active slots/heights, handlers and desktop layout stay unchanged. Finish transitions already permit natural reflow.
