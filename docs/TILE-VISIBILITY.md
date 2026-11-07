# 胡牌与暗杠展示 / Winning-tile and concealed-kong visibility

新 schema 3 开局保存 `publicConcealedKongs: true` 与 `hideSelfDrawWins: true`。缺字段或明确 false 的旧局保留原视图；读取不回填、不重写历史、不重算分。schema1/2 引擎完全不改。
New schema-three games save `publicConcealedKongs: true` and `hideSelfDrawWins: true`. Missing/false saved flags retain the previous view policy; reads never backfill, rewrite history or recalculate scores. Schema-one/two engines remain unchanged.

- 已成立暗杠的牌面与扩展张数对三家可见，暗手牌及待决回应仍私密。暗杠历史记录保持原字段，不借展示更新重写历史。
  Established concealed-kong faces and extended sizes are visible to all three seats; concealed hands and pending responses remain private. Existing kong history fields are not retroactively rewritten.
- 进行中，自摸胡牌从手牌移到胡牌区后，仅本人能见牌面；两家对手只得到 `tile: null, hidden: true`。普通接炮、杠后接炮、抢杠及共胡牌仍公开。不是隐藏或修改当前摸到的牌。
  During play, only the owner sees a settled self-drawn winning tile; opponents receive `tile: null, hidden: true`. Discard, kong-discard, robbed-kong and shared wins stay public. This does not change the current drawn tile.
- 房间的 `game.players`、`seats`、`retiredTiles`、事件、文案与个人历史都按同一座位权限投影。对手全部胡牌计分明细采用严格类型白名单，仅保留公开数字摘要、已知布尔/枚举与牌型来源番标签；删除 handCounts、听口、未知字段及嵌套牌种数据，包括后续接炮的累计分解。积分、付款人与金额、公开萝卜保持可见，权威明细完整保存在服务端。
  Room players/seats, retired physical references, events, prose and profile history use the same seat permissions. All opponent win breakdowns use a strict typed allowlist of public scalar summaries, known booleans/enums and pattern/source fan labels. Counts, waits, unknown fields and nested tile metadata are omitted, including cumulative details on later discard wins. Scores, payers, amounts and public radishes remain visible; full authority stays stored server-side.
- 终局重新投影时恢复胡牌区、实体归档、事件和计分明细，不回改旧账；新一局才使用新的默认开关。进行中的展示暂停仍算未结束，因此最后一次胡在真正终局之前保持遮牌。
  Finished projections restore win piles, retired references, events and breakdowns without rewriting the ledger. Presentation pauses remain live, so a final win stays masked until the engine actually finishes.

## 代码入口 / Code path

`shared/tile-visibility.js` 只做复制与遮蔽；`shared/game.js#getPlayerView` 和 `server/history.js#publicEvents` 共用它。`server/api.js` 的副本座位摘要继续来自裁剪后的视图。新坐下的玩家不能继承前任手牌、听口或私人诊断；已公开的新局暗杠不重新变暗。
`shared/tile-visibility.js` only copies/masks data and is shared by getPlayerView and publicEvents. API seat summaries still derive from filtered views. Replacement occupants cannot inherit predecessors' hands, waits or private diagnostics; explicitly public new-game kongs do not become hidden again.

`src/App.vue` 用 `hidden` 渲染背面、无牌种的提示和字幕。隐藏的胡牌仍播放自摸声音、显示高亮并正常完成展示 Promise；`null` 不转换为一条。声音依靠已提交来源，不需要牌面。
App renders backs and identity-free tooltips/captions using hidden. Masked wins still play self-draw audio, highlight the slot and complete presentation promises; null is never coerced into one bamboo. Audio depends on committed source, not the tile face.

## 验证 / Verification

`tests/tile-visibility.test.js` 检查本人/两家对手、持续自摸、终局/归档、API/重连/个人历史、未知计分字段、旧快照和权威不变。`tests/ui.test.js` 编译真实 Vue 组件，验证牌背、字幕、提示、高亮、取消与终局恢复。既有暗杠测试更新新局期望；旧版本测试保持原样。源码断言与模拟组件测试不是实际浏览器布局验收。
The tile-visibility suite covers owner/both opponents, repeat wins, finish/archive, API/reconnect/profile history, unknown score fields, old snapshots and unchanged authority. Actual Vue compilation tests cover backs, captions, tooltips, highlights, cancellation and finish reveal. Existing new-game kong expectations change; frozen-engine tests remain intact. Source and simulated-component checks are not real-browser layout acceptance.

公开番数和萝卜分仍可能供玩家推理；本功能隐藏直接牌面与私人元数据，不承诺阻止基于公开账目的数学推断。 / Public fan/radish totals can support deductions; this feature hides direct faces/private metadata, not mathematical inference from the public ledger.
