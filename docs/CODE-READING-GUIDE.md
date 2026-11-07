# 从这里开始读代码 / Start reading here

这不是只给代码加标题的改动。自维护源码已经展开压缩写法，按文件职责、函数、状态、关键判断和副作用增加中文在上、英文在下的说明。你可以按以下路线通读，不必先懂整个前端生态。
Maintained source has expanded layout and Chinese-first bilingual explanations of responsibilities, functions, state, decisions, and effects. Follow this route without first learning the entire frontend ecosystem.

## 建议的五条路线 / Five reading routes

1. **先看到画面 / See the page**：`index.html → src/main.js → src/MahjongTile.vue → src/Icon.vue`，然后读 [前端指南](FRONTEND-READING-GUIDE.md)。先认识组件、props、ref、computed、模板绑定。 / Learn components, props, refs, computed values, and template bindings.
2. **跟一次操作 / Follow one action**：`src/App.vue` 的 enterRoom/mutate/refresh → `server/api.js` → `shared/game.js` 的 applyAction → 返回视图。对照 [生命周期](ARCHITECTURE-AND-LIFECYCLES.md)。 / Trace a request through authority and back to the view.
3. **看懂规则 / Understand rules**：[规则引擎指南](ENGINE-READING-GUIDE.md) → createGame → getLegalActions → 状态转换 → 胡牌/计分 → 不变量检查。 / Read deal, actions, transitions, scoring, and invariants in order.
4. **看懂保存和重连 / Understand persistence**：[服务端指南](SERVER-READING-GUIDE.md) → api/history/store → App 的请求代次、离席队列、存储恢复。 / Connect server persistence to browser recovery and cancellation.
5. **学会安全修改 / Learn safe changes**：[风格规范](CODING-STANDARDS.md) + [术语](TERMINOLOGY.md) + [测试指南](TESTING-READING-GUIDE.md)，选一个已有场景阅读准备、执行、断言、清理。 / Read conventions and a complete arrange/act/assert/cleanup test.

每次修改必须先读根目录 [AGENTS.md](../AGENTS.md)。它是以后工作入口，不用靠记忆去找这几份规范。
Every change starts with AGENTS.md; it links the required guides so future work does not rely on memory.

## 自维护源码清单 / Maintained source inventory

### 浏览器 / Browser

| 文件 / File | 职责 / Responsibility |
|---|---|
| `index.html` | 页面元信息、Vue 挂载点与模块入口。 / Metadata, mount point, module entry. |
| `src/main.js` | 挂载 Vue，导入样式。 / Mount Vue and load styles. |
| `src/App.vue` | 大厅/牌桌、会话、网络、表单、重连、声音和动画编排。 / Lobby/table, sessions, requests, recovery, and presentation orchestration. |
| `src/MahjongTile.vue` | 单张牌的图形和可访问性展示。 / Tile rendering and accessibility. |
| `src/Icon.vue` | 小图标 SVG，不包含游戏规则。 / SVG icons, not rules. |
| `src/character-audio.js` | 角色、权威事件游标、逐事件结果音频串行队列。 / Characters, event cursor and serial audio with per-event outcomes. |
| `src/shared-playback.js` | 完整公开前缀、同座声音协调、成功记录、失败接力与降级。 / Complete public prefixes, sibling audio coordination, success records, bounded recovery and fallback. |
| `src/mahjong-photo-faces.js` | 用户 PNG 图集矩形裁切、原图尺寸与牌种定位。 / User PNG atlas rectangles, source dimensions and tile mapping. |
| `src/style.css` | 基础布局、组件外观、响应式样式。 / Base layouts, components, responsive rules. |
| `src/tabletop.css` | 后加载的牌桌视觉覆盖；顺序与优先级必须保留。 / Later table overrides; preserve order and specificity. |

### 规则、接口与存储 / Rules, API, and storage

| 文件 / File | 职责 / Responsibility |
|---|---|
| `shared/game.js` | 当前 schema 3 规则状态机。 / Current schema-three engine. |
| `shared/v2-game.js` | schema 2 旧局兼容，不能替换成新版。 / Schema-two compatibility. |
| `shared/legacy-game.js` | schema 1/缺版本旧局兼容。 / Version-one/missing-version compatibility. |
| `shared/start-options.js` | 前后端共用的开局喜钱默认值、上限与金额校验。 / Shared ready-bonus defaults, bounds, and validation. |
| `shared/character-assignment.js` | 开局角色分配与旧局角色映射。 / Character assignment and legacy mapping. |
| `server/api.js` | HTTP 路由、输入与身份验证、规则分派、原子提交。 / Routing, validation, authorization, engine dispatch, CAS. |
| `server/history.js` | 参与者快照、历史归档、本桌与个人记录投影。 / Participant snapshots, archives, table/profile records. |
| `server/store.js` | MemoryStore 与 D1Store。 / In-memory and hosted storage. |
| `server/node.js` | FileStore 与 Node HTTP/API 适配。 / Local-file storage and Node HTTP/API adapter. |
| `server/start.js` | 独立 Node 服务启动与静态资源提供。 / Standalone Node startup and static asset serving. |
| `server/worker.js` | 当前正式 Worker 入口和资产绑定。 / Active hosted Worker entry and assets. |
| `db/schema.ts` | 维护中的 D1 表声明；不改变既有列名。 / Maintained D1 table declarations. |

