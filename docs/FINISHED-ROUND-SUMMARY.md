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
- `characterId`：只读原始 `gameMeta.characters` 的本局角色快照，完整3/4项、数量匹配、已知且唯一才公开；缺失/损坏为 `null`。不使用会补默认角色的公开 `game.characters`，也不借现占座者角色。时间/身份估计标记不抹掉独立保存的真实角色映射。
  Read only the original game-meta character snapshot when its complete three/four-entry map matches the player count and contains known unique IDs; otherwise null. Never use compatibility-default public game.characters or current occupants. Estimated timestamps/identity do not invalidate an independently retained actual role map.
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


## 牌桌回看与按钮纠正 / Table review and return button

本轮实际浏览器、几何、键盘与最终全测见[终局牌面验收](qa/FINISHED-TABLE-TILES-20261108.md)。
See the [terminal display QA](qa/FINISHED-TABLE-TILES-20261108.md) for browser, geometry, keyboard and aggregate results.

用户随后明确要求结算后立绘下方的其他玩家手牌也可见。两玩法牌桌只消费现有 finished-only 摘要，不扩大API暴露面。`roundSummaryHandsBySeat` 沿用双终局门并额外校验玩法、原座位唯一性及牌种范围；未知手牌不猜，已知空手独立显示。每条均标“本局：摘要原名”，同名或换名替补都不会被当成上局手牌主人。花麻将1/2/3、观众、终局重连共用此只读路径；成都已胡但整局未结束仍不摊牌。下一局与缺摘要更新立即撤下旧牌面，无新增缓存/监听/请求。
The user additionally requested visible opponent hands beneath table portraits after settlement. Both tables consume only the existing finished-only summary, without enlarging API exposure. The helper enforces both phases plus mode, unique original seats and tile ranges; missing and empty hands remain distinct. Every strip visibly labels its original summary participant, including same-name replacements. All Flower versions, spectators and reconnects share the path; retired winners in live Chengdu remain concealed. New-game or missing-summary updates withdraw old faces without new caching, listeners or requests.

结算弹框原“返回大厅”改为“返回牌桌”，只调用 `closeNextRoundDialog → closeModal`；原session、房间、当前局、网址和历史保留。与叉号/Escape复用busy和DOM提交后焦点恢复，开局结果未同步时不重试或清掉连接提示。页面其他真正离桌按钮仍保留。隔离预览只额外放行 `data-next-round-return` 的安全本地关闭，开局/离桌和API封锁仍在。
The dialog's former lobby button now returns to the table through the existing close path, retaining session, room, game, URL and history. Busy/focus guards are shared with close/Escape; unresolved starts are neither retried nor cleared. Other genuine departure controls remain. The isolated preview permits only this safe local close in addition to existing modal controls, retaining start/departure/API blocks.

总览牌压扁修复只将共享牌样式改为 `flex:none`，保留既有width/height：竖向胡牌引用不再把桌面26px/手机24px的basis用作高度，继续显示26×36 / 24×33px，与手牌/副露一致。真实浏览器尺寸与终局牌桌键盘回看由最终QA报告记录。
The overview ratio fix uses shared flex:none while retaining existing dimensions: column win references no longer treat26px/24px width bases as heights, preserving26×36 and24×33px like hand/meld tiles. Final QA separately records browser geometry and keyboard table review.

终局牌桌条固定76px，预算为40px牌高、上下16px内边距与最多20px非覆盖式横滚条；底部12px也容纳原5px牌影。保留overflow:auto，不能用隐藏纵向溢出来掩盖裁牌。最终真实浏览器QA另外记录clientHeight/scrollHeight、扣内边距后的内容高度、牌影可见性与无额外纵条情况。
Terminal table strips reserve76px:40px tiles,16px vertical padding and up to20px classic horizontal scrollbar, with12px bottom padding retaining the5px shadow. Overflow stays automatic, never hiding clipped content. Final real-browser QA separately records actual client/scroll heights, content capacity, shadow visibility and absence of needless vertical scrolling.

## 本局角色原画背景 / Original round-character backgrounds

用户随后允许每位玩家的结算区域用对应人物立绘作背景。`round-summary.js` 只接收上述历史 `characterId`，`roundSummaryPortrait` 从固定 `CHARACTER_PORTRAITS[id].base` 取现有原图。未知/旧记录缺角色时保持中性底色，不按座位、昵称、当前人物或分数猜角色/表情；不用动画、生成图、响应中的URL或动态路径。
The user subsequently permitted the matching character portrait behind each player's settlement area. The adapter accepts only the historical characterId and selects existing base art from the fixed catalog. Unknown/missing roles keep the neutral background without guessing by seat, name, current role or score; no animation, generated art, response URLs or dynamic paths are used.

背景层绝对定位、不可交互且 `aria-hidden`，不增加结算区高度或改牌宽高/间距。暖白渐变桌面最低74%不透明度，手机最低82%；配套深色文字对最坏黑色图像素仍达4.5:1。图片失败只在当前弹层实例标记该固定URL并撤下装饰，轮询不重试、换角色不受旧失败影响；关闭再打开可重新加载。原单滚动区、Tab/详情/返回牌桌与所有分数/牌引用保持不动。
The absolute, noninteractive, aria-hidden layer adds no content height or tile-size/spacing changes. Warm-white overlay opacity is at least74% on desktop and82% on phones, with dark text retaining4.5:1 even over black artwork pixels. Image failure removes only decoration and remembers that fixed URL for this dialog instance; polls do not retry, another character is unaffected, and reopening can retry. Scrolling, focus/details/return controls, scores and tile references remain unchanged.

专项 `tests/round-summary-portraits.test.js` 覆盖三代花麻将/3与4座/成都、原映射/同名替补/JSON恢复/估计时间、非法/稀疏/缺记录、真实HTTP观战/重连/下一局、七角色×七视图实际Vue SSR、失败事件/换角/撤销与输入不变。CSS编译检查及对比度计算是结构/数值证据，不是浏览器像素、图片网络或实体手机验收。
The dedicated suite covers versions/modes/table sizes, original maps/replacements/restoration/estimated times, malformed/sparse/missing data, real HTTP viewers/reconnects/next games, seven roles across seven actual Vue SSR views, error/switch/withdrawal events and input immutability. Compiled CSS and contrast checks are structural/numeric evidence, not browser pixels, image-network or physical-phone acceptance.
