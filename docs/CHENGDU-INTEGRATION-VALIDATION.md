# 成都基础与万牌集成验收 / Chengdu foundation and wan integration

**当前本地状态 / Current local status:** 成都正式schema2、独立引擎、HTTP生命周期和专用牌桌已整合；本文其余准备版/媒体阶段描述保留历史时点。最新行为与测试见 [成都牌桌界面](CHENGDU-PLAY-INTERFACE.md)、[房间后端](CHENGDU-ROOM-BACKEND.md)及 [正式集成验收](CHENGDU-PLAY-VALIDATION.md)。这不代表已发布。
Production Chengdu schema2, independent engine, HTTP lifecycle and UI are now locally integrated. Earlier preparation/media-only statements below are historical. Follow the linked current guides/validation; local integration does not imply deployment.


日期：2026-11-07。分支：`feature/chengdu-foundation-integrated`。仅本地集成，未推送、合并或部署。
Date: 2026-11-07. Branch: `feature/chengdu-foundation-integrated`. Local integration only, without pushing, merging or deploying.

## 输入与交付边界 / Inputs and scope

- 模式基础 `534f6a7` 与成都准备引擎 `b27f922` 原样保留。 / Preserve the mode foundation and preparation engine unchanged.
- 万牌图集/工具 `c2e7bb9` 与七角色63条万牌声音 `319e592` 分别整合为 `367275d`、`cf0f2d0`。冲突仅为文档尾部追加，保留双方内容。 / Integrate both asset commits under the listed local commit IDs; retain both sides of documentation-only append conflicts.
- 新 `src/mahjong-tile-presentation.js` 统一不可变图片、读屏标签和声音键，实际 `MahjongTile.vue` 与 `character-audio.js` 共用。编号0–17沿用原图、裁切和声音路径；18–26映射一至九万。 / The new immutable media catalog joins actual component/audio consumers; existing identities retain source/crops/paths and 18–26 map to wan one through nine.
- 每个模式的牌种/合法动作仍由服务端决定，展示目录不授权任何玩法。成都HTTP仍返回 `GAME_MODE_UNAVAILABLE`；正式 `createGame`、`settleGame` 仍抛 `CHENGDU_RULES_PENDING`。开发准备层仍停在 `rulesPending`。 / Server mode adapters still authorize identities/actions. Chengdu HTTP/production start/settlement fail closed and development preparation still stops at rulesPending.
- 没有采用未确认的番型、付款、查叫、退杠、胡牌可见性或换牌轮回默认；没有新增成都建房入口或完整可玩的成都桌。 / No invented defaults for fan, payers, exhaustion checks/refunds, win visibility or exchange cycling; no playable Chengdu entry.

## 兼容与隐私 / Compatibility and privacy

相对建房设置基线 `abd50f1`，178个既有public非manifest文件全部逐字节一致；其中164条旧MP3及原clip元数据由资产测试额外检查。原条筒PNG、角色图、历史资产不删、不覆盖。所有旧声音路径不变，227个存储MP3包括新增63个及三个保留旧胡声。
All 178 existing non-manifest public files match the room-settings baseline byte for byte. Asset tests additionally preserve all 164 old MP3s and their clip metadata. Original artwork/portraits/historical assets remain unchanged, with 227 stored MP3s including 63 new calls and three retained legacy hu calls.

三个花麻将引擎、App、生产CSS和原图定位模块与该基线完全相同。模式与成都准备源码相对 `b27f922` 没有改动。万牌背面不解析或输出原图，title与读屏仅为“背面牌”；非法/空牌显示空白。声音只针对公开已提交弃牌，不播报摸牌、换出/换入或未公开定缺；沿用原队列、静音、取消与重连游标。
All three Flower engines, App, production CSS and original crop module match that baseline. Mode/preparation sources are unchanged from b27f922. Wan backs resolve/output no atlas and expose only the back label; invalid/empty identities stay blank. Audio voices only committed public discards through existing queue/mute/cancellation/reconnect behavior, never private preparation or draws.

## 自动检查 / Automated checks

