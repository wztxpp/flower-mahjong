#!/usr/bin/env python3
# 历史增量制作：从已有原创录音恢复声线，追加自摸/放炮并核对旧文件。
# Historical incremental authoring: recover original character references, add win calls and verify old assets.
# 不要上传模型、凭证或中间 WAV；运行前核对历史清单前提。 / Never upload models, credentials or intermediate WAVs; check historical manifest assumptions first.
# 导读：docs/VOICE-TOOLING-GUIDE.md。 / Reading guide: docs/VOICE-TOOLING-GUIDE.md.
"""Extend the existing voice pack with 自摸/放炮 using its shipped character voices.

When original intermediate reference WAVs are unavailable, recover each voice
from its hash-verified 一条/二条/三条 clips. This does not redesign voices or change
old audio. Generate locally, then audit/finalize the incremental manifest.
"""
import argparse
import datetime
import json
import importlib.metadata
from pathlib import Path
import time

from generate import ROOT, VOICES, BASE_ID, BASE_REVISION, sha256, write_json, load_model, validate_wave, encode

# 此脚本负责历史上的自摸/放炮六条扩展，不是完整语音包重建器。
# This historical script extends six self-draw/discard-win clips, not the entire voice pack.
WIN_CALLS = {'zimo': '自摸', 'fangpao': '放炮'}
# 恢复参考按一条、二条、三条固定顺序拼接，文本必须与该顺序一致。
# Recover references in fixed one/two/three bamboo order; transcript must match that order.
REFERENCE_CALLS = ['tiao-1', 'tiao-2', 'tiao-3']
REFERENCE_TEXT = '一条。二条。三条。'


# 输入角色、成品目录、工作目录和清单；返回拼接波形/来源记录，并写 WAV/JSON。
# Given voice, output/work directories and manifest, return joined samples/provenance and write WAV/JSON.
def recovered_reference(style, output, work, manifest):
    import numpy as np
    import soundfile as sf
    from audit import decode
    sources=[]
    pieces=[]
    # 逐一核对来源哈希，再解码，拒绝使用被替换的旧角色音频。
    # Verify each source hash before decoding; reject replaced character recordings.
    for call in REFERENCE_CALLS:
        path=output/style/f'{call}.mp3'
        digest=sha256(path)
        assert digest==manifest['voices'][style]['clips'][call]['sha256'], f'Changed reference source: {path}'
        sources.append({'call':call, 'src':f'/voices/{style}/{call}.mp3', 'sha256':digest,
                        'text':manifest['voices'][style]['clips'][call]['text']})
        pieces.append(decode(path))
        # 24 kHz 下 3600 个零采样是 0.15 秒停顿，防止相邻词直接相接。
        # At 24 kHz, 3600 zeros provide a 0.15 s pause between words.
        pieces.append(np.zeros(3600,dtype=np.float32))
    # 删除最后一个停顿块，只在词与词之间保留静音。
    # Drop the final silence block so pauses remain only between words.
    wave=np.concatenate(pieces[:-1])
    ref=work/f'{style}-recovered-reference.wav'
    sf.write(ref,wave,24000,subtype='PCM_16')
    record={'text':REFERENCE_TEXT, 'sha256':sha256(ref), 'sourceClips':sources,
            'durationSeconds':len(wave)/24000, 'interClipSilenceSeconds':0.15,
            'method':'Recovered from existing original generated character clips; original intermediate reference WAV was unavailable in this execution environment.'}
    write_json(ref.with_suffix('.json'),record)
    return wave,record


