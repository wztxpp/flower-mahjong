# 双语可读性规范 / Bilingual readability standards

## 1. 面向谁写 / Write for the maintainer

维护者前端基础较弱，准备逐段通读项目。因此代码必须能回答：这是什么、为什么存在、由谁调用、会改什么、下一步去哪里。不要用“显而易见”省略状态转换和异步边界。
The maintainer is learning frontend development and intends to read the project in detail. Explain what a block is, why it exists, who calls it, what it changes, and what runs next. State transitions and async boundaries are never “obvious.”

本规范适用于所有自维护源码、测试、业务配置和资产制作脚本。第三方、平台脚手架、已应用迁移和生成文件不手工美化，改在文档解释用途。
These standards cover maintained source, tests, domain configuration, and asset-authoring scripts. Explain third-party/platform scaffolding, applied migrations, and generated files in documentation instead of hand-editing them.

## 2. 注释密度 / Comment density

- 文件头：职责、调用入口、可信边界、不能混淆的概念、相关文档。 / File header: responsibility, entry points, trust boundaries, distinctions, and related documentation.
- 函数或类：目的、参数语义、返回值、是否原地修改、错误/取消行为。一个逻辑连贯的小工具可用两行说明。 / Function/class: purpose, parameter meaning, result, mutation, errors, and cancellation. A small cohesive helper can use two explanatory lines.
- 关键判断：解释“为什么这个条件能阻止某个问题”，特别是 `!== false` 与 `=== true`、`??` 与 `||`、旧局缺字段、请求过时、权限、计分顺序。 / Decisions: explain why the condition prevents a problem, especially strict-vs-fallback booleans, nullish-vs-falsy fallback, missing legacy fields, stale requests, authorization, and scoring order.
- 循环：解释遍历的集合、顺序是否重要、退出条件；递归说明尝试与回滚。 / Loops: explain the collection, ordering, and termination; explain trial and rollback in recursion.
- 复杂行：展开条件、对象和异步步骤，允许逐行注释。不要仅写“加一”“返回”“循环”而不讲业务含义。 / Complex lines: expand conditions, objects, and async steps; line-level comments are welcome. Do not merely repeat “increment,” “return,” or “loop” without meaning.
- 注释写在代码上方，中文在前，英文紧随；短字段解释可用 `中文 / English`。优先解释当前事实，历史原因必须指出适用版本。 / Prefer comments above code, Chinese first, followed by English; short fields may use `Chinese / English`. Explain current facts and label historical version constraints.
- 不把“暂定”“兼容”删掉以显得确定；没有用户确认的玩法不写成统一麻将标准。 / Preserve provisional and compatibility labels; do not present unconfirmed rules as a universal standard.

## 3. 命名与术语 / Naming and vocabulary

以 [术语字典](TERMINOLOGY.md) 为准。标识符使用清楚的英文 `camelCase`，常量使用 `UPPER_SNAKE_CASE`，类使用 `PascalCase`，组件使用 `PascalCase.vue`。`seat` 是0起、严格小于本桌playerCount的整数；显示时才加一。`room` 不等于 `game`，`player` 不等于个人 `profile`，`revision` 不等于浏览器请求代次。
Follow the terminology dictionary. Use descriptive English camelCase identifiers, UPPER_SNAKE_CASE constants, PascalCase classes, and PascalCase.vue components. A seat is always a zero-based integer; add one only for display. A room is not a game, a player is not a profile, and a revision is not a browser request epoch.

布尔量优先 `is` / `has` / `can` / `should`；数组使用复数；索引用 `…Index`；数量用 `…Count`；存储摘要用 `…Hash`，明文凭证用 `…Token`。避免同一作用域的 `x/p/s/g/tmp`。简单数学比较器 `(a, b)` 可接受，但业务回调用 `player`、`meld`、`tile`。命名变更必须通过词法作用域工具或逐处核对，不用全局文本替换。
Prefer is/has/can/should for booleans, plural collections, …Index for indexes, …Count for counts, …Hash for stored digests, and …Token for raw credentials. Avoid cryptic domain names. Simple numeric comparators may use a/b; domain callbacks should use player/meld/tile. Rename by lexical binding or reviewed references, never blind replacement.

**已有的协议/存储键不为风格改名。** `mySeat`、`you`、`seat` 等存在于不同边界，必须记录映射而不是强行统一 JSON。内部叫法标准化不等于打断旧浏览器和旧存档。
**Do not rename existing wire/storage keys for style.** Document mappings between boundary-specific names such as mySeat, you, and seat. Consistent internal terminology must not break older clients or saved state.

## 4. 代码布局 / Layout

