#!/usr/bin/env python3
# 抢杠增量迁移：追加三条抢杠，旧胡转为兼容记录，保留原音频字节。
# Rob-kong incremental migration: add three calls, move hu metadata to legacy and retain original audio bytes.
# 模型权重/凭证不可上传；审计成功不等于部署或人工试听通过。 / Never upload weights/credentials; successful audit is neither deployment nor listening approval.
# 导读：docs/VOICE-TOOLING-GUIDE.md。 / Reading guide: docs/VOICE-TOOLING-GUIDE.md.
"""Add three genuine 抢杠 clips from the pack's existing generated character voices.

Uses the same free local Qwen Base workflow and recovered per-character
references as 自摸/放炮. Retains old 胡 files as legacy compatibility assets,
while the manifest exposes three separate winning calls without trailing 胡.
"""
import argparse
import datetime
import importlib.metadata
import json
from pathlib import Path
import time
from generate import ROOT, VOICES, BASE_ID, BASE_REVISION, sha256, write_json, load_model, validate_wave, encode
from extend_win_calls import recovered_reference, REFERENCE_TEXT, REFERENCE_CALLS


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
    # 资源键 qianggang 是客户端协议，中文是模型要读的完整词语，不追加胡。
    # qianggang is the client asset key; the Chinese text is the complete spoken call, without trailing hu.
    call,text='qianggang','抢杠'
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
            prompt=model.create_voice_clone_prompt(ref_audio=(wave,24000),ref_text=REFERENCE_TEXT,x_vector_only_mode=False)
            # 独立 5000 种子偏移区分抢杠扩展；随机种子不是音质保证。
            # A separate 5000 seed offset distinguishes rob-kong generation; seeds do not guarantee quality.
            seed=VOICES[style]['seed']+5000+args.seed_offset
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
            'limitations':'ASR is not human listening or a guarantee of persona consistency, pronunciation, or tone. Existing audio is unchanged.',
            'recordings':{},'contextualChecks':{},
            'runtime':{name:importlib.metadata.version(name) for name in ['torch','qwen-tts','transformers','faster-whisper','soundfile','numpy']}}
    # 三个角色必须全部具备成品及来源记录，才能完成扩展审计。
    # All three voices need final audio and provenance records to complete extension auditing.
    for style in VOICES:
        path=args.output/style/f'{call}.mp3'
        meta=json.loads((args.work_dir/style/f'{call}.json').read_text())
        # 先核对实际文件对应这份生成记录，再解码检查并记录 ASR。
        # Match actual bytes to generation metadata before decoding and recording ASR.
        assert sha256(path)==meta['sha256']
        wave=decode(path)
        validate_wave(wave,24000)
        duration=len(wave)/24000
        segments,_=asr.transcribe(np.pad(decode(path,16000),(3200,8000)),language='zh',beam_size=5,
            condition_on_previous_text=False,vad_filter=False,no_speech_threshold=None)
        transcript=''.join(s.text for s in segments).strip()
        report['recordings'][style]={'text':text,**meta,'transcript':transcript,'mp3DecodeChecked':True,
            'durationSeconds':duration,'mp3ClippingFraction':float(np.mean(np.abs(wave)>=.999))}
        voice=manifest['voices'][style]
        voice['clips'][call]={'text':text,'src':f'/voices/{style}/{call}.mp3','durationSeconds':round(duration,4),
            'sha256':meta['sha256'],'mp3Bytes':path.stat().st_size,'transcript':transcript,
            'pronunciationReview':'asr-recorded-not-listening-certified'}
        voice.setdefault('extensions',{})['robKongCall']={'date':args.date,'reference':meta['reference'],'calls':[call]}
        # 只把旧 hu 元数据移到兼容区，不删除或重写磁盘上的 MP3。
        # Move only legacy hu metadata into the compatibility section; do not delete or rewrite its MP3.
        if 'hu' in voice['clips']:
            voice.setdefault('legacyClips',{})['hu']=voice['clips'].pop('hu')
        # 此迁移预期原清单已有 hu 或 legacyClips.hu；缺失不是自动补齐的情况。
        # This migration expects an existing hu or legacyClips.hu entry; missing data is not automatically repaired.
        voice['legacyClips']['hu']['usage']='Compatibility file only; not a current winning announcement.'
        print(f'{style}/{call}: {text} -> {transcript}',flush=True)
        # 拼接基础报牌与三种胜利词作上下文识别；每段后留 0.35 秒静音。
        # Join base calls and three winning calls for contextual ASR with 0.35 s silence after each.
        sequence=REFERENCE_CALLS+['zimo','fangpao',call]
        joined=np.concatenate([np.concatenate([decode(args.output/style/f'{key}.mp3',16000),np.zeros(5600,dtype=np.float32)]) for key in sequence])
        prompt='麻将报牌，自摸，放炮，抢杠。'
        segments,_=asr.transcribe(joined,language='zh',beam_size=5,condition_on_previous_text=False,
            vad_filter=False,no_speech_threshold=None,initial_prompt=prompt)
        transcript=''.join(s.text for s in segments).strip()
        # 只按转写是否包含抢杠标记复核状态，不能代替人耳确认声调。
        # Mark review by whether the transcript contains rob-kong; this cannot replace listening for tone.
        matched=text in transcript
        report['contextualChecks'][style]={'calls':sequence,'transcript':transcript,'initialPrompt':prompt,'expectedNewCallMatched':matched}
        voice['clips'][call]['pronunciationReview']='context-asr-reviewed-not-listening-certified' if matched else 'uncertain'
        print(f'{style} context: {transcript}',flush=True)
    hashes=set()
    # 最终不变量：每角色 23 条可播放 + 1 条旧胡，所有字节哈希唯一且来源匹配。
    # Final invariants: 23 playable plus one legacy hu per voice, with unique matching byte hashes.
    for style,voice in manifest['voices'].items():
        assert len(voice['clips'])==23 and 'hu' not in voice['clips']
        assert all(key in voice['clips'] for key in ['zimo','fangpao','qianggang'])
        stored={**voice['clips'],**voice.get('legacyClips',{})}
        assert len(stored)==24
        for key,clip in stored.items():
            digest=sha256(args.output/style/f'{key}.mp3')
            assert digest==clip['sha256']
            assert digest not in hashes
            hashes.add(digest)
        old=original['voices'][style]
        for key,clip in {**old['clips'],**old.get('legacyClips',{})}.items():
            # 除了新增抢杠以外，基线中的成品一律不许改变。
            # Every baseline recording except the targeted rob-kong call must remain unchanged.
            if key!=call: assert sha256(args.output/style/f'{key}.mp3')==clip['sha256'],f'Existing clip changed: {style}/{key}'
    assert len(hashes)==72
    # 分别记录可播放数与磁盘总数，避免把 3 条旧胡当成当前胜利语音。
    # Track playable and stored counts separately so three legacy hu clips are not current winning calls.
    manifest.update(expectedClipCount=69,clipCount=69,storedClipCount=72,legacyClipCount=3,updatedDate=args.date)
    # 保留客户端胜利类型映射；杠后放炮仍读放炮，抢杠只读抢杠。
    # Preserve client win-type mapping: kong-discard reads fangpao; rob-kong reads qianggang only.
    manifest['winAnnouncements']={'selfDraw':'zimo','discard':'fangpao','kongDiscard':'fangpao','robKong':'qianggang','appendHu':False}
    manifest['quality']['robKongExtension']={'date':args.date,'clipCount':3,'mp3DecodeChecked':True,
        'asr':'faster-whisper small / CPU int8 / Chinese / beam_size=5','subjectiveListeningCompleted':False}
    write_json(ROOT/'docs/voice-qianggang-audit.json',report)
    # 全部断言通过后才落盘清单；报告与清单是两次独立写入，并非跨文件事务。
    # Write the manifest after all assertions pass; report and manifest writes are not a cross-file transaction.
    write_json(manifest_path,manifest)
    print('69 playable clips + 3 unchanged legacy 胡 clips; 72 distinct files; existing 69 hashes unchanged.',flush=True)

if __name__=='__main__': main()
