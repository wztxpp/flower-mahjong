# 自贡三人花麻将：试玩规则 v3

依据本次口述和试玩截图修订，不宣称是统一的自贡地方标准。只使用虚拟积分，无充值、现金或付费赌注。此文对应0.7.0 版本；是否已发布请以公开站版本号和实际部署结果为准。

新开局使用 schemaVersion 3。已开始的 schema 2 局继续按 [v2 规则](V2-RULES.md) 和冻结引擎运行；更早的 schema 1 局继续按 [原规则](LEGACY-RULES.md)。更新不重新洗旧局、不改旧账、不回填未验证的旧记录。

## 可变牌桌新局补充 / New variable-table snapshots

新建桌可选3或4人、1至5副（每半副）、神龙起算1至20张，默认3人/2副/6张；半副18种牌各2张。普通同牌4张起每张一番，9张加6番；神龙门槛处10分，之后逐张翻倍；一组杠上限为该局同牌总数。以下早期文字中的“三家/两家/144张/八张上限”仅描述原默认桌或旧局；新局以本段及[完整说明](VARIABLE-TABLES.md)为准。四人全部其他玩家付款的分支改为三家各付，来源单独付款和七对固定档位不变。旧进行中局不升级计分。
New tables select three/four seats, one–five decks in half steps and a dragon threshold of one–twenty, default 3/2/6. Ordinary copy fan continues linearly above eight; dragons double from ten at threshold; kong limits follow actual copy budgets. Earlier fixed-three/eight-copy wording is historical/default context, superseded for new tables by [the full specification](VARIABLE-TABLES.md). Preserve source-only payers and fixed seven-pairs tiers; do not upgrade active saved games.

## 牌与流程

- 三人，只用一至九条、一至九筒，每种八张，共 144 张实体牌。各 13 张，庄家先多发一张。
- 服务器自动摸牌；玩家仍决定出牌、胡、碰、杠或过。没有吃、定缺或流局查叫。基础胡型为四组加一对，亦支持下文已确认的七对、大单吊、清一色与对对胡规则。
- 弃牌后等所有有合法回应的玩家操作完才推进。胡优先于杠、杠优先于碰；同级按本局方向顺位，一炮多响默认全部胡，固定优先放炮者的下家、再上家，不由点击先后决定；先统一结算，未结束时由优先赢家继续摸牌。重复请求或旧版本请求不会重复结算。
- 同一局可以多次胡。三家都至少胡过一次，或牌墙耗尽，结束本局。同一弃牌的多家胡先全部结算，再检查结束；结束后不再摸牌。

## 胡后固定手牌、连续自摸与接牌限制

