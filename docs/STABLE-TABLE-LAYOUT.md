# 稳定牌桌布局 / Stable table layout

## 目标与原因 / Goal and causes

2026-11-08 按用户截图移除对手画框的声线类型、牌河下方“花间 / 自贡花麻将”装饰横栏，以及本人手牌上方整条角色说明。玩家姓名、角色名/头像、我/房主/庄家标记、规则、虚拟积分、原图局部动画与角色语音保持原有来源和权限。
The November 8 screenshot request removes opponent voice-style labels, the decorative strip below the rivers, and the own-hand role-description strip. Player/character identity, badges, rules, virtual scores, original-art motion and voice retain their original sources and permissions.

原牌河只有 min-height 和 max-height，达到上限之前仍会每多一行增长；公开碰杠、胡牌、萝卜、接牌提示、动作按钮和结算说明又会插入或换行。窄屏侧栏历史和总账也会增长。这些真实布局变化会改变文档高度，并触发浏览器滚动锚定，不是“每次轮询重挂载整桌”。
Previously, min/max-height allowed rivers to grow until their cap. Melds, wins, radishes, claims, action buttons and settlement messages added rows, as did stacked narrow-screen history and ledgers. These real layout changes altered document height and browser scroll anchoring; polling did not remount the entire table.

## 实现与阅读顺序 / Implementation and reading order

1. `src/App.vue` 给条件内容加游戏期间稳定的父槽：`opponent-public-cards`、`claim-slot`、`own-public-cards`、`hand-feedback`、`room-notices`。自己的私有手牌仍受原参与者/观战条件保护。 / Stable parent slots contain conditional content. Original participant/spectator guards still protect private hands.
2. `src/tabletop.css` 最后“稳定牌桌视窗”覆盖原有 min/max 规则，按视口宽度固定可视高度。牌河、共享萝卜、身份状态、手牌、听牌、操作、动态及总账超出固定容量时分别内部滚动。 / Final overrides fix viewport heights at each width; rivers, public cards, identity/status, hands, waits, actions, history and ledgers scroll internally only when their fixed capacity is exceeded.
3. `src/ChengduTable.vue` 使用独立的公开牌/牌河/接牌/说明/换牌结果槽，准备阶段到普通回合、胡后退出都不靠插入整行推动本人手牌。仍由服务端合法动作驱动按钮。 / Independent Chengdu slots stabilize preparation, normal turns and retirement. Server legal actions still drive every button.

`.stable-scroll` 或 `data-stable-scroll` 表示有名称、可 Tab 聚焦的局部滚动区。原生方向键、Page Up/Down、触摸和滚轮读取溢出内容；按钮与手牌仍保留原生焦点和至少44px动作按钮。`scrollbar-gutter: stable` 预留经典滚动条宽度，避免滚动条刚出现就让内容再次换行。超高内容从可访问的起点排布，不能用不安全居中把首行挤到负坐标。
The class/attribute identifies named, keyboard-focusable local viewports. Native keys, touch and wheel expose overflow while real buttons retain focus and existing action targets. Reserved scrollbar gutters avoid rewrapping when classic bars appear. Overflow starts at a reachable origin, not a negatively centered position.

纯横向、单行的手牌、副露牌组、暗手占位与工具/动作条单独使用 `scrollbar-gutter: auto`。它们不需要防止纵向滚动条引起换行；空竖沟槽反而会令 Chromium 的 scrollWidth/clientWidth 差值与实际横向终点不同，并让末牌进入该空白边带。该例外不改固定高度、overflow 或 Tab；牌河、公开牌、历史等纵向区仍预留 stable 沟槽。
Single-row horizontal hands, meld groups, concealed placeholders and tool/action strips use automatic gutters. They do not need protection from vertical-bar rewrapping; an empty vertical gutter instead makes Chromium's width difference disagree with the actual horizontal endpoint and places the final tile in that empty strip. This exception changes no heights, overflow or focus, while vertical rivers/public cards/history retain stable gutters.

