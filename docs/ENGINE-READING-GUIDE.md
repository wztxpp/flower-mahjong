# 规则引擎逐层导读 / Layered engine reading guide

## 先认清版本 / Identify the version first

- `shared/game.js`：当前 v3 引擎。 / Current v3 engine.
- `shared/v2-game.js`：保存局 schemaVersion=2 的兼容引擎。 / Compatibility engine for saved schema version 2.
- `shared/legacy-game.js`：schemaVersion=1 或缺字段的旧局。 / Legacy engine for version 1 or missing version.

它们有相同导出接口但不同规则，不能仅因为代码相似就合并。`server/api.js` 的 `engineFor` 负责选择，前端不能选择一个有利规则版本来处理同一局。
They have similar exported interfaces but different contracts. server/api.js selects the engine; the browser cannot choose a more favorable version for one saved game.

这三个文件是纯 JavaScript 模块：没有 DOM、Vue、网络或数据库。先用测试种子创建局，再给 `applyAction` 一个座位和动作，即可重放。
These modules have no DOM, Vue, network, or database. Create a seeded game and pass a seat/action to applyAction to replay it.

## 推荐阅读顺序 / Recommended reading order

1. 常量与小工具：理解 18 种 × 8 张，以及复制/排序/计数/移除实体牌。 / Constants/helpers: eighteen identities times eight copies; clone, sort, count, remove.
2. `createGame`：从默认规则、洗牌、发牌走到状态对象。 / Follow normalization, shuffle, deal, and state creation.
3. `getPlayerView`：先看客户端最终能拿到什么，理解隐私边界。 / Read the projection before internals to understand privacy.
4. `getLegalActions`：看引擎如何区分 turn、claim、finished。 / Understand phase-dependent decisions.
5. `applyAction`：看一次动作的唯一提交入口。 / Read the single action-commit entry.
6. `discardTile`、`resolveClaimWindow`、`beginDrawStep`、`drawTile`：把普通回合连起来。 / Follow the ordinary discard/claim/draw cycle.
7. `isWinningHand`、`getWaitTiles`：理解牌型递归与听口。 / Study structural recursion and waits.
8. 胡牌与杠：再读 `settleHuBatch`、`declareKong`、`offerKongUpgrade`、`calculateHuScore`。 / Then study hu/kong transitions and scoring.
9. `assertGameInvariants`：反过来理解哪些状态绝不能出现。 / Finish with invalid states and conservation.

## 从一张弃牌跟读 / Trace one discard

`applyAction` 先验证输入只含允许字段，并用 `type` 与 `tile` 匹配合法动作。只有通过才复制整局并增加 `revision`，因此失败不会半改旧对象。
applyAction validates fields and matches type/tile against the allowlist before copying and incrementing revision. A rejected request cannot partially corrupt the original.

已胡者能胡时 `getLegalActions` 只返回胡，优先于手动/自动出牌和杠；接炮与抢杠都在添加过牌前处理，读取旧窗口不改存档对象。首次胡和冻结版本仍保留原选择。见 [胡后必胡纠错](POST-HU-WIN-CORRECTION.md)。
For prior winners, getLegalActions returns hu alone before any discard/pass/kong alternative. Claim and rob-kong reads apply it before adding pass, without mutating saved windows. First wins and frozen versions retain their choices. See [mandatory-win correction](POST-HU-WIN-CORRECTION.md).

`discardTile` 从手牌移除一张，保存这次是否杠后出牌，清除 `lastDraw`，写入弃牌事件。它会按顺位计算他家选项，有选项才建立 `claim`。没有选项则指定下一位进入 draw。
discardTile removes one physical tile, captures its post-kong provenance, clears lastDraw, logs the event, and computes opponents’ options. It creates a claim window only when someone has options; otherwise it starts the next draw.

`resolveClaimWindow` 不是每来一条回复就直接执行。只有 eligibleSeats 全部回应，才看胡、杠、碰与保存顺序。`responses[seat]` 里没东西和 `{type:'pass'}` 不一样。
resolveClaimWindow waits for all eligible responses before applying priority and saved order. Missing response differs from an explicit pass.

v3 的 `advanceAutomaticSteps` 会继续执行不用玩家选择的摸牌；胡后可能自动打出无用新牌，但有胡/杠或手动确认时必须停。300 次上限来自有限牌墙，不是一个计时器。
v3 advanceAutomaticSteps performs non-decision draws/discards but stops for hu, kong, or manual confirmation. Its 300-transition bound is a finite-wall safety guard, not a timer.

## 看懂胡牌递归 / Understand structural win recursion

