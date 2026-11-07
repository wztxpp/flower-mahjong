# 万牌显示与语音 / Wan artwork and voices

## 原图与显示边界 / Original artwork and display contract

`public/assets/tiles/mahjong-wan-faces-20261107.png` 是用户提供的571×109原图，字节原样保留。`src/mahjong-wan-faces.js` 只声明九个3:4矩形及到60×80视窗的等比变换，不重画汉字，不把原图左边的“万牌”标签放入牌面。
The 571×109 PNG retains the user's original bytes. The module declares nine 3:4 crop rectangles and proportional transforms into a 60×80 viewport, without redrawing glyphs or including the left-side label.

万牌编号18–26对应一至九万。0–17仍完全属于原条/筒图集；新模块对这些编号、null、字符串和非法值返回null。客户端选中万牌后应使用新模块的URL、宽高和变换，而不是把所有27牌种强塞进旧PNG。读屏名称应为对应数字＋“万”，背面仍不暴露牌种。
Wan IDs18–26 map one through nine. Existing IDs0–17 remain in the original atlas. The new module returns null for old IDs, null, strings and invalid inputs. The renderer must choose the new URL/dimensions/transform for wan and retain concealed-face accessibility.

`tests/wan-assets.test.js` 验证原图哈希、PNG尺寸、矩形数量/边界/比例及编号范围。原图已实际查看；像素坐标以原图为准。最终整合还必须在实际牌桌确认窄屏、牌河和手牌的裁切可见性。
The tests verify source hash, PNG size, rectangle count/bounds/aspect and ID range. The source pixels were inspected. Integrated table QA must still inspect crops in narrow screens, rivers and hands.

## 语音制作边界 / Voice production contract

`extend_wan_calls.py` 仅追加 `wan-1` 至 `wan-9`。使用已有固定版本Qwen模型进行本地CPU推理，不上传声音、不使用付费服务、不采集或模仿真人。前提是七角色164文件基线；生成和审计都会核对旧MP3哈希及原有clip元数据。
The extension adds only wan-1 through wan-9 using pinned Qwen models locally on CPU, without uploading voices, paid services, or real-person samples/imitation. It requires the seven-character164-file baseline and verifies old MP3 bytes and clip metadata before generation/auditing.

若指定的原始参考WAV存在，必须匹配已发布角色的reference哈希与身份；不存在则沿用原自摸/放炮制作中“一条、二条、三条”恢复流程。每条新音频记录完整模型参数、种子、参考来源、WAV和MP3哈希。旧164条及其metadata不改。
An existing original reference must match the shipped character hash/identity; absent references use the established one/two/three-bamboo recovery flow. Each new clip records settings, seed, reference provenance and WAV/MP3 hashes. The164 original files and their metadata remain unchanged.

审计会检查63条可解码、有限采样、非静音、时长和削波，记录孤立词与无词汇提示的完整序列ASR；只有所有文件完整且来源一致才合并为224条当前语音、227个存储MP3（含三个旧胡）。自动ASR不是人工试听、声调或角色表演认证，所有原文与不确定项必须保留。
Audit checks all63 files for decoding, finite samples, non-silence, duration and clipping, retaining isolated ASR plus unprompted sequence ASR. Only complete/provenance-consistent results merge into224 active calls and227 stored MP3 files including three legacy hu. Automated ASR is not human listening, tone or persona certification; preserve raw transcripts and uncertainties.

## 本次完成记录 / Completed production record (2026-11-07)

- 七角色各九条全部完成：63个不同MP3，解码音频共83.92秒、1,070,388字节；清单224条当前语音、227个文件，旧胡三条仍保留。 / All63 distinct MP3 files completed, totaling83.92 decoded seconds and1,070,388 bytes;224 active calls and227 stored files, including three retained hu clips.
- 前三角色从自身已发布一条/二条/三条恢复参考；地主、老实人、富婆、女明星复用先前原创VoiceDesign参考，哈希与已发布清单一致。没有新增真人样本或重新设计角色。 / First three references recovered from their own shipped clips; the other four reused hash-matching original synthetic references, without real-person samples or persona redesign.
- 官方固定修订的17个Base/ASR模型文件在本地重新核验SHA256；新63条均通过解码、非静音、有限采样、时长、削波与唯一哈希检查。旧164文件、全部旧clip元数据、角色属性、legacy与旧扩展来源均未改变。 / Reverified17 pinned model files; all63 pass decoding/acoustic/uniqueness checks. All164 old files, clip metadata, persona properties and previous extension/legacy provenance are unchanged.
- 七套无目标词提示的九词序列ASR均完整识别一至九万。孤立词有36条字面差异，包含同音字、英文误识别和漏字，全部原文保留在 `docs/voice-wan-audit.json` 与清单不确定项。 / All seven unprompted sequence transcripts cover one through nine wan.36 isolated clips have literal ASR differences, including homophones, English hallucinations and omissions; raw results/uncertainties are retained.
- **没有人工主观试听**，不声称声调、音色一致性或表演品质完全认证。原图已查看并以像素边界检查九个裁切未截断红字或黑色数字；整合页面真实浏览器验收仍由调用方执行。 / **No human subjective listening**: tones, persona consistency and performance are not certified. Source pixels and ink bounds were checked; integrated browser QA remains the caller's responsibility.

本分支只提供资产与工具，不修改MahjongTile组件、运行时报牌分派或规则引擎，不推送、不部署。
This branch supplies assets/tooling only, without changing the tile component, runtime audio mapping or game engine, pushing, or deploying.

### 资产分支验证 / Asset-branch validation

- `npm test`：934/934通过，包括旧三/七角色哈希、63条万牌审计和九张原图边界。 /934 of934 passed.
- `npm run lint`：0错误、4个原有未使用变量警告。 /0 errors; four existing unused-variable warnings.
- `npm run build`：通过；构建后清单与源JSON完全一致，63条万牌MP3全部复制进发布目录。 /Passed; built/source manifests match and all63 files are present.
- Python编译、隔离基线破坏检查（旧音频和旧元数据被改必须拒绝）、ASR数字/繁体规范化检查通过。 /Python compilation plus isolated baseline-mutation and ASR normalization checks passed.
- 未进行整合后的UI、真实浏览器声音播放或人工主观试听，本报告只代表资产分支范围。 /Integrated UI/browser playback and human listening were not run; these results cover only the asset branch.


## 后续运行时集成 / Subsequent runtime integration

资产分支的“未接组件”仅描述当时范围。现由 `src/mahjong-tile-presentation.js` 接入真实MahjongTile与character-audio，逐一保留旧18牌映射、所有原图/旧MP3和原有元数据；万牌背面/非法值不泄漏牌面。正式成都仍没有注册，也没有新增可玩入口或采用未确认结算默认。最新验证见 [集成报告](CHENGDU-INTEGRATION-VALIDATION.md)。
The asset branch's unconnected-component statement describes its historical scope. The shared presentation module now connects MahjongTile/audio while preserving all 18 old mappings, original image/MP3 bytes and old metadata; hidden/invalid wan reveals no face. Chengdu remains unregistered without a playable entry or invented settlement defaults. See the latest integration report.