- 胡后原有暗手牌不能换打，只处理新摸牌。**已经胡过的玩家，能胡就必须胡，只提供“胡牌”，不能过、出牌、碰或杠**；自然摸牌、胡后续摸、杠后补摸、接炮和抢杠都适用。仍须本人点击确认，不自动胡。已经胡过且新牌不能胡时，如有保留完整听口的合法杠，必须选择其中一项杠，不能过或直接打出新牌，不自动杠。
- **胡后自动打出是建房选项**：新桌在创建前勾选，默认勾选；创建后同桌每局沿用。缺少创建快照的旧桌仍可在第一局及下一局开局前设置。勾选时，没有可选胡、杠就自动打出刚摸牌；不勾选时，服务端停在当前玩家，须点“过”打出新牌后才推进。正常轮转摸牌、胡后续摸、杠后补摸均适用；不改变能胡必胡、有合法杠必须杠和原手牌固定的规则。
- 本局设置保存为 `rules.autoDiscardAfterHu`，开局后不可修改，所有玩家可查看；刷新、重连和服务重启沿用存档值。已有 schema-v3 存档缺少该字段时继续自动打出，不迁移旧牌局、不改旧账。schema1/2 仍使用各自冻结引擎。
- **胡后紧接着再摸到可胡牌，可以继续自摸胡**，不再受旧版整套听口重合锁阻挡。每一张新摸牌只能结算一次，已移到胡牌区的牌不能再次被当作新摸牌。
- 自己尚未胡过时，自摸可胡则不提供杠，但仍可放弃胡并出牌；接牌同时可胡也可杠时，只提供胡或过。对于未胡者打出的弃牌，如果自己尚未胡过且可胡、可碰、没有可做的杠，则提供胡、碰、过。自己已经胡过且可胡时，一律只提供胡。
- 胡后必胡是用户确认的 schema-v3 规则纠错，已有局和已保存待回应窗口也按此过滤可用动作，不改规则快照、已提交回应、历史或已结算分。schema1/2 冻结引擎不改。详见 [胡后必胡纠错](POST-HU-WIN-CORRECTION.md)。
- 胡过者不能再碰；**胡过者打出的任何牌，其他人都不能碰或明杠**，包括杠后弃牌。
- 胡过者普通弃牌不能被接胡；只有其杠后的下一张弃牌仍可被胡。合法暗杠、完成碰后出牌的补杠、逐张加杠至八张仍允许，不因禁止接明杠而一并禁掉；胡后杠必须保持完整听口。胡后补杠/加杠还必须使用本次真实摸入的同牌，不能抽走原暗手而留下另一张摸牌，听口相同也不能换手牌。
- **杠上花结束本次杠后机会**：补牌自摸胡后，再续摸打出的牌受已胡保护，别人不能胡、碰、明杠，不是普通放炮，也不加杠后接炮番。只有之后真实完成一个新杠，才重新产生杠后补摸和弃牌机会。当前schema3及旧保存态的后续动作按此纠正，已接受回应、旧历史和分数不重算；详见[杠上花续摸纠错](KONG-HU-CONTINUATION-CORRECTION.md)。
  **A replacement win consumes its kong opportunity**: subsequent continuation discards are protected from hu/peng/exposed kong, not ordinary discard wins with reduced fan. Only a new committed kong creates another replacement/discard opportunity. Apply to future schema-three actions and restored states without revoking accepted responses or rescoring history.
- **自己已经胡过不再锁普通接炮**：只要未胡者打出合法听牌，就可以再次胡，不必等自己下一次正常摸牌，也不必更换听口。已胡出牌者普通弃牌保护仍保留，杠后弃牌和抢杠的来源例外不变。旧存档中的锁口字段保留以兼容历史，但不再限制 schema-v3 接胡；schema1/2 仍走冻结旧引擎。
- **自弃同牌限制**：无论是否已经胡过，自己打过的同种牌，在本人下一次实际摸牌前不能接胡或抢杠胡，其他听口不受此条限制。正常摸、胡后续摸、杠后补摸都解除先前限制；碰或准备摸牌不解除。若碰后又打出另一种牌，在实际摸牌前两种牌都不能胡。当前schema3和保存局的未回应机会都按此检查，已接受回应、历史和旧账保留。详见[锁手牌与自弃纠错](FLOWER-HAND-LOCK-CORRECTION.md)。

## 胡牌区与实体守恒

每个人都有胡牌区。新局保存 `hideSelfDrawWins: true`：进行中自摸胡牌仅本人可见，其他两家见牌背，终局公开；事件、计分明细和个人历史同样过滤。缺字段旧局保留原公开策略。自摸牌从暗手牌移出，实体保存在已胡实体区；胡牌区显示引用。接炮实体由原弃牌持有，第一位赢家引用它，另一位赢家显示“共胡”逻辑副本。

个人计分统计包括胡牌区中的共胡记录，但不再加一次牌河中的同一实体。144 张守恒只计实体所在位置，胡牌引用和虚拟副本不增加实体牌。

## 每次胡的番数与分数

