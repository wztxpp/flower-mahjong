#!/usr/bin/env python3
# 本地原创语音制作入口：先参考声线，再逐条报牌；会写音频及来源 JSON。
# Local original-voice authoring: references first, individual calls second; writes audio and provenance JSON.
# 不得上传模型权重、登录凭证或中间参考到网页仓库。 / Never upload weights, credentials or intermediate references to the web repository.
# 导读：docs/VOICE-TOOLING-GUIDE.md。 / Reading guide: docs/VOICE-TOOLING-GUIDE.md.
"""Generate original Mandarin mahjong voices locally with Qwen3-TTS.

Only local inference is used. Download official model weights before running.
Run --phase references, then --phase clips, then audit.py. Keep model weights
and intermediate WAVs outside the website/repository.
"""
from __future__ import annotations
import argparse
import datetime
import gc
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

# 从脚本位置定位仓库，不依赖运行命令时的当前目录。
# Resolve the repository from this script, independently of the shell working directory.
ROOT = Path(__file__).resolve().parents[2]
# 模型名与固定修订写入来源记录；本地目录仍须由操作者准备对应版本。
# Model IDs and pinned revisions describe provenance; operators must supply matching local files.
DESIGN_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
DESIGN_REVISION = "5ecdb67327fd37bb2e042aab12ff7391903235d3"
BASE_ID = "Qwen/Qwen3-TTS-12Hz-0.6B-Base"
BASE_REVISION = "5d83992436eae1d760afd27aff78a71d676296fc"
REFERENCE_TEXT = "准备好了吗？一条，二条，三筒，九筒。碰！杠！胡！这局真开心。"
# 三个角色各有原创提示词和基础随机种子，不通过变调伪装成不同声音。
# Each original character has a direction prompt and base seed, rather than pitch-shifted duplicates.
VOICES = {
    "sweet": {
        "label": "萝莉音",
        "seed": 671103,
        "direction": "原创虚构的成年女性二次元甜萌声线。音色高而轻盈，明亮清甜，带一点软糯的鼻腔共鸣，俏皮可爱，语调有灵动的小起伏。声音纤细但吐字清晰，微笑着轻快报麻将牌，句尾干净，不拖长音，不要念说明文字，不要婴儿含糊腔，不要气声耳语。",
    },
    "elegant": {
        "label": "御姐音",
        "seed": 671207,
        "direction": "原创虚构的三十岁成熟女性御姐声线。中低音区，温润醇厚，胸腔共鸣明显，轻微自然沙感，沉稳优雅而自信。像从容掌控牌局的女主角，字头利落，语速适中，短促干净地报麻将牌。不要甜腻，不要尖细，不要播音腔，不要耳语，不要念说明文字。",
    },
    "sunny": {
        "label": "阳光少女音",
        "seed": 671309,
        "direction": "原创虚构的二十岁年轻成年女性阳光少女声线。中高音明亮通透，开朗爽快，口腔共鸣饱满自然，声音清脆有活力。像爱运动、笑容灿烂的朋友，积极热情地报麻将牌，字头有精神，节奏轻快，声音张开而不喊叫。不要软糯撒娇，不要鼻音卖萌，不要低沉沙哑，不要念说明文字。",
    },
}
NUMBERS = "一二三四五六七八九"
# 字典顺序同时决定生成顺序和种子偏移；改顺序会影响后续重生成。
# Dictionary order determines generation order and seed offsets; reordering changes later regeneration.
ALL_CALLS = {**{f"tiao-{i}": f"{n}条" for i,n in enumerate(NUMBERS,1)},
         **{f"tong-{i}": f"{n}筒" for i,n in enumerate(NUMBERS,1)},
         "peng": "碰", "hu": "胡", "gang": "杠", "zimo": "自摸", "fangpao": "放炮", "qianggang": "抢杠"}
# 旧客户端仍可能读取 hu；默认生成排除它，但显式 --call hu 仍可选择。
# Older clients may read hu; default generation excludes it, while --call hu explicitly selects it.
LEGACY_CALLS = {"hu": "胡"}
CALLS = {key: text for key, text in ALL_CALLS.items() if key not in LEGACY_CALLS}


# 读取文件全部字节计算内容指纹；用于核对来源和缓存，不证明发音正确。
# Hash all file bytes to verify provenance/cache identity, not pronunciation.
def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


