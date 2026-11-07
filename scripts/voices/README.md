# 本地生成麻将角色语音

此工具使用与《十二证词》相同的方法：Qwen3-TTS VoiceDesign 先设计三个原创声线，再由 0.6B Base 使用自行生成的参考录音保持声音一致。所有推理在本地 CPU 运行，不使用浏览器朗读、付费 API、真人声纹、云端计费语音服务或简单变调替代声线。

每个角色 23 条：一至九条、一至九筒、碰、杠、自摸、放炮、抢杠。总共 69 条当前可播放语音；另保留三条旧“胡”兼容文件，总计 72 个 MP3，输出至 `public/voices/{sweet,elegant,sunny}/`。模型权重、虚拟环境、WAV 中间文件不要加入网页仓库。

## 安装与下载

需要 Python 3.12、FFmpeg、约 10 GB 内存和可容纳模型/运行环境的磁盘空间。CPU 可以运行，但速度依赖机器。无需 GPU。

```bash
python3.12 -m venv /tmp/mahjong-tts-venv
source /tmp/mahjong-tts-venv/bin/activate
pip install --index-url https://download.pytorch.org/whl/cpu torch==2.8.0 torchaudio==2.8.0
pip install -r scripts/voices/requirements.txt
export HF_HOME=/tmp/mahjong-hf-cache
export HF_HUB_DISABLE_XET=1
python - <<'PY'
from huggingface_hub import snapshot_download
models = {
    'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign': '5ecdb67327fd37bb2e042aab12ff7391903235d3',
    'Qwen/Qwen3-TTS-12Hz-0.6B-Base': '5d83992436eae1d760afd27aff78a71d676296fc',
}
for model, revision in models.items():
    snapshot_download(model, revision=revision,
                      local_dir='/tmp/mahjong-models/' + model.split('/')[-1])
snapshot_download('Systran/faster-whisper-small',
                  local_dir='/tmp/mahjong-models/faster-whisper-small',
                  allow_patterns=['config.json', 'model.bin', 'tokenizer.json', 'vocabulary.txt'])
PY
```

`requirements-lock.txt` 记录首次生成环境实际版本，可用于审计或复现。CPU Torch 的 `+cpu` 包来自上面的 PyTorch 官方索引。

## 生成与检查

```bash
export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 OMP_NUM_THREADS=4
python scripts/voices/generate.py --model-root /tmp/mahjong-models --phase references
python scripts/voices/generate.py --model-root /tmp/mahjong-models --phase clips
python scripts/voices/audit.py --asr-model /tmp/mahjong-models/faster-whisper-small
```

默认中间文件路径 `/tmp/flower-mahjong-voices`。可用 `--work-dir` 指定其他目录，三个命令必须使用同一个目录。CPU 默认为 4 线程、bfloat16；如硬件不支持，可使用 `generate.py --dtype float32`，但会增加内存用量。工具仅载入已经下载的本地权重。

生成命令支持安全续跑：只有文字、声音方向、参考录音和文件哈希都匹配，才复用已有文件。对有问题的单条重生成：

```bash
python scripts/voices/generate.py --model-root /tmp/mahjong-models --phase clips \
  --voice sweet --call tiao-1 --seed-offset 100 --force
python scripts/voices/audit.py --asr-model /tmp/mahjong-models/faster-whisper-small
```

不要把换音调/变速当作不同角色。方向、参考录音种子、参考哈希、模型版本和各段 MP3 哈希会写入清单或审计文件。

## 验证边界

- MP3 为单声道 24 kHz、96 kbps，FFmpeg loudnorm 目标 -18 LUFS / -2 dBTP。
- 检查 69 个唯一文件、解码、时长、静音、削波与哈希。
- 本地 faster-whisper small 对成品 MP3 逐条转写。短音节可能被识别成同音字，需保留原始转写并复核，不得把识别器输出自动当成发音真值。
- 声音风格来自三组独立 VoiceDesign 提示词，而不是变调。
- 自动检查不等同于真人主观试听，不保证表演风格或每个声调完美。

## 来源

