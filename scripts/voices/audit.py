#!/usr/bin/env python3
# 成品检查入口：读取 MP3/来源记录，执行本地 ASR，并写报告与完整清单。
# Final-asset audit: reads MP3/provenance, runs local ASR and writes reports plus complete manifests.
# 哈希和声学检查不能证明字音或角色表演正确。 / Hashes and acoustic checks do not certify pronunciation or character performance.
# 导读：docs/VOICE-TOOLING-GUIDE.md。 / Reading guide: docs/VOICE-TOOLING-GUIDE.md.
"""Decode/hash all expected voice files and run local Mandarin ASR for review.

ASR is evidence, not a subjective voice-quality or pronunciation certification.
A manifest is produced only when all expected files exist and decode correctly.
"""
from __future__ import annotations
import argparse
import json
import datetime
from pathlib import Path
import subprocess
import numpy as np
from generate import (ROOT, VOICES, CALLS, DESIGN_ID, DESIGN_REVISION, BASE_ID,
                      BASE_REVISION, REFERENCE_TEXT, sha256, write_json)


# 用 FFmpeg 解码到指定采样率的单声道 float32 数组；失败抛错，不改输入。
# Decode with FFmpeg into mono float32 at the requested rate; errors propagate and input is unchanged.
def decode(path, sr=24000):
    data = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(path),
                           "-ar", str(sr), "-ac", "1", "-f", "f32le", "-"],
                           check=True, capture_output=True).stdout
    return np.frombuffer(data,dtype=np.float32)


