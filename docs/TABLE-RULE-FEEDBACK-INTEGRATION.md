# 牌桌布局与规则反馈联合验收 / Table-layout and rules feedback integration

## 本地组合 / Local composition

基线main `ac10fa3d2e7c7f817b7239b07e1453f7a2944b10`。独立工作树`flower-feedback-integration`、分支`integrate/table-rule-feedback`，保留UI提交顺序`bcbb731 → 6772f01 → 41b2f9a`，再合规则`044991d`为`63992f4`。仅架构、术语和测试导读三个文件的末尾追加区发生冲突；两边说明均保留。没有冲突涉及生产源码。
Based on main ac10fa3, the independent integration branch retains the three UI commits and applies rules044991d as63992f4. Only appended architecture/terminology/testing documentation conflicted; both additions were retained. No production-source conflict occurred.

本次另在现有`tests/ui.test.js`增加四项交叉回归，不改生产逻辑：真实schema3引擎投影进入真实Vue组件，不能仅靠人工UI快照假设规则已生效。
Four cross-layer regressions were added to the existing UI suite without further production changes. They feed real schema-three projections into the actual Vue component instead of assuming rules from artificial action lists.

## 已对齐行为 / Integrated behavior

- 胡后的补碰/加杠只允许使用当前本人实际摸入的同种牌，不允许把锁定手牌中的原牌取出、留下不同新牌，即使听口相同。合法暗杠继续显示并可由原权威路径执行。 / Post-hu upgrades require the actual current drawn identity and cannot exchange held tiles despite identical waits; legal concealed kongs retain their authoritative path and controls.
- 自己打过的同种牌，在本人下一次实际摸牌前不可接胡/抢杠。旧未回应窗口先过滤再执行已胡必胡逻辑；本人见解释与过牌，不误显示“必胡”。 / Self-discarded identities remain barred until the next actual own draw; saved unanswered claims filter before mandatory-hu presentation and show the owner a private explanation/pass.
- 操作条居中、窄屏原生横向滚动可达、普通内容固定容量、无角色名片，以及手牌/立绘之后的状态/身份/终局页脚，均保留原UI提交。玩家接牌仍靠近动作，观众公开提示仍在页脚。 / Centered actions, reachable narrow overflow, normal-content reservation, removed persona nameplates and post-hand/art footers retain the original UI implementation and privacy guards.
- 新测试覆盖3/4/7张副露的禁用升级、合法暗杠、普通接炮/抢杠旧窗的JSON恢复、刷新后仍锁定、footer/操作条顺序，以及观众没有本人诊断/手牌/动作。 / New cases cover several upgrade sizes, valid concealed kongs, saved discard/rob-kong claims, JSON/refresh persistence, footer/action order and spectator privacy.

源码逐字比较全部通过：`src/`与UI最终`41b2f9a`相同；`shared/`与规则最终`044991d`相同；`server/`、冻结schema1/2和成都引擎与main基线相同。没有借整合改动成都玩法、媒体素材、联机协议或旧版规则。
Byte-for-byte comparisons passed: src matches UI41b2f9a, shared matches rules044991d, and server/frozen Flower/Chengdu engines match the baseline. Integration introduces no additional mode, media, protocol or frozen-rule changes.

## 实际检查 / Executed checks

- `npm test`：**1400/1400通过**，0失败、0跳过。首次仅组合提交也已1396/1396通过。 /Final1400 passed with zero failures/skips; the initial composition also passed1396.
- 联合专项：`node --test tests/ui.test.js tests/post-hu-held-tile.test.js tests/self-discard-lock.test.js tests/flower-lock-api.test.js tests/stable-table-layout.test.js tests/stable-table-fixture.test.js tests/portrait-layout.test.js tests/chengdu-ui.test.js`，**276/276通过**。 /Combined focused276 passed.
- `npm run lint`：0错误，3条既有警告（worker默认对象导出、game未用wasRepeat、rob-kong测试未用passAll）；保留既有Pages目录提示。 /Zero errors, three existing warnings and the existing Pages notice.
- `npm run build`：45模块，客户端/Worker构建成功；`index-BgRm970r.js`、`index-B-JC4nZe.css`、`renderer-DIVv3ao9.js`。 /Client/Worker build passed with the listed assets.
- `git diff --check`通过；独立只读复核255项专项通过，无可操作缺陷。 /Whitespace check and independent255-check review passed, with no actionable defect found.

## 保存恢复与验收限制 / Recovery and validation boundaries

生产完整追加历史可恢复自弃限制；任意删减/损坏历史无法可靠恢复，也不会根据牌河、暗手或旧huLockActive猜锁。本人真实摸牌解除之前限制，不是刷新或进入摸牌步骤。已接受的旧胡回应仅在牌种、来源位、弃牌索引和胡来源精确匹配本窗口时保留结算资格，并仍验牌型；不撤回已接受动作、不重写旧账。见[规则纠错](FLOWER-HAND-LOCK-CORRECTION.md)。
Complete committed history restores locks; arbitrarily missing/corrupt history cannot be reconstructed and never prompts guesses from rivers/hands/legacy flags. Only actual own draws clear locks. Narrow exact-window treatment preserves already accepted old wins while still validating hand shape, without rewriting accepted actions or settled accounts.

本次整合没有启动浏览器、预览服务或访问真实牌局。UI分支的既有隔离合成浏览器证据随提交保留，且其生产UI源码逐字相同，详见[布局验收](STABLE-TABLE-VALIDATION.md)。这些证据不等于“本次重新跑过”，也不覆盖真实网络多人打牌、实体手机/触摸、所有浏览器、读屏语音或设备声音。SSR/AST交叉检查不能代替这些验收。
No browser/service or real game was used during integration. Existing UI-branch synthetic browser evidence remains attached to unchanged production UI source, but was not rerun here and does not validate real-network multiplayer, physical touch devices, all browsers or spoken/audio behavior. SSR/AST checks do not substitute for these checks.

没有push、合并main、部署、数据库迁移或线上修改。临时依赖软链在检查后移除，原两个工作树保持原状。
No push, main merge, deployment, migration or production modification occurred. The temporary dependency link was removed after checks and both source worktrees were preserved.
