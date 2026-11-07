# 成都独立引擎 / Independent Chengdu engine

## 当前可用范围 / Current capability

正式纯入口为 `shared/chengdu-engine.js`：新局schema 2、`rulesVersion: chengdu-1`、`runtimeKind: production`，覆盖准备、摸打碰杠胡、退场与流局结算。schema 1原型仍独立，不能改一个developmentOnly标记升级。此分支没有改正式注册表、HTTP或UI，因此这里只证明纯引擎，不宣称网站集成已完成。无发布、数据库迁移或真实牌局访问。
Production pure entry is chengdu-engine.js: schema two, rulesVersion chengdu-1 and runtimeKind production, covering preparation, turns, melds/wins, retirement and draw settlement. Draft schema one remains separate and cannot be promoted by a flag change. This branch does not modify registration, HTTP or UI, so it proves the engine rather than completed website integration. No publication, migration or real-game access occurred.

旧准备模块 `chengdu-game.js` 的createGame/settleGame导出继续失败关闭；新正式工厂直接从完整牌墙构造正式快照，不接收保存的原型或客户端策略。花麻将三个引擎及规则保持原样。
Legacy preparation creation/settlement exports remain blocked. The new factory constructs production snapshots from a complete wall, rejecting saved drafts and caller-authored policy. All three Flower engines/rules remain unchanged.

## 用户确认的规则 / User-confirmed rules

以下为当前最新口径，替代准备层文档中曾经未决或被纠正的口径。
These are the latest confirmations, superseding earlier unresolved or corrected preparation-stage interpretations.

- 四人、条筒万27种×4张=108张；可选首胡结束/血战、可选换三张；同花色三张交换、必须定缺。 / Four seats, 27 identities times four copies; first-win/blood-battle and exchange choices; exchange three same-suit tiles and require dingque.
- 换牌首局从顺时针开始，只在开启换三张的局按顺→对→逆循环；屏幕座位映射由接入层明确提供。 / Exchange starts clockwise and advances clockwise/opposite/counterclockwise only for exchange-enabled games; integration supplies the screen layout.
- 平胡1番、对对胡2番、七对/金钩钓/清一色3番，每根+1；清一色组合额外+2番。金钩钓不重复叠加已经包含的对对胡；七对四张算一根，所以龙七对4番8分。 / Regular one fan, all-triplets two, seven-pairs/golden-hook/pure-suit three, each root adds one; pure-suit combinations add two. Golden-hook does not double-count all-triplets; four identical tiles in seven-pairs add one root, producing four-fan/eight-point luxury seven-pairs.
- 4/5/6番封顶对应8/16/32；自摸加番先加番再封顶，加底先封顶后+1，所以4番封顶可自摸9分。 / Caps four/five/six map to eight/sixteen/thirty-two; add-fan precedes capping, add-base follows it, allowing nine points at the four-fan cap.
- 一炮多响；能胡可选择不胡，但放弃后到本人下一次实际摸牌前不能胡。选择碰或杠而不胡同样记录过胡，成功补摸后才解锁；抢补杠成功时提杠者没有补摸，锁不能提前清除。 / All eligible discard winners win together. Declining a win locks wins until the next actual own draw; choosing another action also declines hu. Successful replacement draws unlock, but a robbed upgrade does not.
- 下一局如有一炮多胡则炮家坐庄，否则首胡者坐庄；一整局无人胡，原庄不变。 / A multi-win discarder becomes next dealer; otherwise the first winner, or the unchanged dealer if nobody won.
- 补杠（刮风）由尚未胡的其他玩家各付平胡一次，当前表为1分；暗杠各付2分。引风下雨由放牌者付2分。 / Supplemental kongs collect one regular-hand value, currently one point, from each active opponent; concealed kongs collect two each. Exposed kongs charge the discarder two points.
- 花猪按每位其他非花猪固定赔 `min(16, 本桌封顶分)`，不看对家是否听牌或已胡，花猪之间不赔。此项取代“按对家最大听口”和“没听不赔”的此前说法。刮风下雨另算，不混入花猪16分或自摸加底。 / Missing-suit offenders pay every non-offender min(16, cap), regardless of readiness/prior wins; offenders do not pay each other. This supersedes maximum-wait and no-wait/no-payment interpretations. Kong payments remain separate, with no self-draw base addition to penalties.