2026-11-08用户最新方向为两玩法操作组靠右，替代早期花麻将居中的要求。花麻将与成都只给第一个真实元素设置 `margin-inline-start: auto`，不再给末尾元素自动边距。Flex把全部剩余空间放在动作之前，单按钮、整组按钮及等待提示都靠右；内容溢出时自动外边距归零，仍从 `flex-start` 的可达起点滚动。两玩法保持68px固定动作行和至少44px按钮高度，不改动作条件或新增包装层。
The latest November 8 direction right-aligns both modes, superseding the earlier Flower-centering requirement. Only the first actual element receives `margin-inline-start: auto`, with no trailing auto margin. Flex places all spare space before one/many actions or waiting text; overflow resolves the margin to zero and retains a reachable `flex-start` origin. Both modes keep their68px fixed row and44px minimum targets without action-condition changes or a wrapper.

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

反馈槽原72px还叠加诊断12px外边距/10px内边距和结算10px外边距/10px内边距，折叠诊断加普通上次结算也会出现滚动条。现在仅在该槽内把诊断间距改为0/6px、结算改为6/6px；始终预留桌面80px、≤640px时120px、≤360px时140px，给窄屏付款方与加番说明换行留位。空内容也保留同样高度，不根据 details 开关或结算有无改变高度。展开诊断、特殊听牌和超长文字仍可在原有具名可聚焦区域内部滚动，成都与动作靠右规则不变。
The previous72px feedback slot also inherited12/10px diagnostic margins/padding and10/10px settlement spacing, causing overflow even with collapsed diagnostics and normal settlement. Scoped spacing is now0/6px and6/6px respectively. The slot always reserves80px on desktop,120px at≤640px and140px at≤360px for wrapped payer/bonus text, even when empty. Details state and settlement presence cannot change its height. Expanded diagnostics, special-hand notes and unusually long text remain reachable through the original named, focusable scroll region. Chengdu and action right alignment are unchanged.

手动合成场景 `normal-feedback` 与 `long-feedback` 使用真正模板读取的诊断、番数、加番和胡牌付款字段；不连接牌局、不运行结算，也不加入原六组自动矩阵。分别用于核对普通折叠内容无滚动条及超长展开内容末端可达。像素结果须由浏览器实测，结构测试不代表浏览器通过。
Manual synthetic stages `normal-feedback` and `long-feedback` populate the actual template's diagnostic, fan, bonus and hu-payment inputs. They neither connect to games nor execute scoring, and leave the original six-case automatic matrix unchanged. Check normal collapsed fit and expanded long-content reachability separately. Structural tests do not substitute for browser pixel measurements.

## 普通内容容量 / Ordinary-content capacity

原168px账本在普通三人总账约207px、四人总账276px、四人本局名单约183–187px时也会滚动。现在本局名单始终200px、总账始终288px，不因记录数量改变；超过容量的离桌参与者、长名字与多位积分仍完整保留并可滚动。成都≤560px信息条固定72px、状态固定88px，容纳简化后的玩法/余牌/庄家和两行状态；桌面为48/66px。不是隐藏滚动条，也不删除内容。
The former168px ledger overflowed with ordinary three-player cumulative rows (about207px), four-player cumulative rows (276px), and four-player round rows (about183–187px). Round/cumulative viewports now stay200/288px regardless of record count. Longer departed-participant lists, names and scores remain fully scrollable. At≤560px Chengdu reserves72px for compact mode/wall/dealer information and88px for two-line status; desktop uses48/66px. No scrollbar hiding or record deletion is introduced.

手动 `chengdu-exchange` 和 `chengdu-dingque` 分别补齐换三张说明与定缺/收到三张牌，使用真正组件的准备字段，只能用于成都玩家视图，不暴露对手私有换牌，不运行真实动作，也不改变14阶段自动矩阵。浏览器还应实测这些准备说明、结果牌和三个定缺按钮，不能把普通回合通过当作准备阶段也通过。
Manual `chengdu-exchange` and `chengdu-dingque` add exchange instructions and missing-suit/received-tile views using the component's real preparation fields. They are Chengdu-player-only, reveal no opponent exchange data, execute no game action, and leave the fourteen-stage automatic matrix unchanged. Browser QA must also measure these instructions, received tiles and three missing-suit buttons; passing ordinary turns does not imply preparation phases pass.

