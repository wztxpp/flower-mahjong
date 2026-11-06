# 可读性重构验收 / Readability refactor verification

## 独立基线 / Independent baseline

纯可读性阶段基于 GitHub main `69d4e52a028ee008a21ff0466c3a5eefecb57696`（v0.7.0），分支 `refactor/readability-chinese`。该阶段不改变规则，不包含随后单独开发的大单吊可配置喜钱和补杠时机修复。后续整合另列验证，不能把玩法修复说成注释本身。
The readability-only stage uses main 69d4e52 (v0.7.0). It does not include the separately developed configurable ready bonus or pung-timing correction. Integration must be verified separately; rule fixes are not presented as comment-only changes.

## 交付范围 / Scope

- 所有自维护 src/shared/server、业务 schema/config/build、26 个测试/夹具/性能/烟测文件、七个语音 Python 工具都有中英双语解释。 / All maintained runtime/domain/build/test/voice-authoring sources have bilingual explanations.
- 三代引擎统一私有助手名，保留导出 API、JSON 字段、存储键、错误/事件文本、执行顺序与兼容规则。前端仅少量局部名称和模板循环变量改为完整单词。 / Engines standardize private helper names while preserving contracts; frontend renames remain local.
- 根 AGENTS.md 设定每次必读，附风格、术语、架构/生命周期、前端、服务端、引擎、测试和语音阅读指南。 / AGENTS.md mandates the linked reading/style/lifecycle guides before future changes.
- 第三方/平台脚手架、锁文件、迁移、媒体、清单和历史审计保持原样，边界详见阅读入口。 / Upstream scaffolding, locks, migrations, media, manifests, and prior audits stay unchanged.

## 纯可读性阶段检查 / Readability-only checks

| 检查 / Check | 结果 / Result |
|---|---|
| 修改前 `npm test` | 571/571 通过。 / All passed. |
| 完成注释与排版后 `npm test` | 571/571 通过，无跳过。 / All passed, none skipped. |
| `npm run build` | Vue 前端与 Worker 构建通过。 / Browser and Worker build passed. |
| `npm run lint` | 0 错误，保留原 4 警告及 Next pages 提示。 / Zero errors, four existing warnings plus the Next pages advisory. |
| 三代引擎 AST | 逆映受控私有重命名后，与基线执行结构相等。 / Equivalent executable AST after reversing approved private renames. |
| 服务端、角色分配、schema、业务构建配置 AST | 与基线相等；仅位置、括号排版和注释归一化。 / Equivalent AST ignoring formatting metadata/comments. |
| 前端脚本与 Vue 生产 render AST | 除已核对局部名称外相等；模板显示语义保留。 / Equivalent modulo reviewed local aliases. |
| 两份 CSS | 选择器、声明值、媒体查询与规则顺序逐项相等。 / Exact selectors, values, parameters, and rule/declaration order. |
| 26 个测试文件 | 执行 AST 相等，标题/断言/正则/夹具不变。 / Equivalent AST, unchanged titles, assertions, regexes, and fixtures. |
| 七个 Python 文件 | `ast.dump` 相等，`py_compile` 全通过；没有运行生成或审计。 / Equal AST and successful compilation; synthesis/audits not executed. |
| 离线行为差分 | 三代共 48 个完整对局、5887 次动作，每步比较三家视图、合法动作和完整状态。 / 48 complete games, 5,887 actions, per-step state/actions/all-seat-view equality. |
| `git diff --check` | 通过。 / Passed. |

运行行为差分：
Run the differential replay:

```sh
node scripts/verify-readability.mjs 69d4e52a028ee008a21ff0466c3a5eefecb57696
```

## 没有冒充通过的项目 / Explicit limits

- 全项目 `tsc --noEmit` 仍报告 10 个既存平台模板错误：db/index.ts 的 DB 类型、worker/index.ts 缺 connector 模块及 Env/ImportMeta/参数类型。没有为消除警告去改平台模板。 / Full TypeScript checking retains ten existing scaffold errors; no template repair is hidden in this refactor.
- 未做新的真人浏览器视觉巡检；模板编译结果和 CSS 结构对比及现有 UI 测试通过，但不把这些说成真实设备验收。 / No new manual browser/device visual inspection; compiler/CSS equivalence and UI tests are distinct evidence.
- 没运行生产烟测；现有 smoke 脚本还带 `0.4.2` 的固定版本断言，不适合直接用于当前版本。 / No production smoke test; the existing script contains an obsolete fixed version expectation.
- 没重新生成音频/图像、迁移数据库、操作现存牌桌、推送或部署。 / No media generation, migrations, live-room changes, push, or deployment.