用户最终明确血战胡者退出、不能再次胡；自摸或单人接炮胡后由胡家下一位未胡者摸，一炮多响由炮家摸。本开发实现到三位已胡结束，或墙耗尽进入流局路径。首胡模式同一张牌的全部胡牌先原子提交再结束，不按点击先后挑赢家。
Final confirmation retires blood-battle winners with no repeated wins. Self-draw/single discard wins advance to the next unwon seat after the winner; multiple discard wins return the draw to the discarder. The development implementation finishes at three winners or exhausted-wall settlement. First-win mode commits the whole simultaneous winning batch before finishing, independent of click order.

血战流局查叫由未听牌者赔听牌者最高可胡牌分；花猪已付固定赔分后不重复赔查叫。花猪和未听牌者均将已收杠分逐笔退给原付款人。已胡者已经退出，不参与后续查叫；花猪固定赔付仍包括非花猪的已胡者。
For blood-battle draws, non-ready players pay each ready player's maximum winning value; missing-suit offenders do not also pay ready checks. Offenders and non-ready players refund all received kong payments to the original payers. Retired winners do not join ready checks, but fixed missing-suit penalties still pay non-offending winners.

缺门未清允许碰杠其他花色，仍不得碰杠缺门牌或带缺门胡牌；碰后必须先完成一次出牌，不能立即暗杠/补杠。相关开发选项已固定，不能再用相反实验值创建局。
Uncleared dingque permits melds of other suits, but not missing-suit melds or wins. After peng, complete a discard before concealed/upgraded kongs. Contradictory experimental policy values now reject.

## 正式快照与原型策略 / Production snapshots and draft policies

用户玩法已确认。正式策略固定由 `chengduProductionPolicy()` 生成并逐次校验，不能用客户端字段覆盖。四人屏幕顺时针映射 `[0,1,2,3]` 对应下→左→上→右；正常摸打逆时针0→3。换牌依其单独的顺→对→逆循环，不混同正常行牌。
User rules are resolved. Production policies are generated and revalidated, never overridden by client fields. Clockwise screen seats [0,1,2,3] map bottom/left/top/right, while normal play goes counterclockwise zero to three. Exchange direction has its independent cycle.

展示沿用既有基线，不影响番分：已成立暗杠公开；自摸胡牌进行中仅本人可见、终局公开；其他暗手牌、换牌明细和未提交回应仍私密。原型保持此前更保守的遮蔽，不回写其保存行为。
Visibility follows the existing baseline without changing scoring: established concealed kongs are public; self-draw winning tiles are owner-only during play and public at finish; all other concealed hands, exchange details and pending responses stay private. Drafts retain their previous conservative masking.

首胡模式无人胡流局也固定查花猪、查叫和退杠，不再接受 `none` 或 `pending`。旧实验待结算存档明确拒绝，不偷偷补默认或重新结算。`planChengduExchangeRound({exchangeThree, exchangeOrdinal, clockwiseSeats})` 返回本局交换计划及 `nextExchangeOrdinal`；房间层只在开局成功时和新局一起原子保存，重连、失败和未启用换牌均不推进。
First-win draws use the same three settlements and reject none/pending. Old experimental pending saves reject without backfilling or resettlement. The pure exchange planner returns the game plan and next ordinal; room integration atomically saves it only with a successful start, never advancing on reconnect, failure or disabled exchanges.

## 文件和调用路线 / Files and call flow

