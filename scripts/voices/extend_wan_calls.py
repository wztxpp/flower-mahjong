#!/usr/bin/env python3
# 成都模式万牌增量制作：复用七个已发布原创成年角色，不设计或采集新的真人声线。
# Chengdu character-suit extension: reuse seven shipped original adult personas, never sample real people.
# 本地模型和参考 WAV 留在仓库外；先核验全部旧资产，再生成并审计63条新报牌。
# Keep models/reference WAVs outside the repo; verify all old assets before generating/auditing 63 calls.
"""Generate/audit one-to-nine wan calls while preserving every previous audio byte and metadata."""
from __future__ import annotations
import argparse
import copy
import datetime
import importlib.metadata
import hashlib
import json
from pathlib import Path
import re
import time
import generate
from extend_characters import NEW_VOICES
from extend_win_calls import recovered_reference

VOICES = {**generate.VOICES, **NEW_VOICES}
WAN_CALLS = {f"wan-{rank}": f"{number}万" for rank, number in enumerate(generate.NUMBERS, 1)}
GENERATION_OPTIONS = {"non_streaming_mode": True, "max_new_tokens": 80,
                      "do_sample": True, "temperature": 0.75, "top_p": 1.0,
                      "subtalker_dosample": True, "subtalker_temperature": 0.8}
ASR_OPTIONS = {"language": "zh", "beam_size": 5, "condition_on_previous_text": False,
               "vad_filter": False, "no_speech_threshold": None}


# 对实际本地模型逐文件做流式哈希，与仓库保留的官方固定下载修订记录核对。
# Stream-hash actual local model files against the repository's pinned official download provenance.
def verify_model_files(model_root):
    source = json.loads((generate.ROOT / "docs/voice-characters-audit.json").read_text())["downloadedModelFiles"]
    revisions = {generate.BASE_ID.split("/")[-1]: generate.BASE_REVISION,
                 "faster-whisper-small": "536b0662742c02347bc0e980a01041f333bce120"}
    verified = {}
    for model_name, revision in revisions.items():
        recorded = source[model_name]
        for relative, metadata in recorded.items():
            path = model_root / model_name / relative
            digest = hashlib.sha256()
            with path.open("rb") as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(block)
            if (metadata["downloadRevision"] != revision or digest.hexdigest() != metadata["sha256"]
                    or path.stat().st_size != metadata["bytes"]):
                raise RuntimeError(f"Local model differs from pinned download: {model_name}/{relative}")
        verified[model_name] = recorded
    return verified


# 基线只保存一次；每次运行核对旧164文件及旧条目，不允许扩展覆盖已有来源记录。
# Save baseline once; every run verifies the old 164 files and entries, prohibiting provenance replacement.
def read_baseline(output, work):
    baseline_path = work / "pre-wan-baseline.json"
    current = json.loads((output / "manifest.json").read_text())
    if baseline_path.exists():
        baseline = json.loads(baseline_path.read_text())
    else:
        if set(current["voices"]) != set(VOICES) or current["storedClipCount"] != 164:
            raise RuntimeError("Expected unextended seven-character baseline (164 stored clips)")
        hashes = {str(path.relative_to(output)): generate.sha256(path)
                  for path in output.glob("*/*.mp3")}
        if len(hashes) != 164 or len(set(hashes.values())) != 164:
            raise RuntimeError("Expected 164 distinct original MP3 files")
        baseline = {"manifest": current, "hashes": hashes}
        generate.write_json(baseline_path, baseline)
    for relative, digest in baseline["hashes"].items():
        if generate.sha256(output / relative) != digest:
            raise RuntimeError(f"Original audio changed: {relative}")
    for voice, original in baseline["manifest"]["voices"].items():
        for field in ("clips", "legacyClips"):
            for call, metadata in original.get(field, {}).items():
                if current["voices"][voice].get(field, {}).get(call) != metadata:
                    raise RuntimeError(f"Original metadata changed: {voice}/{call}")
    return baseline