# 写临时 JSON 后替换目标，避免正常读取者看到半份文件；会覆盖已有目标。
# Write temporary JSON then replace the target to avoid partial reads; existing targets are overwritten.
def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)


# 构建缓存身份：角色、文本、方向及模型修订；不含种子偏移或所有生成选项。
# Build cache identity from voice/text/direction/revisions, not seed offset or every generation option.
def generation_identity(style, call=None):
    return {"voice": style, "direction": VOICES[style]["direction"],
            "referenceText": REFERENCE_TEXT, "designRevision": DESIGN_REVISION,
            "baseRevision": BASE_REVISION, "text": ALL_CALLS.get(call) if call else REFERENCE_TEXT}


# 只从本地目录载入 CPU 模型；torch 参数沿用现有调用签名，不在函数中使用。
# Load a CPU model from local files only; the torch argument preserves the existing unused parameter.
def load_model(path, torch, dtype):
    from qwen_tts import Qwen3TTSModel
    print(f"Loading {path}", flush=True)
    return Qwen3TTSModel.from_pretrained(str(path), device_map="cpu", dtype=dtype,
                                         attn_implementation="sdpa", local_files_only=True)


# 将采样数组转 float32 并检查单声道、有限数、时长、响度与削波；返回合格数组。
# Convert samples to float32 and check mono/finite values, duration, level and clipping; return valid samples.
def validate_wave(wav, sr, minimum=0.2, maximum=6.5):
    import numpy as np
    wav = np.asarray(wav, dtype=np.float32)
    duration = len(wav) / sr
    # 二维声道或 NaN/无穷值不能进入编码流程。
    # Reject multichannel arrays and NaN/infinity before encoding.
    if wav.ndim != 1 or not np.all(np.isfinite(wav)):
        raise RuntimeError("Invalid or non-mono waveform")
    # 时长窗口是异常检测，不是对每个汉字发音时长的硬性语言规则。
    # The duration window detects suspicious output, not a linguistic timing rule.
    if not minimum <= duration <= maximum:
        raise RuntimeError(f"Suspicious duration {duration:.3f}s")
    # 峰值和均方根分别检查瞬时音量与整体能量，排除极静音输出。
    # Peak and RMS check instantaneous level and overall energy to reject near-silence.
    if np.max(np.abs(wav)) < 0.01 or np.sqrt(np.mean(wav**2)) < 0.001:
        raise RuntimeError("Silent or extremely quiet waveform")
    # 超过千分之一采样贴近满幅会被视为削波风险。
    # More than one sample in a thousand near full scale signals clipping risk.
    if np.mean(np.abs(wav) >= 0.999) > 0.001:
        raise RuntimeError("Clipped waveform")
    return wav


# 由 WAV 生成临时 MP3，验证可解码再替换目标；FFmpeg 失败直接抛错。
# Encode WAV to temporary MP3, decode-check, then replace the target; FFmpeg errors propagate.
def encode(wav, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix(".tmp.mp3")
    # 响度归一化目标 -18 LUFS、峰值 -2 dBTP；输出 24 kHz 单声道、96 kbps。
    # Normalize toward -18 LUFS / -2 dBTP; output 24 kHz mono at 96 kbps.
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(wav),
                    "-af", "loudnorm=I=-18:TP=-2:LRA=7", "-ar", "24000", "-ac", "1",
                    "-c:a", "libmp3lame", "-b:a", "96k", str(temp)], check=True)
    # 完整解码丢弃结果，只检查编码文件可读；这不是人工试听。
    # Decode the full file and discard samples to test readability, not listening quality.
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(temp),
                    "-f", "null", "-"], check=True)
    temp.replace(target)