≤360px局内通过 `body:has(.app-shell.in-game)` 单独解除body原320px最小宽度，让320px视口扣除经典滚动条后的305px内容区可正常响应；大厅下限不变，不用横向隐藏掩盖超宽内容。须重验两玩法在真实clientWidth下的页面宽和按钮/末牌可达性。手动 `finished` 供两玩法及兼容观战视图检查终局/再开入口；不执行再开，也不将终局纳入局中等高保证。
At≤360px, `body:has(.app-shell.in-game)` releases only the in-game body's former320px minimum, allowing a320px viewport's305px content area after classic scrollbars to respond normally. The lobby floor is unchanged and horizontal overflow is not hidden. Recheck both modes' document width and action/final-tile reachability at the actual client width. Manual `finished` views expose finish/restart controls across modes and compatible spectator views without executing a restart or extending the in-game stability guarantee to finished games.

`ordinary-public` 另测普通公开牌容量：花麻将每人一组碰、一次胡、全桌十三张萝卜，成都每人一组碰；每人十八张牌河、短名单和空历史。该场景不混入自动压力场景的四副露/十二次胡，不能用极限内容的合理滚动替代普通内容验收。手机完整手牌和实际多行牌河仍允许内部滚动。
`ordinary-public` separately measures ordinary public-card capacity: Flower has one peng and one win per player plus thirteen shared radishes; Chengdu has one peng per player. Both retain eighteen discards per seat, short ledgers and empty history. Unlike the automatic four-meld/twelve-win stress views, this isolates ordinary content rather than treating its overflow as necessary long-content scrolling. Full phone hands and genuinely long rivers may still scroll locally.

此前普通公开牌浏览器量测显示：桌面对手公开内容约93px，比旧92px多1px也会出条，因此桌面槽仍固定96px，手机维持98px。共享池旧120/152px容量包含了标题、教程、边框和留白；本轮删除这些重复内容后，牌和动态来源保留在桌面72px、≤640px时108px的固定条内。十三张普通萝卜、动态增加/待翻数量仍须用浏览器实测无溢出，极长局仍保留完整牌与滚动入口，不用隐藏滚动条掩盖容量不足。
Earlier ordinary-card measurements found about93px of desktop opponent content, so its96px slot and98px phone slot remain. The shared pool's old120/152px capacities included a heading, tutorial, box and padding. Removing those repeated elements lets tiles and changing source use fixed72px desktop/108px phone strips. Browser verification must still confirm thirteen ordinary radishes and increment/pending information fit; longer games retain every tile and accessible scrolling rather than hiding capacity problems.

成都手机常规四回应在原间距下会仅因几像素留白而横滚。≤560px动作gap改为6px；≤360px再用5px gap和8px左右内边距，给四回应与三个定缺短按钮留出空间。保留原字体、至少44px按钮高度及超长动作组横向滚动，准备说明和换牌结果槽不增高；实际首尾可达与fit仍以浏览器量测为准。
Ordinary four-response Chengdu phone groups previously overflowed because of spare spacing. At≤560px actions use a6px gap; at≤360px a5px gap and8px inline padding leave room for four responses or three missing-suit choices. Text size,44px minimum height and long-group horizontal scrolling remain unchanged; preparation/receipt slots do not grow. Actual fit and endpoint reachability still require browser measurement.

花麻将≤360px动作行仅将gap改为3px：320px经典滚动条下可用229px，四个常用回应加原5px间距约234px；三个间距各省2px后约228px。按钮文字、大小、内边距及68px行高保持，390px和桌面不变，五动作等超长组仍保留横向滚动与首尾可达。
At≤360px Flower changes only its action-row gap to3px. With a320px viewport and classic scrollbar, four ordinary responses need about234px with the former5px gaps against229px available; saving2px across each of three gaps reduces the group to about228px. Button text, dimensions, padding and68px row height stay unchanged, as do390px/desktop layouts. Five-action and other long groups retain horizontal scrolling and reachable endpoints.

## 主牌桌信息置底 / Main-table information footer