## 警告明细 / Existing warnings

`server/worker.js` 匿名默认导出；`shared/game.js` 的兼容参数 kongDiscard 与本地 wasRepeat 未使用；`tests/rob-kong.test.js` 的 passAll 未使用。为保持可执行结构，本阶段没有顺手删除这些项。
The existing warnings concern the Worker default export, unused compatibility/local engine variables, and an unused test helper. They were not silently removed as unrelated cleanup.

## 功能整合后的最终验收 / Final integration verification

本地整合以独立功能提交 `4d9641f8ef4dab519eae85292547954c3510d3a0` 为行为基线，它包含 `9192ab5` 的可配置喜钱和已确认的碰后出牌再补杠纠正。保留可审查的纯重构提交 `9da4b4ee63cdc4ff5e527172000439c1639e83da`。两部分历史独立保留，再合并，不覆盖任一工作分支。
Integration uses feature commit 4d9641f, including configurable ready points and the authorized pung-timing correction, as its behavior baseline. The separate readability commit 9da4b4e remains independently reviewable.

- **595/595 测试通过**，无失败/跳过；Vue 与 Worker 生产构建通过。 / All 595 tests pass with none skipped; browser and Worker production builds pass.
- **72 个完整对局、8378 次动作**：三代引擎每步状态、三家私有视图、合法动作和输入不变性均与功能基线一致，包含 0/最大喜钱、手动模式、方向与旧 false 策略。 / 72 complete games and 8,378 actions match the feature baseline, including views, legal actions, input immutability, zero/max bonus, manual mode, direction, and false-policy correction.
- **27 个测试/脚本执行 AST 完全一致**，新夹具和新测试全部有双语说明。 / All 27 test/script ASTs match the feature baseline; new cases and fixtures are explained bilingually.
- **引擎、API、开局校验、前端脚本/Vue render、CSS 结构相等**：仅已核对的内部变量名及非执行排版/注释不同。 / Runtime AST/render/CSS structures match modulo reviewed internal names and non-executable formatting/comments.
- **lint 0 错误、4 个原警告**；TypeScript 的十条诊断与功能基线逐字比较相同，仍不算 typecheck 通过。 / Lint has zero errors/four existing warnings; all ten TypeScript diagnostics exactly match the feature baseline, not a passing typecheck.
- 新导读的所有相对链接已核实，另做了身份/派生状态/归档时机/HTTP 错误码的独立文档复核。 / Relative guide links resolve; independent review checked identity, derived state, archive timing, and HTTP error semantics.

```sh
node scripts/verify-readability.mjs 4d9641f8ef4dab519eae85292547954c3510d3a0
```

**有意改变的功能**：喜钱在开局可配置为每家 0–100000，默认 50；碰后必须先真正出一张，之后正常窗口可补杠，不要求新摸到同牌。v0.7.0 false 的纠正不重写旧规则字段、手牌、历史或旧账，更老的允许/缺省策略仍保留。其余可读性改动不应改变功能。
**Intentional feature changes**: per-opponent ready points are configurable at start, and upgrades require completing the post-peng discard before later legal windows without a matching-new-draw requirement. The v0.7.0 false correction does not rewrite saved rules, tiles, history, or settled scores; older allow/missing timing remains intact. Other readability changes do not change behavior.

仍未执行真人浏览器视觉验收、生产烟测、推送或部署。源码已准备可审查，但本地验证不能替代远端发布与发布后的验收。
Manual browser/device visual acceptance, production smoke testing, push, and deployment remain unperformed. Local verification does not replace remote release verification.

差分脚本需要包含该基线提交的 Git 工作区；仅解压源码 ZIP 没有 `.git` 历史时，仍可运行 npm test/build，但无法执行跨提交对比。脚本只从本地 Git 读取基线，不会自动联网抓取。
The replay script requires a Git checkout containing the baseline commit. A source ZIP without .git can still run tests/build but cannot compare commits. The script reads local Git only and never fetches automatically.