普通胡及大单吊每次重新统计**自己的手牌＋碰杠牌＋胡牌区**，不包含萝卜、对手的牌或重复的牌河引用：

- 基础 1 番。
- 同种牌恰好 4 张加 1 番、5 张加 2 番、6 张加 3 番、7 张加 4 番、8 张加 5 番。多种牌各自相加，包含共胡的逻辑记录。
- 例如手牌 3 张五筒、胡牌区 3 张五筒，即加 3 番，连基础共 4 番。
- 超过 8 张逻辑统计的同牌加番未明确，不自行延伸，暂不额外加该项番。七对固定档位使用下节独立规则，不套用该未确认边界。

番转分：1→1，2→2，3→4，4→8，5→10，6→12，7→14，8→16；五番起每加一番加两分。

普通一次胡：**番对应分数＋萝卜匹配分**。神龙不在每次胡中支付。

## 七对、大单吊与牌型加番（0.6.0 新局）

新局保存 `specialHuPatterns: true`。既有存档缺少该标记或为 false 时继续旧牌型计分，不重新计算旧账；下一局才启用本节。

- **七对**：首个七对完整十四张中每一种牌都成为之后听牌种类。普通七对有七种，一个四张组六种，两个四张组或一个六张组五种；按实际种类数而非固定写死七种。
- 首次七对番数为 `3 + 每组 n≥4 的 (n−3) 之和`。一组四张为四番八分，两组四张为五番十分，一组六张为六番十二分。
- **清七对**再叠加清一色两番：无额外同牌组时五番十分。初次七对总档位含已有清一色番，后续保持不变，不因累积的胡牌区或更多相同赢牌增加新番；萝卜仍按当前三区每次重算。
- **大单吊**以四组碰杠牌和一张暗手牌识别；先胡一次后，原单张和自己的碰杠区牌种均可胡。同种牌允许碰两次，分别算两组，受每种八张实体牌限制。
- 大单吊或对对胡各加两番，二者互斥，优先认作大单吊；清一色可再加两番。大单吊胡牌分按番分与萝卜计算，仍可累积普通同牌加番。
- 基础一番，所以仅一个加两番牌型为三番四分；加上清一色为五番十分。七对按自身固定算法，不再额外套对对胡。
- 特殊听牌不会放宽弃牌来源限制，不会增加实体牌；一炮多响继续使用逻辑引用。先胡普通牌型后若后来首次形成大单吊/七对，也从该次符合牌型的胡牌建立特殊听牌。

## 全桌共享萝卜

- 全桌第一次胡翻基础 6 张，加首胡前成功杠累计的萝卜张数，只翻一次，不是每人首胡各翻 6 张。
- 首胡前，成功的明杠、暗杠、逐张加杠及完成碰后出牌的补杠只累计萝卜张数，不从牌尾取牌、不提前公开；仍从牌头补牌。首胡后成功杠从牌尾翻 1 张，再从牌头补牌。
- 首胡时若此前成功杠五次，一起翻 11 张。首胡前共享池为空，被抢的补杠不累计。剩余牌不足应翻张数只翻剩下的牌；旧存档已经翻出的萝卜不收回、不重复补翻。
- 三家都用同一个共享池计分。内部保留哪个动作翻出的来源记录，实体只计一次；界面只显示一个全桌池。
- 每种牌的本人匹配数量与萝卜数量相乘，例如本人两张二筒、共享萝卜两张二筒，加 4 分。
- 萝卜匹配计算本人的全部胡牌区（含共胡逻辑记录）＋碰杠区＋手牌区；本次胡牌移入胡牌区后只计一次，不重复加牌河引用。按每种牌的本人数量乘共享萝卜数量后求和。例如七筒 2×1，加四筒 1×2，共 4 分。萝卜自身不进入本人牌数，番数算法不变。
- v0.4.0 已开局的存档保留 `radishCountsWinPile: false`，不改旧账；v0.4.1 新局默认 true。