# 命令行入口：解析路径/阶段，再执行本地文件读取、推理或审计；失败向调用者传播。
# CLI entry: parse paths/phase, then read files, infer or audit locally; failures propagate.
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    # output 是成品目录；work-dir 提供参考/生成记录及可续跑 ASR 缓存。
    # Output contains final clips; work-dir supplies references, generation records and resumable ASR cache.
    parser.add_argument("--output",type=Path,default=ROOT/"public/voices")
    parser.add_argument("--work-dir",type=Path,default=Path("/tmp/flower-mahjong-voices"))
    parser.add_argument("--asr-model",type=Path,required=True)
    parser.add_argument("--threads",type=int,default=4)
    parser.add_argument("--date",default=datetime.datetime.now(datetime.timezone.utc).date().isoformat())
    # 默认按 MP3 哈希复用转写；更换识别模型或识别设置需强制刷新。
    # Reuse transcripts by MP3 hash by default; force a refresh after changing ASR models/settings.
    parser.add_argument("--force-asr",action="store_true")
    # 部分模式可跳过缺失成品，但仍需角色参考；齐全时仍会写清单。
    # Partial mode skips missing clips but still needs references; a complete set still writes the manifest.
    parser.add_argument("--partial",action="store_true",help="Audit completed files without publishing an incomplete manifest")
    args=parser.parse_args()
    from faster_whisper import WhisperModel
    import soundfile as sf
    import librosa
    # 识别模型仅从本地加载，CPU int8 降低占用，不调用云端识别服务。
    # Load local-only ASR using CPU int8 to reduce resources; no cloud speech service is called.
    model=WhisperModel(str(args.asr_model),device="cpu",compute_type="int8",
                      cpu_threads=args.threads,local_files_only=True)
    audit_path=args.work_dir/"audit.json"
    old=json.loads(audit_path.read_text()) if audit_path.exists() else {}
    # 旧报告按角色/报牌键缓存；哈希不一致时才重新识别。
    # Cache old report rows by voice/call; a changed hash triggers fresh recognition.
    rows=old.get("recordings",{})
    previous_path=args.output/"manifest.json"
    previous=json.loads(previous_path.read_text()) if previous_path.exists() else {}
    # 先在内存构造候选清单；质量字段明确未完成人工试听。
    # Build a candidate manifest in memory; quality fields explicitly do not claim human listening.
    manifest={"schemaVersion":1,"language":"zh-CN","status":"generated",
       "generatedDate":args.date, "expectedClipCount":len(VOICES)*len(CALLS),"clipCount":len(VOICES)*len(CALLS),
       "engine":"Qwen3-TTS local CPU", "voices":{},
       "provenance":{"designModel":DESIGN_ID,"designRevision":DESIGN_REVISION,
          "baseModel":BASE_ID,"baseRevision":BASE_REVISION,"qwenTtsVersion":"0.1.1",
          "paidServiceUsed":False,"realPersonVoiceSampleUsed":False,
          "source":"https://github.com/QwenLM/Qwen3-TTS",
          "referenceWorkflow":"https://github.com/wztxpp/twelve-alibis/blob/dc8c1cdb81eaa4d1c7a47dd4c3432c1177580723/docs/AUDIO-SOURCE.md"},
       "quality":{"mp3DecodeChecked":True,"asr":"faster-whisper small / CPU int8 / Chinese / beam_size=5",
          "subjectiveListeningCompleted":False,
          "limitations":"ASR and acoustic checks do not certify human-like performance, intended persona, or perfect pronunciation. Raw transcripts are retained for review."}}
    # 跨全部角色收集文件哈希，发现字节完全重复的成品即失败。
    # Collect hashes across all voices to reject byte-identical final clips.
    hashes=set()
    # 按配置顺序审计所有角色；参考音高仅是估算，不是角色质量评分。
    # Audit every configured voice in order; reference pitch is an estimate, not a persona quality score.
    for style,info in VOICES.items():
        reference=args.work_dir/f"{style}-reference.wav"
        ref_meta=json.loads(reference.with_suffix('.json').read_text())
        ref_wave,sr=sf.read(reference,dtype="float32")
        f0=librosa.yin(ref_wave,fmin=80,fmax=600,sr=sr,frame_length=1024,hop_length=256)
        energy=librosa.feature.rms(y=ref_wave,frame_length=1024,hop_length=256)[0]
        # 只对能量足够的帧估算中位音高，减少静音对结果的影响。
        # Use sufficiently energetic frames for median pitch, limiting silence contamination.
        voiced=f0[energy>max(float(energy.max())*0.15,0.005)]
        voice={"label":info["label"],"direction":info["direction"],
               "reference":{"text":REFERENCE_TEXT,"sha256":sha256(reference),"seed":ref_meta["seed"],
                            "estimatedMedianPitchHz":round(float(np.median(voiced)),2)},"clips":{}}
        # 只审计当前可播放报牌；旧 hu 的保留检查在后面独立进行。
        # Audit current playable calls; legacy hu preservation is checked separately below.
        for call,text in CALLS.items():
            path=args.output/style/f"{call}.mp3"
            meta_path=args.work_dir/style/f"{call}.json"
            # 缺文件只能在明确部分模式跳过，否则正常读取失败阻止发布清单。
            # Skip missing files only in explicit partial mode; otherwise read errors prevent manifest output.
            if args.partial and (not path.exists() or not meta_path.exists()):
                continue
            meta=json.loads(meta_path.read_text())
            digest=sha256(path)
            # 实际成品必须与生成记录一致，防止沿用另一份音频的来源说明。
            # Final bytes must match generation metadata to avoid attaching another recording’s provenance.
            assert digest==meta["sha256"],f"Hash mismatch: {path}"
            assert digest not in hashes,f"Duplicate clip bytes: {path}"
            hashes.add(digest)
            # 检查真正解码后的成品，而不只相信生成前 WAV 的质量数据。
            # Inspect the decoded final audio rather than relying only on pre-encoding WAV measurements.
            wave=decode(path)
            duration=len(wave)/24000
            assert 0.2<=duration<=6.5, f"Suspicious duration: {path}"
            assert np.isfinite(wave).all() and np.max(np.abs(wave))>0.01, f"Invalid/quiet audio: {path}"
            assert np.mean(np.abs(wave)>=0.999)<0.001,f"Clipped MP3: {path}"
            key=f"{style}/{call}"
            # 缓存只绑定 MP3 哈希，未绑定识别模型版本；force-asr 绕过缓存。
            # Cache keys bind MP3 hashes, not ASR model versions; force-asr bypasses reuse.
            if args.force_asr or rows.get(key,{}).get("sha256")!=digest:
                # Padding avoids a subsecond utterance ending exactly at the decoder boundary.
                # 识别输入为 16 kHz，前补 0.2 秒后补 0.5 秒，避免短词贴着解码边界。
                # ASR uses 16 kHz with 0.2 s leading and 0.5 s trailing silence to protect short utterance boundaries.
                wave16=decode(path,16000)
                padded=np.pad(wave16,(3200,8000))
                segments,details=model.transcribe(padded,language="zh",beam_size=5,
                    condition_on_previous_text=False,vad_filter=False,
                    initial_prompt="这是中文麻将报牌语音。")
                # 转写结果可能延迟产生；先消费完整序列，再拼文本并记录概率。
                # Segments may be lazy; consume them before joining text and recording probabilities.
                segments=list(segments)
                transcript="".join(s.text for s in segments).strip()
                rows[key]={"text":text,"transcript":transcript,"sha256":digest,
                           "languageProbability":details.language_probability,
                           "averageLogProbability":float(np.mean([s.avg_logprob for s in segments])) if segments else None,
                           "durationSeconds":duration,"mp3Bytes":path.stat().st_size,
                           "seed":meta["seed"],"carrier":meta.get("carrier"),"crop":meta.get("crop"),"mp3DecodeChecked":True,
                           "mp3ClippingFraction":float(np.mean(np.abs(wave)>=0.999))}
                # 逐条保存缓存，长任务中断后可从已核实音频继续。
                # Persist each cached result so a long interrupted run can resume verified recordings.
                write_json(audit_path,{"method":manifest["quality"]["asr"],"recordings":rows})
            voice["clips"][call]={"text":text,"src":f"/voices/{style}/{call}.mp3",
                "durationSeconds":round(duration,4),"sha256":digest,"mp3Bytes":path.stat().st_size,
                "transcript":rows[key]["transcript"]}
            print(f"{key}: {text} -> {rows[key]['transcript']}",flush=True)
        # 沿用旧清单的兼容条目，不能因当前播放列表变化而删除旧文件来源。
        # Preserve legacy entries from the prior manifest despite changes to the current playback list.
        old_voice=previous.get("voices",{}).get(style,{})
        legacy=dict(old_voice.get("legacyClips",{}))
        if "hu" in old_voice.get("clips",{}): legacy["hu"]=old_voice["clips"]["hu"]
        # 兼容文件必须存在且哈希不变；这里只验证，不重新生成。
        # Legacy files must exist with unchanged hashes; this verifies rather than regenerates them.
        for legacy_call,clip in legacy.items():
            path=args.output/style/f"{legacy_call}.mp3"
            assert path.exists() and sha256(path)==clip["sha256"], f"Changed legacy file: {path}"
        if legacy: voice["legacyClips"]=legacy
        manifest["voices"][style]=voice
    # Keep a separately reviewed context report only while every recorded hash
    # still matches. Never carry old review status onto regenerated audio.
    # 上下文审查只能复用到相同音频，不能把旧审查标签套到新生成文件上。
    # Reuse contextual review only for matching audio; never transfer old review labels to regenerated clips.
    context_path=ROOT/"docs/voice-context-audit.json"
    if len(hashes)==len(VOICES)*len(CALLS) and context_path.exists():
        context=json.loads(context_path.read_text())
        reviewed=context.get("voices",{})
        # 要求角色集合、报牌数量以及每条记录哈希与候选清单匹配。
        # Require matching voice sets, call counts and each recorded hash against the candidate manifest.
        matching=(set(reviewed)==set(VOICES) and all(
            len(reviewed[style].get("calls",[]))==len(CALLS) and all(
                call["sha256"]==manifest["voices"][style]["clips"][call["call"]]["sha256"]
                for call in reviewed[style]["calls"])
            for style in VOICES))
        # 只有匹配且带有 review 的外部审查报告才补充质量标签。
        # Add quality labels only from a matching contextual report that contains a review section.
        if matching and "review" in context:
            review=context["review"]
            uncertain=review.get("uncertainCalls",[])
            manifest["quality"]["contextualAsr"]=context["method"]
            manifest["quality"]["pronunciationReview"]=review["status"]
            manifest["quality"]["uncertainCalls"]=uncertain
            manifest["quality"]["contextReviewNotes"]=review["notes"]
            for style,voice in manifest["voices"].items():
                voice["contextualTranscript"]=reviewed[style]["transcript"]
                for call,clip in voice["clips"].items():
                    clip["pronunciationReview"]=("uncertain" if f"{style}/{call}" in uncertain
                        else "context-asr-reviewed-not-listening-certified")
    manifest["legacyClipCount"]=sum(len(voice.get("legacyClips",{})) for voice in manifest["voices"].values())
    manifest["storedClipCount"]=len(hashes)+manifest["legacyClipCount"]
    # 非部分模式必须凑齐全部可播放文件；Python -O 会移除 assert，不应用于审计。
    # Full mode requires every playable file; Python -O disables asserts and must not be used for audits.
    if not args.partial:
        assert len(hashes)==len(VOICES)*len(CALLS)
    # 完整集合才写运行时清单；即使 partial 标志存在，齐全时也会写入。
    # Write the runtime manifest only for a complete set, even when partial mode is enabled.
    if len(hashes)==len(VOICES)*len(CALLS):
        write_json(args.output/"manifest.json",manifest)
    # 审计不是纯只读命令：此处总会覆盖文档报告。
    # Audit is not read-only: this always replaces the documentation report.
    write_json(ROOT/"docs/voice-audit.json",{"method":manifest["quality"]["asr"],
                "limitations":manifest["quality"]["limitations"],"recordings":rows})
    print(f"Audited {len(hashes)}/{len(VOICES)*len(CALLS)} MP3 files: decoding, non-silence, unique hashes, and ASR. Review transcripts before publishing.",flush=True)

if __name__=="__main__":
    main()
