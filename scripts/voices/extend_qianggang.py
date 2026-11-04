#!/usr/bin/env python3
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


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--phase',choices=['generate','audit'],required=True)
    p.add_argument('--model-root',type=Path,required=True)
    p.add_argument('--work-dir',type=Path,required=True)
    p.add_argument('--output',type=Path,default=ROOT/'public/voices')
    p.add_argument('--voice',choices=list(VOICES))
    p.add_argument('--threads',type=int,default=4)
    p.add_argument('--seed-offset',type=int,default=0)
    p.add_argument('--force',action='store_true')
    p.add_argument('--date',default=datetime.datetime.now(datetime.timezone.utc).date().isoformat())
    args=p.parse_args()
    args.work_dir.mkdir(parents=True,exist_ok=True)
    manifest_path=args.output/'manifest.json'
    manifest=json.loads(manifest_path.read_text())
    baseline=args.work_dir/'original-manifest.json'
    if not baseline.exists(): write_json(baseline,manifest)
    original=json.loads(baseline.read_text())
    import numpy as np
    import soundfile as sf
    from audit import decode
    call,text='qianggang','抢杠'
    if args.phase=='generate':
        import torch
        torch.set_num_threads(args.threads)
        torch.set_num_interop_threads(1)
        model=load_model(args.model_root/BASE_ID.split('/')[-1],torch,torch.bfloat16)
        for style in ([args.voice] if args.voice else VOICES):
            wave,reference=recovered_reference(style,args.output,args.work_dir,manifest)
            destination=args.output/style/f'{call}.mp3'
            wav_path=args.work_dir/style/f'{call}.wav'
            meta_path=wav_path.with_suffix('.json')
            if destination.exists() and meta_path.exists() and not args.force:
                old=json.loads(meta_path.read_text())
                if old['text']==text and old['sha256']==sha256(destination) and old['reference']['sha256']==reference['sha256']:
                    print(f'Reuse {style}/{call}',flush=True)
                    continue
            prompt=model.create_voice_clone_prompt(ref_audio=(wave,24000),ref_text=REFERENCE_TEXT,x_vector_only_mode=False)
            seed=VOICES[style]['seed']+5000+args.seed_offset
            torch.manual_seed(seed)
            start=time.time()
            wavs,sr=model.generate_voice_clone(text=text+'。',language='Chinese',voice_clone_prompt=prompt,
                non_streaming_mode=True,max_new_tokens=80,do_sample=True,temperature=.75,top_p=1.0,
                subtalker_dosample=True,subtalker_temperature=.8)
            result=validate_wave(wavs[0],sr)
            wav_path.parent.mkdir(parents=True,exist_ok=True)
            sf.write(wav_path,result,sr,subtype='PCM_16')
            encode(wav_path,destination)
            write_json(meta_path,{'voice':style,'call':call,'text':text,'modelInputText':text+'。',
                'sha256':sha256(destination),'wavSha256':sha256(wav_path),'seed':seed,'reference':reference,
                'model':BASE_ID,'modelRevision':BASE_REVISION,'qwenTtsVersion':'0.1.1',
                'durationSeconds':len(result)/sr,'sampleRate':sr,'mp3Bytes':destination.stat().st_size,
                'generationSeconds':time.time()-start,'generationDate':args.date,
                'wavClippingFraction':float(np.mean(np.abs(result)>=.999))})
            print(f'{style}/{call}: {len(result)/sr:.2f}s audio in {time.time()-start:.1f}s',flush=True)
        return
    from faster_whisper import WhisperModel
    asr=WhisperModel(str(args.model_root/'faster-whisper-small'),device='cpu',compute_type='int8',cpu_threads=args.threads,local_files_only=True)
    report={'date':args.date,'method':'Local Qwen3-TTS 0.6B Base, recovered original character references; faster-whisper small / CPU int8 / Chinese / beam_size=5',
            'paidServiceUsed':False,'realPersonVoiceSampleUsed':False,'subjectiveListeningCompleted':False,
            'limitations':'ASR is not human listening or a guarantee of persona consistency, pronunciation, or tone. Existing audio is unchanged.',
            'recordings':{},'contextualChecks':{},
            'runtime':{name:importlib.metadata.version(name) for name in ['torch','qwen-tts','transformers','faster-whisper','soundfile','numpy']}}
    for style in VOICES:
        path=args.output/style/f'{call}.mp3'
        meta=json.loads((args.work_dir/style/f'{call}.json').read_text())
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
        if 'hu' in voice['clips']:
            voice.setdefault('legacyClips',{})['hu']=voice['clips'].pop('hu')
        voice['legacyClips']['hu']['usage']='Compatibility file only; not a current winning announcement.'
        print(f'{style}/{call}: {text} -> {transcript}',flush=True)
        sequence=REFERENCE_CALLS+['zimo','fangpao',call]
        joined=np.concatenate([np.concatenate([decode(args.output/style/f'{key}.mp3',16000),np.zeros(5600,dtype=np.float32)]) for key in sequence])
        prompt='麻将报牌，自摸，放炮，抢杠。'
        segments,_=asr.transcribe(joined,language='zh',beam_size=5,condition_on_previous_text=False,
            vad_filter=False,no_speech_threshold=None,initial_prompt=prompt)
        transcript=''.join(s.text for s in segments).strip()
        matched=text in transcript
        report['contextualChecks'][style]={'calls':sequence,'transcript':transcript,'initialPrompt':prompt,'expectedNewCallMatched':matched}
        voice['clips'][call]['pronunciationReview']='context-asr-reviewed-not-listening-certified' if matched else 'uncertain'
        print(f'{style} context: {transcript}',flush=True)
    hashes=set()
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
            if key!=call: assert sha256(args.output/style/f'{key}.mp3')==clip['sha256'],f'Existing clip changed: {style}/{key}'
    assert len(hashes)==72
    manifest.update(expectedClipCount=69,clipCount=69,storedClipCount=72,legacyClipCount=3,updatedDate=args.date)
    manifest['winAnnouncements']={'selfDraw':'zimo','discard':'fangpao','kongDiscard':'fangpao','robKong':'qianggang','appendHu':False}
    manifest['quality']['robKongExtension']={'date':args.date,'clipCount':3,'mp3DecodeChecked':True,
        'asr':'faster-whisper small / CPU int8 / Chinese / beam_size=5','subjectiveListeningCompleted':False}
    write_json(ROOT/'docs/voice-qianggang-audit.json',report)
    write_json(manifest_path,manifest)
    print('69 playable clips + 3 unchanged legacy 胡 clips; 72 distinct files; existing 69 hashes unchanged.',flush=True)

if __name__=='__main__': main()
