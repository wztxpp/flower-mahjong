#!/usr/bin/env python3
# 四名新增成年角色的离线制作入口，沿用固定官方模型；不改旧角色声音。
# Offline authoring for four new adult characters with pinned official models; preserves old voices.
# 生成沿用 generate.py，审计隔离输出后才合并；此脚本不安装、不下载、不发布。
# Reuses generate.py and audits in isolation before merging; never installs, downloads or publishes.
"""Generate original additional character references/clips, then audit and merge safely."""
from __future__ import annotations
import argparse
import copy
import datetime
import json
import re
from pathlib import Path
import shutil
import sys
import generate

NEW_VOICES = {
    "landlord": {
        "label": "地主",
        "seed": 671411,
        "direction": "原创虚构的四十岁成年男性地主角色，豪爽老练，自信爽朗。男中低音，胸腔共鸣厚实，略带自然沙感，吐字清楚，报牌有干脆的劲头，平静中透着丰富阅历。普通话清晰自然，不要夸张方言，不要喊叫，不要模仿任何真人，不要念说明文字。",
    },
    "honest": {
        "label": "老实人",
        "seed": 671513,
        "direction": "原创虚构的三十五岁成年男性老实人角色，朴实温厚，诚恳友善。自然中音，柔和温暖，口腔共鸣结实但不粗哑，节奏踏实平稳，像亲切可靠的邻家大哥，清楚干净地报麻将牌。不要傻气结巴，不要刻意卖萌，不要喊叫，不要模仿任何真人，不要念说明文字。",
    },
    "wealthy": {
        "label": "富婆",
        "seed": 671617,
        "direction": "原创虚构的四十岁成熟女性富婆角色，成熟从容，有气场，慵懒中保持利落。醇厚圆润的女性中低音，声音饱满顺滑，克制而自信，语调优雅，像见惯世面且享受牌局的女主人。短促清晰报牌，不要气声耳语，不要嗲声，不要拖尾，不要模仿任何真人，不要念说明文字。",
    },
    "star": {
        "label": "女明星",
        "seed": 671719,
        "direction": "原创虚构的二十八岁成年女性明星角色，明亮精致，有表现力。清亮通透的女性中高音，字音圆润清晰，微笑着自信报牌，有适度舞台感染力与灵动语调，但保持自然短促。不要唱歌，不要夸张尖叫，不要幼态撒娇，绝不模仿任何真实明星或演员，不要念说明文字。",
    },
}


# 旧72文件及完整来源清单保存为工作目录基线；重跑必须与同一基线一致。
# Save the original 72 files and provenance as a work-directory baseline; reruns must match it.
def baseline(output, work):
    path = work / "original-voices-baseline.json"
    if path.exists():
        saved = json.loads(path.read_text())
    else:
        manifest = json.loads((output / "manifest.json").read_text())
        original = {key: value for key, value in manifest["voices"].items() if key not in NEW_VOICES}
        if set(original) != {"sweet", "elegant", "sunny"}:
            raise RuntimeError("Expected the three original voices")
        hashes = {str(p.relative_to(output)): generate.sha256(p)
                  for voice in original for p in (output / voice).glob("*.mp3")}
        if len(hashes) != 72:
            raise RuntimeError("Expected exactly 72 original MP3 files")
        saved = {"hashes": hashes, "manifest": manifest}
        generate.write_json(path, saved)
    for relative, digest in saved["hashes"].items():
        if generate.sha256(output / relative) != digest:
            raise RuntimeError(f"Original audio changed: {relative}")
    return saved