# 优先使用与已发布清单哈希一致的原创参考；原三声线没有原WAV时沿用既有恢复方法。
# Prefer hash-matching original references; recover the original three from shipped clips when WAVs are absent.
def reference_for(voice, args, manifest):
    import soundfile as sf
    original = args.reference_dir / f"{voice}-reference.wav" if args.reference_dir else None
    if original and original.exists():
        metadata = json.loads(original.with_suffix(".json").read_text())
        digest = generate.sha256(original)
        if digest != manifest["voices"][voice]["reference"]["sha256"] or digest != metadata["sha256"]:
            raise RuntimeError(f"Reference hash differs from shipped persona: {voice}")
        if metadata["identity"]["voice"] != voice:
            raise RuntimeError(f"Reference persona mismatch: {voice}")
        wave, rate = sf.read(original, dtype="float32")
        reference = {"method": "Reused original synthetic VoiceDesign reference verified against shipped manifest",
                     "sha256": digest, "text": metadata["identity"]["referenceText"],
                     "durationSeconds": len(wave) / rate, "originalReferenceMetadata": metadata}
    else:
        wave, reference = recovered_reference(voice, args.output, args.work_dir, manifest)
        rate = 24000
    generate.validate_wave(wave, rate, minimum=1, maximum=24)
    return wave, rate, reference


# 一次加载模型，按声线生成，缓存身份包含完整参数、种子和参考指纹，避免错用旧候选。
# Load once and generate by persona; cache identity includes full settings, seed and reference hash.
def generate_calls(args, baseline):
    import numpy as np
    import soundfile as sf
    import torch
    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    model = generate.load_model(args.model_root / generate.BASE_ID.split("/")[-1], torch, torch.bfloat16)
    for voice in ([args.voice] if args.voice else VOICES):
        wave, rate, reference = reference_for(voice, args, baseline["manifest"])
        prompt = model.create_voice_clone_prompt(ref_audio=(wave, rate), ref_text=reference["text"],
                                                x_vector_only_mode=False)
        for index, (call, text) in enumerate(WAN_CALLS.items()):
            if args.call and call not in args.call:
                continue
            seed = VOICES[voice]["seed"] + 6000 + index + args.seed_offset
            identity = {"voice": voice, "call": call, "text": text, "modelInputText": text + "。",
                        "model": generate.BASE_ID, "modelRevision": generate.BASE_REVISION,
                        "referenceSha256": reference["sha256"], "seed": seed,
                        "dtype": "bfloat16", "generationOptions": GENERATION_OPTIONS}
            destination = args.output / voice / f"{call}.mp3"
            wav_path = args.work_dir / voice / f"{call}.wav"
            meta_path = wav_path.with_suffix(".json")
            if not args.force and destination.exists() and wav_path.exists() and meta_path.exists():
                old = json.loads(meta_path.read_text())
                if (old["identity"] == identity and old["sha256"] == generate.sha256(destination)
                        and old["wavSha256"] == generate.sha256(wav_path)):
                    print(f"Reuse verified {voice}/{call}", flush=True)
                    continue
            torch.manual_seed(seed)
            started = time.time()
            waves, sample_rate = model.generate_voice_clone(text=text + "。", language="Chinese",
                                                           voice_clone_prompt=prompt, **GENERATION_OPTIONS)
            result = generate.validate_wave(waves[0], sample_rate)
            wav_path.parent.mkdir(parents=True, exist_ok=True)
            sf.write(wav_path, result, sample_rate, subtype="PCM_16")
            generate.encode(wav_path, destination)
            generate.write_json(meta_path, {"identity": identity, "reference": reference,
                "sha256": generate.sha256(destination), "wavSha256": generate.sha256(wav_path),
                "sampleRate": sample_rate, "durationSeconds": len(result) / sample_rate,
                "mp3Bytes": destination.stat().st_size, "generationSeconds": time.time() - started,
                "generationDate": args.date, "wavClippingFraction": float(np.mean(np.abs(result) >= 0.999))})
            print(f"{voice}/{call}: {len(result)/sample_rate:.2f}s audio in {time.time()-started:.1f}s", flush=True)
        read_baseline(args.output, args.work_dir)


# ASR 原文不修饰；只规范标点和数字用于标记差异，不把同音词或上下文识别当人工认证。
# Preserve raw ASR; normalize only punctuation/numerals for review flags, never certify homophones or context.
def normalize(text):
    return re.sub(r"[^\w]", "", text).translate(str.maketrans("123456789萬", "一二三四五六七八九万"))


