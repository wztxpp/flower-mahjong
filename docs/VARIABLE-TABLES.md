# 可变人数与副数 / Variable table dimensions

## 已确认玩法 / Confirmed rules

- 建房前选择3人或4人，默认3人；1至5副、每次半副，默认2副。一副为18种条筒各4张（72张），半副各2张（36张），总牌数72–360张。
  Choose three/four seats (default three) and one–five decks in half steps (default two). Each full deck has four of each bamboo/dot identity; a half-deck adds two of each.
- 神龙门槛是建房参数，1–20整数、默认6。到门槛为每家10分，每多一张翻倍（10、20、40、80……）；不强制门槛低于每种牌数量，过高时提示本局不会触发。其牌区范围、终局一次结算、多神龙相加和付款资格不变。
  Dragon threshold is fixed at creation, integer 1–20, default six. Each payer owes ten at threshold, doubling per further copy. A threshold above the physical copy budget remains selectable with a warning. Zones, once-only final settlement and eligibility remain unchanged.
- 普通同牌四张加一番，每增一张加一番，所以9张加6番、20张加17番。七对继续使用首次完整牌型固定档位，后续同牌不再升档；萝卜仍独立计分。
  Ordinary copy fan is count minus three from four copies. Seven pairs retains its first complete-hand tier and never grows with subsequent wins. Radish scoring remains independent.
- 已成立的杠可逐张加到本局同牌总数（4–20张），每次仍是一组，只加一张、补摸一次、累计/翻一张萝卜，遵守抢杠、牌墙余量和胡后保听口要求。
  An established kong may extend to the physical identity budget of four–twenty copies. Each extension remains one group and preserves robbery, replacement/radish, wall-capacity and post-win wait constraints.

## 四人的自然推广 / Four-player generalization

四人逆时针0→3→2→1→0。相对自己为右→对→左；同级回应、多人胡和抢杠采用同顺序，与点击速度无关。一炮三响先统一结算，再判断是否全员已胡，未结束由优先赢家续摸。每人起手13张、庄家14张，萝卜基础6张不随人数/副数增加。
Four seats rotate counterclockwise 0→3→2→1→0, relative right/opposite/left. Equal-priority claims and simultaneous wins use that order. Settle all three discard winners before testing completion; deal thirteen/fourteen and keep six base radishes.

原“其他两家付款”的分支改为所有其他玩家，四人时三家各付原单价；普通自摸仍排除已经胡过者，末家首次普通自摸仍收全体。明杠后本次补摸只收该明杠来源者，普通接炮/杠后接炮/抢杠仍只收实际来源；**普通接炮的大单吊继续保留所有其他玩家付款的既有特例**。喜钱、暗杠、补杠和加杠同样按所有对手转账，保持零和。
Former all-opponent branches expand from two to three payers without changing unit prices. Preserve unwon-only ordinary self-draw, final-first-win exceptions, exposed-kong provenance and source-only discards/robbery. Ordinary big-single discard wins deliberately retain their all-opponent exception. Ready/kong payments stay zero-sum.

## 存档与接口 / Snapshots and API

建房 POST `/api/rooms` 新增可选 `settings: {playerCount, deckCount, dragonStartCount}`，拒绝非法类型、额外键和越界数值；未传时使用3/2/6。房间 `settings` 固定，加入及 start.options 无法修改。新局 `rules` 复制参数并显式保存 `exponentialDragon:true`、`extendedCopyFan:true`。`gameMeta.config`、归档 `config` 与个人记录 `config` 保留实际新局设置；不需D1列迁移。
Room creation accepts optional validated settings, defaulting to 3/2/6. Joining/start options cannot resize the room. New rules save the dimensions plus explicit exponentialDragon/extendedCopyFan flags. Metadata, archives and personal records preserve config without a database migration.

缺配置旧房/旧局按3人2副解读，不改动原对象。旧局缺两个新计分标记时保留原>8同牌番兜底和6/7/8神龙封顶，不重算已结算账目。旧房下一局属于新的明确开局，采用默认3/2/6和新规则，但不回填旧房settings。schema1/2引擎不变。
Old saves lacking dimensions read as three seats/two decks, without mutation. Missing scoring flags preserve the original above-eight fan fallback and capped dragon table. A subsequent explicit new round uses new defaults; existing records do not change. Frozen engines one/two remain untouched.

## 实现与维护 / Implementation and maintenance

- `shared/start-options.js`：唯一共享输入约束与 `copiesPerTile`，旧规则缺字段只读回退。
- `shared/game.js`：创建牌墙、座位校验、顺序、付款、听口/胡型、杠上限、守恒与自动循环界限使用真实快照。递归计数memo使用逗号分隔，避免十张以上的多位数键混淆。
- `server/api.js`、`server/history.js`：配置、动态落座、角色人数、续庄和归档；读取永不升级现有局。
- `src/App.vue`、`src/tabletop.css`：建房表单、只读桌设置、第四对家、四份牌河、窄屏两层对手区和长杠局部滚动。实际合法动作仍由服务器给出。
- 角色接口人数为显式参数，不能拿七角色池长度当人数；角色核心依赖提交 `b5b2641`。