### 构建与配置 / Build and configuration

- `vite.config.ts`：Vue、平台插件、开发 API 中间件、固定端口和浏览器输出。 / Vue/plugin/dev middleware, fixed port, browser output.
- `drizzle.config.ts`：schema 位置与迁移输出。 / Schema and migration output locations.
- `scripts/build-mahjong.mjs`：清理可生成产物、构建 Vue、打包 Worker、写配置；不是发布。 / Rebuild browser/Worker output and config, without publishing.
- `scripts/verify-readability.mjs`：离线跨版本差分重放，与指定 Git 基线逐步比较。 / Offline differential replay against a Git baseline.
- `package.json`、`.npmrc`、`.gitignore`、`tsconfig.json`、`eslint.config.mjs`：保留运行/依赖/忽略/类型/检查配置，本次不改安装版本或原平台设定；JSON 不允许随意加注释。 / Preserved runtime/dependency/tool configuration; no dependency or platform changes. JSON comments are not permitted.

### 测试 / Tests

`tests/*.test.js`、`tests/fixtures/*.js`、`tests/smoke/room-lifecycle.mjs`、`tests/performance/*` 都是自维护代码，已加双语说明。每个文件与运行前提在 [测试指南](TESTING-READING-GUIDE.md) 列明；测试不等于生产请求许可。
All test, fixture, smoke, and performance sources are maintained and explained. The testing guide lists every file and execution prerequisites. A test script is not authorization to run it against production.

### 语音制作 / Voice authoring

七个 `scripts/voices/*.py` 均已逐函数、流程与重要分支注释：`generate.py`、`audit.py`、`generate_context_rescue.py`、`extract_context_rescue.py`、`review_context.py`、`extend_win_calls.py`、`extend_qianggang.py`。它们不是用户打开网页时运行的代码。
The seven annotated Python authoring/audit scripts run offline, not when players open the app. Read [语音工具指南 / Voice tooling guide](VOICE-TOOLING-GUIDE.md) before using them. Generation and auditing can write assets/manifests; do not rerun casually.

## 保持原样的边界 / Boundaries intentionally left unchanged

这些不是遗漏注释，而是为了保护上游和生成记录：
These are intentionally preserved upstream/generated boundaries, not missing coverage:

- `node_modules/**`：第三方安装内容；`package-lock.json`：安装锁。 / Installed dependencies and lockfile.
- `dist/**`、`.wrangler/**`、`.sites-runtime/**`、构建缓存：可再生成输出。 / Build/runtime caches and output.
- `public/assets/**`、`public/characters/*.png`、`public/voices/**/*.mp3`、`public/voices/manifest.json` 与来源审计 JSON：原资产和生成追溯记录，不通过“注释重构”重新生成。 / Media, manifest, and audit provenance are preserved.
- `drizzle/*.sql`、`drizzle/meta/**` 与 `db/migrations/*.sql`：已有迁移记录；两套 SQL 是替代路径，不可两套都应用。 / Existing migrations; the two SQL sets are alternatives, not cumulative migrations.
- `scripts/vite/**`、`scripts/connector-preview/**`：平台插件与连接器预览实现，含上游许可证，原样保留。 / Hosting plugin and connector preview scaffolding with upstream licensing.
- `scripts/{build-verified.sh,execution-profile.mjs,install-ci.mjs,install-ci.sh,install-pnpm.sh,npm-install.mjs,pnpm-install.mjs,run-framework.mjs,sites-env.mjs,sites-env.sh,tool-environment.mjs}`：平台安装/环境/旧构建辅助脚本，非麻将业务；用途在下节解释，源文件不改。 / Platform installation/environment/legacy-build helpers, not Mahjong domain code.
- `worker/index.ts`、`db/index.ts`：保留平台模板；当前构建并不以 `worker/index.ts` 为入口。 / Retained platform adapters, not the active Mahjong Worker entry.
- `.openai/hosting.json`、资产提示词、版本审计与历史 QA：保留配置和证据。 / Hosting metadata, provenance, and historical QA remain intact.

## 平台脚本如何理解 / How to understand preserved platform scripts

安装脚本负责选择 npm/pnpm 和可用环境；`sites-env*`/`tool-environment`/`execution-profile` 提供平台环境包装；`connector-preview` 与 Vite 平台插件负责预览绑定。旧 `build-verified.sh` 运行 Vinext 构建，当前麻将的 npm build 则运行自定义 `build-mahjong.mjs`。读业务时先跳过这些模板，遇到平台构建问题再查。
Installation helpers choose npm/pnpm and the platform environment. Environment wrappers and connector/Vite plugins support preview bindings. The legacy build-verified script runs Vinext, while Mahjong’s npm build uses build-mahjong. Skip the retained scaffolding while learning domain behavior.