# 仅当63条均可解码且来源一致时合并清单；逐条和全序列ASR独立保存，旧元数据全部保留。
# Merge only after all 63 decode and match provenance; retain isolated/context ASR and all old metadata.
def audit_calls(args, baseline):
    import numpy as np
    from faster_whisper import WhisperModel
    from audit import decode
    asr = WhisperModel(str(args.model_root / "faster-whisper-small"), device="cpu", compute_type="int8",
                       cpu_threads=args.threads, local_files_only=True)
    manifest = copy.deepcopy(baseline["manifest"])
    report = {"date": args.date, "paidServiceUsed": False, "realPersonVoiceSampleUsed": False,
              "subjectiveListeningCompleted": False, "originalAudioPreserved": True,
              "originalAudioHashes": baseline["hashes"], "recordings": {}, "contextualChecks": {},
              "asrModel": "Systran/faster-whisper-small", "asrRevision": "536b0662742c02347bc0e980a01041f333bce120",
              "verifiedModelFiles": args.verified_models,
              "asrCpuThreads": args.threads,
              "asrOptions": ASR_OPTIONS, "runtime": {name: importlib.metadata.version(name)
                  for name in ["torch", "qwen-tts", "transformers", "faster-whisper", "soundfile", "numpy"]},
              "limitations": "ASR is not human listening or a guarantee of persona consistency, pronunciation or tone. Raw transcripts are retained."}
    # 逐条缓存包含模型/设置/文件哈希，允许生成进行中做只写工作目录的预审。
    # Isolated cache includes model/settings/file hash, permitting work-directory-only review during generation.
    cache_path = args.work_dir / "wan-isolated-asr-cache.json"
    cache_identity = {"model": report["asrModel"], "revision": report["asrRevision"],
                      "options": ASR_OPTIONS, "runtime": report["runtime"]}
    previous = json.loads(cache_path.read_text()) if cache_path.exists() else {}
    cache = previous if previous.get("identity") == cache_identity else {"identity": cache_identity, "clips": {}}
    hashes = set(baseline["hashes"].values())
    uncertain = []
    for voice in VOICES:
        pieces = []
        boundaries = []
        elapsed = 0.0
        for call, text in WAN_CALLS.items():
            path = args.output / voice / f"{call}.mp3"
            metadata_path = args.work_dir / voice / f"{call}.json"
            if args.partial and (not path.exists() or not metadata_path.exists()):
                continue
            metadata = json.loads(metadata_path.read_text())
            identity = metadata["identity"]
            wav_path = metadata_path.with_suffix(".wav")
            if not wav_path.exists() or generate.sha256(wav_path) != metadata["wavSha256"]:
                raise RuntimeError(f"Missing or changed source WAV: {voice}/{call}")
            digest = generate.sha256(path)
            if (digest != metadata["sha256"] or digest in hashes or identity["text"] != text
                    or identity["voice"] != voice or identity["call"] != call
                    or identity["modelRevision"] != generate.BASE_REVISION
                    or identity["referenceSha256"] != metadata["reference"]["sha256"]):
                raise RuntimeError(f"Invalid or duplicate generated clip: {voice}/{call}")
            hashes.add(digest)
            wave = generate.validate_wave(decode(path), 24000)
            wave16 = decode(path, 16000)
            key = f"{voice}/{call}"
            cached = cache["clips"].get(key, {})
            if cached.get("sha256") == digest and not args.force:
                transcript = cached["transcript"]
            else:
                segments, _ = asr.transcribe(np.pad(wave16, (3200, 8000)), **ASR_OPTIONS)
                transcript = "".join(segment.text for segment in segments).strip()
                cache["clips"][key] = {"sha256": digest, "transcript": transcript}
                generate.write_json(cache_path, cache)
            differs = normalize(transcript) != normalize(text)
            if differs:
                uncertain.append(f"{voice}/{call}")
            row = {**metadata, "text": text, "transcript": transcript,
                   "mp3DecodeChecked": True, "durationSeconds": len(wave) / 24000,
                   "decodedRms": float(np.sqrt(np.mean(wave ** 2))),
                   "mp3ClippingFraction": float(np.mean(np.abs(wave) >= 0.999)),
                   "isolatedAsrLiteralDifference": differs}
            report["recordings"][f"{voice}/{call}"] = row
            manifest["voices"][voice]["clips"][call] = {"text": text, "src": f"/voices/{voice}/{call}.mp3",
                "durationSeconds": round(len(wave) / 24000, 4), "sha256": digest,
                "mp3Bytes": path.stat().st_size, "transcript": transcript,
                "pronunciationReview": "asr-recorded-not-listening-certified"}
            boundaries.append({"call": call, "startSeconds": elapsed, "endSeconds": elapsed + len(wave16) / 16000})
            elapsed += len(wave16) / 16000 + 0.35
            pieces.extend([wave16, np.zeros(5600, dtype=np.float32)])
            print(f"{voice}/{call}: {text} -> {transcript}", flush=True)
        if len(boundaries) != len(WAN_CALLS):
            continue
        # 不提供目标词提示的序列转写减少答案提示偏差；仍不能代替实际试听。
        # Use unprompted context ASR to reduce target-word prompting bias; it still cannot replace listening.
        segments, _ = asr.transcribe(np.concatenate(pieces), **ASR_OPTIONS)
        transcript = "".join(segment.text for segment in segments).strip()
        report["contextualChecks"][voice] = {"calls": list(WAN_CALLS), "boundaries": boundaries,
            "transcript": transcript, "initialPrompt": None,
            "expectedSequence": "，".join(WAN_CALLS.values()),
            "literalSequenceMatched": normalize(transcript) == normalize("".join(WAN_CALLS.values()))}
        manifest["voices"][voice].setdefault("extensions", {})["wanCalls"] = {
            "date": args.date, "calls": list(WAN_CALLS), "reference": metadata["reference"]}
        print(f"{voice} context: {transcript}", flush=True)
    read_baseline(args.output, args.work_dir)
    if args.partial:
        report["partial"] = True
        report["uncertainCalls"] = uncertain
        generate.write_json(args.work_dir / "wan-partial-audit.json", report)
        print(f"Partial review: {len(report['recordings'])}/63; manifest unchanged.", flush=True)
        return
    if len(report["recordings"]) != 63 or len(hashes) != 227:
        raise RuntimeError("Expected 63 new and 164 original distinct clips")
    manifest.update(expectedClipCount=224, clipCount=224, storedClipCount=227, updatedDate=args.date)
    manifest["quality"]["wanExtension"] = {"clipCount": 63, "voices": list(VOICES),
        "audit": "docs/voice-wan-audit.json", "mp3DecodeChecked": True, "asrModel": report["asrModel"],
        "asrRevision": report["asrRevision"], "subjectiveListeningCompleted": False,
        "uncertainCalls": uncertain, "limitations": report["limitations"]}
    report["uncertainCalls"] = uncertain
    generate.write_json(generate.ROOT / "docs/voice-wan-audit.json", report)
    generate.write_json(args.output / "manifest.json", manifest)
    read_baseline(args.output, args.work_dir)
    print("63 new clips audited; original 164 audio files and clip metadata unchanged.", flush=True)


