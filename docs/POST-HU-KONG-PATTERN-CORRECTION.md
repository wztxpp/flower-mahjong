# 胡后杠保留牌型 / Preserve the winning pattern after hu

## 用户确认与原因 / Confirmation and cause

2026-11-10用户确认：胡后杠不能影响已经固定的胡牌牌型，并指出七对胡后仍出现杠。旧检查只比较`contextualWaitTiles`；七对听口直接复用`firstHuPattern.waitTiles`，拆对子成立副露后也会返回原听口，因此错误通过，甚至被“胡后必杠”强制执行。
On 2026-11-10 the user confirmed that a post-hu kong must preserve the fixed winning pattern and reported a seven-pairs kong. The old comparison reused saved expanded seven-pairs waits even after a simulated meld destroyed the pairs, incorrectly permitting and potentially mandating the kong.

## 权威条件 / Authoritative conditions

- 已保存七对牌型的玩家不能再声明任何杠。包括四张组、多个四张组、六张组、清七对，以及同时可拆成普通胡的七对；不会通过重新分类改换牌型。七对后续听牌和固定番数原样保留。
  A player with a recorded seven-pairs pattern cannot declare any further kong, including quadruple/sextuple groups, pure seven pairs, and dual standard decompositions. Repeated waits and fixed fan remain unchanged.
- 胡后暗杠、补杠和加杠必须使用本人的当前真实同牌摸入。暗杠是原刻子加新牌，不能拿走原有四张而把另一张新牌留在锁手里，即便前后听口相同。明杠使用他人弃牌补原刻子，不套用本人摸牌条件。
  Post-hu concealed/peng/extended kongs must use the matching actual current draw. A concealed kong extends a held triplet, never exchanges a held quadruple for an unrelated draw despite equal waits. An exposed kong uses the other player's discard instead.
- 所有胡后杠仍须保留全部听口。旧`preserveWaitsOnPostHuKong:false`或缺字段不再绕过本次明确纠错，但保存值不改写。例如已有三副露、暗手`[6条,6条,6条,8条]`听7条/8条，摸6条不能暗杠，因为杠后只听8条。
  Every post-hu kong must retain every wait. False/missing legacy wait flags cannot bypass this correction and are not rewritten. With three melds, held `[6 bamboo ×3, 8 bamboo]` waits on seven/eight; drawing six cannot kong because only eight would remain.
- 不改牌型的普通胡、对对胡、清一色刻子转杠，以及既有合法补杠、加杠、明杠继续保留；胡优先、碰后先出牌、抢杠、墙牌余量、杠分和萝卜规则不改。
  Shape-preserving standard/all-triplets/pure-suit triplet kongs and existing legal upgrades/extensions/exposed kongs remain. Hu priority, post-peng timing, rob-kong, wall capacity, charges and radishes are unchanged.

## 保存与版本边界 / Saved-game and version boundaries

`canDeclareKong`负责新动作，`getLegalActions`同样过滤保存窗口里尚未回应的明杠，并保留过牌让旧窗口收束。读取与拒绝动作不修改局、积分或规则快照。已接受回应、已成立副露、已结算历史不撤销或重算，不修复真实旧账。
New actions use `canDeclareKong`; `getLegalActions` also filters unanswered saved exposed-kong choices and retains pass to close the window. Reads and rejections mutate nothing. Accepted responses, committed melds and settled history are neither revoked nor recalculated.

没有首胡牌型快照的旧局不从累积胡牌区猜七对，不新增保存字段或迁移；仍保护真实摸牌、结构听口。schema1/2、成都引擎、服务器与界面生产源码保持不变。
Legacy saves without a first-pattern snapshot do not infer seven pairs from accumulated wins. No persisted field or migration is added; current-draw and structural-wait protection still applies. Frozen schemas one/two, Chengdu, server and UI production sources remain unchanged.

## 回归入口 / Regression entry points

- `tests/fixtures/post-hu-pattern.js`：真实首胡与JSON恢复的守恒七对夹具。
  Real first-hu and JSON-restored conserved seven-pairs fixtures.
- `tests/post-hu-pattern.test.js`：五种七对、三种摸牌、自动/手动、旧开关、普通同听口换手、丢听口、保存明杠、新旧提交边界、合法暗杠/明杠与再次胡。
  Five seven-pairs forms, three draw sources, automatic/manual behavior, old flags, held-tile exchange, lost waits, saved claims, accepted-response boundaries, legal kongs and repeat wins.
- `tests/flower-lock-api.test.js`：FileStore重启、HTTP重复非法暗杠无写入、手动过牌保留手牌与旧账。
  FileStore restart, no-write repeated illegal HTTP kongs, and manual pass preserving the held hand and ledger.

完整检查结果随交付记录；引擎与HTTP测试不是生产联机试玩。
Aggregate checks are recorded with delivery; engine/HTTP tests are not a production multiplayer playtest.

## 验收 / Verification

基线`78c729861b292332b1af972238fc3c079308bf24`；新增33项回归，完整`npm test`为1718/1718通过。独立复核专项64/64；新牌型专项在旧基线上23/32失败，修正后32/32通过。使用锁文件全新安装依赖，`npm run lint`零错误、3条既有警告，`npm run build`成功（保留既有大包提示）；`git diff --check`通过。未进行生产真人联机试玩或全项目TypeScript检查。
Baseline `78c7298`; 33 added regressions and all 1,718 tests pass. Independent focused review passes 64/64. The new pattern suite fails 23/32 on baseline and passes 32/32 after correction. Dependencies were freshly installed from the lockfile; lint has zero errors and three existing warnings, build succeeds with the existing large-chunk notice, and diff whitespace checks pass. No production multiplayer playtest or repository-wide TypeScript check was run.