## 终局神龙

每个玩家在整局结束时统计：**本人的手牌＋碰杠牌＋全部胡牌区（含共胡记录）＋全桌共享萝卜**。同种牌 6 张收 10 分、7 张收 20 分、8 张收 40 分，由另外两家各支付一次。

- 神龙是独立终局结算，不随每次胡重复支付，也不额外增加普通番数。
- 同一次最终多家胡全部完成后，才用最终牌区与共享池统计神龙。服务端保存终局已结算标记；重复终局请求、刷新和重连不重复支付。
- 暂定同一玩家多种神龙分别相加；8 张以上仍按 40 分上限。逻辑共胡会使个人统计可能超过 8，未确认更高档位，不自行推导。
- 暂定流局也做同样终局神龙，已胡与未胡者均参加。是否有额外资格条件尚未明确。

## 付款方与大单钓

- 普通接炮由出牌者付；普通自摸（正常摸牌、胡后续摸）仅向胡之前未胡的其他玩家收取，首胡和再次胡都适用。明杠后本次补摸胡，只向该次明杠的出牌者收取；自己摸来的暗杠、补杠、加杠后本次补摸胡，由另外两家支付。该来源只跟随本次杠后补摸，不延续到普通胡后续摸。杠后接炮只由实际出牌者付，不按自摸结算，已胡、未胡、大单吊及多人共胡均如此；多人共胡由同一出牌者分别向每位赢家付款。
- 终局首胡自摸例外：第三家普通自摸结束时，另外两家仍各付一次；明杠后补摸仍仅原明杠出牌者付。多人共胡先全部记胡再判断终局；所有杠后接炮无论首胡或再胡，均只由出牌者付款。神龙独立结算。
- v0.4.2 新局保存 `finalHuPaymentExceptions: true`；旧局缺少该标记保留原自摸付款规则；schema 3 杠后接炮付款修复不依赖此标记。
- 普通自摸付款方排除也适用于大单吊；新局分值按上述番分加萝卜，旧局原固定五十分规则继续保留。即时杠分和终局神龙保持独立。杠后补摸按上述本次杠的来源确定付款方。杠后接炮适用上面的出牌者单独付款规则。旧局未保存 `selfDrawOnlyUnwon` 的，继续原有付款规则，不改旧账。
- 新牌型只改变大单吊的分值与特殊听牌，不暗改付款方：普通接炮的大单吊仍沿用已有两家付款逻辑，自摸及终局例外按既有规则；杠后接炮适用最新出牌者单独付款修复。旧局保留原五十分与旧叠加选项；终局神龙独立结算。

## 即时杠分

- 明杠：仅出牌者付 2 分。
- 暗杠：另外两家各付 2 分。
- 补杠：碰后必须先打出一张，再在后续合法操作时补杠，另外两家各付 1 分。原先留在手里的第四张也能补，不要求新摸同牌。
- 四张杠可逐张加到第五、六、七、八张：每次另外两家各付 1 分，该组仍为一个组；每次另计 1 个萝卜并补 1 张牌；首胡前累计到首胡才翻。
- 每组最多八张实体牌；不得有第九张。每次杠最少需要 2 张墙牌，保留原合法杠边界；首胡前延后取萝卜不额外放宽此限制。
- 即时杠分与之后每次胡的三牌区加番独立；失败动作、过期请求和重复请求不收分、不加萝卜。

## 私密、记录与限制

胡牌诊断只依据本人的牌和公开信息，不公开对手暗手牌。仅出牌、碰、胡、杠播放可关闭的角色语音；确认胡牌时先播该赢家的“自摸”或“放炮”，再播“胡”，杠后接炮归“放炮”；无机器人、倒计时或静默自动判过。断线玩家可能阻塞牌局，等待带原房间参数和本浏览器座位凭证重连。