按第二张截图的红框反馈，花麻将的状态/余牌、终局提示与下一局/换桌按钮、本人昵称/身份/积分移到 `table-info-footer`，位于全部公共牌区、私有手牌、动作及独立立绘之后。它们在DOM中真正置后，不用CSS order伪装顺序，原桌面侧栏仍能并列。大厅没有手牌/立绘，唯一的本人摘要仍紧接大厅中心，保留原 `own-player-area` 外观；观众不渲染本人摘要。各来源、条件和点击处理器不改。
Following the second screenshot, Flower status/wall count, finish/restart/change-table controls and own identity/score now occupy table-info-footer after all public tiles, private hand/actions and separate art. Actual DOM order matches reading/focus order, and the desktop sidebar still sits alongside. Without a lobby hand/art area, the unique own summary stays directly after the lobby center with its original own-player-area styling; spectators receive no own summary. Original bindings, guards and handlers remain unchanged.

玩家的固定接牌槽与合法动作共同位于手牌上方的无框动作带，回应时可以同时查看待接牌与碰杠胡/过；空槽仍保持固定容量。观众没有私有手牌，只有页脚保留同一公开接牌提示。成都同样把状态与终局结算放在全部牌区、手牌、累计和动态后的 `chengdu-table-footer`，玩家接牌槽紧邻动作，未授权手牌仍不会渲染。状态区域保留原live语义、固定高度、具名/可聚焦滚动；终局按钮不隐藏、不复制。
Players' fixed claim slots and legal actions now share the frameless dock above the hand, keeping offered tiles beside responses. Empty slots retain fixed capacity. Spectators instead read the same public claim in the footer without receiving private hands. Chengdu status and final settlement likewise follow its board, hand, totals and history; player claims stay by actions and private-hand guards remain intact. Status keeps live semantics, fixed capacity and keyboard scrolling; finish controls are neither hidden nor duplicated.

结构回归验证两个页脚及接牌槽的真实顺序、唯一身份/终局块、原按钮与余牌绑定，并保留旧版本、观众和大厅SSR检查。终局合成场景 `finished` 由浏览器另验页脚位置与按钮可达，不点击请求。新布局不修改任一SFC脚本、规则、计分、历史或联机协议。
Structural regressions verify actual footer/claim order, unique identity/finish blocks and unchanged action/wall bindings, alongside legacy, spectator and lobby SSR coverage. Browser QA uses the synthetic finished stage to check footer placement/control reachability without submitting requests. No SFC script, rule, score, history or transport protocol changes are made.

手机（≤640px）的花麻将终局页脚让图标与首段说明先占整行，下一局/换桌按钮自然换到后面，避免长说明被两按钮挤成四五字宽的竖列。该覆盖仅匹配 `finished-banner` 首段，进行中固定槽、高度、按钮事件和桌面布局不变；终局本来允许自然重排。
On phones up to640px, Flower's finish icon/text occupy a row before restart/change-table controls, preventing those controls squeezing the explanation into a narrow column. The override targets only the finished banner's first span; active slots/heights, handlers and desktop layout stay unchanged. Finish transitions already permit natural reflow.


## 紧凑牌区 / Compact play areas

2026-11-08截图反馈进一步移除花麻将整个 `hand-info-row`，包括“手牌区”“胡后固定”和重复 `statusDetail`。手牌区仍有可访问名称和绑定原 `statusDetail` 的描述；“轮到你了”现在位于手牌上方动作带右侧，原听口与旧局锁听提示保留在手牌下方。共享池不再显示“全桌共享萝卜”标题或常驻教程，名称/首胡规则进入可访问属性，牌数、待翻杠数和最新来源仍可见，所有牌仍完整遍历。普通本局/累计账本、公开碰杠胡牌及反馈容量不缩小。
The November 8 screenshot feedback removes the entire Flower `hand-info-row`, including the hand title, frozen-hand badge and repeated `statusDetail`. The hand retains a name and description bound to the original status; its turn badge now occupies the upper-right dock, with waits and legacy locks retained below the hand. The shared pool drops its visible heading/tutorial while accessibility attributes retain identity/first-hu rules. Counts, pending kongs and latest provenance remain visible, and every tile is rendered. Ordinary ledgers, public meld/win slots and feedback capacities are not reduced.

