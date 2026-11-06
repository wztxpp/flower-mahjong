#!/usr/bin/env python3
# 短词补救第一步：生成带语境候选 WAV，不切片、不写成品 MP3。
# Short-call rescue step one: generate contextual candidate WAVs, without cropping or final MP3 output.
# 保持中间目录在仓库外，不上传模型或凭证。 / Keep intermediates outside the repository; never upload models or credentials.
# 导读：docs/VOICE-TOOLING-GUIDE.md。 / Reading guide: docs/VOICE-TOOLING-GUIDE.md.
"""Generate review-only carrier phrases for three uncertain short calls.

Does not publish or crop audio. Review exact words and silence/timestamps before
extracting only the target word. Uses the existing original reference voices.
"""
import argparse
from pathlib import Path
import time
from generate import VOICES, REFERENCE_TEXT, BASE_ID, load_model, validate_wave, write_json, sha256


# 命令行入口：解析路径/阶段，再执行本地文件读取、推理或审计；失败向调用者传播。
# CLI entry: parse paths/phase, then read files, infer or audit locally; failures propagate.
def main():
    p=argparse.ArgumentParser(description=__doc__)
    # model-root 是已下载模型；work-dir 提供原参考，output 仅放候选载体句。
    # Model root holds downloaded weights; work-dir supplies original references; output holds carrier candidates only.
    p.add_argument('--model-root',type=Path,required=True)
    p.add_argument('--work-dir',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    args=p.parse_args()
    import torch
    import soundfile as sf
    torch.set_num_threads(4)
    torch.set_num_interop_threads(1)
    # 沿用现有角色的 Base 克隆模型，不再次 VoiceDesign 或使用真人样本。
    # Use the Base clone model with existing characters, without redesign or real-person samples.
    model=load_model(args.model_root/BASE_ID.split('/')[-1],torch,torch.bfloat16)
    # 候选目标是已知三条历史疑难短词；这里不会重做整个语音包。
    # Targets are three historically uncertain short calls, not a rebuild of the voice pack.
    targets=[('sweet','hu','胡'),('sweet','gang','杠'),('sunny','tong-9','九筒')]
    # 按角色建立一次参考提示，再为该角色的目标词生成候选。
    # Build one reference prompt per voice, then generate its target candidates.
    for style in ['sweet','sunny']:
        reference=args.work_dir/f'{style}-reference.wav'
        # 此脚本读取参考并记录其哈希，但不像基础生成器那样核对参考身份 JSON。
        # This reads and hashes the reference but does not validate its identity JSON like the base generator.
        wave,sr=sf.read(reference,dtype='float32')
        prompt=model.create_voice_clone_prompt(ref_audio=(wave,sr),ref_text=REFERENCE_TEXT,x_vector_only_mode=False)
        # 枚举固定目标总表，索引参与种子；过滤其他角色不重排索引。
        # Enumerate the fixed target list for seed indexes; skipping other voices does not renumber indexes.
        for index,(voice,call,text) in enumerate(targets):
            # 跳过不属于当前参考角色的目标，防止套错声线。
            # Skip targets belonging to other voices to avoid using the wrong character reference.
            if style!=voice: continue
            # 前缀麻将提供语境；成品只能保留目标词，不能整句直接发布。
            # The mahjong prefix provides context; only the target word belongs in the final published clip.
            full_text=f'麻将。{text}！'
            # 3000 偏移加目标索引区分候选种子；重复运行会覆盖候选，无复用缓存。
            # Offset 3000 plus target index separates candidate seeds; reruns overwrite candidates without cache reuse.
            seed=VOICES[style]['seed']+3000+index
            torch.manual_seed(seed)
            start=time.time()
            wavs,sr=model.generate_voice_clone(text=full_text,language='Chinese',
                voice_clone_prompt=prompt,non_streaming_mode=True,max_new_tokens=128,
                do_sample=True,temperature=0.75,top_p=1.0,
                subtalker_dosample=True,subtalker_temperature=0.8)
            # 载体句比单词长，使用 0.6–10 秒窗口做基本声学筛查。
            # Carrier phrases are longer than isolated calls, so basic checks use a 0.6–10 s window.
            wav=validate_wave(wavs[0],sr,minimum=0.6,maximum=10)
            output=args.output/style/f'{call}-carrier.wav'
            output.parent.mkdir(parents=True,exist_ok=True)
            sf.write(output,wav,sr,subtype='PCM_16')
            # 保存载体全文、目标词、种子与参考/载体哈希，供后续人工选取切点。
            # Save full carrier text, target, seed and reference/carrier hashes for later reviewed cropping.
            write_json(output.with_suffix('.json'),{'voice':style,'call':call,'targetText':text,
                'modelInputText':full_text,'seed':seed,'referenceSha256':sha256(reference),
                'carrierSha256':sha256(output),'durationSeconds':len(wav)/sr,
                'generationSeconds':time.time()-start,'sampleRate':sr})
            print(style,call,full_text,len(wav)/sr,'seconds',flush=True)

if __name__=='__main__': main()