- `npm test`：1034/1034通过，0失败、0跳过（原准备层1021 + 素材4 + 集成9）。 / All 1034 tests pass, with no failures or skips.
- 新目录测试3项：27牌映射/不可变性、严格非法输入、加载媒体后模式/动作闸门不放宽。 / Three catalog cases cover mappings/immutability, invalid inputs and unchanged mode/action gates.
- 新真实编译组件测试3项：九万的两种尺寸与按钮语义、背面/非法值无泄漏、全部18种原牌裁切/标签保留。 / Three compiled-component cases cover both wan sizes/button semantics, concealment/invalid inputs and all old crops/labels.
- 新音频测试3项：七角色×四座×27牌映射、准备/非法事件静音、现场与重连去重。 / Three audio cases cover persona/seat/identity routing, silent invalid/private events and reconnect deduplication.
- `npm run lint`：0错误、4个既有警告；仍有已有Next pages目录提示。 / Zero errors and four existing warnings, plus the existing Next pages advisory.
- `npm run build`：Vue与Worker构建通过，客户端JS为 `index-DaifV3kC.js`。 / Vue/Worker build passes with the listed client bundle.
- 构建后核对两个PNG、全部227个MP3以及manifest与源文件逐字节相同。 / Both atlases, all 227 MP3s and the manifest match their source files in the build.
- `git diff --check` 通过。 / Whitespace validation passes.
- `node tests/performance/benchmark-presentation.mjs b27f922` 完成6轮内存Vue渲染。装载器同步新媒体依赖，并补齐原来缺失的共享播放依赖与select选项替身。这只验证基准可运行；App没有变化、两侧共用当前牌组件，不据此宣称真实浏览器性能改善。 / Six rounds of in-memory Vue rendering complete after updating media/shared-playback dependencies and the select mock. This is harness execution evidence, not an old-versus-new tile-performance comparison or browser speedup.

首次全量检查发现邀请测试装载器和旧图片源码断言仍绑定旧组件导入，已修正并重跑全部1034项；没有跳过失败测试或降低旧资产哈希要求。
The first full run found stale component imports in the invitation harness and old atlas source assertions. Both were updated and all 1034 cases rerun, without skipped failures or relaxed asset hashes.

## 隔离浏览器验收 / Isolated browser acceptance

专用四个 `tests/browser/wan-preview*` 文件只编译真实MahjongTile、声音映射和原生产CSS；显式不读取主Vite配置、不导入App/API/FileStore，不连接线上房间，不伪造成都游戏状态。它们不进入生产构建。通过官方浏览器及原生终端启动的本地服务检查。
Four dedicated preview files compile the actual tile component/audio mapping/production CSS while explicitly excluding the main Vite config, App, APIs and FileStore. They neither touch live rooms nor fabricate Chengdu games, and are not production-build entries. The local server is inspected through the official browser/native terminal.

已验证桌面与390px独立iframe视口，九张万牌完整可见。普通牌47×64，小牌河桌面25×35、窄屏24×34；两张背面只暴露“背面牌”标签，没有image或牌种文字。iframe触发真实CSS断点，但不是手机设备验收，也不是完整成都牌桌。
Desktop and independent 390px iframe views show all nine wan faces. Regular tiles measure 47×64; river tiles measure 25×35 on desktop and 24×34 narrow. Both backs expose only the back label without images or identity text. The iframe exercises real responsive rules, not a physical phone or complete Chengdu table.

七角色共63条真实万牌MP3均自然触发ended，解码/播放时长0.56–3.44秒；没有媒体错误或超时。这是浏览器真实媒体完成验证，不是扬声器录音或主观音色/声调认证。自建Vite已在原生Terminal中Ctrl+C停止并确认回到shell。
All 63 real wan MP3s across seven personas naturally reached ended, with durations of 0.56–3.44 seconds and no errors/timeouts. This verifies browser media completion, not speaker recording or subjective voice/tone quality. The native-terminal Vite process was stopped with Ctrl+C and its shell prompt verified.

本次工作区保留 `wan-preview-desktop.jpg`、`wan-preview-narrow.jpg`、`wan-preview-audio-complete.jpg`，以及 `wan-preview-visual.json`、`wan-preview-audio.json`、`wan-preview-report.json`，不提交到源码。
The workspace retains the three screenshots and three JSON evidence files listed above, outside committed source.

## 明确未覆盖 / Explicit limits

没有成都完整碰杠胡、流局结算、真实多人联机、物理手机/多设备、扬声器录音或人工主观音色/声调认证。没有运行全项目TypeScript检查（仓库已有平台模板类型问题），也没有执行数据库迁移、生产请求或发布。已通过的基础/媒体检查不能表述为成都完整上线验收。
No complete Chengdu turn/settlement, live multiplayer, physical-device, speaker-recording or subjective persona/tone certification is claimed. No full-project TypeScript check, migrations, production requests or publication ran. Foundation/media passes are not full Chengdu launch acceptance.
