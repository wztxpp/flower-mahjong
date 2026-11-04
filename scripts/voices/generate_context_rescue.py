#!/usr/bin/env python3
"""Generate review-only carrier phrases for three uncertain short calls.

Does not publish or crop audio. Review exact words and silence/timestamps before
extracting only the target word. Uses the existing original reference voices.
"""
import argparse
from pathlib import Path
import time
from generate import VOICES, REFERENCE_TEXT, BASE_ID, load_model, validate_wave, write_json, sha256


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--model-root',type=Path,required=True)
    p.add_argument('--work-dir',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    args=p.parse_args()
    import torch
    import soundfile as sf
    torch.set_num_threads(4)
    torch.set_num_interop_threads(1)
    model=load_model(args.model_root/BASE_ID.split('/')[-1],torch,torch.bfloat16)
    targets=[('sweet','hu','胡'),('sweet','gang','杠'),('sunny','tong-9','九筒')]
    for style in ['sweet','sunny']:
        reference=args.work_dir/f'{style}-reference.wav'
        wave,sr=sf.read(reference,dtype='float32')
        prompt=model.create_voice_clone_prompt(ref_audio=(wave,sr),ref_text=REFERENCE_TEXT,x_vector_only_mode=False)
        for index,(voice,call,text) in enumerate(targets):
            if style!=voice: continue
            full_text=f'麻将。{text}！'
            seed=VOICES[style]['seed']+3000+index
            torch.manual_seed(seed)
            start=time.time()
            wavs,sr=model.generate_voice_clone(text=full_text,language='Chinese',
                voice_clone_prompt=prompt,non_streaming_mode=True,max_new_tokens=128,
                do_sample=True,temperature=0.75,top_p=1.0,
                subtalker_dosample=True,subtalker_temperature=0.8)
            wav=validate_wave(wavs[0],sr,minimum=0.6,maximum=10)
            output=args.output/style/f'{call}-carrier.wav'
            output.parent.mkdir(parents=True,exist_ok=True)
            sf.write(output,wav,sr,subtype='PCM_16')
            write_json(output.with_suffix('.json'),{'voice':style,'call':call,'targetText':text,
                'modelInputText':full_text,'seed':seed,'referenceSha256':sha256(reference),
                'carrierSha256':sha256(output),'durationSeconds':len(wav)/sr,
                'generationSeconds':time.time()-start,'sampleRate':sr})
            print(style,call,full_text,len(wav)/sr,'seconds',flush=True)

if __name__=='__main__': main()