- `chengdu-hand.js`：纯结构、缺门和结构听口。 / Shapes, missing-suit checks and structural waits.
- `chengdu-scoring.js`：`calculateChengduScore`、`getChengduWaitScores`；只用本人牌，清一色固定+2，不读取对手/墙。 / Own-hand scoring and wait values, with confirmed pure-suit stacking and no hidden-table knowledge.
- `chengdu-contract.js`：设置校验、封顶数学、换牌映射与旧准备入口闸门。 / Options, cap arithmetic, exchange mapping and legacy preparation gates.
- `chengdu-game.js`：上一阶段准备层；原导出合同保留。 / Original preparation layer, preserving its exports.
- `chengdu-play-policy.js`：开发策略快照验证，无静默默认。 / Explicit development-policy snapshot validation.
- `chengdu-settlement.js`：完整流局计划；先分类和算账，后统一提交。 / Complete draw plans, separating classification/calculation from posting.
- `chengdu-engine.js` / `chengdu-production-contract.js`：正式工厂、外部调用边界和schema 2快照校验。 / Production factory, public call boundary and schema-two snapshot validation.
- `chengdu-play.js`：`createDevelopmentGame → applyAction → getLegalActions/getPlayerView`，独立碰杠胡状态机、庄家、投影和不变量。 / Development factory, actions/legal choices/views, independent turn state machine, dealer selection and invariants.

开发调用必须提供完整108张牌墙与明确庄家，随机性由正式建局适配层负责。`createDevelopmentGame` 先复用准备层，最后一次定缺在同一个动作内转入回合，不重发牌、不增加第二次 revision。正式注册前仍需完整创建/规则配置/角色/视图/历史/展示能力适配以及前端开发。
Development creation requires a complete wall and explicit dealer; the production adapter owns secure random dealing. Final dingque enters play in the same action without redealing or a second revision. Production still needs configuration, creation, character/view/history/pacing adapters and frontend integration.

## 动作和实体牌 / Actions and physical tiles

客户端意图先严格解析、精确匹配合法动作，然后复制原局、转换、检查守恒。每种牌恰好4张、总108张，虚拟积分合计零。碰/杠接走的弃牌标记 `claimed` 后不再重复计入实体；接炮与抢杠胡的赢家引用同一张弃牌，多个胡不复制实体牌。
Strictly parse and match actions before cloning, transitioning and checking four-per-identity/108-total/zero-sum invariants. Claimed discards are counted only in their meld; multiple winners reference one physical discard without duplicating it.

碰不摸牌；杠成功才付杠分并补摸。补杠先保留原碰和手中第四张，开启抢杠窗口。被抢只移出新增一张，不收杠分、不补摸；无人抢才升级原碰。牌墙为空时不提供需要补摸的杠。
Peng does not draw. A kong posts and replacement-draws only on success. An offered upgrade keeps the peng and fourth tile intact while robbery is pending; robbery removes only that tile with no kong charge/replacement, while passes permit the upgrade. Empty walls disable replacement-requiring kongs.

每个回应窗口保存 `passedWinAtOpen`，验证时据此重建完整可回应座位及动作。已提交的过胡锁变化另行检查，避免漏掉另一赢家、伪造可胡选项或绕过过胡限制。收齐全部真实回应后才按胡、明杠、碰优先级处理。
Each claim saves opening passed-win locks, enabling full eligibility/action reconstruction. Validate response-induced lock changes separately to detect omitted winners, forged options or lock bypasses. Resolve only after all eligible responses, prioritizing wins, exposed kongs and peng.

换三张后庄家原多发牌可能已经换走，因此起手胡资格与“某张真实新摸牌”分开：初始 `lastDraw.source=initial`、`tile=null`，不向界面伪造一张已经不在手中的牌。
Exchange may remove the dealer's extra dealt tile, so initial-hand win eligibility is separate from a particular new draw: initial lastDraw has a null tile identity rather than presenting an exchanged-away tile.

## 流局幂等、隐私与重连 / Idempotence, privacy and recovery