当前全项目 TypeScript 检查仍有模板相关的已存在错误，主要是 DB/CONNECTORS/ImportMeta 类型和缺失 connector 模板模块。实际 Vue/Worker 生产构建和运行测试另行验证，不把它们混称为全项目 typecheck 已通过。
The repository-wide TypeScript check retains known template-related DB/CONNECTORS/ImportMeta and missing connector-module errors. Actual Vue/Worker builds and runtime tests are separate checks; do not describe them as a passing full typecheck.

## 修改前的小练习 / A small exercise before editing

挑一个按钮，回答：它读哪个 ref/computed？调用哪个请求？提交什么动作？服务端如何验权？哪一步真正变更牌局？如何保证旧响应不覆盖新桌？声音从哪个已确认事件产生？找到这七处以后，再修改比从 CSS 或条件表达式随便试更安全。
Pick one button and identify its state source, request, action payload, server authorization, committed transition, stale-response guard, and confirmed audio event. Locating these seven points makes edits safer than trial-and-error changes.

## 当前展示节奏 / Current presentation pacing

[音画完成后推进](PRESENTATION-PACING.md) 是本轮新增维护文档，连接 App、CharacterAudio、当前引擎与 API。新增维护测试为 `tests/presentation-game.test.js` 和 `tests/presentation-api.test.js`，随 `npm test` 运行；原 ui/audio 测试继续覆盖完成与取消。
The new maintained [presentation pacing](PRESENTATION-PACING.md) guide connects App, CharacterAudio, the current engine and API. The two presentation test files run under npm test alongside updated UI/audio completion and cancellation cases.

[胡后必胡纠错](POST-HU-WIN-CORRECTION.md) 连接引擎动作白名单、HTTP 拒绝、界面提示与存档兼容；新增维护文件 `tests/post-hu-win.test.js` 和 `tests/fixtures/post-hu-win.js` 已列入测试指南。
The [mandatory-win correction](POST-HU-WIN-CORRECTION.md) connects engine allowlists, HTTP rejection, UI guidance and saved-state compatibility. The new maintained suite and fixture are listed in the testing guide.

## 平滑播放修复维护清单 / Smooth-playback maintenance inventory

`src/App.vue` 新增接收/展示分离和本地FIFO；`src/character-audio.js` 的 enqueueOrdered 返回逐事件真实结果；`src/shared-playback.js` 负责完整公开前缀、同座位成功记录及有界失败接力；`server/api.js` 支持 local 节拍及GET竞争重读。新增维护测试为 `tests/ordered-audio.test.js`、`tests/shared-playback.test.js`、`tests/presentation-network.test.js`；`tests/browser/isolated-server.mjs` 与 `tests/browser/README.md` 仅服务隔离合成浏览器验收。不得连接真实牌局或把此辅助服务发布到生产。完整协议见 [音画节奏](PRESENTATION-PACING.md)。
App adds received/displayed separation and a local FIFO; audio reports per-event outcomes; shared-playback coordinates complete public prefixes, same-seat success records and bounded sibling retries; the API adds local cadence and safe read-contention handling. New maintained audio/network suites join npm test. The browser server/readme are isolated synthetic acceptance helpers only, never production endpoints. See the pacing guide.

- `docs/SMOOTH-PLAYBACK-VALIDATION.md`：本次自动与真实浏览器验收、证据范围和未验证项。 / Automated and real-browser acceptance, evidence scope and unverified areas.

杠事件番维护入口：`shared/game.js` 的新局快照与本次计分、`src/App.vue` 的来源标签；`tests/game.test.js` 覆盖 true/false/缺字段、真实暗杠补摸与续摸、多家杠后接炮，`tests/rob-kong.test.js` 覆盖抢杠原番与恢复，`tests/special-patterns.test.js` 覆盖七对固定档位，`tests/api.test.js` 保留旧八分反馈并验证新补摸一番。`tests/ui.test.js` 验证新旧明细的中文标签且不重复展示事件番。没有新增测试文件。
Kong-event maintenance entry: new-game snapshots and per-win scoring in shared/game.js, source labels in App.vue. Existing game tests cover true/false/absent flags, real concealed-kong replacement/continuation and multiple discard winners; rob-kong tests protect original fan/restoration; special-pattern tests protect fixed seven-pairs tiers; API tests preserve the old eight-point report and verify new replacement fan. UI tests verify Chinese labels for current/legacy breakdowns without duplicate event fan. No new test files were added.

- `shared/tile-visibility.js`、`tests/tile-visibility.test.js` 与 [展示隐私](TILE-VISIBILITY.md)：新局暗杠公开、自摸胡牌按座位遮蔽，以及房间/个人历史共用过滤。 / New-game public kongs and seat-private self-draw wins, shared across room/profile projections.