主页始终进大厅，不自动回旧桌，也没有恢复按钮。个人历史积分由服务端持久保存，以浏览器随机凭证而非昵称识别。清除浏览器数据或换设备不会自动恢复身份，当前无跨设备找回功能。所有结算保持全桌零和。

### 抢杠（本轮新增，待发布）

- 已有杠加第 5–8 张（以及旧局仍允许的碰后补杠），先公开待补的那一张，进入抢杠回应窗口；尚未胡者可以胡或过，已胡者可胡就只能胡，碰、明杠都不能抢这个动作。
- 补杠者未胡时，第一手就可被抢。补杠者已胡时，普通摸牌的补杠直接成立；杠后补摸再补杠则可被抢，抢胡者无论此前胡过与否均按合法听牌判断。
- 所有符合条件的人回应后统一结算；一炮多响按补杠者的下家优先，不依网络回应顺序。被抢则本次补杠不成立，不收杠分、不翻杠萝卜、不补牌，原碰杠区不改变，胡牌只由补杠者付款。
- 全部过后才完成补杠及原有杠分、萝卜、补摸。普通抢杠加 1 番；七对抢杠不加这一番，保留七对本身的固定番及共享萝卜计分。

## 连局换庄

首局一号位庄家先出。下一局由上局第一条胡牌结算记录的玩家坐庄；同时多人胡按已确定的结算顺序取第一个。无首胡记录时保留原一号位开局。庄家拿初始第十四张并先操作，房主开始牌局的权限独立，不随庄家转移。已进行中的牌局不重发牌或切换庄家。

## v0.6.5 大单吊听牌独立结算

新局四组碰杠已成立、出牌后仅剩一张手牌且有合法听牌时，立即向另外两家各收本局开局时设置的喜钱，每人每局只结算一次。新桌在创建前输入每家支付的虚拟积分，创建后同桌每局沿用；缺创建快照的旧桌仍在开局或下一局前设置，默认 50，允许 0–100000 的整数；0 分不发生转账，但仍记录本局已触发，避免重复结算。开局后不可修改。第四组杠成立后、补摸前已满足听牌，也在此时结算；碰后尚未出牌的两张手牌不结算。该项与后续胡牌番分、萝卜、即时杠分及局末神龙独立。已开始的旧局缺少启用标记，沿用原账，不追溯补收；下一局启用。已有启用听牌喜钱、但未保存金额的旧局仍按每家 50 分；不改已结算事件、胡牌计分或总积分。


## 最新行牌方向、碰后出牌再补与总积分

- 新局保存 `turnDirection: "counterclockwise"`。屏幕座位不交换：自己的下一个行动者是右手边，再到左手边；座位号按 0→2→1→0。自然摸牌、全部过牌后的推进、同级碰/明杠、多人胡与抢杠胡的赢家顺序均使用同一方向，回应点击先后不影响结果。胡优先于杠、杠优先于碰不变。
- 已有 schema-v3 存档缺少方向字段时继续顺时针；不修改尚未结束的局和其待回应窗口。下一局采用新默认。schema1/2 冻结引擎不改。
- 新局保存 `allowPungUpgrade: true` 和 `pungUpgradeAfterDiscard: true`。碰后记录 `pendingPungDiscard`，直到自己实际打出一张牌才解除；暗杠、补摸或胡牌不代替这次出牌。解除后尚未胡者在自己的合法操作窗口可以用原有同牌或新摸同牌补杠；已胡者只能用本次摸入同牌，不能换掉锁定手牌。胡优先、胡后听口保持、抢杠、牌墙余量和杠分规则不变。
- v0.7.0 误设的 `allowPungUpgrade: false` 现按“碰后先出牌”处理，不再永久禁补。没有待出牌状态的存档从本人最近一次碰/出牌事件推断；不重洗、不改手牌、不重算旧分数。更早缺少该标记或明确允许且没有新时机规则的存档保留原补杠时机，已有抢杠窗口不丢失。下一局使用修正规则。
- 牌桌“本桌总积分”从服务端历局记录合计，包含本局暂记，分别显示已结算和本局暂记。再开一局、刷新或重连不清零，结束与归档不重复计入。离桌玩家保留原分数，新落座者从零开始；不按昵称或座位继承。大厅个人总积分仍只统计本人跨桌已结算牌局，不向同桌公开其他房间的记录。

