# 成都引擎准备层 / Chengdu engine preparation layer

本页保留第一阶段准备层的实现范围与当时验证；最新规则纠正、可测试回合引擎与未决项以 [成都独立开发引擎](CHENGDU-ENGINE.md) 为准，尤其花猪已改为固定16分受封顶限制，不再按对家听口或要求对家听牌。
This page preserves stage-one implementation/validation; [the current development guide](CHENGDU-ENGINE.md) supersedes earlier rules and gaps, especially fixed capped-sixteen missing-suit penalties without wait-based recipient pricing or eligibility.

## 范围和发布状态 / Scope and release status

本次以 `534f6a7` 模式基础为基线，新增独立成都结构与准备阶段原型。**不是可玩的成都麻将，也没有注册生产引擎。** 原模式注册表、HTTP、角色/会话/观战生命周期、花麻将三个版本、前端、素材和数据库均不改。没有发布、迁移或访问真实牌局。
This work starts from mode foundation `534f6a7` and adds independent Chengdu shape/preparation modules. **It is not playable Chengdu and has no production registration.** The registry, HTTP, character/session/spectator lifecycle, three Flower versions, UI, assets and database are unchanged. No publication, migration or real-game access occurred.

`createGame()` 和 `settleGame()` 无条件抛出 `ChengduRulesPendingError`（`CHENGDU_RULES_PENDING` / 409）。客户端传 `approved` / `force` 不能绕过。`server/game-engines.js` 对成都仍返回 `GAME_MODE_UNAVAILABLE`。不能为了演示把原型登记成正式引擎，也不能用花麻将的同版本号顶替。
`createGame()` and `settleGame()` always throw `ChengduRulesPendingError` (`CHENGDU_RULES_PENDING` / 409); caller approval/force flags cannot bypass it. The registry still returns `GAME_MODE_UNAVAILABLE`. Never register this prototype for a demo or substitute a numerically matching Flower version.

## 已确认信息与未决细则 / Confirmed facts and unresolved details

已确认：四人；条/筒/万各九种、每种四张、总108张；可选首胡结束/血战；可选换三张但必须同花色；必须定缺；换牌按“顺、对、逆”三种方向轮回；自摸加底/加番可选；4/5/6番封顶对应8/16/32分；自摸加底在封顶后仍加1，例如4番封顶时9分。
Confirmed: four seats; 27 bamboo/dots/characters identities with four copies each, 108 total; first-win/blood-battle choice; optional three-tile exchange restricted to one suit; mandatory dingque; forward/opposite/reverse exchange cycle; add-base/add-fan self-draw choice; caps 4/5/6 map to 8/16/32 points; add-base still adds one after capping, so the four-fan cap can pay nine.

血战流局需要查花猪、查叫、退杠。用户后续已纠正花猪为每位非花猪固定赔 min(16,封顶)，不看听牌/已胡；此前“对家最高听口”和“未听不赔”口径不再适用。后续番表、过胡、庄家和部分杠金额也已确认。最新未决退杠等细节见当前开发指南。
Blood-battle draws require penalties, ready checks and kong refunds. Later clarification replaces prior wait-based penalty/eligibility interpretations with fixed min(16, cap) per non-offender regardless of readiness/prior wins. Pattern, passed-win, dealer and some kong rules were also subsequently confirmed; see the current guide for remaining gaps.

第一阶段当时未决（后续确认与当前闸门见新指南）：换牌第一局起点、哪些局推进轮回、顺/逆与真实座位几何映射；具体牌型/番表及叠加；杠付分/退杠；同张多胡与首胡结束的顺序；过胡限制；下局庄家；血战流局细则；胡牌展示隐私。所有未决项都在 `CHENGDU_RULE_GAPS` 明确列出，不能通过配置字符串自称已实现。
At stage one, pending items covered the exchange starting point, eligible rounds and physical seat orientation; pattern/fan table and stacking; kong payment/refunds; simultaneous/first-win ordering; passed-win restrictions; next dealer; draw settlement; and winning-tile disclosure. `CHENGDU_RULE_GAPS` explicitly lists these gaps; a configuration string cannot claim implementation.

