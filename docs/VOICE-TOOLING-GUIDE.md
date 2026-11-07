# 语音制作代码导读 / Voice tooling reading guide

这些 Python 文件是离线资产制作工具，不参与浏览器每次报牌，也不参与服务器算分。阅读或修改注释不需要安装模型或重新生成音频。
These Python files author offline assets. They do not run for browser announcements or server scoring. Reading or editing comments requires neither model installation nor audio regeneration.

## 文件与阅读顺序 / Files and reading order

1. `scripts/voices/generate.py`：共享常量、哈希/JSON、波形检查、编码，然后参考声线与成品生成入口。 / Shared constants, hashes/JSON, waveform checks and encoding, followed by reference and final-clip generation.
2. `scripts/voices/audit.py`：成品解码、来源核对、孤立词识别、清单组装与旧文件保留。 / Final decoding, provenance verification, isolated-word recognition, manifest assembly and legacy preservation.
3. `scripts/voices/review_context.py`：把当前报牌顺序拼接，记录上下文转写与每段音频位置。 / Join current calls and record contextual transcripts with source positions.
4. `scripts/voices/generate_context_rescue.py` 与 `extract_context_rescue.py`：先产出候选载体句，再按已检查的边界裁剪目标词。 / Generate candidate carrier phrases, then crop the target at reviewed boundaries.
5. `scripts/voices/extend_win_calls.py`：历史自摸/放炮扩展，并提供从原有录音恢复参考的公共函数。 / Historical self-draw/discard-win extension and shared reference recovery from existing recordings.
6. `scripts/voices/extend_qianggang.py`：抢杠扩展，旧胡元数据转为兼容条目，保留音频字节。 / Rob-kong extension, moving old hu metadata into legacy entries while preserving audio bytes.
7. `scripts/voices/README.md`：安装、固定版本、操作示例与历史来源。 / Installation, pinned versions, operational examples and historical provenance.

以上七个基础自维护 Python 脚本加上文末新增的 `extend_characters.py`，共八个制作入口。依赖锁、模型、WAV、MP3、生成的 JSON 审计和清单不是手工注释目标。
The seven base Python scripts above plus extend_characters.py below form eight authoring entries. Dependency locks, models, WAV/MP3 assets and generated JSON audits/manifests are not manual annotation targets.

## 数据流与副作用 / Data flow and side effects

基础流程：本地 VoiceDesign 权重 + 原创角色提示 → 参考 WAV/JSON → 本地 Base 模型 + 参考音频/原文 → 每条 WAV/JSON → FFmpeg MP3 → 本地 ASR 审计 → 完整运行时清单。
Base flow: local VoiceDesign weights + original character prompt → reference WAV/JSON → local Base model + reference/transcript → per-call WAV/JSON → FFmpeg MP3 → local ASR audit → complete runtime manifest.

- `--model-root` / `--asr-model` 指向预先下载的本地模型；推理使用 `local_files_only=True`，不负责下载。 / These flags point to predownloaded local models; inference uses local-only loading and does not download weights.
- `--work-dir` 存参考、临时 WAV、生成元数据、缓存或迁移基线；不同流程默认值不同，不可混淆。 / Holds references, WAV intermediates, generation metadata, caches or migration baselines; defaults differ by workflow.
- `--output` 通常指向成品目录，但载体候选生成器的 output 是候选目录，裁剪器 output 是成品目录。 / Usually the final-asset directory, but carrier generation uses it for candidates, while extraction uses it for finals.
- `audit.py` 不是只读：写工作目录缓存、`docs/voice-audit.json`，齐全时还写成品目录 `manifest.json`。`--partial` 仅允许跳过缺失成品，不禁止完整时写清单。 / Audit writes cache and documentation reports plus the manifest when complete; partial mode permits missing clips, not a blanket prohibition on manifest writes.
- 扩展脚本的 audit 阶段写扩展报告和清单；`review_context.py` 写上下文报告；它们都不部署网站。 / Extension audits write reports/manifests; context review writes its report. None deploys the website.
- `write_json` 和 `encode` 在单文件级别先写临时文件再替换；多个文件不是一个事务，失败后应检查实际完成范围。 / JSON writing and encoding replace individual temporary files; multiple outputs are not transactional, so inspect partial completion after errors.

## 名称、顺序与来源 / Names, order and provenance

`style`/`voice` 是 `sweet`、`elegant`、`sunny` 资源角色键；`call` 是 `tiao-1`、`peng`、`qianggang` 等资源键；`text` 是要读的中文。已有资源键、JSON 字段和命令行参数都是边界，不因注释任务改名。Python 保留现有 snake_case，与 JavaScript 的 camelCase 分开理解。
`style`/`voice` identify asset characters; `call` identifies an asset such as tiao-1, peng or qianggang; `text` is spoken Chinese. Asset keys, JSON fields and CLI flags are compatibility boundaries. Existing Python snake_case is distinct from JavaScript camelCase.

