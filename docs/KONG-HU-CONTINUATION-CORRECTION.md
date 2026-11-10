# 杠上花后的续摸弃牌 / Discards after a kong-replacement win

## 已确认边界 / Confirmed boundary

2026-11-10用户确认：杠后补牌自摸胡已结束本次杠后机会。接下来的胡后补摸属于普通续摸，已胡玩家打出的牌不能被别人胡、碰或明杠，不存在“普通放炮减一番”的处理。此前把杠标记保留至下一张弃牌、跨过自摸和续摸的实现不适用于当前schema3。
On 2026-11-10 the user confirmed that a replacement-draw win consumes that kong opportunity. The subsequent continuation discard is protected because its source has won: nobody may hu, peng or expose a kong from it. This is not an ordinary discard win with one fewer fan. The earlier marker lifetime spanning self-draw wins and continuations is corrected for schema three.

真正的杠后补摸直接弃牌仍可被接胡；出牌者此前已胡也一样，碰和明杠仍禁止。若胡后续摸又合法完成一个新杠，新杠会产生自己的补摸与接胡机会。杠上花原有一番、明杠补摸的来源付款、其他杠费、萝卜、七对固定番和神龙都不改。
A direct replacement discard remains claimable even from a previous winner, still without peng/exposed-kong claims. A genuinely new kong after hu creates its own replacement opportunity. Existing replacement fan, exposed-kong source payment, kong charges, radishes, fixed seven-pairs tiers and dragons are unchanged.

## 状态与保存兼容 / State and saved-game compatibility

- `continueAfterHu`在展示暂停或终局之前清除优先赢家的`pendingKongDiscard`；旧版保存在胡牌展示段的局也经过此入口。不重算已完成的胡牌。
  `continueAfterHu` clears the priority winner's marker before presentation or termination, including old saved hu boundaries, without recalculating the committed win.
- `discardTile`对本人的真实`lastDraw.source === 'continuation'`忽略遗留标记，覆盖旧版已经续摸但还未打出的保存态。真实新杠来源为`replacement`，不受影响。
  `discardTile` ignores stale markers for an actual own continuation draw, covering saved already-drawn states. A fresh kong uses replacement instead and remains valid.
- `isProtectedPostHuDiscard`只读判断旧版已经提交的错误弃牌：必须为当前牌河末张，牌河长度与弃牌/抢杠事件数一致，最后弃牌事件的座位、牌种、杠后标记完全匹配，前一个本人动作是续摸。缺失、矛盾记录或中间有新杠，不猜测改判。
  The read-only protection helper requires the final river tile, equal river and discard/rob-offer event counts, an exact final seat/tile/kong-marker match, and a preceding own continuation draw. Missing/conflicting history or an intervening new kong never triggers guessed correction.
- 该判断用于待展示弃牌恢复、新接牌窗口、已保存未回应选项和私有诊断。旧错误窗口只保留过牌以正常收束；已提交回应不撤销，已接受胡仍按原来源一次结算。读取不会改写旧弃牌、历史、规则快照或已结算积分。
  Paused-discard recovery, new claims, saved unanswered choices and private diagnostics share protection. Old affected windows retain pass so they can close. Accepted responses remain committed and settle once using their recorded source. Reads never rewrite river/history/rules/settled balances.

不增加配置开关、存储字段或迁移。schema1/2及成都文件保持原样；历史规则文档中的旧标记说明仅描述冻结版本。
No option, persisted field or migration is added. Frozen schemas one/two and Chengdu remain unchanged; historical documentation describes those frozen engines.

## 回归入口 / Regression entry points

- `tests/fixtures/kong-hu-continuation.js`：完整144张合成牌预算、真实杠/胡/续摸及旧错误窗口，不存真实用户记录。
  Full 144-tile synthetic budgets, real transitions and old erroneous windows, without real user records.
- `tests/kong-hu-continuation.test.js`：四类杠、首胡/再胡、自动/手动、即时/分段、逐段JSON恢复、连续自摸、新杠、旧展示/待决状态、终局、已接受回应和缺证据保守分支。
  Four kong kinds, first/repeat wins, automatic/manual and immediate/paced execution, JSON boundary recovery, repeat wins, fresh kongs, saved states, termination, accepted responses and insufficient evidence.
- `tests/flower-lock-api.test.js`：FileStore重启后的真实HTTP处理器检查；非法胡重试无写入、私有诊断一致、过牌收束不重算旧账。
  Actual HTTP handlers after FileStore restart verify no-write rejected retries, consistent private diagnostics and pass closure without rescoring history.

完整检查和发布结果以该次交付报告为准；引擎/HTTP回归不等于真人浏览器联机试玩。
Use the delivery report for final checks and publication. Engine/HTTP regressions are not a live multiplayer browser playtest.

本次新增40项引擎回归及1项HTTP/FileStore回归；独立复核的相关43项全部通过。完整`npm test`为1738/1738，`npm run lint`为0错误、3个原有警告（及既有Next目录提示），`npm run build`成功。新引擎测试在修正前基线有34项失败、修正后40项全部通过。未进行真人浏览器联机试玩或全项目TypeScript检查。
This change adds forty engine regressions and one HTTP/FileStore case; an independent focused run passes all forty-three related cases. Full tests pass 1738/1738, lint has zero errors and three existing warnings (plus the existing Next directory notice), and the production build succeeds. The new engine suite fails thirty-four cases on the old baseline and passes all forty after correction. Live multiplayer browser play and the repository-wide TypeScript check were not run.