# 命令行入口：解析路径/阶段，再执行本地文件读取、推理或审计；失败向调用者传播。
# CLI entry: parse paths/phase, then read files, infer or audit locally; failures propagate.
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    # 模型目录只读；work-dir 存中间文件，output 存成品。phase 必须显式选择。
    # Model root is read-only; work-dir holds intermediates and output holds final clips. Phase is required.
    parser.add_argument("--model-root", type=Path, required=True)
    parser.add_argument("--work-dir", type=Path, default=Path("/tmp/flower-mahjong-voices"))
    parser.add_argument("--output", type=Path, default=ROOT / "public/voices")
    parser.add_argument("--phase", choices=["references", "clips"], required=True)
    parser.add_argument("--voice", choices=list(VOICES))
    parser.add_argument("--call", choices=list(ALL_CALLS), nargs="+")
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--dtype", choices=["bfloat16", "float32"], default="bfloat16")
    # 更改种子或模式时需 --force：缓存身份未覆盖这些选项。
    # Use --force when changing seed or modes: cache identity does not cover those options.
    parser.add_argument("--seed-offset", type=int, default=0)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--streaming-text", action="store_true", help="Use Qwen simulated streaming text mode")
    parser.add_argument("--neutral-actions", action="store_true", help="Use a full stop for action calls instead of an exclamation mark")
    args = parser.parse_args()
    # 重型依赖在解析参数后载入，因此 --help 不触发模型推理。
    # Load heavyweight dependencies after argument parsing, so --help does not run inference.
    import numpy as np
    import soundfile as sf
    import torch
    # 限制 CPU 并行度；bfloat16 更省内存，float32 可用于不支持的硬件。
    # Limit CPU parallelism; bfloat16 saves memory, while float32 accommodates unsupported hardware.
    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    dtype = getattr(torch, args.dtype)
    styles = [args.voice] if args.voice else list(VOICES)
    args.work_dir.mkdir(parents=True, exist_ok=True)
    model_name = DESIGN_ID if args.phase == "references" else BASE_ID
    model = load_model(args.model_root / model_name.split("/")[-1], torch, dtype)
    # 逐角色处理，同一模型复用；每个角色的参考与元数据路径相互隔离。
    # Process voices in order using one model; each voice has separate reference and metadata paths.
    for style in styles:
        ref_path = args.work_dir / f"{style}-reference.wav"
        ref_meta_path = args.work_dir / f"{style}-reference.json"
        # 参考阶段设计长句声线，不生成每张牌的成品。
        # The reference phase designs a longer voice sample, not final tile calls.
        if args.phase == "references":
            identity = generation_identity(style)
            # 只有文件与元数据都存在且未强制重做，才尝试复用。
            # Attempt reuse only when both audio and metadata exist and force is off.
            if ref_path.exists() and ref_meta_path.exists() and not args.force:
                old = json.loads(ref_meta_path.read_text())
                # 身份与实际音频哈希都匹配才跳过推理；仅文件名相同不足以复用。
                # Skip inference only when identity and actual audio hash match; a filename alone is insufficient.
                if old.get("identity") == identity and old.get("sha256") == sha256(ref_path):
                    print(f"Reuse verified reference {style}", flush=True)
                    continue
            # 固定种子辅助重现；不同设备、依赖或模型仍可能产生不同字节。
            # Fixed seeds aid replay; hardware, dependencies or models may still change the bytes.
            seed = VOICES[style]["seed"] + args.seed_offset
            torch.manual_seed(seed)
            t0 = time.time()
            wavs, sr = model.generate_voice_design(text=REFERENCE_TEXT, language="Chinese",
                instruct=VOICES[style]["direction"], max_new_tokens=320,
                do_sample=True, temperature=0.8, top_p=1.0,
                subtalker_dosample=True, subtalker_temperature=0.8)
            wav = validate_wave(wavs[0], sr, minimum=3, maximum=24)
            sf.write(ref_path, wav, sr, subtype="PCM_16")
            write_json(ref_meta_path, {"identity": identity, "seed": seed, "sha256": sha256(ref_path),
                "durationSeconds": len(wav)/sr, "generationSeconds": time.time()-t0})
            print(f"Reference {style}: {len(wav)/sr:.2f}s audio in {time.time()-t0:.1f}s", flush=True)
            continue
        # 成品阶段依赖已完成参考阶段，缺任一来源文件立即停止。
        # Clip generation requires completed references; stop if either source file is missing.
        if not ref_path.exists() or not ref_meta_path.exists():
            raise RuntimeError(f"Generate {style} reference before clips")
        reference_meta = json.loads(ref_meta_path.read_text())
        # 拒绝过期方向或被替换的参考，避免悄悄混用角色来源。
        # Reject stale directions or replaced references rather than silently mixing provenance.
        if reference_meta.get("identity") != generation_identity(style) or reference_meta.get("sha256") != sha256(ref_path):
            raise RuntimeError(f"Stale or modified {style} reference")
        ref_audio, ref_sr = sf.read(ref_path, dtype="float32")
        # 把自行生成的参考音频与原文配对，不是采集真人声纹。
        # Pair the self-generated reference with its transcript, not a real-person voice sample.
        prompt = model.create_voice_clone_prompt(ref_audio=(ref_audio, ref_sr),
                                                 ref_text=REFERENCE_TEXT, x_vector_only_mode=False)
        # 遍历含旧 hu 的稳定总表；过滤发生在枚举后，保留原有种子索引。
        # Enumerate the stable full list including legacy hu; filter afterward to preserve seed indexes.
        for index,(call, text) in enumerate(ALL_CALLS.items()):
            # 无显式选择时只做当前可播放条目，保留磁盘上的旧兼容文件。
            # Default selection produces current calls only and leaves old compatibility files on disk.
            if not args.call and call in LEGACY_CALLS: continue
            # 显式 --call 是白名单，不修改其他报牌文件。
            # An explicit --call list limits generation without modifying other calls.
            if args.call and call not in args.call: continue
            wav_path = args.work_dir / style / f"{call}.wav"
            meta_path = wav_path.with_suffix(".json")
            target = args.output / style / f"{call}.mp3"
            identity = generation_identity(style,call)
            # 成品复用还要求中间 WAV 存在，但此处不校验其字节哈希。
            # Clip reuse also requires an intermediate WAV, but does not validate its byte hash here.
            if wav_path.exists() and meta_path.exists() and target.exists() and not args.force:
                old = json.loads(meta_path.read_text())
                # 核对生成身份、成品哈希及参考哈希；更换种子/选项仍须主动强制重做。
                # Check generation identity, final hash and reference hash; seed/option changes still require force.
                if old.get("identity") == identity and old.get("sha256") == sha256(target) and old.get("referenceSha256") == sha256(ref_path):
                    print(f"Reuse verified {style}/{call}", flush=True)
                    continue
            # 成品种子在角色基数上加 1000 与报牌索引，与参考生成区分。
            # Clip seeds add 1000 and call index to the voice seed, separating them from reference generation.
            seed = VOICES[style]["seed"] + 1000 + index + args.seed_offset
            torch.manual_seed(seed)
            t0 = time.time()
            # 碰/旧胡/杠默认用感叹号，其余用句号；标点影响表演但不改报牌文本。
            # Peng/legacy hu/gang use exclamation by default; others use periods. Punctuation shapes delivery.
            wavs,sr = model.generate_voice_clone(text=text + ("！" if call in ("peng","hu","gang") and not args.neutral_actions else "。"),
                language="Chinese", voice_clone_prompt=prompt, non_streaming_mode=not args.streaming_text,
                max_new_tokens=80, do_sample=True, temperature=0.75, top_p=1.0,
                subtalker_dosample=True, subtalker_temperature=0.8)
            wav = validate_wave(wavs[0], sr)
            wav_path.parent.mkdir(parents=True, exist_ok=True)
            sf.write(wav_path, wav, sr, subtype="PCM_16")
            encode(wav_path, target)
            # 保存种子、参考/成品/WAV 哈希与实际选项，供后续审计核对来源。
            # Record seed, reference/final/WAV hashes and actual options for later provenance audits.
            write_json(meta_path, {"identity": identity, "seed": seed,
                "referenceSha256": sha256(ref_path), "sha256": sha256(target),
                "generationOptions": {"nonStreamingMode": not args.streaming_text, "neutralActions": args.neutral_actions, "dtype": args.dtype},
                "wavSha256": sha256(wav_path), "sampleRate": sr, "durationSeconds": len(wav)/sr,
                "wavClippingFraction": float(np.mean(np.abs(wav)>=0.999)),
                "rms": float(np.sqrt(np.mean(wav**2))), "generationSeconds": time.time()-t0,
                "mp3Bytes": target.stat().st_size, "mp3DecodeChecked": True,
                "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()})
            print(f"{style}/{call}: {len(wav)/sr:.2f}s audio in {time.time()-t0:.1f}s",flush=True)
        # 释放当前角色提示并收集垃圾，降低连续 CPU 生成的内存占用。
        # Release the current voice prompt and collect garbage to reduce sequential generation memory.
        del prompt
        gc.collect()

# 直接运行才执行 CLI；其他脚本导入工具函数不会启动生成。
# Run the CLI only when executed directly; importing helpers does not start generation.
if __name__ == "__main__":
    main()