## 文件与接口 / Files and interfaces

- `shared/chengdu-options.js`：保留已有基本选项合同，不扩展或静默改变已用字段。 / Preserve the existing basic-choice contract without retrofitting its fields.
- `shared/chengdu-contract.js`：显式计分选择校验、三个封顶映射、已计算番数的自摸封顶数学、换牌轮回/座位映射、未决规则错误。 / Explicit scoring-choice validation, cap mapping, arithmetic for already-computed fan, exchange cycle/seat mapping, and pending-rule errors.
- `shared/chengdu-hand.js`：四组一对、七对结构、对对胡结构、清一色/根的事实，定缺存在检查、强制缺门出牌集合、结构听口。**不计算牌型番数，不决定能胡或付款。** / Shape facts, missing-suit presence, forced missing-suit discards and structural waits. **No pattern fan, win authorization or payments.**
- `shared/chengdu-game.js`：开发准备状态机、动作解析、守恒与三类视图。 / Development preparation state machine, input parsing, invariants and three audience projections.
- `tests/chengdu-engine.test.js`：合成牌、不同提交顺序、无副作用、隐私、JSON/FileStore重连、封顶数学、未决拒绝和24种子守恒。 / Synthetic deals, order independence, immutability, privacy, JSON/FileStore recovery, cap arithmetic, fail-closed boundaries and 24 seeded conservation runs.

`chengduWinPoints(fan, isSelfDraw, {selfDraw, fanCap})` 只接收已由未来规则层算好的正整数番数。自摸加番先加一番再封顶，加底先封顶后加一分；接炮不加自摸项。不得据此认为实际牌型番表或付款方已实现。
`chengduWinPoints(fan, isSelfDraw, {selfDraw, fanCap})` accepts an already-computed positive fan count. Add-fan increments before capping; add-base increments points after capping; discard wins receive neither self-draw adjustment. This does not implement actual pattern fan or payers.

`chengduExchangeDirection(cycleStart, cycleOrdinal)` 的序号从0起，起点必须显式传入。它不负责决定哪局计入轮回。`chengduExchangeRecipient(seat, direction, clockwiseSeats)` 要求显式四座位顺时针表，不把 `seat + 1` 猜成屏幕顺时针。以后房间层应在实际成功开局时快照方向，不在刷新/断线恢复时增加游标。
`chengduExchangeDirection(cycleStart, cycleOrdinal)` requires a start and zero-based ordinal without selecting eligible rounds. Recipient mapping requires an explicit clockwise seat array rather than assuming increasing indices are visually clockwise. A future room integration must snapshot direction only at a successful start, never increment on reads/reconnects.

## 状态转换 / State transitions

`createPreparationGame({wall, dealerSeat, options, scoring, exchangePlan})` 只供隔离开发。输入必须有完整108张牌墙及明确庄家，没有生产随机发牌默认。新对象标记 `developmentOnly:true`；开发 `schemaVersion:1` 不是已经发布的存档合同，不接受进入正式模式注册。
The preparation-only constructor requires a complete supplied wall and explicit dealer. It has no production random-deal default. Output is marked `developmentOnly:true`; development schema one is not a released save contract and must not enter the production registry.

1. 发每家13张、庄家多一张，牌墙余55张。 / Deal 13 each plus one to the dealer, leaving 55.
2. 启用换三张则 `exchange`；每家只提交自己真实持有的同花色三张。四家未到齐不移动任何实体牌，已提交者无重复动作。 / In exchange, submit three genuinely held same-suit tiles. Do not move tiles until all four submit, and reject duplicate submissions.
3. 四家齐后先统一移出、再统一移入。收件/选择记录只是引用，不计入实体牌预算。进入 `dingque`。 / Remove all outgoing tiles before adding any incoming tiles; receipts/selections are references, not new physical copies. Enter dingque.
4. 不换牌则直接定缺。四家须各自确认，未提交者不能被自动选花色。 / Without exchange, enter dingque directly. Require each person's explicit choice, never auto-select.
5. 全部定缺后进入 `rulesPending`，没有任何摸/出/碰/杠/胡动作，也不结算。 / Once all choose, enter rulesPending without draw/discard/peng/kong/hu or settlement.