# 完整审计在独立临时目录执行，防止基础审计覆盖历史来源或输出半份七角色清单。
# Audit in an isolated staging directory so the base auditor cannot overwrite historic provenance.
def audit_new(args, saved):
    import audit
    import review_context
    stage = args.work_dir / "audited-assets"
    stage.mkdir(parents=True, exist_ok=True)
    for voice in NEW_VOICES:
        target = stage / voice
        target.mkdir(exist_ok=True)
        for call in generate.CALLS:
            shutil.copyfile(args.output / voice / f"{call}.mp3", target / f"{call}.mp3")
    audit.VOICES = NEW_VOICES
    audit.ROOT = args.work_dir / "audit-reports"
    sys.argv = ["audit.py", "--output", str(stage), "--work-dir", str(args.work_dir),
                "--asr-model", str(args.asr_model), "--threads", str(args.threads)]
    if args.force_asr:
        sys.argv.append("--force-asr")
    audit.main()
    review_context.VOICES = NEW_VOICES
    report_path = args.work_dir / "character-context-audit.json"
    sys.argv = ["review_context.py", "--output", str(stage), "--asr-model", str(args.asr_model),
                "--report", str(report_path), "--threads", str(args.threads)]
    review_context.main()
    new = json.loads((stage / "manifest.json").read_text())
    # 新旧所有文件哈希必须各异；来源和参考身份必须与本次真实文件一致。
    # Require unique old/new hashes and provenance/reference identities matching actual files.
    all_hashes = set(saved["hashes"].values())
    generation_records = {}
    for voice in NEW_VOICES:
        for call in generate.CALLS:
            meta = json.loads((args.work_dir / voice / f"{call}.json").read_text())
            audio_path = args.output / voice / f"{call}.mp3"
            digest = generate.sha256(audio_path)
            # 成品再检查均方根，防止仅一个尖峰让近静音文件通过。
            # Check final RMS too, so a lone peak cannot disguise near-silence.
            wave = generate.validate_wave(audit.decode(audio_path), 24000)
            meta["decodedRms"] = float((wave ** 2).mean() ** 0.5)
            ref = args.work_dir / f"{voice}-reference.wav"
            if (digest in all_hashes or meta["sha256"] != digest
                    or meta["identity"] != generate.generation_identity(voice, call)
                    or meta["referenceSha256"] != generate.sha256(ref)):
                raise RuntimeError(f"Invalid provenance or duplicate: {voice}/{call}")
            all_hashes.add(digest)
            generation_records[f"{voice}/{call}"] = meta
    baseline(args.output, args.work_dir)
    merged = copy.deepcopy(saved["manifest"])
    merged["voices"].update(new["voices"])
    merged.update(expectedClipCount=161, clipCount=161, storedClipCount=164, legacyClipCount=3,
                  updatedDate=datetime.datetime.now(datetime.timezone.utc).date().isoformat())
    report = json.loads((audit.ROOT / "docs/voice-audit.json").read_text())
    # 仅将字面不同列为待复核，不把ASR同音字差异自动解释成正确或错误。
    # Flag literal differences for review, without declaring ASR homophones correct or incorrect.
    uncertain = []
    for key, row in report["recordings"].items():
        normalized = re.sub(r"[^\w]", "", row["transcript"])
        normalized = normalized.translate(str.maketrans("123456789", "一二三四五六七八九"))
        if normalized != row["text"]:
            uncertain.append(key)
    merged["quality"]["subjectiveListeningCompleted"] = False
    merged["quality"]["legacyReviewScope"] = ["sweet", "elegant", "sunny"]
    merged["quality"]["additionalCharactersQuality"] = {
        "voices": list(NEW_VOICES),
        "asrModel": "Systran/faster-whisper-small",
        "asrRevision": "536b0662742c02347bc0e980a01041f333bce120",
        "isolatedAudit": "docs/voice-characters-audit.json",
        "contextAudit": "docs/voice-characters-context-audit.json",
        "subjectiveListeningCompleted": False,
        "pronunciationReview": "raw-asr-not-listening-certified",
        "uncertainCalls": uncertain,
        "uncertainCallMethod": "Literal isolated-ASR differences after punctuation and numeral normalization; may include homophones. Context transcripts retained separately.",
        "limitations": "Original top-level contextualAsr/pronunciationReview/uncertainCalls apply only to legacyReviewScope. New character ASR is small, not medium; persona, tones and pronunciation need listening review.",
    }
    report.update(originalAudioHashes=saved["hashes"], originalAudioPreserved=True,
                  provenance=new["provenance"], voices=new["voices"],
                  generationRecords=generation_records, subjectiveListeningCompleted=False)
    for source, field in [("model-download-audit.json", "downloadedModelFiles"),
                          ("reference-asr.json", "referenceRawAsr")]:
        source_path = args.work_dir / source
        if source_path.exists():
            report[field] = json.loads(source_path.read_text())
    generate.write_json(generate.ROOT / "docs/voice-characters-audit.json", report)
    generate.write_json(generate.ROOT / "docs/voice-characters-context-audit.json", json.loads(report_path.read_text()))
    generate.write_json(args.output / "manifest.json", merged)


# 生成参数直接交给既有生成器，仅替换新角色配置；审计参数独立解析。
# Forward generation flags to the established generator, replacing only voice configuration.
def main():
    generate.VOICES = NEW_VOICES
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", required=True, choices=["references", "clips", "audit"])
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=generate.ROOT / "public/voices")
    parser.add_argument("--asr-model", type=Path)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--force-asr", action="store_true")
    args, _ = parser.parse_known_args()
    args.work_dir.mkdir(parents=True, exist_ok=True)
    saved = baseline(args.output, args.work_dir)
    if args.phase == "audit":
        if args.asr_model is None:
            parser.error("--asr-model is required for auditing")
        audit_new(args, saved)
    else:
        generate.main()
    baseline(args.output, args.work_dir)


if __name__ == "__main__":
    main()