`isWinningHand` 先检查牌数：剩余手牌需要 `(4 - meldCount) × 3 + 2` 张。一个副露代替三张结构需求，即使杠实际有四到八张，结构上仍只占一组。
The concealed structural size is (4 − meldCount) × 3 + 2. A kong occupies one group even when it physically contains four to eight tiles.

先尝试七对特例，再依次拿一个对子作将。剩下的牌进入 `meldable`：找最小非零牌种，尝试三张刻子；失败则尝试同花色顺子。每次递归返回后都恢复计数，所以各分支相互独立。
After the seven-pairs case, try each pair. meldable takes the lowest remaining identity and tries a triplet, then a same-suit sequence. Restore counts after recursion so branches remain independent.

`first % 9 <= 6` 表示起点只可能是一到七，不能让八条、九条、一筒错误地成为顺子。memo 的键是剩余频次，不是牌的原始顺序。
The modulo boundary prevents eight/nine bamboo from crossing into dots. Memoization keys are remaining counts, not original hand order.

`getWaitTiles` 枚举每个可能补进来的牌种，调用上述结构判断。它不查看对手或牌墙，因此不会把秘密信息通过“可听什么”泄露给玩家。
getWaitTiles tries each possible added identity using structural checks without querying opponents or the wall.

## 计番、萝卜与付款分开 / Separate fan, radishes, and payers

- `classifyHuPattern` 解释完整牌型；首次七对档位要保存，不因以后胡牌区积累又升档。 / Classify the complete shape and preserve the first qualifying seven-pairs tier.
- `calculateHuScore` 计算 fan、fanPoints、radishBonus 等分解，但不扣任何人的分。 / Calculate a breakdown without moving points.
- `settleHuBatch` 根据来源、杠来源、已经胡过的人和末家例外确定付款座位。这个顺序很敏感，不能随便交换分支。 / Determine payers from win source, kong provenance, prior winners, and final-win exceptions; branch order matters.
- `transferPoints` 才进行零和转账，同时返回 payments 给历史/界面。 / Only the transfer helper mutates balances and emits payment entries.
- `settleDragons` 在 v3 终局收一次神龙分，独立 settled 防重；不能把它重新加到每次胡里。 / Settle v3 dragons once at finish, not on every hu.
- `awardBigSingleReady` 在真实形成待牌后处理一次喜钱；不在 `getLegalActions` 这类读取里收费。 / Process the ready bonus only after a committed ready shape, never during a read-only legal-action calculation.

番与分不同：1/2/3/4 番对应 1/2/4/8 分，5 番起是 2×番数。萝卜是“匹配牌张数乘匹配萝卜张数”的求和。付款人数决定收入总额，但不改变每人应付的 score.total。
Fan maps to points; radishes multiply matching copy counts. Payer count determines total income, not the per-payer score.total.

## 杠与抢杠 / Kong and rob-kong

`canDeclareKong` 只模拟，不移动真实牌，不付分，不翻萝卜。`declareKong` 才提交。已胡玩家还可能要求杠前后听口完全一致，因此不能只检查手里有四张。
canDeclareKong simulates only; declareKong commits. A post-hu kong may need to preserve every wait, so four copies alone are insufficient.

`buGang` 是三张碰补成四张，`addGang` 是已成立的杠加到第五至八张。抢杠窗口只放出新增一张：无人抢时再把该牌放回手中由原提交流程处理；有人胡时原杠不成立，不能提前收杠分或把四张都交给赢家。
buGang upgrades a peng; addGang extends an established kong. A rob-kong window offers only the additional tile. If everyone passes, commit normally; if someone wins, do not prematurely charge or transfer the entire original meld.

用户确认的补杠时机是：碰后先完成一次出牌，然后在之后正常合法窗口补杠；不是永久禁止，也不是必须新摸到匹配牌。`requiresPungDiscard` 对新策略及 v0.7.0 的错误 false 开关采用该纠正；`pendingPungDiscard` 优先读保存标记，旧存档从本人最近的碰/出牌事件推断。原手牌、积分、历史和规则字段不重写。更老的允许/缺省策略仍保留原时机。
Confirmed timing requires completing the peng claimant’s discard before later legal upgrades, not a permanent ban or a matching-new-draw requirement. requiresPungDiscard applies the correction to the new policy and v0.7.0 false flag. pendingPungDiscard uses the saved marker or the seat’s latest peng/discard events. Hands, scores, history, and rule fields are not rewritten; older allow/missing timing remains intact.

## 隐私与守恒 / Privacy and invariants

`getPlayerView` 只给本人 hand，对手给 handCount；新局暗杠公开，自摸胡牌对其他两家以 null/hidden 隐藏，旧局按原快照；尚未统一处理的反应只给 respondedSeats。不要把整个 game 直接 JSON 返回。
Return the requester’s hand and opponents’ counts. New snapshots publish kong faces and hide opponent self-drawn wins until finish; old snapshots retain their policy. Return only response status, never the complete private game object.