# 命令行入口：解析路径/阶段，再执行本地文件读取、推理或审计；失败向调用者传播。
# CLI entry: parse paths/phase, then read files, infer or audit locally; failures propagate.
def main():
    p=argparse.ArgumentParser(description=__doc__)
    # generate 会写音频和元数据；audit 会检查成品并写报告/清单，不是只读。
    # Generate writes audio/metadata; audit verifies finals and writes report/manifest, so it is not read-only.
    p.add_argument('--phase',choices=['generate','audit'],required=True)
    p.add_argument('--model-root',type=Path,required=True)
    p.add_argument('--work-dir',type=Path,required=True)
    p.add_argument('--output',type=Path,default=ROOT/'public/voices')
    p.add_argument('--voice',choices=list(VOICES))
    p.add_argument('--call',choices=list(WIN_CALLS),nargs='+')
    p.add_argument('--threads',type=int,default=4)
    # 种子偏移不参与复用判定；想换种子重生成必须同时使用 --force。
    # Seed offsets are not part of reuse checks; use --force to regenerate with a changed seed.
    p.add_argument('--seed-offset',type=int,default=0)
    p.add_argument('--force',action='store_true')
    p.add_argument('--date',default=datetime.datetime.now(datetime.timezone.utc).date().isoformat())
    args=p.parse_args()
    args.work_dir.mkdir(parents=True,exist_ok=True)
    manifest_path=args.output/'manifest.json'
    manifest=json.loads(manifest_path.read_text())
    # 首次保存旧清单作为保留检查基线；续跑不覆盖，需保留同一工作目录。
    # Save the initial manifest as preservation baseline; resuming keeps it, so retain the work directory.
    baseline=args.work_dir/'original-manifest.json'
    # 只在基线缺失时创建，避免把已修改的清单当作原始来源。
    # Create a baseline only when absent to avoid treating later edits as original provenance.
    if not baseline.exists(): write_json(baseline,manifest)
    original=json.loads(baseline.read_text())
    import numpy as np
    import soundfile as sf
    from audit import decode
    # 生成分支在完成后返回，不顺带更新清单；需单独跑 audit 阶段。
    # Generation returns after writing clips; manifest finalization requires a separate audit phase.
    if args.phase=='generate':
        import torch
        torch.set_num_threads(args.threads)
        torch.set_num_interop_threads(1)
        model=load_model(args.model_root/BASE_ID.split('/')[-1],torch,torch.bfloat16)
        # 可只生成选定角色；审计仍检查所有角色，不是选择性发布。
        # Generation can target one voice; auditing still checks all voices, not a selective release.
        for style in ([args.voice] if args.voice else VOICES):
            # 从既有且哈希匹配的角色成品恢复参考，不重新设计声线。
            # Recover references from hash-matching existing character clips without redesigning the voice.
            wave,reference=recovered_reference(style,args.output,args.work_dir,manifest)
            prompt=model.create_voice_clone_prompt(ref_audio=(wave,24000),ref_text=REFERENCE_TEXT,x_vector_only_mode=False)
            # 固定报牌顺序决定种子索引；选择部分条目不改变其原始索引。
            # Fixed call order determines seed indexes; filtering does not alter original indexes.
            for index,(call,text) in enumerate(WIN_CALLS.items()):
                if args.call and call not in args.call: continue
                destination=args.output/style/f'{call}.mp3'
                wav_path=args.work_dir/style/f'{call}.wav'
                meta_path=wav_path.with_suffix('.json')
                # 只有成品与元数据存在、未强制重做时才尝试缓存复用。
                # Attempt cache reuse only if final audio/metadata exist and force is off.
                if destination.exists() and meta_path.exists() and not args.force:
                    old=json.loads(meta_path.read_text())
                    # 文本、成品哈希、参考哈希均一致才复用；并非完整的模型/参数缓存键。
                    # Reuse requires matching text, final hash and reference hash, not a complete model/parameter cache key.
                    if old['text']==text and old['sha256']==sha256(destination) and old['reference']['sha256']==reference['sha256']:
                        print(f'Reuse {style}/{call}',flush=True)
                        continue
                # 4000 区间区分本次扩展与基础报牌/载体候选的随机种子。
                # The 4000 offset separates this extension’s seeds from base clips and carrier candidates.
                seed=VOICES[style]['seed']+4000+index+args.seed_offset
                torch.manual_seed(seed)
                start=time.time()
                wavs,sr=model.generate_voice_clone(text=text+'。',language='Chinese',voice_clone_prompt=prompt,
                    non_streaming_mode=True,max_new_tokens=80,do_sample=True,temperature=.75,top_p=1.0,
                    subtalker_dosample=True,subtalker_temperature=.8)
                # 先校验推理出的波形，再写中间 WAV 和归一化 MP3。
                # Validate inferred samples before writing intermediate WAV and normalized MP3.
                result=validate_wave(wavs[0],sr)
                wav_path.parent.mkdir(parents=True,exist_ok=True)
                sf.write(wav_path,result,sr,subtype='PCM_16')
                encode(wav_path,destination)
                # 保留实际输入、种子、参考来源链和音频哈希，便于追溯每条新增录音。
                # Retain actual input, seed, reference provenance chain and hashes to trace each new recording.
                write_json(meta_path,{'voice':style,'call':call,'text':text,'modelInputText':text+'。',
                    'sha256':sha256(destination),'wavSha256':sha256(wav_path),'seed':seed,'reference':reference,
                    'model':BASE_ID,'modelRevision':BASE_REVISION,'qwenTtsVersion':'0.1.1',
                    'durationSeconds':len(result)/sr,'sampleRate':sr,'mp3Bytes':destination.stat().st_size,
                    'generationSeconds':time.time()-start,'generationDate':args.date,
                    'wavClippingFraction':float(np.mean(np.abs(result)>=.999))})
                print(f'{style}/{call}: {len(result)/sr:.2f}s audio in {time.time()-start:.1f}s',flush=True)
        return
    from faster_whisper import WhisperModel
    # 审计仅用本地 CPU int8 识别；不把音频上传外部服务。
    # Audit uses local CPU int8 recognition without uploading audio to external services.
    asr=WhisperModel(str(args.model_root/'faster-whisper-small'),device='cpu',compute_type='int8',cpu_threads=args.threads,local_files_only=True)
    # 记录依赖版本与未人工试听的限制；ASR 结果是复核材料而非发音认证。
    # Record dependency versions and listening limitations; ASR is review evidence, not pronunciation certification.
    report={'date':args.date,'method':'Local Qwen3-TTS 0.6B Base, recovered original character references; faster-whisper small / CPU int8 / Chinese / beam_size=5',
            'paidServiceUsed':False,'realPersonVoiceSampleUsed':False,'subjectiveListeningCompleted':False,
            'limitations':'ASR is not human listening or a guarantee of persona consistency, pronunciation, or tone. Original clips are unchanged.',
            'recordings':{},'contextualChecks':{},
            'runtime':{name:importlib.metadata.version(name) for name in ['torch','qwen-tts','transformers','faster-whisper','soundfile','numpy']}}
    all_hashes=set()
    # 审计每个角色的两条新增成品，核对生成记录再执行孤立词识别。
    # Audit both new clips for every voice, verify generation records, then run isolated-word ASR.
    for style in VOICES:
        reference=None
        for call,text in WIN_CALLS.items():
            path=args.output/style/f'{call}.mp3'
            meta=json.loads((args.work_dir/style/f'{call}.json').read_text())
            assert sha256(path)==meta['sha256']
            wave=decode(path)
            validate_wave(wave,24000)
            duration=len(wave)/24000
            # 16 kHz 输入前后补 0.2/0.5 秒，帮助识别极短报牌。
            # Pad 16 kHz input by 0.2/0.5 s before/after to aid short-call recognition.
            wave16=np.pad(decode(path,16000),(3200,8000))
            segments,_=asr.transcribe(wave16,language='zh',beam_size=5,condition_on_previous_text=False,
                vad_filter=False,no_speech_threshold=None)
            transcript=''.join(s.text for s in segments).strip()
            row={**meta,'transcript':transcript,'mp3DecodeChecked':True,
                 'durationSeconds':duration,'mp3ClippingFraction':float(np.mean(np.abs(wave)>=.999))}
            report['recordings'][f'{style}/{call}']=row
            manifest['voices'][style]['clips'][call]={'text':text,'src':f'/voices/{style}/{call}.mp3',
                'durationSeconds':round(duration,4),'sha256':meta['sha256'],'mp3Bytes':path.stat().st_size,
                'transcript':transcript,'pronunciationReview':'asr-recorded-not-listening-certified'}
            reference=meta['reference']
            print(f'{style}/{call}: {text} -> {transcript}',flush=True)
        manifest['voices'][style].setdefault('extensions',{})['winTypeCalls']={'date':args.date,'reference':reference,'calls':list(WIN_CALLS)}
        # 历史上下文包含旧 hu；它是审计语料序列，不是当前客户端播放规则。
        # Historical context includes legacy hu; this audit sequence is not the current client playback rule.
        sequence=REFERENCE_CALLS+list(WIN_CALLS)+['hu']
        joined=np.concatenate([np.concatenate([decode(args.output/style/f'{call}.mp3',16000),np.zeros(5600,dtype=np.float32)]) for call in sequence])
        segments,_=asr.transcribe(joined,language='zh',beam_size=5,condition_on_previous_text=False,
            vad_filter=False,no_speech_threshold=None,initial_prompt='麻将报牌，自摸，放炮，胡牌。')
        transcript=''.join(s.text for s in segments).strip()
        # 字符串包含检查只说明 ASR 找到目标词，不能排除漏字、幻听或声调问题。
        # Substring matches only show ASR found target words; they cannot rule out omissions, hallucinations or tone errors.
        matched=all(text in transcript for text in WIN_CALLS.values())
        report['contextualChecks'][style]={'calls':sequence,'transcript':transcript,'initialPrompt':'麻将报牌，自摸，放炮，胡牌。','expectedNewCallsMatched':matched}
        for call in WIN_CALLS:
            manifest['voices'][style]['clips'][call]['pronunciationReview']=('context-asr-reviewed-not-listening-certified' if matched else 'uncertain')
            report['recordings'][f'{style}/{call}']['contextualNewCallsMatched']=matched
        print(f'{style} context: {transcript}',flush=True)
    # 检查整套清单的数量、唯一字节和旧文件保留；这些是历史迁移的固定预期。
    # Check manifest counts, byte uniqueness and preserved originals; these are fixed historical migration expectations.
    for style,voice in manifest['voices'].items():
        assert len(voice['clips'])==23
        for call,clip in voice['clips'].items():
            path=args.output/style/f'{call}.mp3'
            digest=sha256(path)
            assert digest==clip['sha256']
            assert digest not in all_hashes,f'Duplicate bytes: {path}'
            all_hashes.add(digest)
        for call,clip in original['voices'][style]['clips'].items():
            # 除本脚本负责的两类外，原始清单中的所有音频必须保持原哈希。
            # Every original clip outside this script’s two target calls must retain its hash.
            if call not in WIN_CALLS: assert sha256(args.output/style/f'{call}.mp3')==clip['sha256'],f'Original clip changed: {style}/{call}'
    # 69 是当时扩展后的数量；不要把历史命令当作任意新清单的通用修复器。
    # 69 is the historical post-extension count; this is not a generic repair tool for arbitrary newer manifests.
    assert len(all_hashes)==69
    manifest['expectedClipCount']=69
    manifest['clipCount']=69
    manifest['updatedDate']=args.date
    manifest['quality']['winTypeExtension']={'date':args.date,'clipCount':6,'mp3DecodeChecked':True,'asr':'faster-whisper small / CPU int8 / Chinese / beam_size=5','subjectiveListeningCompleted':False}
    write_json(ROOT/'docs/voice-win-audit.json',report)
    # 全部断言通过后才落盘清单；报告与清单是两次独立写入，并非跨文件事务。
    # Write the manifest after all assertions pass; report and manifest writes are not a cross-file transaction.
    write_json(manifest_path,manifest)
    print('69 unique clips; all original 63 hashes unchanged; six new clips decoded and ASR recorded.',flush=True)

if __name__=='__main__': main()
