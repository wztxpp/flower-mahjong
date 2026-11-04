#!/usr/bin/env python3
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


def decode(path, sr=24000):
    data = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(path),
                           "-ar", str(sr), "-ac", "1", "-f", "f32le", "-"],
                           check=True, capture_output=True).stdout
    return np.frombuffer(data,dtype=np.float32)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output",type=Path,default=ROOT/"public/voices")
    parser.add_argument("--work-dir",type=Path,default=Path("/tmp/flower-mahjong-voices"))
    parser.add_argument("--asr-model",type=Path,required=True)
    parser.add_argument("--threads",type=int,default=4)
    parser.add_argument("--date",default=datetime.datetime.now(datetime.timezone.utc).date().isoformat())
    parser.add_argument("--force-asr",action="store_true")
    parser.add_argument("--partial",action="store_true",help="Audit completed files without publishing an incomplete manifest")
    args=parser.parse_args()
    from faster_whisper import WhisperModel
    import soundfile as sf
    import librosa
    model=WhisperModel(str(args.asr_model),device="cpu",compute_type="int8",
                      cpu_threads=args.threads,local_files_only=True)
    audit_path=args.work_dir/"audit.json"
    old=json.loads(audit_path.read_text()) if audit_path.exists() else {}
    rows=old.get("recordings",{})
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
    hashes=set()
    for style,info in VOICES.items():
        reference=args.work_dir/f"{style}-reference.wav"
        ref_meta=json.loads(reference.with_suffix('.json').read_text())
        ref_wave,sr=sf.read(reference,dtype="float32")
        f0=librosa.yin(ref_wave,fmin=80,fmax=600,sr=sr,frame_length=1024,hop_length=256)
        energy=librosa.feature.rms(y=ref_wave,frame_length=1024,hop_length=256)[0]
        voiced=f0[energy>max(float(energy.max())*0.15,0.005)]
        voice={"label":info["label"],"direction":info["direction"],
               "reference":{"text":REFERENCE_TEXT,"sha256":sha256(reference),"seed":ref_meta["seed"],
                            "estimatedMedianPitchHz":round(float(np.median(voiced)),2)},"clips":{}}
        for call,text in CALLS.items():
            path=args.output/style/f"{call}.mp3"
            meta_path=args.work_dir/style/f"{call}.json"
            if args.partial and (not path.exists() or not meta_path.exists()):
                continue
            meta=json.loads(meta_path.read_text())
            digest=sha256(path)
            assert digest==meta["sha256"],f"Hash mismatch: {path}"
            assert digest not in hashes,f"Duplicate clip bytes: {path}"
            hashes.add(digest)
            wave=decode(path)
            duration=len(wave)/24000
            assert 0.2<=duration<=6.5, f"Suspicious duration: {path}"
            assert np.isfinite(wave).all() and np.max(np.abs(wave))>0.01, f"Invalid/quiet audio: {path}"
            assert np.mean(np.abs(wave)>=0.999)<0.001,f"Clipped MP3: {path}"
            key=f"{style}/{call}"
            if args.force_asr or rows.get(key,{}).get("sha256")!=digest:
                # Padding avoids a subsecond utterance ending exactly at the decoder boundary.
                wave16=decode(path,16000)
                padded=np.pad(wave16,(3200,8000))
                segments,details=model.transcribe(padded,language="zh",beam_size=5,
                    condition_on_previous_text=False,vad_filter=False,
                    initial_prompt="这是中文麻将报牌语音。")
                segments=list(segments)
                transcript="".join(s.text for s in segments).strip()
                rows[key]={"text":text,"transcript":transcript,"sha256":digest,
                           "languageProbability":details.language_probability,
                           "averageLogProbability":float(np.mean([s.avg_logprob for s in segments])) if segments else None,
                           "durationSeconds":duration,"mp3Bytes":path.stat().st_size,
                           "seed":meta["seed"],"carrier":meta.get("carrier"),"crop":meta.get("crop"),"mp3DecodeChecked":True,
                           "mp3ClippingFraction":float(np.mean(np.abs(wave)>=0.999))}
                write_json(audit_path,{"method":manifest["quality"]["asr"],"recordings":rows})
            voice["clips"][call]={"text":text,"src":f"/voices/{style}/{call}.mp3",
                "durationSeconds":round(duration,4),"sha256":digest,"mp3Bytes":path.stat().st_size,
                "transcript":rows[key]["transcript"]}
            print(f"{key}: {text} -> {rows[key]['transcript']}",flush=True)
        manifest["voices"][style]=voice
    # Keep a separately reviewed context report only while every recorded hash
    # still matches. Never carry old review status onto regenerated audio.
    context_path=ROOT/"docs/voice-context-audit.json"
    if len(hashes)==len(VOICES)*len(CALLS) and context_path.exists():
        context=json.loads(context_path.read_text())
        reviewed=context.get("voices",{})
        matching=(set(reviewed)==set(VOICES) and all(
            len(reviewed[style].get("calls",[]))==len(CALLS) and all(
                call["sha256"]==manifest["voices"][style]["clips"][call["call"]]["sha256"]
                for call in reviewed[style]["calls"])
            for style in VOICES))
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
    if not args.partial:
        assert len(hashes)==len(VOICES)*len(CALLS)
    if len(hashes)==len(VOICES)*len(CALLS):
        write_json(args.output/"manifest.json",manifest)
    write_json(ROOT/"docs/voice-audit.json",{"method":manifest["quality"]["asr"],
                "limitations":manifest["quality"]["limitations"],"recordings":rows})
    print(f"Audited {len(hashes)}/{len(VOICES)*len(CALLS)} MP3 files: decoding, non-silence, unique hashes, and ASR. Review transcripts before publishing.",flush=True)

if __name__=="__main__":
    main()