`sr` 是每秒采样数；`wav`/`wave` 是采样数组，不是文件路径；`ref` 是参考文件，`prompt` 在合成流程中是声音提示对象，在 ASR 中则是文本提示。`digest` 是文件 SHA-256；`meta` 是旁边 JSON 的来源记录。
`sr` is samples per second; wav/wave are sample arrays, not paths. ref is a reference file. A synthesis prompt is a voice-conditioning object; an ASR prompt is text. digest is a file SHA-256; meta is its accompanying provenance record.

基础角色种子用于参考生成；基础成品加 1000 和总表索引；载体候选加 3000 和目标索引；自摸/放炮加 4000 和索引；抢杠加 5000。字典顺序会影响索引，因此不能把排序当无害格式化。固定种子帮助复现，不保证不同硬件/依赖的音频字节完全相同。模型修订字符串记录预期来源，不会自动校验本地目录的每份权重。
Reference generation uses character seeds. Base clips add 1000 plus full-list index, carriers 3000 plus target index, win calls 4000 plus index and rob-kong 5000. Dictionary order affects indexes; sorting is not harmless formatting. Seeds aid reproducibility, not cross-platform byte equality. Revision strings record expected provenance without verifying every local weight file.

## 缓存与重跑 / Cache and reruns

- 基础参考：文件与元数据存在，identity 与实际哈希匹配，且没有 `--force` 才复用。 / Reference reuse requires existing files/metadata, matching identity/hash and no force flag.
- 基础成品：还要求 WAV 存在、成品哈希与参考哈希匹配；不重新核对 WAV 哈希。identity 不含种子偏移、dtype 或全部生成模式。 / Clip reuse also requires WAV existence, final/reference hashes; WAV bytes are not revalidated. Identity omits seed offset, dtype and some modes.
- 扩展成品：文本、成品哈希、恢复参考哈希匹配即可复用；并非所有参数都参与缓存键。 / Extension reuse checks text, final hash and recovered-reference hash, not every parameter.
- 因此想换种子、精度或生成模式重新出音频，要明确 `--force`；只改参数可能继续复用旧成品。 / To regenerate with new seed, precision or mode, explicitly force it; changing flags alone may reuse old audio.
- 基础 ASR 缓存按成品哈希复用，更换识别模型或设置需 `--force-asr`。上下文脚本和扩展审计不使用这个逐条缓存。 / Base ASR reuse keys on final hashes; force ASR after model/settings changes. Context and extension audits do not use this per-call cache.
- 载体候选、裁剪和上下文报告没有安全跳过缓存，会覆盖其目标。 / Carrier generation, extraction and context reports have no skip/reuse cache and overwrite their targets.

## 波形、编码与裁剪 / Waveforms, encoding and cropping

`validate_wave` 检查一维有限采样、时长、峰值、均方根与削波比例。基础成品默认 0.2–6.5 秒，参考 3–24 秒，载体 0.6–10 秒。这些窗口用于发现异常，不证明汉字读得正确。
Validation checks one-dimensional finite samples, duration, peak, RMS and clipping fraction. Windows are 0.2–6.5 s for base clips, 3–24 s for references and 0.6–10 s for carriers. These detect anomalies, not correct pronunciation.

FFmpeg 使用 loudnorm 目标 -18 LUFS、-2 dBTP、LRA 7，输出单声道 24 kHz/96 kbps MP3。参数是目标，不是对实际响度的独立测量证明；随后完整解码只证明文件可解码。
FFmpeg targets -18 LUFS, -2 dBTP and LRA 7, producing mono 24 kHz/96 kbps MP3. These are normalization targets, not independently measured loudness guarantees; subsequent decoding checks readability only.

ASR 使用 16 kHz 输入；孤立词前后补 3200/8000 个零采样，即 0.2/0.5 秒；上下文每词后加 5600 个零采样，即 0.35 秒；恢复参考用 24 kHz 下 3600 个零采样，即 0.15 秒。
ASR uses 16 kHz: isolated calls receive 3200/8000 leading/trailing zero samples (0.2/0.5 s); context sequences use 5600 zeros after each call (0.35 s). Recovered references use 3600 zeros at 24 kHz (0.15 s).

裁剪器的 start/end 是秒，乘采样率后四舍五入转为 Python 半开切片。它检查边界合法与基本声学条件，不检测词边界，不验证载体 JSON 的哈希是否仍匹配实际 WAV。必须事先核对载体、目标词和静音边界；生成的参考身份检查也不能替代这一人工核对。
Crop start/end are seconds, rounded to sample indexes for a half-open Python slice. Extraction checks valid bounds and acoustic basics, not word boundaries or whether the recorded carrier hash still matches the WAV. Verify carrier, target words and silence boundaries first; reference identity checks do not replace that review.