守恒是三层：实体牌总数 144；每种恰好八张；三人的 score 相加为零。再按阶段验证手牌基础张数，多的一张只能属于当前 discard 步骤的座位。winPile 是逻辑引用，不能重复计数。
Conserve 144 physical tiles, eight of each identity, and zero-sum scores. Validate phase-dependent hand sizes. Logical win-pile references are not extra physical tiles.

## 本次重构的验证方法 / Readability verification

纯可读性提交只统一私有助手名称、排版和注释，不改导出接口/规则键/存档键。最终整合另包含独立授权的喜钱与补杠功能提交，行为比较以该功能提交为基线。语法比较先把受控私有名称映回基线，再忽略位置和注释；若仍相等，说明执行表达式、分支次序与数据字面量未变。另用固定种子跨三版本对局重放比较每步状态、视图和合法动作。
The pure readability commit changes only private helpers, layout, and explanations. Final integration separately includes authorized bonus/timing changes, so its behavior baseline is the feature commit. AST comparison reverses the approved private renames and ignores locations/comments, then checks expressions, branch order, and literals. Seeded differential replays independently compare states, views, and legal actions across all three versions.

## 音画分步入口 / Presentation-paced entry points

`applyAction` 保留原即时语义；`applyPresentedAction` 使用同一规则但在出牌/碰/杠/整批胡后设置 `game.presentation`。出牌暂停发生在计算接牌选项之前。`continuePresentedGame` 清除该标记后继续到下一个展示或决策点，不增加引擎 revision，不重复结算。`getLegalActions` 在暂停时为空；存档 rules 不变。具体标记、服务端确认和验证见 [音画节奏](PRESENTATION-PACING.md)。
`applyAction` keeps immediate semantics. `applyPresentedAction` uses the same rules but marks presentation boundaries after discards/peng/kong/win batches, before discard-claim evaluation. Continuation clears the marker and reaches the next boundary without changing engine revision or repeating settlement. Legal actions are empty while paused; saved rules remain intact. See [presentation pacing](PRESENTATION-PACING.md).

### 首胡前选择与碰后暗杠 / Pre-win choice and post-peng restriction

`getDiscardClaimOptions` 在新局中同时列出未胡者的胡、明杠和碰；`getLegalActions` 把可胡判断与杠枚举分开，但已胡必胡仍提前返回。`pendingPungDiscard` 同时保护补杠时机和新局暗杠时机，只有真实出牌清除义务。新规则由 `preHuActionChoice` 和 `concealedKongAfterPungDiscard` 显式快照启用，旧局缺字段保持原行为。回归入口为 `tests/action-choice.test.js`。
In new games, getDiscardClaimOptions lists all unwon hu/exposed-kong/peng options, while getLegalActions separates hu detection from kong enumeration but still returns early for mandatory post-win hu. pendingPungDiscard protects upgrade timing and new-game concealed-kong timing until a real discard. Explicit snapshot flags opt into the changes; absent saved flags preserve historical behavior. See tests/action-choice.test.js.
## 杠事件计番快照 / Kong-event scoring snapshot

`settleHuBatch` 在牌型固定后选择本次事件来源；七对不加事件番，普通抢杠保持原行为，其余只在 `rules.kongEventFan === true` 下开启。`calculateHuScore` 在番转分前加一次，不修改 `firstHuPattern` 或付款方。读取旧局不合并默认值，旧历史不重算。详细规则见 [当前规则](RULES.md)。
After freezing the pattern, settleHuBatch chooses this win's event source. Seven pairs excludes event fan; ordinary rob-kong keeps its old behavior, and other sources require rules.kongEventFan === true. calculateHuScore adds it once before point conversion without changing firstHuPattern or payers. Saved-game reads do not merge defaults or recalculate history. See the current rules.

## 可变牌桌维护入口 / Variable-table maintenance

[可变人数与副数](VARIABLE-TABLES.md) 是3/4人、1–5副、神龙门槛及新计分快照的当前说明，替代本指南早期固定三人/144张/八张上限的默认描述。新增维护测试为 `tests/variable-table.test.js`、`tests/fixtures/variable-table.js` 和 `tests/variable-room-api.test.js`；UI专项并入原测试。旧局和schema1/2不改。
[Variable tables](VARIABLE-TABLES.md) documents snapshot-driven dimensions and scoring, superseding earlier fixed-three/144/eight-copy defaults here. The listed new maintained tests join existing UI coverage; old games and frozen engines remain unchanged.
