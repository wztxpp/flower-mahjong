# 从这里开始读代码 / Start reading here

当前原图局部动效入口：[Canvas2D展示层](PORTRAIT-MOTION.md)。维护文件为 `src/CharacterArtwork.vue`、`src/PortraitMotionSettings.vue`、`src/portrait-motion/{settings,catalog,loader,controller,renderer,timeline,images,geometry}.js`、`scripts/verify-portrait-motion-build.mjs` 与 `tests/portrait-motion-{settings,controller,component,renderer,timeline,geometry,build}.test.js`。素材目录为 `public/portrait-motion/`，原始 `public/characters/` 字节保持不动。
The current original-preserving Canvas2D guide owns the listed maintained files/tests and new asset directory; original character bytes stay unchanged.

无损素材图集维护入口为 `scripts/portraits/pack-motion-atlas.mjs`、`tests/portrait-motion-atlas.test.js` 与 [图集契约](PORTRAIT-MOTION-ATLAS.md)。它们只摘取已有RGBA，不生成或修饰图片；动态发区的连续原纹理分支在geometry.js，不能混称ImageGen头发帧。
Lossless atlas maintenance lives in the listed packer/test and linked contract. It extracts existing RGBA without generating or retouching artwork. Continuous original-texture hair is implemented in geometry.js and must not be called ImageGen hair frames.

旧 [Live2D展示层](LIVE2D-RUNTIME.md)、[许可](LIVE2D-LICENSE-REVIEW.md)、[验收](LIVE2D-VALIDATION.md) 是历史记录。`src/live2d/**`、`src/Live2DSettings.vue`、官方SDK、旧模型及其离线测试保留，不再由生产入口执行或打包公开分发；详见新指南的构建边界。
The old Live2D guides, source, official SDK, models and offline tests remain historical, outside active execution and public distribution. See the new build boundary.

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
| `shared/character-assignment.js` | 落座角色分配、占座稳定映射与旧局兼容。 / Seating-time roles, stable occupancy and legacy-game mappings. |
| `server/api.js` | HTTP 路由、身份与原子提交，调用模式适配器。 / Routing, identity and CAS through mode adapters. |
| `server/game-engines.js` | 按模式与版本选引擎，隔离动作/配置/隐私/展示能力。 / Mode/version registry and action/config/privacy/pacing adapters. |
| `server/flower-visibility.js` | 花麻将既有事件与观战公开投影。 / Existing Flower event/spectator projections. |
| `shared/game-modes.js` | 模式名称、牌种集合与缺字段兼容。 / Mode definitions, tile sets and missing-field compatibility. |
| `shared/tile-sets.js` | 花麻将18种、成都27种身份目录，不含副数或规则。 / Eighteen/27 identity catalogs, without copy budgets or rules. |
| `shared/chengdu-options.js` | 已确认成都选项的独立校验，尚未开放开局。 / Confirmed Chengdu options; game creation remains disabled. |
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

## 七角色扩展维护入口 / Seven-character maintenance entry

[七角色与三/四座位](SEVEN-CHARACTERS.md) 解释角色池、固定座位与旧局映射。第八个语音制作脚本为 `scripts/voices/extend_characters.py`：生成四套原创成年声线，隔离审计后合并清单，不覆盖旧72条声音。新增夹具 `tests/fixtures/original-voice-hashes.json` 固定记录基线公开音频指纹。
[Seven characters, three/four seats](SEVEN-CHARACTERS.md) separates the roster, fixed seats and legacy mapping. The eighth authoring script, `scripts/voices/extend_characters.py`, generates four original adult voices and merges isolated audits without replacing the original 72 files. The added fixture stores public baseline-audio fingerprints.

## 可变牌桌维护入口 / Variable-table maintenance

[可变人数与副数](VARIABLE-TABLES.md) 是3/4人、1–5副、神龙门槛及新计分快照的当前说明，替代本指南早期固定三人/144张/八张上限的默认描述。新增维护测试为 `tests/variable-table.test.js`、`tests/fixtures/variable-table.js` 和 `tests/variable-room-api.test.js`；UI专项并入原测试。旧局和schema1/2不改。
[Variable tables](VARIABLE-TABLES.md) documents snapshot-driven dimensions and scoring, superseding earlier fixed-three/144/eight-copy defaults here. The listed new maintained tests join existing UI coverage; old games and frozen engines remain unchanged.

- `server/spectators.js`、`shared/event-names.js`、`tests/spectators.test.js` 与 [观战和名字动态](SPECTATING-AND-NAMED-LOGS.md)：独立只读观战权限、公开投影与按局参与者名字。 / Independent spectator capabilities, public projections and per-game participant names.