- 两空格缩进；一行一个语句；嵌套对象、长参数、复合条件按逻辑分行。使用现有模块语法，不批量换框架。 / Use two-space indentation, one statement per line, and logical wrapping for objects, arguments, and conditions. Keep the existing module/framework style.
- 优先早返回处理不合法/过期/缺失情况；不要为了减少行数堆叠三元运算。原有计分优先级链应先解释并回归，再另任务拆解。 / Use early returns for invalid, stale, or absent state. Avoid dense ternaries; explain and test existing scoring priority chains before a separate extraction.
- 保持副作用显式：读取、计算、复制、修改、持久化、响应分阶段。不要把 await、赋值和业务动作压成一行。 / Separate reads, calculations, copies, mutation, persistence, and responses. Do not compress awaits and business side effects into one line.
- 不随意提取跨版本共享代码，也不为纯注释重构引入新依赖、状态管理库或 TypeScript 全面迁移。 / Do not deduplicate versioned engines or introduce dependencies/framework migrations for readability alone.
- CSS 保持选择器、顺序、优先级、媒体查询和变量值；分区注释必须指出后置覆盖。模板不要改变空白相关内容、key、v-if/v-for、事件修饰符或可访问性属性。 / Preserve CSS selectors, order, specificity, media queries, and values. Label later overrides. Preserve template keys, directives, event modifiers, accessibility, and whitespace-sensitive content.

## 5. 状态、兼容性与隐私 / State, compatibility, and privacy

规则引擎用 `applyAction` 复制旧局，再验证、转换、检查守恒；服务端用房间 revision 原子保存。客户端只提交意图，不能自行改权威积分或决定合法动作。只返回当前座位可见的数据。
The engine copies state in applyAction, validates and transitions it, then checks invariants. The server saves using room-revision compare-and-swap. The client submits intent; it does not authoritatively score or decide legal actions. Return only the requesting seat's authorized view.

保存的 `schemaVersion` 决定规则引擎；保存的 rules 决定旧局行为。新建默认规则只能影响新局。离席不是删除房间，刷新不是重开，旧座位号不是身份，昵称不是凭证。
Saved schemaVersion selects the engine, and saved rules govern existing games. New defaults affect new games only. Leaving is not deleting, refreshing is not restarting, a reused seat is not identity, and a nickname is not a credential.

## 6. 异步与前端 / Async and frontend

- 每个请求说明输入快照、代次、取消和成功后更新范围。`AbortController` 不能保证服务器没执行写入。 / Document request snapshots, epochs, cancellation, and accepted update scope. AbortController cannot prove a server write did not execute.
- 换桌/卸载要清理定时器、监听、动画、音频和在途请求；旧响应必须比对会话代次。 / Clear timers, listeners, animations, audio, and in-flight requests on room changes/unmount; reject stale responses by session epoch.
- `ref` 是可写响应式源，`computed` 是派生视图，`watch` 管副作用；不要在模板重复编排请求。 / refs are writable reactive sources, computed values are derived views, and watchers handle effects. Do not orchestrate requests inside templates.
- 播放游标只消费权威新事件；重连先建立基线，不能补播历史或播出尚未提交的动作。 / Audio cursors consume new authoritative events only; reconnect by establishing a baseline, not replaying history or announcing uncommitted actions.

## 7. 测试与交付 / Testing and delivery

测试写清准备条件、动作、期望和防止的回归。固定种子用于重放，不用于生产洗牌。测试夹具必须满足本局副数×72张、每种副数×4张和积分零和；缺配置旧局仍为144/8；不要为了凑场景制造非法状态。源码结构断言要验证真实契约，不锁住无意义空白。
Describe setup, action, expectation, and regression protected. Fixed seeds support replay, not production shuffling. Fixtures conserve the saved deck budget (72 total and four per identity per deck), with legacy 144/eight defaults and zero-sum scores. Source assertions should protect contracts rather than incidental whitespace.

完成报告分别列出：实际改动、未触碰范围、测试数量/命令、旧版本验证、未运行项、分支/提交、是否发布。可读性任务不等于获得部署或数据库操作授权。
Report changes, untouched boundaries, exact checks, legacy validation, unrun checks, branch/commit, and publication status separately. A readability task does not authorize deployment or database operations.

## 已授权的规则纠错例外 / Authorized rule-correction exception

一般不能静默改变旧局规则。补杠时机是用户明确纠正旧实现的例外：v0.7.0 的 `allowPungUpgrade:false` 不再解释为永久禁止，而是碰后先完成一次出牌、之后正常窗口允许补杠。由 `requiresPungDiscard` 与兼容推断读取处理，不重写旧规则字段、牌区、历史或已结算分；更老的允许/缺省策略仍保留。详见 [补杠纠错说明](PUNG-UPGRADE-CORRECTION.md)。
Normally saved rules must not change silently. The user-authorized pung timing correction is an explicit exception: v0.7.0 false means discard once after peng before later legal upgrades, not a permanent ban. Compatibility reads apply it without rewriting saved rules, tiles, history, or settled scores; older allow/missing timing remains intact.

schema 3 已胡者的能胡必胡也属用户明确纠错，过滤当前/已保存未回应窗口，不改已提交回应或历史积分。具体边界见 [胡后必胡纠错](POST-HU-WIN-CORRECTION.md)。
Mandatory available wins for prior winners in schema three are also user-authorized corrections. Filter current/saved unanswered choices without changing submitted responses or historical scores. See [mandatory-win correction](POST-HU-WIN-CORRECTION.md).