流局计划先完整计算，确定后才统一提交，并把每笔退杠标记到原 `kongLedger`。完成态必须恰有一条一致的结算事件，旧实验pending态不再接受。反复读取或再次调用开发结算不重复付款；把完成局单改成pending也会拒绝。
Compute complete draw plans before posting and marking original kong-ledger refunds. Finished draws require exactly one consistent settlement event; obsolete experimental pending states reject. Repeated reads/settlement do not repost, and simply flipping a finished state to pending rejects.

三类投影使用正向白名单：本人手牌/听口只给本人；观众和换座者没有手牌/动作/私人回应；尚未处理的选择不公开；抽牌永不向他人公开；正式暗杠及自摸胡牌按上方快照展示。旧局恢复不修改方向、规则、手牌、积分或已提交回应。FileStore与MemoryStore/CAS复用现有存储生命周期，不另造身份体系。
All audiences use allowlists: own hands/waits are private, spectators/replacements have no private decisions/actions, and draw identities remain private while production kong/win identities follow the snapshot above. Recovery preserves rules, direction, hands, balances and responses. Existing FileStore/MemoryStore/CAS lifecycles are reused without a new identity system.

## 验证 / Validation

新增专项在 `tests/chengdu-scoring.test.js`、`tests/chengdu-play.test.js`，原准备层50项继续运行。覆盖已确认番表/根/组合/封顶、多胡顺序、碰杠与抢杠、退役、过胡、流局计划与阻断、重复结算拒绝、隐私、JSON/FileStore重启、CAS，以及24种子完整回放。独立审查发现的初始牌身份、选择杠时过胡锁、完整回应集合、重开结算及遗漏原杠付款人问题均补实现与回归。
New scoring/play suites run alongside the original fifty preparation cases. Coverage includes patterns/roots/caps, multi-win ordering, melds/robbery, retirement/passed wins, draw plans/gates/idempotence, privacy, JSON/FileStore/CAS and 24 full seeded replays. Independent-review findings on initial tile identity, passed hu while upgrading, complete claim eligibility , reopened settlement and omitted original kong payers received fixes and regressions.

最终测试/lint/build数量见交付记录。未做成都网页、真实浏览器、多设备或声音验收，未运行生产HTTP、数据库迁移或完整仓库TypeScript检查。纯引擎通过不代表上线验收通过。
Final counts are recorded in the handoff. No Chengdu UI, real-browser/device/listening acceptance, production HTTP, migrations or full repository TypeScript run; pure-engine tests are not launch acceptance.

本轮最终结果：成都专项124/124（准备50、计分20、回合54）；`npm test` 1095/1095；lint零错误、原4警告；Vue/Worker生产构建与`git diff --check`通过。只读独立审查已复核5项修复。花麻将源码、注册表/API、前端/素材、数据库/迁移与依赖锁无改动。
Final results: Chengdu focused 124/124 (50 preparation, 20 scoring, 54 play); full suite 1095/1095; lint zero errors/four existing warnings; Vue/Worker production build and diff check pass. Independent read-only review reverified five fixes. Flower code, registry/API, UI/media, database/migrations and dependency lock remain unchanged.

## 后续确认更新 / Subsequent confirmations

本轮固定明杠2、查叫/退杠资格、缺门未清可碰杠、碰后先出牌，以及单胡/自摸后胡家下家、多响炮家摸和胡者退出。增加8项专门回归并重新运行全部成都种子回放；最新测试数量见本轮交付，不沿用上次124/1095统计。正式注册/API/前端仍无改动，无发布。
This update fixes exposed-kong two points, ready/refund eligibility, non-missing-suit melds before clearance, post-peng discard, winner retirement and distinct single/multiple-win continuations. Eight new regressions and all seeded replays run again; current handoff counts supersede prior 124/1095 figures. Production registration/API/UI remain unchanged, without publication.

最新确认批次验证：成都专项132/132（准备50、计分20、回合62）；全量1103/1103；lint零错误、原4警告；构建及diff检查通过。独立审查复核本批规则转换未发现正常流程矛盾。未做生产、真实浏览器或设备验收。
Latest confirmation-batch validation: Chengdu focused 132/132 (preparation 50/scoring 20/play 62), full 1103/1103, lint zero errors/four existing warnings, build and diff checks pass. Independent review found no normal-flow contradiction in this rules patch. No production/browser/device acceptance is claimed.

