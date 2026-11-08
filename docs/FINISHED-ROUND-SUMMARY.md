# 终局完整摘要 / Finished-round summary

## 授权与隐私边界 / Authorized disclosure boundary

2026-11-08 用户明确要求结束弹框展示“胡了多少次、神龙多少、每个人的手牌、总输赢”。因此新增 **仅服务端 `game.phase === 'finished'` 时** 的 `game.roundSummary` 白名单响应。它是结束后摊牌的明确例外，不是修改行牌中的隐私规则。玩家、观众、重连者及终局换入的新座位都能读同一份终局公开摘要。
The user explicitly requested hu counts, dragons, each player's hand and net results in the end dialog. The additive `game.roundSummary` response is therefore available **only after authoritative server-side finish**. This is an explicit final-reveal exception, not a change to live privacy. Participants, spectators, reconnects and replacement occupants see the same public terminal summary.

进行中的 `turn`、`claim`、成都换三张/定缺、已有人胡但尚未结束的血战，以及下一局，均不输出该键。原 `game.players[].hand`、摸牌、待回应、听口、旧暗杠与历史过滤保持原样。摘要不公开牌墙、原 `player` 对象、完整 `scoreBreakdown`、私人准备选择或任何凭证。UI 隐藏不是安全边界，服务端在构造摘要前先检查真实阶段。
Live turns/claims, Chengdu preparation, blood battles with retired winners, and subsequent games omit the key. Existing hand/draw/response/wait/concealed-kong/history projections remain unchanged. No wall, raw player, full score breakdown, private preparation choice or credential enters the summary. UI visibility is not the security boundary: the server checks its phase before constructing the data.

## 数据来源与协议 / Sources and contract

`server/game-engines.js` 是唯一玩法分发入口，分别登记 `roundSummary`。`server/round-summary.js` 的两个只读投影不导入、合并或修改规则引擎。`server/history.js` 的 `roundSummaryForRoom` 补入原参与者名字与本桌累计；`server/api.js` 仅在真实终局附上结果。
The registry remains the sole mode dispatcher and registers separate summary functions. The two read-only projections neither import nor merge/change engines. History joins original participant names and table totals; the API attaches the result only to real terminal games.

顶层为 `gameMode`、`schemaVersion`、`finishReason` 和按绝对座位排列的 `players`。每人字段如下：
The header contains mode, schema version, finish reason and players ordered by absolute seat:

- `seat`、`name`：原本局参与者身份展示；不以终局换入者覆盖原名字。缺快照时仅显示座位，不猜历史名字。
  Original round participant label, never replaced by the current occupant. Missing snapshots use a seat label without guessing names.
- `huCount`：花麻将读取保存的玩家计数；成都读取 `won`，已胡为1、未胡为0。缺字段为 `null`，不以日志条数补造统计。
  Flower uses persisted counts; Chengdu uses its zero/one retirement record. Missing fields are null, never fabricated from event counts.
- `roundScore`：当前 `player.score` 的实际本局净变动，已包含该模式所有胡、杠、喜钱、神龙或流局实际转账；不会重新相加任何明细。
  Actual current-game net score, already including every applicable committed transfer. Detail entries are never added again.
- `tableScore`：既有本桌账本按原参与者凭证摘要匹配的累计，包含本局一次；不是个人跨桌累计。缺身份、估计身份或相关旧账分数缺失为 `null`，不显示猜测的0。
  Existing table-ledger total matched internally to the original participant, including this game once; not a cross-table profile total. Missing/estimated identity or missing relevant old scores yields null, not guessed zero.
- `finalHand`：原样复制服务器终局 `hand`；缺牌区为 `null`。
  Exact copy of the final concealed hand; a missing zone is null.
- `melds`：只复制 `type/tile/tiles` 和存在的 `fromSeat/extended`，包括终局暗杠牌面；不展开原副露对象。
  Allowlisted final melds, including final concealed-kong faces, never raw object spreads.
