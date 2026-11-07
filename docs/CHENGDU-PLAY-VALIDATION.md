# 成都正式生命周期整合验收 / Chengdu production lifecycle validation

## 结果与范围 / Result and scope

本地分支`feature/chengdu-play-integration`已整合正式成都引擎、房间后端与独立界面。基于准备界面`7fb4ad6`，整合引擎`3480cc9 → 146db98 → 4faeebe → 3ddf17d`，后端`71843b2 → a161d40 → 53bc79c`。集成源码最终检查点`1a4b948`；本验收页为随后仅文档记录。未push、未部署，不代表生产环境已经开放。
The local branch integrates production Chengdu engine, room backend and independent UI. The listed source commits build on the preparation UI. Final source checkpoint is1a4b948; this subsequent change records results only. Nothing was pushed or deployed and production availability is not implied.

- 独立成都schema2/rulesVersion`chengdu-1`，固定四人、108张、定缺，首胡/血战、换三张、自摸加底/加番与4/5/6番封顶。开发schema1、伪造版本与坏存档拒绝，不回退花麻将。 / Independent versioned production engine and strict settings; drafts/forgeries/corrupt saves reject without Flower fallback.
- 正式开局安全洗牌，换三张局数与新game同一次CAS保存；从首个开启局顺→对→逆循环，关闭换牌、刷新/重连、失败/重复开局不推进。 / Secure shuffle and atomic enabled-round cursor, without advancement on disabled rounds, reads, resumes or failed/duplicate starts.
- 真实动作打通：换三张、定缺、出牌、碰、杠、胡/过、抢杠、一炮多响、胡后退出，首胡/三家胡/牌尽终局、查花猪/叫/退杠、下一庄/下一局。 / Preparation, play, claims/robbery, simultaneous wins/retirement, all end modes/draw settlement and next-round lifecycle are integrated.
- 共用凭证/档案、座位、房主、角色/报牌、观战、离席/重连、个人历史/累计账。正式暗杠公开，自摸胡牌终局才对他人公开，其他暗手与换牌内容仍私有。 / Existing identity/rooms/characters/audio/spectators/history are reused, with mode-owned privacy projections.
- `ChengduTable.vue`不重写规则：只渲染投影、匹配legalActions并交回App。中文历史按该局名字与公开付款格式化，不受当前桌换座影响。 / UI renders projections and emits allowlisted actions only; historical prose uses same-round names/public payments.

## 实际验证 / Checks performed

在最终源码`1a4b948`执行：
At source checkpoint1a4b948:

- `npm test`：**1168/1168通过**，0失败、0跳过。 /1168 passed, zero failures/skips.
- `node --test tests/chengdu-ui.test.js tests/ui.test.js tests/invitation-copy.test.js`：**182/182通过**，包含真实SFC及真实App→API→MemoryStore从满员开局、换三张、定缺到首次出牌。 /182 passed, including actual SFC and App/API/MemoryStore lifecycle.
- `npm run lint`：0错误，4个原有警告：worker默认对象导出、game两个未使用变量、rob-kong测试助手未使用。保留既有Pages目录提示。 /Zero errors; four pre-existing warnings and existing Pages-directory notice.
- `npm run build`：Vue客户端/Worker构建成功，30模块，`index-BtF4pufb.js`、`index-Dyc1zD7q.css`。 /Vue/Worker build passed with the listed asset hashes.
- `git diff --check`通过。 /Diff whitespace check passed.

全量保留花麻将三个独立版本、三/四人桌、可变副数、已有积分/角色/媒体/观战及房间规则回归。成都独立HTTP覆盖完整流局、换牌三轮、并发CAS、FileStore重启、版本证明拒绝无写入、换座历史及隐私。测试用合成牌局与隔离存储，不访问线上用户牌局。
Full regression retains all three Flower engines, three/four-seat tables, configurable decks and prior score/media/lifecycle behavior. Chengdu HTTP coverage includes full draws, exchange cycling, CAS, FileStore recovery, proof-rejection no-write semantics and replacement/history privacy. Tests use synthetic games/isolated stores, never production rooms.

独立只读复核：139项针对性规则/模式/界面检查通过；最终修复后另复跑4项UI/真实App链路/文案及1项版本证明。额外32个正式种子局、2384动作、7次胡/44次杠逐步验证隐私、旧对象不变、JSON恢复和归档幂等，未发现剩余具体阻断问题。没有以这些自动检查替代真实设备验收。
Independent read-only review passed139 targeted checks, followed by four UI/end-to-end/prose checks and one proof check. An additional32 seeded production games/2384 actions/7 wins/44 kongs passed stepwise privacy, immutability, JSON recovery and archive-idempotence checks, with no remaining concrete blocking finding. Automated review does not replace device acceptance.

## 整合中发现并修复 / Integration defects fixed

1. 成都动作带gameId/gameRevision但不带Flower播放标记时被误报409。新增模式能力`actionGameProof:true`，完整匹配证明独立于媒体；部分/过期/错误/重复证明仍拒绝并无写入，Flower原条件保留。 /Decoupled Chengdu game proofs from Flower media flags without relaxing stale-proof checks or old Flower behavior.
2. 正式满员成都按钮仍显示“未开放”。改为按实际rulesVersion2显示“人齐了，开始牌局”，null旧准备服务端仍禁用；清理品牌/下拉准备版措辞。 /Corrected production lobby labels while retaining legacy-null start gating.
3. 成都个人历史原本只显示英文事件type。共用纯文本格式器显示该局名字、牌/动作和公开付款，隐藏字段不恢复。 /Localized archived events using round-specific names and public data only.
4. 相同牌选择复制曾对Vue代理使用structuredClone。改为纯JSON动作复制，并用真实组件交互回归。 /Fixed reactive-proxy action cloning with tested plain-JSON copying.

## 未做与限制 / Unperformed checks and limits

- 本次未重启浏览器或隔离开发服务。先前实际浏览器只验证准备版配置/建房，不能算作此正式成都桌的视觉、触控、多人标签、刷新重连、观战或声音验收。 /No browser/service restart occurred. Prior preparation-only browser evidence does not validate this new table's layout/touch/multitab/reconnect/spectating/audio behavior.
- 没有真实设备语音试听，没有线上数据库/真实用户对局/生产流量测试。 /No actual-device listening or production-user/database/traffic testing.
- 响应式CSS与可及性语义有源码/真实SFC检查，真实窄屏布局和键盘体验仍待浏览器验收。 /Responsive/accessibility code and SFC semantics are checked; real viewport/keyboard behavior remains unverified.
- 只使用虚拟积分；未引入充值、支付、真钱或任何发布操作。 /Virtual scores only, without payment/cash or deployment actions.

相关维护入口：[界面](CHENGDU-PLAY-INTERFACE.md)、[房间后端](CHENGDU-ROOM-BACKEND.md)、[正式引擎](CHENGDU-ENGINE.md)。
Maintenance guides: UI, room backend and production engine above.
