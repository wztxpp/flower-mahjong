# 修改前必读 / Read before every change

本仓库面向正在学习前端的维护者。可理解性是交付要求，不是可选润色。每次开始工作（包括修 bug、加规则、重构和发布）都必须先读本文件及下面的规范，再读准备修改的源码与测试。
This repository is maintained by someone learning frontend development. Readability is a delivery requirement, not optional polish. Before every change, read this file, the standards below, and the affected source and tests.

## 必读顺序 / Required reading order

1. [阅读入口 / Reading map](docs/CODE-READING-GUIDE.md)：先了解文件职责与学习路线。 / Understand responsibilities and the recommended learning path.
2. [代码风格 / Code style](docs/CODING-STANDARDS.md)：双语注释、命名、分支、异步和验证约定。 / Bilingual comments, naming, branches, async work, and verification.
3. [术语字典 / Terminology](docs/TERMINOLOGY.md)：同一概念使用同一英文标识；已有协议字段不可随意改名。 / Use one English name for each concept; preserve existing protocol fields.
4. [架构与生命周期 / Architecture and lifecycles](docs/ARCHITECTURE-AND-LIFECYCLES.md)：区分浏览器页面、会话、房间、座位、单局、回合与记录。 / Distinguish page, session, room, seat, game, turn, and record lifecycles.
5. 涉及前端读 [前端导读 / Frontend guide](docs/FRONTEND-READING-GUIDE.md)；涉及服务端读 [服务端导读 / Server guide](docs/SERVER-READING-GUIDE.md)；涉及规则读 [规则引擎导读 / Engine guide](docs/ENGINE-READING-GUIDE.md) 与 [当前规则](docs/RULES.md)。 / Read the guide for the layer you change and its rule contract.
6. 涉及发布，先读 [发布流程 / Release workflow](docs/RELEASE-WORKFLOW.md)。 / Read the release workflow before publishing.

## 不可破坏的边界 / Non-negotiable boundaries

- 本项目只使用虚拟积分。保留功能、算分、动作优先级、隐私、联机和旧桌行为。 / This game uses virtual scores. Preserve behavior, scoring, action priority, privacy, networking, and existing rooms.
- 新规则只能通过明确的版本或开局规则快照引入。不能给已保存的旧局补默认字段以静默启用新行为。 / Introduce new rules through explicit versions or new-game snapshots; never silently retrofit saved games.
- `gameMode` 与 `schemaVersion` 是独立维度，分发只经 `server/game-engines.js`。缺模式旧局才兼容花麻将，未知模式不能回退，成都未登记前不能借用花麻将规则/隐私/计分。见 [模式边界](docs/GAME-MODES.md)。 / Mode and schema version are independent; dispatch only through the registry. Only missing modes mean legacy Flower; unknown modes never fall back, and Chengdu cannot borrow Flower rules/privacy/scoring before registration.
- `shared/game.js`、`shared/v2-game.js`、`shared/legacy-game.js` 是三个独立规则版本；外形相似不代表可以合并。 / The three engine versions are independent compatibility contracts, not deduplication opportunities.
- HTTP 路径、JSON 键、动作 type、规则键、浏览器存储键、D1 列名、导出函数签名是兼容边界。局部变量可改名；协议迁移必须另有明确设计和回归测试。 / HTTP paths, JSON keys, action types, rule keys, browser storage keys, D1 columns, and exported signatures are compatibility boundaries.
- 不提交凭证、生产 `.data`、真实牌局或个人记录；不给客户端对手手牌和未公开反应。 / Never commit credentials, production state, or personal records; never expose concealed opponent data.
- 不修改 `node_modules`、`dist`、平台脚手架、音频/图像生成物、锁文件或已应用迁移来完成注释任务。完整边界见阅读入口。 / Do not edit dependencies, build output, platform scaffolding, media, lockfiles, or applied migrations for a readability task.

## 每次修改的完成条件 / Definition of done

1. 先记录基线与当前工作树，保留他人未完成的修改。 / Record the baseline and preserve concurrent work.
2. 新增/修改逻辑有详细中文 + 英文注释：说明输入、输出、副作用、关键判断原因和兼容例外，不只翻译语法。 / Explain inputs, outputs, side effects, decision rationale, and compatibility exceptions in Chinese and English.
3. 同步术语和相关架构/阅读文档；新文件加入维护清单。 / Update terminology, relevant guides, and the maintained-file inventory.
4. 执行 `npm test`、`npm run lint`、`npm run build`；按修改补专项检查。纯可读性变更再做语法结构和确定性行为对比。 / Run tests, lint, build, and focused checks; compare syntax structure and deterministic behavior for readability-only changes.
5. 如存在失败或没运行的检查，写清命令、原因和范围，不能说全部通过。 / Report failures and unrun checks precisely.
6. 没有明确发布授权时，不 push、不合并、不部署。获得授权后先同步并推送 GitHub main、核实远端提交，再用该提交构建发布。 / Without explicit publication authorization, do not push, merge, or deploy. When authorized, verify pushed main before building and publishing it.

## 已授权的规则纠错例外 / Authorized rule-correction exception

一般不能静默改变旧局规则。补杠时机是用户明确纠正旧实现的例外：v0.7.0 的 `allowPungUpgrade:false` 不再解释为永久禁止，而是碰后先完成一次出牌、之后正常窗口允许补杠。由 `requiresPungDiscard` 与兼容推断读取处理，不重写旧规则字段、牌区、历史或已结算分；更老的允许/缺省策略仍保留。详见 [补杠纠错说明](docs/PUNG-UPGRADE-CORRECTION.md)。
Normally saved rules must not change silently. The user-authorized pung timing correction is an explicit exception: v0.7.0 false means discard once after peng before later legal upgrades, not a permanent ban. Compatibility reads apply it without rewriting saved rules, tiles, history, or settled scores; older allow/missing timing remains intact.

用户另确认 schema 3 已胡者能胡必胡，当前及已保存待回应窗口只提供胡；不倒改已提交回应、历史或旧账，schema1/2 冻结。见 [胡后必胡纠错](docs/POST-HU-WIN-CORRECTION.md)。
The user also confirmed mandatory available wins for prior winners in schema three, including saved unanswered windows. Do not retroactively change submitted responses/history/scores or frozen schemas one/two. See [mandatory-win correction](docs/POST-HU-WIN-CORRECTION.md).

2026-11-08用户另确认：schema3胡后补/加杠只能用本次真实摸入同牌，不能借听口不变换掉锁定手牌，合法暗杠仍保留；自弃同牌至本人下一次实际摸牌前禁胡。当前与保存局后续动作共用检查，不迁移、不改已接受回应或旧账，缺历史不猜。详见[锁手牌与自弃纠错](docs/FLOWER-HAND-LOCK-CORRECTION.md)。
The 2026-11-08 correction locks held tiles after hu and blocks self-discarded identities until the next actual own draw. Apply to future schema-three actions without migrations, revoking accepted responses or guessing absent history; preserve legal concealed kongs and frozen engines.

2026-11-10用户明确杠上花消费本次杠后机会，胡后续摸弃牌受已胡保护，不能普通接炮或加杠后番。schema3后续动作及可证明的旧未回应窗口按此纠正；已接受回应、历史及旧账不改，schema1/2冻结。详见[杠上花续摸纠错](docs/KONG-HU-CONTINUATION-CORRECTION.md)。
The 2026-11-10 correction consumes a kong opportunity upon replacement hu, protecting later continuation discards. Apply to future schema-three actions and provable unanswered saved windows without revoking accepted responses, rescoring history or changing frozen engines.