成都去掉“万条筒，四方坐定”、常驻行牌教程及“你的手牌”框标题；原玩法/余牌/庄家信息变成单条，固定手牌说明行显示换牌选中数量、不能撤回的提交说明、缺门及本人回合。两玩法都减少包在真手牌托架外的重复外框和内边距；头像、立绘、牌面尺寸、触控高度及动画文件不变。状态/终局/身份页脚依旧在主牌桌末端，玩家接牌槽现在与动作一起位于手牌上方。
Chengdu drops the decorative title, persistent turn-order tutorial and boxed hand heading. Mode/wall/dealer facts use one compact strip; the fixed hand-note row keeps exchange selection progress, irreversible-submission guidance, missing suit and own turn. Both modes remove redundant outer hand-box decoration and padding without changing art/avatar/tile dimensions, target heights or animation files. Status/finish/identity footers stay at the end, and player claims now sit with controls above the hand.

花麻将无框覆盖明确使用 `.table-surface:not(.lobby-table) > .own-player-area`；大厅页脚也复用 `own-player-area`，不能被这条局内样式误改底色、边框、阴影或间距。专项结构测试同时保护选择器范围和大厅原绑定。
Flower's borderless override explicitly uses `.table-surface:not(.lobby-table) > .own-player-area`. The lobby footer also reuses `own-player-area` and must retain its background, border, shadow and spacing. A focused structural test protects the selector scope and original lobby binding.

紧凑牌区改动本身只涉及模板/CSS，不修改两个SFC脚本。不用条件高度、裁短数据、自动滚动或隐藏溢出来取得紧凑效果。结构与SSR回归覆盖新可访问属性、移除可见标题、两玩法靠右和原隐私/动作边界；真实像素与十四阶段稳定性仍以最终浏览器记录为准，不能把通过编译当作量测结论。
The compact-layout changes themselves are template/CSS-only and do not modify either SFC script. Compactness does not rely on conditional heights, truncated data, automatic scrolling or hidden overflow. Structural/SSR tests cover accessibility, removed headings, both right-aligned action groups and original privacy/action boundaries. Final browser records, not compilation, establish actual pixels and fourteen-stage stability.

用户随后明确取消牌河标题和“多少条记录”。花麻将删除整条 `discard-label`，不再预留其桌面34px/手机44px标题槽；牌河本身仍固定156px/144px。`data-river-seat`、按观察座位的排列、完整记录与具名Tab滚动区均保留。成都原本没有可见牌河标题/条数，所以保留原150px牌河、姓名可访问标签和每席牌组，不增删公开牌。
The user then explicitly removed river titles and record counts. Flower deletes the entire `discard-label` and its34px desktop/44px phone heading slot while retaining156px/144px river capacity. `data-river-seat`, viewer-relative ordering, complete records and named keyboard-scrollable regions remain. Chengdu already had no visible river title/count, so its150px river, named accessibility label and per-seat tiles stay unchanged.

成都普通接牌原因重复等待长句从64px换成72px内容而出现小竖滚。玩家与观众接牌槽现在只显示打牌人、打出/抢杠来源和原尺寸牌；等待所有有资格牌友回应的说明在有接牌时作为具名区域的 `aria-description`。64px槽、牌尺寸和长姓名局部滚动不变，不为去掉滚动条而加高整个牌区。
Ordinary Chengdu claims previously wrapped a repeated waiting sentence into72px inside a64px slot. Player/spectator claim slots now show the source player, discard/rob-kong source and original-size tile; waiting for eligible responses becomes the named region's conditional `aria-description`. The64px slot, tile size and long-name local scrolling remain, without enlarging the board to remove a scrollbar.


## 无框居中手牌与角色动作带 / Frameless centered hands and themed actions

2026-11-08后续截图明确要求进一步精简：删除手牌托架的背景、边框和阴影，保留全部原始牌面。花麻将的 `.my-hand` 与成都的 `.chengdu-hand-tiles` 都按真实内容 `width: max-content`、`min-width: 0`、`margin-inline: auto` 居中；牌组超宽时auto边距归零，首牌不落到负坐标，仍可原生横向滚到末牌。手牌外层有具名Tab入口，不切片、不自动滚动、不通过隐藏溢出来伪装完整显示。
The later November8 references request further simplification: remove the rack background, border and shadow while retaining every original tile face. Both intrinsic-width tile lists use max-content width, zero minimum width and automatic inline margins. Fitting lists center; overflowing margins resolve to zero, keeping the first tile at a reachable origin and the last accessible by native scrolling. Named keyboard entry points remain, without slicing, automatic scrolling or hiding overflow.