# 必须显式选择阶段，所有路径由调用者提供；脚本不安装、不下载、不推送或部署。
# Require an explicit phase and caller-supplied paths; never install, download, push or deploy.
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", choices=["generate", "audit"], required=True)
    parser.add_argument("--model-root", type=Path, required=True)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--reference-dir", type=Path)
    parser.add_argument("--output", type=Path, default=generate.ROOT / "public/voices")
    parser.add_argument("--voice", choices=list(VOICES))
    parser.add_argument("--call", choices=list(WAN_CALLS), nargs="+")
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--seed-offset", type=int, default=0)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--partial", action="store_true", help="Audit completed calls in the work directory only; never merge")
    parser.add_argument("--date", default=datetime.datetime.now(datetime.timezone.utc).date().isoformat())
    args = parser.parse_args()
    if args.threads < 1:
        parser.error("--threads must be positive")
    if args.phase == "generate" and args.partial:
        parser.error("--partial is only supported for audit")
    if args.phase == "audit" and (args.voice or args.call or args.seed_offset):
        parser.error("--voice, --call and --seed-offset only select generation candidates")
    args.work_dir.mkdir(parents=True, exist_ok=True)
    args.verified_models = verify_model_files(args.model_root)
    baseline = read_baseline(args.output, args.work_dir)
    if args.phase == "generate":
        generate_calls(args, baseline)
    else:
        audit_calls(args, baseline)


if __name__ == "__main__":
    main()