已确认的强制缺门出牌规则有纯函数及场景测试，但尚未接入可玩的回合转换。**先打缺门不保证流局时无人花猪**：最后一个摸牌回合可能只能打掉一张，手中仍余缺门。测试覆盖这个结构事实，不冒称完成血战流局结算。
The confirmed forced-discard rule has a pure helper and scenario test, not a playable turn transition. **Mandatory missing-suit discards do not guarantee zero missing-suit players at exhaustion**: the final turn may remove only one of several remaining tiles. A test covers this fact without claiming full blood-battle settlement.

## 隐私、重连和原有生命周期 / Privacy, reconnect and existing lifecycles

本人视图仅本人手牌与换牌记录。别人和观众只能看提交状态；定缺到四家都完成才公开各家花色。换座后的原参与者投影按观众处理，无手牌、收件或合法动作。事件使用严格白名单，不展开任意事件文本或未来新增私有字段。准备完成不是终局，不摊开所有手牌。
A player sees only their hand/exchange details. Others/viewers see submission status; suits are revealed after all four choose. Former-occupant projections are spectator-like, with no hands, receipts or actions. Events use a strict allowlist, not arbitrary text or future private fields. Preparation completion is not the end of the game and does not reveal all hands.

每个成功动作先从合法集合精确匹配、再克隆、再推进、最后校验；失败不修改原对象。所有状态均为JSON数据，重连恢复保存的选择和方向，不重发牌或再次执行交换。FileStore合成重启证明存储生命周期可复用，但没有放开成都HTTP，所以这不是成都真实多人联机验收。
Actions exactly match the allowlist before cloning/transitions/invariant checks; failures preserve the input. JSON snapshots retain choices and direction without redealing or re-exchanging. A synthetic FileStore restart demonstrates storage reuse, but HTTP remains disabled, so this is not Chengdu multiplayer acceptance.

## 验证范围 / Verification scope

最终命令与数量在本次交付中记录。必须跑 `node --test tests/chengdu-engine.test.js`、`npm test`、`npm run lint`、`npm run build`；原41个模式基础用例仍验证花麻将逐步等价及成都未开放。未做浏览器/设备/声音验收，因为没有新UI或完整可玩模式。
Record final command results/counts in the handoff. Run focused tests, all tests, lint and build; the original 41 mode-foundation cases still check Flower parity and disabled Chengdu. No browser/device/audio acceptance is claimed because there is no new UI or complete playable mode.

本轮最终验证：专项50/50；`npm test` 1021/1021（原971 + 新50）；lint 0错误、原有4警告；Vue/Worker构建通过。`git diff --check` 通过。没有做完整TypeScript检查、真实浏览器、多设备、声音、生产HTTP或数据库迁移；不把本轮通过称作成都完整玩法上线验收。
Final validation: focused 50/50; full suite 1021/1021 (971 existing plus 50 new); lint zero errors/four existing warnings; Vue/Worker build passes; diff whitespace check passes. No full TypeScript, real-browser, multi-device, listening, production HTTP or database-migration run; this is not a complete Chengdu launch acceptance.


## 后续房间UI接入 / Subsequent room UI

上文记录纯引擎交付时的范围；现在 [成都房间准备](CHENGDU-ROOM-PREPARATION.md) 允许创建没有 game 的准备容器。`modeForRoom` 可返回该容器策略，但 `engineFor`、正式开局与结算仍失败关闭；测试改为验证实际启动入口而非禁止建立空房间。开发准备引擎没有被登记为生产版本。
The earlier text records the pure-engine delivery. Preparation rooms now permit an empty game-less container; modeForRoom may resolve its room policy, while engineFor, production start and settlement remain fail-closed. Tests guard start entries rather than forbid empty rooms. No development engine was registered for production.