## 角色、变人数与观战联合验收 / Combined feature verification

[联合验收报告](FEATURE-INTEGRATION-VALIDATION.md) 记录三/四人玩家和观众的集成边界、真实浏览器与全量检查结果。新增联合场景位于现有 `tests/spectators.test.js`、`tests/ui.test.js`，未弱化媒体资产门槛。
The integration report records player/viewer boundaries, real-browser coverage and aggregate checks. Combined cases extend the existing spectator/UI suites without relaxing media contracts.

本轮角色分支验收记录为 [SEVEN-CHARACTERS-QA.md](SEVEN-CHARACTERS-QA.md)，分别列出自动检查通过项、语音试听边界和当时真实浏览器未完成项；最新联合结果以上方整合报告为准。
The character-branch verification record retains its automated passes, listening limits and then-uncompleted browser checks; the integration report above holds the latest combined result.

- [建房参数统一验收](ROOM-SETTINGS-VALIDATION.md)：创建快照与旧房兼容、统一面板、自动测试和真实浏览器验收记录。 / Creation snapshots, legacy compatibility, unified form and automated/real-browser evidence.

## 模式分发维护入口 / Mode dispatch maintenance

[麻将模式与版本边界](GAME-MODES.md) 解释独立模式、适配合同、18/27牌种、成都未开放范围和验证结果。新增维护测试为 `tests/game-modes.test.js`、`tests/game-mode-api.test.js`。
[Mode/version boundaries](GAME-MODES.md) covers adapters, tile catalogs, disabled Chengdu scope and verification. Both new suites join the maintained test inventory.

## 成都准备层维护入口 / Chengdu preparation maintenance

新增 `shared/chengdu-contract.js`、`shared/chengdu-hand.js`、`shared/chengdu-game.js` 和 `tests/chengdu-engine.test.js`，详见 [成都引擎准备层](CHENGDU-ENGINE-FOUNDATION.md)。它们只实现隔离准备阶段、结构牌型与计分数学，正式开局和结算仍阻断；原花麻将源码与注册表不改。
New contract, shape, preparation and test modules are documented in [the Chengdu preparation guide](CHENGDU-ENGINE-FOUNDATION.md). They implement isolated preparation, structural shapes and arithmetic only; production start/settlement remain blocked, with Flower and the registry unchanged.
## 万牌资产维护入口 / Wan asset maintenance entry

`src/mahjong-wan-faces.js` 与 `tests/wan-assets.test.js` 定义并验证用户原图、万牌18–26和SVG等比视窗；`scripts/voices/extend_wan_calls.py` 复用七角色来源追加63条万牌语音。显示接入与规则属于调用者，资产脚本不改游戏生命周期。见 [万牌素材说明](WAN-ASSETS.md)。
The atlas module/test preserve source bytes and define wan identities18–26/proportional viewports. The offline script adds63 calls using existing personas. Rendering integration and rules belong to callers, not asset tools. See [wan assets](WAN-ASSETS.md).


## 万牌展示集成维护入口 / Wan presentation integration

`src/mahjong-tile-presentation.js` 是图片、读屏名称和报牌键的只读共同目录。`MahjongTile.vue` 与 `character-audio.js` 共用它，规则引擎不依赖展示；原条筒图集保持独立。新增 `tests/tile-presentation.test.js` 验证严格编号、不可变记录和模式闸门；UI与声音场景扩展原测试。详见 [集成验收](CHENGDU-INTEGRATION-VALIDATION.md)。
The read-only presentation catalog joins art, accessible labels and voice keys for the tile component and audio, without engine dependencies on presentation. The new suite checks strict identities, immutable records and mode gates; existing UI/audio suites gain integration cases. See [validation](CHENGDU-INTEGRATION-VALIDATION.md).


隔离万牌浏览器维护文件为 `tests/browser/wan-preview.html`、`wan-preview.js`、`wan-preview-narrow.html` 和 `wan-preview-server.mjs`。只编译真实组件/CSS/媒体，显式不加载主API或FileStore；复现方式见 `tests/browser/README.md`。它们不能进入部署。
The four isolated wan-preview files compile actual components/CSS/media without the main API or FileStore. See the browser README for reproduction. Never deploy these helpers.

## 成都开房准备 / Chengdu room preparation

新增维护文件 `shared/chengdu-room-settings.js` 与 `tests/chengdu-room.test.js`；App使用共用严格校验，模式注册器只开放空房间，仍无可运行成都版本。前端/API/可及性及验证范围见 [成都开房与房间准备](CHENGDU-ROOM-PREPARATION.md)。
New maintained settings/test files compose strict validation for App and a game-less room registration, with no runnable Chengdu version. See the dedicated guide for UI/API/accessibility and verification boundaries.


