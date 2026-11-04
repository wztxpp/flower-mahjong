#!/usr/bin/env python3
"""Supplement isolated-word ASR with contextual transcription of all expected calls.

This improves recognition of very short Mandarin syllables but remains an
ASR-assisted review, not a human listening test. Does not alter audio assets.
"""
import argparse
from pathlib import Path
import numpy as np
from audit import decode
from generate import ROOT, VOICES, CALLS, sha256, write_json


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--asr-model',type=Path,required=True)
    p.add_argument('--voice',choices=list(VOICES),nargs='+')
    p.add_argument('--threads',type=int,default=2)
    p.add_argument('--output',type=Path,default=ROOT/'public/voices')
    p.add_argument('--report',type=Path,default=ROOT/'docs/voice-context-audit.json')
    args=p.parse_args()
    from faster_whisper import WhisperModel
    model=WhisperModel(str(args.asr_model),device='cpu',compute_type='int8',
                      cpu_threads=args.threads,local_files_only=True)
    prompt='麻将报牌，一至九条，一至九筒，碰、胡、杠。'
    report={'method':f'{args.asr_model.name} / CPU int8 / Chinese / beam_size=5',
            'initialPrompt':prompt,'interClipSilenceSeconds':0.35,
            'limitations':'Context assists recognition of isolated syllables; this is not subjective listening or a guarantee of pronunciation.',
            'voices':{}}
    for style in (args.voice if args.voice else VOICES):
        pieces=[]
        calls=[]
        offset=0.0
        for call,text in CALLS.items():
            path=args.output/style/f'{call}.mp3'
            wave=decode(path,16000)
            calls.append({'call':call,'text':text,'sha256':sha256(path),
                          'startSeconds':round(offset,4),'endSeconds':round(offset+len(wave)/16000,4)})
            pieces.extend([wave,np.zeros(5600,dtype=np.float32)])
            offset+=len(wave)/16000+0.35
        combined=np.concatenate(pieces)
        segments,_=model.transcribe(combined,language='zh',beam_size=5,
            condition_on_previous_text=False,vad_filter=False,no_speech_threshold=None,
            initial_prompt=prompt)
        segments=[{'start':s.start,'end':s.end,'text':s.text,'avgLogProbability':s.avg_logprob} for s in segments]
        report['voices'][style]={'calls':calls,'segments':segments,'transcript':''.join(s['text'] for s in segments)}
        print(style,report['voices'][style]['transcript'],flush=True)
        write_json(args.report,report)

if __name__=='__main__':
    main()