- `wins`：独立的已胡牌引用，包含 `tile/source/inHand` 和已有 `fromSeat/virtual`；缺可用记录为 `null`。不是再次加入手牌的新实体牌。
  Separate committed winning references with presence/source metadata, not additional physical hand tiles; unavailable records are null.
- `dragons`：见下一节。
  Mode-specific availability and actual settlement details below.

## 胡牌与手牌不能混拼 / Do not combine win records with the hand

花麻将 v2/v3 已把胡牌从手牌移出，另存 `winPile`。v1 没有胡牌区，只能从真实 `hu` 事件列出胡牌引用。所有花麻将 `wins[].inHand` 为 false；胡后可能继续摸打，所以终局剩余手牌也不是每次胡牌时的完整牌型快照。客户端不应把所有胡牌拼回13张手牌。
Flower v2/v3 move winning tiles out of hands and retain separate win piles. v1 has only actual hu history. All Flower winning references have `inHand:false`. Continued play means the final remaining hand is not a complete snapshot of every earlier winning shape; clients must not append all wins to the thirteen tiles.

成都自摸胡者保留手中第14张，`inHand:true`；接炮/抢杠胡牌仍位于弃牌区，`inHand:false`。两种情况都原样显示终局手牌并另标胡牌来源，不增加实体牌、不重复第14张。成都尚未结束时即使某人已经退场也不摊手牌。
Chengdu self-draw winners retain the fourteenth tile in hand (`inHand:true`); discard/rob-kong wins remain in the river (`false`). Show the exact hand and separate reference without duplicating tiles. A retired winner in a still-live battle does not reveal their hand.

## 神龙的版本差异 / Versioned dragon availability

- 花麻将 v3：只读 `dragonSettlement.settled === true` 的实际 `entries`，`status:'settled'`。每人的 `count` 为其已结算神龙组数；`details` 逐项只有 `tile/count/pointsPerOpponent`。无该席结算条目时为确定的0组和空数组。
  Flower v3 reads actual completed settlement entries only. Count is settled groups; details allowlist tile, copy count and points charged per opponent. No entry for that seat means known zero.
- `dragons.pointsPerOpponent` 是本席所有神龙合计向每位他家收取的分数，不是净收入。`payments` 是本席收取神龙那笔结算中的实际 `{seat,delta}`，不包含本席给其他神龙拥有者的支出。要看总输赢，只读 `roundScore`。
  Aggregate points are charged to each opponent, not net profit. Payments belong to this seat's dragon receipt entry and exclude its payments toward other owners' dragons. Overall net results come only from roundScore.
- 花麻将 v1/v2：旧版神龙奖励混在每次胡牌分中，未保存可靠组数/牌种明细。因此为 `status:'unavailable'`，其余字段 `null`。不能把 `dragonBonus` 加总后当神龙净分，也不能从终局牌面重新结算。
  Legacy bonuses are embedded in individual wins without reliable group/tile records. Return unavailable/null, never infer net dragon profit from bonus sums or rescore final tiles.
- 成都：没有花麻将神龙，`status:'notApplicable'`，其余字段 `null`。不能将龙七对番型冒充神龙结算。
  Chengdu has no Flower dragon settlement and returns notApplicable/null; dragon-seven-pairs patterns are not this feature.
- v3 保存局若缺真实结算记录，也返回 unavailable/null，不补默认记录。
  Missing v3 settlement records are unavailable, never backfilled.

## 生命周期与账本 / Lifecycle and ledger

终局仍保存在 `room.game`，下一次真正 `/start` 才归档。`tableScores` 已把当前结束局和旧归档按 `gameId + seat` 去重；摘要复用它，绝不再加一遍 `roundScore`。临时座位映射只在查询副本中使用原参与者，因此同名替补不会继承旧累计，离开的原参与者也不会丢累计。相关旧账缺分时摘要明确未知；重复档案遵循原账本“先出现的记录”优先级。
The finished game remains current until the next actual start archives it. Existing tableScores already includes current/archived games once per game ID/seat. The summary reuses that ledger without adding roundScore again. A query-only original-participant map prevents same-name replacement inheritance and retains departed players' totals. Incomplete relevant scores are unknown, and duplicates follow the existing first-record precedence.