The listed files own validation, snapshot-driven engine dimensions, API/history persistence and responsive presentation. Counting memo keys are delimited to distinguish multi-digit frequencies. Character mapping takes an explicit seat count independent of its seven-role roster.

## 验证入口 / Verification entry points

`tests/variable-table.test.js`、`tests/fixtures/variable-table.js` 为18配置完整对局、四座隐私、三响/抢杠、末家自摸、20张杠、9–20张同牌、七对固定、神龙10/20/40/80与极值、旧快照、喜钱0/50和不变量提供合成测试。`tests/variable-room-api.test.js` 覆盖18配置、非法输入、第四座身份、跨局归档与临时FileStore重启。`tests/ui.test.js` 编译实际组件验证新表单和四人展示。这些自动测试不等同于四台物理设备或移动浏览器实测。
The suites cover complete matrix games, four-seat privacy, multi-claim settlement, limits and legacy contracts, API persistence/restart and compiled-component rendering. Automated rendering is not a claim of four physical-device/mobile-browser acceptance.

## 本分支验收记录 / Branch validation record (2026-11-07)

核心提交为 `3cd47bf`，基于 `bc6d296` 加角色核心接口（原提交 `b5b2641`，本分支拣入 `ad027b7`）。没有改动冻结的 `shared/v2-game.js`、`shared/legacy-game.js`，没有push或部署。
Core implementation 3cd47bf builds on bc6d296 and the separately developed character-core dependency. Frozen engines are unchanged; nothing was pushed or deployed.

- `node --test tests/variable-table.test.js tests/variable-room-api.test.js tests/ui.test.js`：209/209通过（59引擎、22API、128UI）。包括18配置完整对局、第四座暗杠/补杠/加杠/碰/明杠、三响/抢杠、特殊付款、喜钱0/50、神龙共享萝卜与新旧公式、FileStore重启。
- `npm test`：893项，891通过；2项角色媒体契约失败，原因是本分支只拣了七角色代码，尚未拣新增PNG/声音manifest资产。不能称全套通过；最终整合资产后须重跑。
- `npm run lint`：退出0，无错误，4个既有warning（worker默认导出、引擎kongDiscard/wasRepeat未使用、rob-kong测试passAll未使用），另有既有Next pages目录提示。
- `npm run build`：通过；最终产物 `index-D6k0IlaH.js` / `index-CPoFmHjV.css`。`git diff --check`通过。

The focused suites pass. The full run has two explicitly unresolved character-media dependency failures until the parallel asset branch is integrated. Lint/build succeeded with the pre-existing warnings noted above.

官方Chromium实测使用稍早的同逻辑构建 `index-BPI5-JKn.js` / `index-DGAJd0S4.css`、四个独立localhost origin及临时MemoryStore。验证默认3/2/6与半副下拉；创建4人/2.5副/神龙20，超过10张提示；1/4、3/4禁开局，4/4可开；第四席本人13张实牌、三对手只背面、三对手/四牌河/四份积分；1180px桌面无横向溢出，规则弹窗关闭及加入者返回大厅/浏览器前后退正确。媒体缺图属于已知依赖。服务已停止。
Real Chromium acceptance used four isolated origins and synthetic in-memory data. It verified configuration, occupancy gates, fourth-seat privacy, all public panels, desktop bounds, rule dismissal and joined-player navigation. Missing portraits are a known dependency. Test servers were stopped.

**未实测**：窄屏、20张长杠浏览器、完整自然出牌/胡牌流程及三人新局浏览器。当前CUA没有viewport调整能力，不能把桌面结果当移动验收；最终CSS另补了长杠容器max-width，尚未做真实长杠视觉复测。相关规则/渲染有自动测试，但不代替这些实测。
Not browser-tested: narrow viewports, a twenty-copy meld, a complete natural game, or a fresh three-player session. CUA lacked viewport controls. The final long-meld container width bound awaits direct visual coverage; automated tests do not replace these checks.

截图保留在本地工作区 `variable-four-desktop.png`、`variable-four-hand.png`、`variable-four-lobby.png`；HTTP证据为隔离测试的 `http.jsonl`，不包含凭证和手牌快照，不随代码提交。整合观战时仅给玩家启用相对四人布局，观众保留独立全席auto-fit；保留观众mySeat=null与只读动作限制。
Local screenshots/logs remain separate from source. When integrating spectating, scope the relative four-seat layout to players and keep spectators' all-seat auto-fit, null seat and read-only restrictions.
