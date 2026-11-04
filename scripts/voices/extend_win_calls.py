#!/usr/bin/env python3
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

WIN_CALLS = {'zimo': '自摸', 'fangpao': '放炮'}
REFERENCE_CALLS = ['tiao-1', 'tiao-2', 'tiao-3']
REFERENCE_TEXT = '一条。二条。三条。'


def recovered_reference(style, output, work, manifest):
    import numpy as np
    import soundfile as sf
    from audit import decode
    sources=[]
    pieces=[]
    for call in REFERENCE_CALLS:
        path=output/style/f'{call}.mp3'
        digest=sha256(path)
        assert digest==manifest['voices'][style]['clips'][call]['sha256'], f'Changed reference source: {path}'
        sources.append({'call':call, 'src':f'/voices/{style}/{call}.mp3', 'sha256':digest,
                        'text':manifest['voices'][style]['clips'][call]['text']})
        pieces.append(decode(path))
        pieces.append(np.zeros(3600,dtype=np.float32))
    wave=np.concatenate(pieces[:-1])
    ref=work/f'{style}-recovered-reference.wav'
    sf.write(ref,wave,24000,subtype='PCM_16')
    record={'text':REFERENCE_TEXT, 'sha256':sha256(ref), 'sourceClips':sources,
            'durationSeconds':len(wave)/24000, 'interClipSilenceSeconds':0.15,
            'method':'Recovered from existing original generated character clips; original intermediate reference WAV was unavailable in this execution environment.'}
    write_json(ref.with_suffix('.json'),record)
    return wave,record


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--phase',choices=['generate','audit'],required=True)
    p.add_argument('--model-root',type=Path,required=True)
    p.add_argument('--work-dir',type=Path,required=True)
    p.add_argument('--output',type=Path,default=ROOT/'public/voices')
    p.add_argument('--voice',choices=list(VOICES))
    p.add_argument('--call',choices=list(WIN_CALLS),nargs='+')
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
    if args.phase=='generate':
        import torch
        torch.set_num_threads(args.threads)
        torch.set_num_interop_threads(1)
        model=load_model(args.model_root/BASE_ID.split('/')[-1],torch,torch.bfloat16)
        for style in ([args.voice] if args.voice else VOICES):
            wave,reference=recovered_reference(style,args.output,args.work_dir,manifest)
            prompt=model.create_voice_clone_prompt(ref_audio=(wave,24000),ref_text=REFERENCE_TEXT,x_vector_only_mode=False)
            for index,(call,text) in enumerate(WIN_CALLS.items()):
                if args.call and call not in args.call: continue
                destination=args.output/style/f'{call}.mp3'
                wav_path=args.work_dir/style/f'{call}.wav'
                meta_path=wav_path.with_suffix('.json')
                if destination.exists() and meta_path.exists() and not args.force:
                    old=json.loads(meta_path.read_text())
                    if old['text']==text and old['sha256']==sha256(destination) and old['reference']['sha256']==reference['sha256']:
                        print(f'Reuse {style}/{call}',flush=True)
                        continue
                seed=VOICES[style]['seed']+4000+index+args.seed_offset
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
            'limitations':'ASR is not human listening or a guarantee of persona consistency, pronunciation, or tone. Original clips are unchanged.',
            'recordings':{},'contextualChecks':{},
            'runtime':{name:importlib.metadata.version(name) for name in ['torch','qwen-tts','transformers','faster-whisper','soundfile','numpy']}}
    all_hashes=set()
    for style in VOICES:
        reference=None
        for call,text in WIN_CALLS.items():
            path=args.output/style/f'{call}.mp3'
            meta=json.loads((args.work_dir/style/f'{call}.json').read_text())
            assert sha256(path)==meta['sha256']
            wave=decode(path)
            validate_wave(wave,24000)
            duration=len(wave)/24000
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
        sequence=REFERENCE_CALLS+list(WIN_CALLS)+['hu']
        joined=np.concatenate([np.concatenate([decode(args.output/style/f'{call}.mp3',16000),np.zeros(5600,dtype=np.float32)]) for call in sequence])
        segments,_=asr.transcribe(joined,language='zh',beam_size=5,condition_on_previous_text=False,
            vad_filter=False,no_speech_threshold=None,initial_prompt='麻将报牌，自摸，放炮，胡牌。')
        transcript=''.join(s.text for s in segments).strip()
        matched=all(text in transcript for text in WIN_CALLS.values())
        report['contextualChecks'][style]={'calls':sequence,'transcript':transcript,'initialPrompt':'麻将报牌，自摸，放炮，胡牌。','expectedNewCallsMatched':matched}
        for call in WIN_CALLS:
            manifest['voices'][style]['clips'][call]['pronunciationReview']=('context-asr-reviewed-not-listening-certified' if matched else 'uncertain')
            report['recordings'][f'{style}/{call}']['contextualNewCallsMatched']=matched
        print(f'{style} context: {transcript}',flush=True)
    for style,voice in manifest['voices'].items():
        assert len(voice['clips'])==23
        for call,clip in voice['clips'].items():
            path=args.output/style/f'{call}.mp3'
            digest=sha256(path)
            assert digest==clip['sha256']
            assert digest not in all_hashes,f'Duplicate bytes: {path}'
            all_hashes.add(digest)
        for call,clip in original['voices'][style]['clips'].items():
            if call not in WIN_CALLS: assert sha256(args.output/style/f'{call}.mp3')==clip['sha256'],f'Original clip changed: {style}/{call}'
    assert len(all_hashes)==69
    manifest['expectedClipCount']=69
    manifest['clipCount']=69
    manifest['updatedDate']=args.date
    manifest['quality']['winTypeExtension']={'date':args.date,'clipCount':6,'mp3DecodeChecked':True,'asr':'faster-whisper small / CPU int8 / Chinese / beam_size=5','subjectiveListeningCompleted':False}
    write_json(ROOT/'docs/voice-win-audit.json',report)
    write_json(manifest_path,manifest)
    print('69 unique clips; all original 63 hashes unchanged; six new clips decoded and ASR recorded.',flush=True)

if __name__=='__main__': main()
