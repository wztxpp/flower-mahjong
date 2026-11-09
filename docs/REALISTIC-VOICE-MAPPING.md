# 人物与声线独立映射 / Separate character and voice identities

2026-11-09：本次只纠正人物与既有声线的搭配，不重新生成、覆盖或改名任何PNG/MP3。基础版本为 `aec932b`。
This change only recasts existing recordings for the characters; no PNG/MP3 is regenerated, overwritten or renamed. Baseline: `aec932b`.

## 依据与试听边界 / Evidence and listening boundary

正式原画 `sweet-scene-base.png` 是粉色开衫、棕短发邻家人物，来源为 `01-pink-neighbor-normal.png`；`sunny-scene-base.png` 是黄色双马尾萌系人物，来源为 `02-yellow-girl-normal.png`。已查看原图，两组三态PNG及各33条MP3均匹配原始清单SHA-256，没有文件互换或改名证据。
The supplied sweet scene depicts the pink-cardigan, brown-bob neighbor; sunny depicts the yellow twin-tail cute persona. Their source names are recorded above. Actual images were inspected, and both sets of three PNGs and 33 MP3s each matched provenance hashes; the files were not swapped or renamed.

旧声线来源把 `sweet` 标为甜萌萝莉音、`sunny` 标为开朗阳光少女音。按正式原画设定重新配对：小桃 `id:sweet → voiceId:sunny`，晴禾 `id:sunny → voiceId:sweet`；其余五角同名映射。选择器声线说明随voiceId调整。
The original voice provenance labels sweet as a cute/light voice and sunny as a bright/energetic voice. Matching those directions to the supplied art gives sweet-character → sunny-voice and sunny-character → sweet-voice; the other five retain same-name mappings. Displayed voice-style labels follow the assigned voice.

**这是按人物设定和原始生成方向作出的推断，不是实际听感认证。** 当前工具不支持音频输入，无法完成同句主观试听；来源清单中的 `subjectiveListeningCompleted:false` 原样保留。ASR、哈希或音高不能证明音色表演适合人物，也不能保证每个声调正确。
**This is a persona/direction inference, not a listening certification.** The available tools could not accept audio for subjective same-line comparison; the original `subjectiveListeningCompleted:false` remains unchanged. ASR, hashes and pitch do not certify performance, persona suitability or pronunciation.

## 实现与兼容 / Implementation and compatibility

- `src/character-audio.js` 的 `CHARACTERS[].id` 仍用于人物、名字、立绘、绝对座位和存档；新增本地 `voiceId` 只选择 `/voices/<voiceId>/<call>.mp3`。
  Character IDs continue to own names, portraits, absolute seats and saved assignments; the local voiceId only selects the recording directory.
- `clipForEvent` 先按服务端人物ID/旧局绝对座位回退解析人物，再读取voiceId。普通弃牌、条筒万、碰杠及三种胡法共用此入口；`warmWins` 通过同一入口预热。
  Event resolution chooses the character before its voice. All suits, peng/kongs and win types share the path, including win preloading.
- 不修改角色分配、存档数组、API、原始来源清单、播报游标或队列。更新后的客户端对旧局保留原人物，仅改其后续新事件使用的声线；首次读取和重连仍不重播历史。已有旧客户端在刷新代码前仍使用旧搭配。
  Assignment, saved arrays, APIs, original provenance, cursors and queues remain unchanged. Updated clients keep legacy characters and only recast subsequent fresh events; initial loads/reconnects do not replay history. Older loaded clients retain their prior mapping until refreshed.
- `sunny` 的兼容记录仍可解析，不因为新选择器隐藏该人物而删除旧人物或录音。
  Legacy sunny assignments remain resolvable even when the new selector hides that character; no old character or recording is deleted.

## 维护与验证 / Maintenance and verification

维护文件：`src/character-audio.js`、`tests/character-audio.test.js`、`tests/voice-assets.test.js`、`tests/ui.test.js` 及本文。测试覆盖明确交叉配对、三/四人所有座位与三种花色、旧局回退、不可变存档、预热一致性、来源哈希及既有播放生命周期；合成音频上下文测试不是主观试听。
The maintained files are the audio module, its audio/assets/UI tests and this guide. Tests cover explicit crossing, all seats/suits, legacy fallback, immutable assignments, matching preload paths, provenance hashes and existing playback lifecycles. Synthetic audio tests are not subjective listening.

本模块专项执行 `node --test tests/character-audio.test.js tests/voice-assets.test.js tests/character-portraits.test.js tests/ordered-audio.test.js`：68/68通过；覆盖全部227条源音频的既有哈希/来源检查。`npm run lint` 为0错误、3条既有warning；最终全量测试、构建和浏览器集成结果由主任务另行记录，不能用此模块专项代替。
The focused command above passed 68/68, including existing provenance/hash checks for all 227 source recordings. Lint reported zero errors and three pre-existing warnings. Final full-suite/build/browser integration is recorded by the integration task; focused checks do not replace it.
