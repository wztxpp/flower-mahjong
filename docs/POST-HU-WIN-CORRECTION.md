# 胡后能胡必胡 / Mandatory wins after hu

用户确认：“已经胡的能胡就必胡，所以胡的时候的选择界面不应该存在除了胡的其他选项”。这是当前 schema 3 的规则纠错，不是新增可配置开关。
The user confirmed that a prior winner must take every available win and must see no other action choice. This corrects schema-three behavior rather than adding a configurable rule.

## 权威入口 / Authoritative entry

`shared/game.js` 的 `getLegalActions` 在已胡者自摸可胡时直接返回 `[{type: 'hu'}]`。自然摸牌、胡后续摸、杠后补摸共用此判断，`autoDiscardAfterHu` 开关不改变它。接炮、杠后弃牌及抢杠窗口则在追加 `pass` 前筛出唯一的 `hu`。`applyAction` 和 `applyPresentedAction` 用同一白名单校验，旧客户端直接发“过”、出牌或杠也会被拒绝，原状态不变。
For a prior winner's available self-draw, getLegalActions returns hu alone across normal, continuation and replacement draws, independently of autoDiscardAfterHu. Discard, post-kong discard and rob-kong windows likewise filter to hu before adding pass. Both action entry points validate this same allowlist, so older clients cannot bypass it and rejected requests leave state untouched.

仍需本人点胡，没有自动代胡。多人胡仍等待所有有资格的人回应，按原方向统一结算；音画展示期间仍无任何动作。没有胡但有合法杠时保留必杠，无胡无杠时保留自动打出/手动点过。首次胡保持原可选行为，计分、付款、听口和实体守恒不改。
Players still click hu; the correction does not autoplay. Simultaneous wins wait for all eligible responses and settle in the existing direction. Presentation gates expose no actions. Mandatory kongs and no-win/no-kong auto-discard/manual-pass behavior remain unchanged, as do optional first wins, scoring, payers, waits and tile conservation.

## 存档与界面 / Saved games and presentation

已有 schema-v3 局的待回应 `claim.options` 在读取时筛选，不原地迁移或改写。已提交的历史选择、回应和积分不倒改；schema1/2 继续各自冻结引擎。新旧 HTTP 客户端均走保存版本的真实引擎。
Existing schema-three claim options are filtered on read without a migration or in-place rewrite. Previously submitted choices, responses and scores are not retroactively changed. Schemas one and two retain their frozen engines, and all HTTP clients use the saved game version.

`App.vue` 的按钮仍完全读取服务端 `legalActions`。`mustHu` 只为当前版本已胡且白名单只有胡的状态提供准确提示，不自算可胡，不补造动作。私有胡牌诊断、回合说明及规则弹窗同步解释必胡，保留旧版本文案。
App buttons still follow the server allowlist. mustHu supplies wording only for a current-version prior winner whose allowlist contains hu alone; it neither calculates wins nor invents actions. Private diagnostics, status text and current rules explain mandatory hu while older-version copy remains intact.

## 回归 / Regression coverage

`tests/post-hu-win.test.js` 与 `tests/fixtures/post-hu-win.js` 覆盖三类自摸来源、自动/手动/缺字段存档、三类接胡、恢复窗口、所有非法备选动作、多人回应顺序、音画暂停与旧引擎边界。HTTP 测试验证存储不变、重连与重复请求；实际 Vue 组件测试核对动作栏只有“胡牌”。旧计分测试使用不能自摸的出牌者手牌，避免用违反新纠错规则的跳胡动作造场景。
The focused suite and conserved fixture cover draw sources, auto/manual/missing flags, claim kinds, restored windows, rejected alternatives, multi-winner response order, presentation pauses and frozen-engine boundaries. HTTP checks cover unchanged storage, reconnects and duplicate requests. Real Vue component rendering verifies a hu-only action row. Payment fixtures use a nonwinning source hand rather than an illegal skipped post-hu win.