## 首胡流局与轮回确认 / First-win draw and cycle confirmation

最新确认首胡无人胡流局也采用血战的查花猪/查叫/退杠；换三从第一场启用局的顺时针开始，仅启用局推进。保留并重跑胡者退出、单胡/自摸后胡家下家、多响炮家摸回归。纯轮回计划无存储副作用，不把页面刷新当新局。
Latest confirmation makes first-win exhausted draws use the blood-battle penalty/ready/refund rules. Exchange starts clockwise on its first enabled game and advances only for enabled games. Retirement and distinct single/self-draw/multiple-win continuations remain covered. The pure planner has no storage side effect and never treats refresh as a new game.

本批验证：成都专项133/133、全量1104/1104、lint零错误和4个既有警告、构建与diff检查通过；未发布。
This batch passes Chengdu focused 133/133, full 1104/1104, lint with zero errors/four existing warnings, build and diff checks; unpublished.

## 正式接入接口 / Production integration contract

- `createGame({wall, dealerSeat, options, scoring, exchangeOrdinal})`：全部显式输入；wall须由服务端加密随机洗好108张，不能传开发策略。options含endCondition/exchangeThree/可选dingque:true，scoring含selfDraw/fanCap。返回正式game及exchangeOrdinal/nextExchangeOrdinal，不写房间。 / Explicit server-shuffled wall, dealer, mode/scoring choices and exchange cursor; no experimental policies and no persistence.
- `assertGameInvariants` 在正式每次读写前验schema、固定策略、展示快照、交换计划、阶段、实体牌和零和；缺字段或developmentOnly/developmentStage字段均拒绝，不自动迁移。 / Validate identity, policies, visibility, exchange, phases, physical copies and zero-sum balances; reject draft markers and missing fields without migration.
- `parseAction / getLegalActions / applyAction` 提交与转换纯动作，最终定缺一次revision内转入turn；`getPlayerView / getSpectatorView / getFormerParticipantView` 只给获准视图。 / Pure actions and authorized projections, with final dingque entering turns in the same revision.
- `dealerForNextGame` 仅接受终局并返回整数庄家；`settleGame` 只对已自动完成的流局返回无变更副本，不能重复入账。 / Finished-only dealer selection and idempotent finished-draw reads.
- `publicEvents` 允许完整局及已过滤公开历史再次过滤，读取score.points或已公开points；已隐藏牌面永不恢复。归档分发必须明确生产版本头，不能把摘要当完整游戏调用不变量。 / History filtering accepts full games or sanitized archives, keeps public points and never restores hidden faces; archive routing is separate from full-state validation.

后端须在同一次成功CAS保存新game和nextExchangeOrdinal，失败/重连不推进。服务端现有角色、凭证、房主、离席、历史和观战生命周期复用，不由引擎创建第二套。房间CAS与真实浏览器验收属于接入分支覆盖，不由本文件13项生产纯引擎测试替代。
The backend must atomically save the new game and next cursor in one successful CAS; failures/reconnects do not advance it. Existing character, credential, host, departure, history and spectator lifecycles remain. Room CAS/browser acceptance belongs to integration, not the thirteen production pure-engine tests here.

正式纯入口批次验证：成都146/146（含正式13项）、全量1117/1117；lint零错误和4个既有警告、Vue/Worker构建、diff检查通过。独立只读审查未发现具体缺陷。房间CAS、后端适配与网页验收由接入分支负责；此分支未发布。
Production-entry validation: Chengdu 146/146 including thirteen production tests, full 1117/1117, lint zero errors/four existing warnings, Vue/Worker build and diff check pass. Independent read-only review found no concrete defect. Room CAS/backend/UI acceptance belongs to integration; this branch remains unpublished.