## 首胡前动作与碰后暗杠 / Pre-win choices and post-peng concealed kongs

新局保存 `preHuActionChoice: true`：未首次胡牌者同时满足胡、碰、杠时可自行选择，自己的可胡摸牌也不屏蔽合法暗杠、补杠或扩杠；实际回应结算仍是胡优先于杠和碰。已胡者能胡时只允许胡，此前已确认的强制胡规则不变。
New games save `preHuActionChoice: true`: before the first win, all legal hu/peng/kong choices remain available, including own-turn concealed, supplemental and extended kongs alongside a winning draw. Claim resolution still prioritizes actual hu responses. Prior winners with an available hu must take it.

新局保存 `concealedKongAfterPungDiscard: true`：碰牌后的当前回合不得暗杠，必须真实打出一张牌；之后的正常窗口恢复暗杠。读取缺少玩家标记的存档时仍可从历史判断待出牌义务。两项新规则在旧局缺失或为 false 时保留旧行为，不补写规则、回应、历史或已结算分；schema1/2 不变。
New games save `concealedKongAfterPungDiscard: true`: the peng claimant must actually discard before concealed kongs become available in later normal windows. Missing player markers can be inferred from history. Saved games lacking either new flag (or explicitly false) retain their former policy without rewriting rules, responses, history or scores; schemas one and two remain unchanged.
## 杠事件加番 / Kong event fan

新开局保存 `kongEventFan: true`：普通抢杠胡、杠后接炮、杠上花（本次杠后补摸自摸）各加一番，先计入总番再换算分数。普通摸牌及胡后续摸不沿用上次杠的一番。七对首次及后续仍按固定档位，不叠加事件番。大单吊、清一色、对对胡、同牌番、萝卜、付款方及即时杠分沿用已有独立规则。
New games save `kongEventFan: true`: ordinary rob-kong, post-kong discard wins and kong replacement self-draw each add one fan before conversion to points. Natural and post-win continuation draws never inherit a previous kong bonus. Seven pairs retains its fixed tier on first and subsequent wins without event fan. Existing big-single, pure-suit, all-triplets, copy-count, radish, payer and immediate kong-payment rules remain independent.

旧 schema 3 存档缺少该字段或明确为 false 时保留旧算分：普通抢杠仍加一番，杠后接炮与杠上花不补加。恢复待回应窗口不会补写字段或重算已结算历史；schema 1/2 冻结。新明细保留 `robKongBonus`，另用 `kongDiscardBonus`、`kongReplacementBonus` 标明本次来源，界面分别显示“抢杠”“杠后接炮”“杠上花”。
Saved schema-three games with an absent/false flag keep historical scoring: ordinary rob-kong still adds one, but post-kong discards and replacement draws gain no new bonus. Restoring a pending claim neither backfills rules nor recalculates settled history; schemas one/two stay frozen. Breakdowns preserve `robKongBonus` and add source-specific `kongDiscardBonus`/`kongReplacementBonus` fields, displayed as the corresponding Chinese event labels.

新局另保存 `publicConcealedKongs: true`，已成立暗杠（含后续加张）牌面对所有玩家公开，其他暗手牌不因此公开。缺字段/false 的旧局和 schema1/2 保留原策略，不改历史或计分。详见 [展示隐私](TILE-VISIBILITY.md)。
New snapshots publish established concealed-kong faces, including extensions, without exposing unrelated concealed hands. Missing/false old snapshots and schemas one/two retain their policy, history and scoring.