旧局通过兼容入口补出的 `startedAtEstimated` 身份，在归档并开始下一局后仍不可靠。累计资格检查也必须覆盖实际计入的旧归档，而非只检查当前局；若该标记属于去重后被忽略的后置副本，则不推翻首条可靠记录。此检查只使摘要累计显示“未记录”，不改旧账本、归档或本局真实净分。
Identity backfilled with `startedAtEstimated` remains uncertain after archival and the next start. Eligibility checks include counted archives, not just the current game; an ignored later duplicate does not invalidate the reliable first record. This only marks the summary total unavailable and never changes the existing ledger, archives or actual round score.

摘要只在响应中构造，不保存到局、归档或个人历史，也不修改 rules/schema、房间 revision、展示节拍、付款或开下一局权限。新局响应不携带上一局摘要。历史存档仍不永久保留手牌。
The projection is response-only, absent from games, archives and profile history. It changes no rules/version, revision, pacing, transfers or start authority. Subsequent games do not carry the prior summary, and archives still do not retain hands.

## 维护与验收 / Maintenance and verification

维护文件：`server/round-summary.js`、注册表/history/api 接线、`tests/round-summary.test.js`。专项包括三代花麻将、3/4座位、成都自摸/接炮/血战流局、真实终局动作响应、所有玩家/观众/替补/重连、下一局隐私、原参与者累计去重、缺记录和 FileStore 重启。`tests/spectators.test.js` 明确区分旧 hand 字段与新终局摊牌通路。全部为隔离合成数据，不代表已发布或浏览器验收。
Maintained files are the projection, registry/history/API wiring and the dedicated suite. Coverage includes all Flower versions, three/four seats, Chengdu wins/draws, actual terminal responses, every viewer role, subsequent-game privacy, participant totals/deduplication, missing records and FileStore restart. Spectator tests distinguish the old hand field from explicit final disclosure. Synthetic checks do not imply publication or browser acceptance.

## 前端展示 / Frontend presentation

`App.vue` 只新增从已显示 `state` 派生的 `finishedRoundSummary`；`round-summary.js` 要求房间/游戏均结束及玩法匹配，再复制白名单展示字段。`RoundSummary.vue` 展示每名原参与者的胡牌次数、神龙组数、结束时手牌、副露、胡牌引用、本局净分及本桌累计。客户端不从当前占座或旧历史补总分、不重算神龙，不添加胡牌到手牌。未知记录为“未记录”，成都为“不适用”；已知零仍显示零。
App adds only a derived displayed-summary value. The adapter requires both finished phases and matching mode before copying display fields. The component shows original participants, counts, exact zones and distinct round/table scores, without reconstruction or adding win references to hands. Unavailable, inapplicable and known-zero values stay distinct.

布局只有总览一个纵向滚动入口，牌组自然换行，底部原控制固定在内容滚动区外。长胡牌记录用原生详情保留所有牌且显式加入Tab焦点圈。320px给净分/累计更宽的列，净分不小于15px；小字对比最暗背景 `#eee2c5` 至少4.5:1。原下一局提示/权限/同步/错误/重连/焦点生命周期完全沿用。真实浏览器结果由独立验收记录报告，不以SSR或样式检查替代。
One vertical viewport contains wrapped tile zones, with original footer actions outside it. Native details preserve all long win records and join the focus loop. At 320px score columns receive extra width, net scores stay at least15px, and small text meets4.5:1 against the darkest background. Existing modal permissions, synchronization, error, reconnect and focus lifecycles remain unchanged. Actual browser results belong to separate acceptance evidence.
