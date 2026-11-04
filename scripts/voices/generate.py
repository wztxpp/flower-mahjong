#!/usr/bin/env python3
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

ROOT = Path(__file__).resolve().parents[2]
DESIGN_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
DESIGN_REVISION = "5ecdb67327fd37bb2e042aab12ff7391903235d3"
BASE_ID = "Qwen/Qwen3-TTS-12Hz-0.6B-Base"
BASE_REVISION = "5d83992436eae1d760afd27aff78a71d676296fc"
REFERENCE_TEXT = "准备好了吗？一条，二条，三筒，九筒。碰！杠！胡！这局真开心。"
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
CALLS = {**{f"tiao-{i}": f"{n}条" for i,n in enumerate(NUMBERS,1)},
         **{f"tong-{i}": f"{n}筒" for i,n in enumerate(NUMBERS,1)},
         "peng": "碰", "hu": "胡", "gang": "杠", "zimo": "自摸", "fangpao": "放炮"}


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)


def generation_identity(style, call=None):
    return {"voice": style, "direction": VOICES[style]["direction"],
            "referenceText": REFERENCE_TEXT, "designRevision": DESIGN_REVISION,
            "baseRevision": BASE_REVISION, "text": CALLS.get(call) if call else REFERENCE_TEXT}


def load_model(path, torch, dtype):
    from qwen_tts import Qwen3TTSModel
    print(f"Loading {path}", flush=True)
    return Qwen3TTSModel.from_pretrained(str(path), device_map="cpu", dtype=dtype,
                                         attn_implementation="sdpa", local_files_only=True)


def validate_wave(wav, sr, minimum=0.2, maximum=6.5):
    import numpy as np
    wav = np.asarray(wav, dtype=np.float32)
    duration = len(wav) / sr
    if wav.ndim != 1 or not np.all(np.isfinite(wav)):
        raise RuntimeError("Invalid or non-mono waveform")
    if not minimum <= duration <= maximum:
        raise RuntimeError(f"Suspicious duration {duration:.3f}s")
    if np.max(np.abs(wav)) < 0.01 or np.sqrt(np.mean(wav**2)) < 0.001:
        raise RuntimeError("Silent or extremely quiet waveform")
    if np.mean(np.abs(wav) >= 0.999) > 0.001:
        raise RuntimeError("Clipped waveform")
    return wav


def encode(wav, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix(".tmp.mp3")
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(wav),
                    "-af", "loudnorm=I=-18:TP=-2:LRA=7", "-ar", "24000", "-ac", "1",
                    "-c:a", "libmp3lame", "-b:a", "96k", str(temp)], check=True)
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(temp),
                    "-f", "null", "-"], check=True)
    temp.replace(target)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-root", type=Path, required=True)
    parser.add_argument("--work-dir", type=Path, default=Path("/tmp/flower-mahjong-voices"))
    parser.add_argument("--output", type=Path, default=ROOT / "public/voices")
    parser.add_argument("--phase", choices=["references", "clips"], required=True)
    parser.add_argument("--voice", choices=list(VOICES))
    parser.add_argument("--call", choices=list(CALLS), nargs="+")
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--dtype", choices=["bfloat16", "float32"], default="bfloat16")
    parser.add_argument("--seed-offset", type=int, default=0)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--streaming-text", action="store_true", help="Use Qwen simulated streaming text mode")
    parser.add_argument("--neutral-actions", action="store_true", help="Use a full stop for action calls instead of an exclamation mark")
    args = parser.parse_args()
    import numpy as np
    import soundfile as sf
    import torch
    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    dtype = getattr(torch, args.dtype)
    styles = [args.voice] if args.voice else list(VOICES)
    args.work_dir.mkdir(parents=True, exist_ok=True)
    model_name = DESIGN_ID if args.phase == "references" else BASE_ID
    model = load_model(args.model_root / model_name.split("/")[-1], torch, dtype)
    for style in styles:
        ref_path = args.work_dir / f"{style}-reference.wav"
        ref_meta_path = args.work_dir / f"{style}-reference.json"
        if args.phase == "references":
            identity = generation_identity(style)
            if ref_path.exists() and ref_meta_path.exists() and not args.force:
                old = json.loads(ref_meta_path.read_text())
                if old.get("identity") == identity and old.get("sha256") == sha256(ref_path):
                    print(f"Reuse verified reference {style}", flush=True)
                    continue
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
        if not ref_path.exists() or not ref_meta_path.exists():
            raise RuntimeError(f"Generate {style} reference before clips")
        reference_meta = json.loads(ref_meta_path.read_text())
        if reference_meta.get("identity") != generation_identity(style) or reference_meta.get("sha256") != sha256(ref_path):
            raise RuntimeError(f"Stale or modified {style} reference")
        ref_audio, ref_sr = sf.read(ref_path, dtype="float32")
        prompt = model.create_voice_clone_prompt(ref_audio=(ref_audio, ref_sr),
                                                 ref_text=REFERENCE_TEXT, x_vector_only_mode=False)
        for index,(call, text) in enumerate(CALLS.items()):
            if args.call and call not in args.call: continue
            wav_path = args.work_dir / style / f"{call}.wav"
            meta_path = wav_path.with_suffix(".json")
            target = args.output / style / f"{call}.mp3"
            identity = generation_identity(style,call)
            if wav_path.exists() and meta_path.exists() and target.exists() and not args.force:
                old = json.loads(meta_path.read_text())
                if old.get("identity") == identity and old.get("sha256") == sha256(target) and old.get("referenceSha256") == sha256(ref_path):
                    print(f"Reuse verified {style}/{call}", flush=True)
                    continue
            seed = VOICES[style]["seed"] + 1000 + index + args.seed_offset
            torch.manual_seed(seed)
            t0 = time.time()
            wavs,sr = model.generate_voice_clone(text=text + ("！" if call in ("peng","hu","gang") and not args.neutral_actions else "。"),
                language="Chinese", voice_clone_prompt=prompt, non_streaming_mode=not args.streaming_text,
                max_new_tokens=80, do_sample=True, temperature=0.75, top_p=1.0,
                subtalker_dosample=True, subtalker_temperature=0.8)
            wav = validate_wave(wavs[0], sr)
            wav_path.parent.mkdir(parents=True, exist_ok=True)
            sf.write(wav_path, wav, sr, subtype="PCM_16")
            encode(wav_path, target)
            write_json(meta_path, {"identity": identity, "seed": seed,
                "referenceSha256": sha256(ref_path), "sha256": sha256(target),
                "generationOptions": {"nonStreamingMode": not args.streaming_text, "neutralActions": args.neutral_actions, "dtype": args.dtype},
                "wavSha256": sha256(wav_path), "sampleRate": sr, "durationSeconds": len(wav)/sr,
                "wavClippingFraction": float(np.mean(np.abs(wav)>=0.999)),
                "rms": float(np.sqrt(np.mean(wav**2))), "generationSeconds": time.time()-t0,
                "mp3Bytes": target.stat().st_size, "mp3DecodeChecked": True,
                "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()})
            print(f"{style}/{call}: {len(wav)/sr:.2f}s audio in {time.time()-t0:.1f}s",flush=True)
        del prompt
        gc.collect()

if __name__ == "__main__":
    main()