## 旧版本与审计限制 / Legacy behavior and audit limits

原三角色每人23条可播放、1条旧胡，共69条可播放和72个MP3；四角色扩展另加92条，当前合计161条可播放、164个MP3。旧胡位于 `legacyClips`，不是当前胜利播报。自摸、放炮、抢杠各播对应词，不追加胡。资源迁移与玩法判断是不同层，不要在制作脚本里修改游戏规则。
The original three voices each retain 23 playable calls and one legacy hu, totaling 69 active calls and 72 files. Four additions contribute 92 calls, bringing the current pack to 161 active calls and 164 MP3 files. Legacy hu lives in legacyClips, outside current win announcements. Each win type plays its corresponding call without appended hu. Asset migration and game-rule evaluation are separate layers.

`extend_win_calls.py` 是历史迁移：其 23/69 数量断言及包含 hu 的上下文属于那次扩展，不是对任意后续清单都正确的通用迁移。`extend_qianggang.py` 另有 23 可播放/24 存储/总 72 的断言，并要求旧 hu 条目。重跑历史迁移前先确认基线，不要通过删除断言强行通过。
The win-call script is a historical migration: its 23/69 counts and hu context belong to that extension, not every later manifest. The rob-kong migration separately expects 23 playable/24 stored per voice, 72 overall and an existing hu entry. Check baselines before rerunning historical migrations; never remove assertions just to force success.

哈希唯一只排除相同字节，不能证明声音角色不同。ASR 会受同音字、短音节和提示词影响；字符串命中也可能漏掉多余词或错误声调。估算音高不是声音风格证明。自动化报告必须保留原始转写及限制，不能声称已经人工试听。不要使用 `python -O` 运行审计，它会关闭这些脚本的 assert 检查。
Unique hashes rule out duplicate bytes, not identical-sounding personas. ASR is affected by homophones, short syllables and prompts; text matches can miss extra speech or incorrect tones. Estimated pitch is not proof of style. Preserve raw transcripts and limitations; never claim human listening from automation alone. Do not audit with python -O, which disables assert checks.

## 安全维护 / Safe maintenance

不要上传模型权重、令牌、登录凭证、虚拟环境或中间参考 WAV；这些不属于网页交付物。仅使用可信本地来源 JSON，来源字段会参与路径和清单构造。下载、安装、生成、审计写入和部署是不同操作，阅读/注释授权不意味着可执行它们。
Never upload model weights, tokens, credentials, virtual environments or intermediate reference WAVs. Use trusted local provenance JSON because its fields feed paths and manifests. Downloading, installation, synthesis, audit writes and deployment are separate operations; readability work does not authorize them.

纯注释验证可通过 `ast.parse` 比较前后 AST，并用 `py_compile` 指定仓库外的 pyc 路径，不导入模型、不运行 main，也不生成媒体。本次脚本注释保留原始 docstring，避免改变 `argparse(description=__doc__)` 的 CLI 文案与语法树。
For comment-only verification, compare parsed ASTs and compile with an explicit out-of-repository pyc path, without importing models, running main or generating media. Script annotations preserve existing docstrings so argparse descriptions and ASTs remain unchanged.

## 四名新增角色 / Four additional characters

`extend_characters.py` 是第八个自维护Python入口：独立配置地主、老实人、富婆、女明星的成年原创声线，复用 `generate.py` 的生成行为；先保存旧72文件及清单基线，任何阶段前后验证哈希。新增音频在隔离目录执行逐条与上下文ASR，齐全且来源一致才合并清单，保留原角色全部来源和旧胡。工作目录必须与生成、审计一致，不得删除基线来掩盖旧音频变化。
The eighth maintained Python entry defines four independent adult voices and reuses generate.py. It saves the original 72-file/manifest baseline and validates hashes before and after each phase. It runs isolated per-clip and contextual ASR before merging a complete, provenance-verified manifest, retaining all original voice metadata and legacy hu. Share the same work directory across phases; never remove its baseline to conceal changes.

生成结果与审计未完成之前，不得把四角色制作配置当作已交付音频。人工试听仍是独立且未自动完成的工作。
Until generation and auditing finish, configuration is not delivered audio. Human listening remains a separate step that automation does not perform.

## 万牌增量入口 / Wan extension entry

第九个入口 `extend_wan_calls.py` 只追加七角色各九条万牌。完整参数/种子/参考/WAV哈希参与缓存核验；任何原164条变化都会停止，所有63条审计完成才写清单。详细来源、数量与自动ASR限制见 [万牌素材说明](WAN-ASSETS.md)。
The ninth authoring entry adds nine wan calls per persona. Cache validation includes complete settings/seed/reference/WAV hashes. Changed original files stop the process; only all63 audited clips permit manifest writes. See the asset contract and ASR limitations.