## 成都回合与计分维护入口 / Chengdu turn/scoring maintenance

新增 `shared/chengdu-scoring.js`、`shared/chengdu-play-policy.js`、`shared/chengdu-settlement.js`、`shared/chengdu-play.js` 与 `tests/chengdu-scoring.test.js`、`tests/chengdu-play.test.js`。阅读 [当前成都开发引擎](CHENGDU-ENGINE.md)，不要把旧准备层的历史未决项当作最新规则。正式HTTP和UI仍未开放。
New scoring, policy, settlement and runtime modules plus scoring/play test suites are documented in [the current Chengdu guide](CHENGDU-ENGINE.md). Older preparation-stage gaps are historical; production HTTP/UI remain disabled.

## 成都正式界面维护入口 / Chengdu production UI maintenance

新增维护文件`src/ChengduTable.vue`、`tests/chengdu-ui.test.js`和[界面导读](CHENGDU-PLAY-INTERFACE.md)。本地正式集成替代上文历史准备版的“UI未开放”状态；是否已发布只看发布记录，不由源码功能推断。
New maintained component/test/guide implement local production integration and supersede historical preparation-only UI statements above. Source availability is not evidence of deployment.

## 成都正式纯入口 / Production Chengdu pure entry

新增维护文件 `shared/chengdu-engine.js`、`shared/chengdu-production-contract.js`、`tests/chengdu-production.test.js`。正式schema 2和原型schema 1严格区分；先读[成都引擎](CHENGDU-ENGINE.md)的正式接口，再读固定快照、工厂、共享准备与回合。该分支不改注册/API/UI。
New maintained production-entry, snapshot-contract and production-test files separate production schema two from draft schema one. Read the production contract, factory, shared preparation and turns in order. Registration/API/UI are outside this branch.

成都公开动态共用维护文件`src/chengdu-event-text.js`，按本局名册格式化即时桌面及个人历史；测试在成都UI和原UI套件。 / The maintained Chengdu event formatter uses per-round names for live/public history, covered by both UI suites.

[成都正式整合验收](CHENGDU-PLAY-VALIDATION.md)记录最终本地生命周期、1168项检查、独立审查及未执行浏览器/发布边界。 / Final production integration validation records lifecycle checks,1168 tests, independent review and browser/deployment limits.

## 立绘反应维护清单 / Portrait-reaction inventory

新增自维护 `src/character-portraits.js`、`tests/character-portraits.test.js` 与用户原图来源 `public/characters/portrait-reactions-manifest.json`；沿 `App.presentWins → CharacterPortraitReactions → characterForPlayer` 阅读。双模式、隐私、三响、取消及资产说明见 [立绘指南](CHARACTER-PORTRAIT-REACTIONS.md)。
New maintained files cover the portrait catalog/controller, focused tests and supplied-image provenance. Follow the App presentation path and the dedicated guide for mode/privacy/triple-win/cancellation contracts.

当前布局与落座角色验收见 [落座身份与立绘验收](CHARACTER-SEATING-VALIDATION.md)；原满框场景记录保留在 [历史场景验收](CHARACTER-SCENE-VALIDATION.md)。新增 `tests/browser/portrait-preview-server.mjs` 和 `portrait-preview-narrow.html` 仅用于隔离内存牌桌/390px实看，不部署、不访问生产资料。
See the current seating/portrait validation; the older scene report is historical. The two portrait-preview browser files serve isolated in-memory and 390px QA only, never production data or deployment.

`tests/portrait-layout.test.js` 遍历真实Vue模板AST验证花麻将/成都手牌位于同一桌面、独立主角位于手牌之后与私有守卫；不复制界面、不运行生产请求。
The portrait-layout suite inspects the real Vue template AST for both modes' shared-table ancestry, a separate portrait after the hand and private guards, without duplicating UI or making production requests.

- [落座身份与立绘验收](CHARACTER-SEATING-VALIDATION.md)：独立本人立绘、加高对手展示，以及落座/开局/续局角色稳定的联合回归。 / Separate self art, taller opponent portraits and stable roles across seating/start/next rounds.

[多帧原图动画验收](PORTRAIT-MULTIFRAME-VALIDATION.md)记录当前五眼态、连续局部发丝、实际浏览器证据和短发限制。 / Current five-shape eyes, continuous original-texture hair, real-browser evidence and short-hair limits.