`.hand-action-dock` 是普通文档流中手牌之前的常驻网格。桌面固定92px，左侧接牌，右侧24px回合提示和68px动作行；≤640px固定132px，上排64px接牌/提示，下排68px完整宽度动作。空闲时不塌缩，也不重复显示“等待牌友”，原页脚仍有完整状态。花麻将手牌112px/手机100px，手机底内边距8px为横向滚动条留足空间；成都手牌112px。提示本身不控制动作祖先：首胡、他家接炮、抢杠、必胡、胡后暗杠/过、成都换三张/定缺/退出与终局均沿用服务端白名单、原事件和禁用守卫。两SFC脚本没有改变。
The dock is a persistent normal-flow grid before the hand. Desktop reserves92px with claims left and a24px prompt plus68px actions right. At≤640px it reserves132px:64px context above a full-width68px action row. Idle space never collapses and no longer repeats waiting prose from the existing footer. Flower hands reserve112px/100px on phones, where8px bottom padding leaves scrollbar capacity; Chengdu reserves112px. Prompt visibility never gates action ancestors. All original allowlists, events and disabled guards remain for claims, rob-kong, mandatory wins, post-win choices, Chengdu preparation/retirement and finish. Both SFC scripts are unchanged.

角色色只从既有七个枚举class取固定CSS变量：小桃粉、清岚紫、晴禾金黄、地主棕金、老实人青灰、富婆绿金、女明星蓝。未知类使用中性色；实际生产角色解析仍会走旧局安全兜底，不把任意字符串放进样式。主按钮采用低饱和浅渐变配深文字，次按钮用深角色色，悬停保留同色系。每组正常文字在主渐变两端和次按钮底色均达到4.5:1。按钮有可见键盘焦点及44×44px下限；≤360px花麻将仅收长按钮左右内边距为9px，使常规四回应无需横滚；成都≤360px同样将原10px侧边距收至8px。更多暗杠等长组仍能滚到首尾。
Seven existing enum classes select fixed, muted palettes matching the artwork. Unknown classes use neutral variables, while production role lookup retains its safe legacy fallback rather than injecting arbitrary style strings. Primary controls have light gradients/dark text; secondary controls and hover retain a dark role color. Normal text reaches4.5:1 against both primary gradient ends and secondary surfaces. Visible keyboard focus and44×44px minimum buttons remain. Flower at≤360px trims only long-button side padding to9px so four ordinary responses fit, with Chengdu likewise trimming its former10px padding to8px at≤360px. Extended kong groups remain scrollable.

`tests/hand-action-dock.test.js` 编译真实AST/CSS验证槽位顺序、持久性、居中与溢出规则、七配色/中性兜底、对比度及触控下限；原 `ui` / `chengdu-ui` SSR新增本人/他家/已回应/抢杠/准备/退出/禁用和真实引擎必胡覆盖。旧稳定结构断言只更新已授权的新顺序，原观战隐私、旧版本、页脚和下一局弹层断言保留。浏览器夹具新增可见七角色选择、短手牌和抢杠手动阶段，不改14阶段自动矩阵，API封锁仍在。仅切不同case时明确卸载/重挂纯视图，避免既有跨模板v-memo缓存混用；同case审计不重挂。
The dedicated structural suite compiles actual AST/CSS for order, persistent slots, safe centering/overflow, seven palettes/fallback, contrast and target sizes. Existing SSR suites add own/other/answered/rob-kong/preparation/retirement/blocked states and a real-engine mandatory-win view. Updated order assertions retain spectator privacy, frozen-version, footer and next-round-dialog coverage. The isolated browser fixture adds a visible role selector and manual short-hand/rob-kong stages without changing its fourteen-stage matrix or API blockade. Only switching fixture cases remounts the view to avoid existing cross-template v-memo reuse; same-case audits never remount.
