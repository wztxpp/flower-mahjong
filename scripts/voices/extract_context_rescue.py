#!/usr/bin/env python3
"""Extract a reviewed target call from a carrier phrase at explicit boundaries.

Only use after checking the full carrier's words and confirming that start/end
are silence boundaries enclosing the complete target call and no extra speech.
"""
import argparse
import json
from pathlib import Path
import numpy as np
from generate import encode, generation_identity, validate_wave, write_json, sha256


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--carrier',type=Path,required=True)
    p.add_argument('--start',type=float,required=True)
    p.add_argument('--end',type=float,required=True)
    p.add_argument('--work-dir',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    args=p.parse_args()
    import soundfile as sf
    meta=json.loads(args.carrier.with_suffix('.json').read_text())
    original,sr=sf.read(args.carrier,dtype='float32')
    assert 0<=args.start<args.end<=len(original)/sr
    wav=validate_wave(original[round(args.start*sr):round(args.end*sr)],sr)
    style,call=meta['voice'],meta['call']
    wave_path=args.work_dir/style/f'{call}.wav'
    wave_path.parent.mkdir(parents=True,exist_ok=True)
    sf.write(wave_path,wav,sr,subtype='PCM_16')
    target=args.output/style/f'{call}.mp3'
    encode(wave_path,target)
    write_json(wave_path.with_suffix('.json'),{
       'identity':generation_identity(style,call),'seed':meta['seed'],
       'referenceSha256':meta['referenceSha256'],'sha256':sha256(target),
       'wavSha256':sha256(wave_path),'sampleRate':sr,'durationSeconds':len(wav)/sr,
       'wavClippingFraction':float(np.mean(np.abs(wav)>=.999)),
       'rms':float(np.sqrt(np.mean(wav**2))),'mp3Bytes':target.stat().st_size,
       'mp3DecodeChecked':True,'carrier':meta,
       'crop':{'startSeconds':args.start,'endSeconds':args.end,
               'method':'Explicit bounds chosen from carrier ASR word timestamps and waveform silence; target call only.'}})
    print(target,sha256(target),flush=True)

if __name__=='__main__': main()