- [Qwen3-TTS 官方项目](https://github.com/QwenLM/Qwen3-TTS)
- [1.7B VoiceDesign](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign)
- [0.6B Base](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base)
- [《十二证词》已核实的原配音来源](https://github.com/wztxpp/twelve-alibis/blob/dc8c1cdb81eaa4d1c7a47dd4c3432c1177580723/docs/AUDIO-SOURCE.md)

## 本次载体句修复

`generate_context_rescue.py` 使用已有参考声音生成三句带语境的候选，不会改写成品。`extract_context_rescue.py` 仅按已检查的静音边界提取目标报牌；不得未经检查就把载体句整段当成报牌发布。

本次采用的载体及截取区间：

- sweet / hu：`麻将。胡！`，1.80–2.40 秒。
- sweet / gang：`麻将。杠！`，1.25–1.75 秒。
- sunny / tong-9：`麻将。九筒！`，1.65–2.72 秒。

完整来源与听音边界见 `docs/VOICE-SOURCE.md` 和 `docs/voice-rescue-audit.json`。`review_context.py --asr-model <本地模型目录>` 可重跑整套序列 ASR。修改任一音频后需重新做上下文检查，不能复用旧哈希对应的审查。

## 增量补充自摸／放炮

`extend_win_calls.py` 只生成并检查三角色的 `zimo.mp3`（自摸）与 `fangpao.mp3`（放炮），保留原有 63 条文件及清单来源。当前执行环境没有最初的参考 WAV，因此从各角色已有且哈希验证通过的“一条／二条／三条”成品重建参考。没有重新设计声音，没有使用真人样本，来源链与新参考哈希保存在 `docs/voice-win-audit.json`。

```bash
python scripts/voices/extend_win_calls.py --phase generate \
  --model-root /tmp/mahjong-models --work-dir /tmp/mahjong-win-voices
python scripts/voices/extend_win_calls.py --phase audit \
  --model-root /tmp/mahjong-models --work-dir /tmp/mahjong-win-voices
```

此增量流程只需既有固定修订的 0.6B Base 与本地 faster-whisper-small。审计会核对六条新音频的解码、静音、削波、独立哈希，保留逐条及上下文转写，并验证原有 63 个文件哈希不变。它不部署网站。六个文件内不包含额外词语。当前三种胡法的对应关系见下一节，已不再追加旧“胡”。

## 三种胡法分别报牌（抢杠扩展）

当前三个胜利语音是“自摸”“放炮”“抢杠”，每种只播对应的一条，不再追加通用“胡”。`extend_qianggang.py` 仅新增每个角色的 `qianggang.mp3`，沿用 `extend_win_calls.py` 的现有角色录音恢复参考方法。

```bash
python scripts/voices/extend_qianggang.py --phase generate \
  --model-root /tmp/mahjong-models --work-dir /tmp/mahjong-qianggang
python scripts/voices/extend_qianggang.py --phase audit \
  --model-root /tmp/mahjong-models --work-dir /tmp/mahjong-qianggang
```

清单的 `clips` 为每角色 23 条可播放语音，共 69 条。旧 `hu` 记录移到 `legacyClips`，对应三个 MP3 原样保留以兼容旧客户端，但不是当前报牌路径；磁盘共 72 个 MP3。新增三条的原文严格为“抢杠”，不附加“胡”。检查详情保存在 `docs/voice-qianggang-audit.json`。

## 双语代码导读 / Bilingual code reading

逐文件职责、数据流、缓存边界、历史迁移和安全检查见 [语音工具导读](../../docs/VOICE-TOOLING-GUIDE.md)。七个自维护 Python 文件均在模块入口、函数、关键分支及数据转换处提供中英对照注释；注释任务不需要运行推理。
See the [voice tooling guide](../../docs/VOICE-TOOLING-GUIDE.md) for responsibilities, data flow, cache limits, historical migrations and safety checks. All seven maintained Python files have bilingual annotations at module entry points, functions, important branches and transformations. Reading or annotating them does not require inference.

### English operational overview

The pack uses original fictional adult character directions with local Qwen3-TTS VoiceDesign references and Base-model cloning. It does not rely on browser speech, paid cloud speech, real-person samples or pitch shifting. Current delivery contains 69 playable calls plus three retained legacy hu MP3s. Keep model weights, credentials, environments and intermediate WAVs outside the website repository.

Installation examples above use Python 3.12, FFmpeg and official pinned dependencies/model revisions. CPU inference needs roughly 10 GB of RAM and sufficient disk space. Downloading is a separate preparation step; inference tools load local weights only. Run reference generation before clip generation, then audit. The three base-flow commands must share the same work directory. bfloat16 is the default; float32 is available in the base generator for hardware compatibility at greater memory cost.

MP3 output is mono 24 kHz/96 kbps, normalized toward -18 LUFS/-2 dBTP. Audits check decoding, duration, level, clipping and hashes, then retain raw local faster-whisper transcripts. ASR, estimated pitch and unique hashes do not certify pronunciation, persona consistency or human listening. Review the actual audio before publishing.

Carrier rescue first generates review-only phrases, then extracts a manually verified target at explicit bounds. Historical crop coordinates above apply only to the recordings that were reviewed, not new candidate audio. Recheck source hashes, words and boundaries before extraction. Incremental win-call tools recover character references from existing hash-verified generated clips when original reference WAVs are unavailable. They do not redesign characters or deploy the website.

### 重跑前注意 / Before rerunning

- 改种子、精度或生成模式时，使用 `--force`；缓存键没有包含所有参数。换识别模型/设置时用 `audit.py --force-asr`。 / Use force after changing synthesis seed, precision or modes because cache identity omits some parameters; force ASR after changing recognition models/settings.
- `audit` 并非只读，会写报告及满足条件时的清单；`--partial` 在文件齐全时仍可写清单。 / Audit writes reports and, when complete, manifests; partial mode can still write a complete manifest.
- 扩展脚本是带固定数量前提的历史迁移，尤其自摸/放炮扩展不可盲目套用到任意更新后的清单。 / Extension scripts are historical migrations with fixed count assumptions, especially the win-call extension; do not blindly apply them to newer manifests.
- 不使用 `python -O` 跑审计；它会关闭重要 assert。载体、裁剪、上下文报告会覆盖指定目标，不具备逐条复用缓存。 / Do not audit with python -O, which disables important assertions. Carrier generation, extraction and context reports overwrite targets without per-clip reuse caches.

## 四角色增量入口 / Four additional character voices

`extend_characters.py` 为地主 `landlord`、老实人 `honest`、富婆 `wealthy`、女明星 `star` 提供独立成年原创声音方向及种子。它复用已有固定修订的官方 VoiceDesign 与 Base，绝不将旧声音变调或复制成新角色。此入口只接受预先下载的本地模型，不负责安装、下载或发布。
The extension defines independent original adult directions and seeds, reuses the pinned official models, and never substitutes pitch-shifted or copied legacy voices. It requires prepared local weights and does not install, download or publish anything.

```bash
export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 OMP_NUM_THREADS=4
python scripts/voices/extend_characters.py --phase references \
  --model-root /workspace/shared/mahjong-models --work-dir /workspace/shared/mahjong-new-voices
python scripts/voices/extend_characters.py --phase clips \
  --model-root /workspace/shared/mahjong-models --work-dir /workspace/shared/mahjong-new-voices
python scripts/voices/extend_characters.py --phase audit \
  --asr-model /workspace/shared/mahjong-models/faster-whisper-small \
  --work-dir /workspace/shared/mahjong-new-voices
```

阶段开始/结束核对原72条文件哈希。审计先在工作目录隔离运行，全部92条解码、来源核对、逐条与上下文ASR完成后，才合并原清单；旧三角色元数据保留。新角色不生成旧 `hu`，每角色只有23条当前报牌。成功后预期161条当前报牌，加三条旧胡，共164个MP3。此处是流程说明，不是已生成或已试听证明；实际交付以资源、清单及审计报告为准。
Every phase checks the original 72 file hashes. Isolated auditing must complete for all 92 new calls before the manifest is merged, preserving old voice metadata. New voices have 23 current calls and no legacy hu. A successful final pack has 161 current calls and three legacy files, totaling 164 MP3s. These instructions describe the workflow, not proof of generation or listening; inspect the actual assets, manifest and reports.
