# 胡后锁手牌与自弃同牌限制 / Held-hand and self-discard corrections

## 用户确认与重现 / Confirmation and reproduction

2026-11-08，用户指出胡后原手里的345筒在摸到6筒后，竟可抽出3筒补入碰杠区，暗手变成456筒。用户另明确暗杠仍然允许，只禁止这种换掉锁定手牌的补杠。随后确认自己打过的同种牌，在本人下一次摸牌前不能胡。
On 2026-11-08 the user reported that drawing six dots after hu allowed a held three-dot upgrade, replacing locked 345 dots with 456. Concealed kongs must remain legal; only this held-tile exchange is forbidden. The user also confirmed that a self-discarded identity cannot be won before the next own draw.

截图对应已有四张3筒的加杠；三张碰补成四张也存在相同问题。合成守恒回归使用待牌暗手`[4条,5条,6条,6条,3筒,4筒,5筒]`，已有3筒碰/杠和2条杠，摸6筒。换牌前后听口都是3条/6条，所以仅比较听口会误放行，胡后必杠还会把非法换牌变成唯一选择。测试不保存截图、真实昵称、房间或用户存档。
The screenshot shows extending an existing four-tile kong; upgrading a three-tile peng has the same flaw. The conserved synthetic hand waits on three/six bamboo both before and after exchanging 345 dots for 456, so wait equality alone wrongly permits and mandates the upgrade. No screenshot, real name, room or user save is committed.

## 权威判断 / Authoritative checks

- `canDeclareKong`：已胡者的`buGang`和`addGang`必须与本人的当前`lastDraw.tile`相同，不能消耗原暗手而留下不同的新摸牌。此条件独立于旧`preserveWaitsOnPostHuKong`开关。仍须满足既有听口、碰后先出牌、牌墙和胡优先条件。未胡者仍可用早先保留的牌补杠；合法暗杠/明杠不改。
  Post-hu peng/kong upgrades must consume the actual current draw, independently of the old wait-preservation flag. Existing wait, post-peng, wall and hu-priority checks still apply. Unwon held-tile upgrades and legal concealed/exposed kongs remain unchanged.
- 每次正常摸牌、胡后续摸、杠后补摸都更新真实摸牌身份，所以同牌连杠仍可做；被抢杠和原杠分/萝卜/付款逻辑不改。旧已打开抢杠窗口不撤销，不倒改已经移动的牌和已提交动作。
  Real normal, continuation and replacement draws renew the usable drawn identity, preserving legitimate chains. Existing rob-kong windows, committed tile movement, kong scores, radishes and payers are not rewritten.
- `hasSelfDiscardHuLock`逆扫本人已提交历史，收集意义上等价于“本人最近一次`draw`以后出现的全部`discard`”。同种牌暂时禁接炮、杠后接炮和抢杠；其他听口不受此条限制。碰后再次出牌会累计多种禁胡牌，碰、胡、杠申请和进入摸牌步骤均不解锁。
  Scan the seat's committed history back to its latest actual draw. Every identity discarded since then is barred from ordinary/post-kong/rob-kong wins; other waits remain eligible. Peng followed by another discard accumulates both identities. Non-draw actions never clear the restriction.
- `getAllowedHuWaits`检查新机会，`getLegalActions`先过滤已保存的未回应胡选项，再执行已胡必胡。旧窗口只剩过牌时仍可正常收束。`getHuDiagnostic`给本人返回`SELF_DISCARD_LOCK`，不改变结构听口计算，也不暴露其他人的暗手或待决选择。
  New claims and saved unanswered options are filtered before mandatory-hu priority. An old now-blocked window retains pass so it can close. A private diagnostic explains the restriction without changing structural waits or revealing concealed information.

## 保存兼容 / Saved-game compatibility

两项都按本次明确纠错应用到当前schema3的后续动作，不增加可配置规则、迁移或状态字段。读取不修改存档；schema1/2冻结文件及成都引擎完全不改。
Both corrections apply to future actions in current and saved schema-three games without adding options, migrations or saved fields. Reads do not mutate saves. Frozen schemas one/two and Chengdu remain unchanged.

生产局的`history`完整追加，MemoryStore/D1/FileStore保存完整JSON，因此可从已经提交的弃牌/摸牌恢复限制。任意手工删减或损坏历史无法可靠恢复，现有不变量也不保证历史完整。无已知弃牌证据时不根据牌河、暗手、旧`huLockActive`猜测限制；该边界有独立测试。正常后续弃牌和摸牌会继续产生可靠证据。
Production history is append-only and fully persisted. Arbitrarily edited or incomplete history cannot be reconstructed reliably, and invariants do not certify completeness. Without evidence, do not infer a lock from rivers, hands or legacy huLockActive; tests explicitly preserve this boundary. Subsequent real discards/draws supply new evidence.

发布前已接受的`claim.responses[seat].type === 'hu'`不撤销，否则可能把多人待回应窗口卡死。`settleHuBatch`只有在当前claim的牌种、来源位、弃牌索引、胡来源全部匹配时保留此已提交意图；仍验证真实胡牌结构。所有新请求先经当前白名单拒绝，客户端不能利用该结算例外提交新的禁胡。已结算分和历史不重算。
Already accepted hu responses are honored to avoid stranding saved multi-party windows. The settlement-only exception requires the exact current claim identity, source seat, river index and win source, and still validates the hand. New requests must pass today's allowlist and cannot invoke this exception. Settled scores/history remain unchanged.

## 回归入口 / Regression entry points

- `tests/post-hu-held-tile.test.js`：同听口换牌反例，碰升级与4–7张加杠，三种摸牌来源，手动/自动与缺字段，合法暗杠及连杠，首胡前兼容和缺失摸牌记录。
- `tests/self-discard-lock.test.js`：真实出牌回合、碰后累计限制、三类实际摸牌后再接胡、自动/手动弃牌、抢杠新旧窗、已接受回应仍验牌型、JSON恢复、隐私与缺失证据。
- `tests/flower-lock-api.test.js`：真实Request/Response非法请求及重复请求不写入，FileStore重启后的过滤、过牌收束与旧版本冲突。

These suites cover conserved engine counterexamples, real turn sequences, source-specific resets, compatibility, privacy, HTTP authority and disk restart. Aggregate results are recorded with the final commit; no browser or production game is used for this rules-only change.

## 本地候选验收 / Local candidate validation

基线`ac10fa3d2e7c7f817b7239b07e1453f7a2944b10`。新增56项，最终`npm test`为1379/1379通过，无跳过；`npm run lint`零错误、3条既有警告（清除了原先未使用的kongDiscard参数警告）；`npm run build`及`git diff --check`通过。独立只读审查复跑自弃26项通过，并将“自动弃牌不加锁”作为内存变异，确认两项回归会失败。schema1/2、成都、server及src与基线逐字无差分。未推送、未部署、未访问真实牌局，未做浏览器验收。
Baseline ac10fa3. All 1,379 tests pass, including 56 added cases, with no skips; lint reports zero errors/three existing warnings, and build/diff checks pass. Independent review reran all 26 self-discard cases and confirmed two fail when an in-memory mutation ignores automatic discards. Frozen engines, Chengdu, server and UI sources remain byte-identical to baseline. No push, deployment, production access or browser acceptance is claimed.
