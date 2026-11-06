#!/usr/bin/env python3
# 短词补救第二步：按已复核边界裁剪，覆盖指定报牌的成品及生成记录。
# Short-call rescue step two: crop at reviewed boundaries and replace the selected final clip/metadata.
# 这不是自动词边界检测；操作前确认只含完整目标词。 / This is not automatic word alignment; confirm the crop contains only the complete target call.
# 导读：docs/VOICE-TOOLING-GUIDE.md。 / Reading guide: docs/VOICE-TOOLING-GUIDE.md.
"""Extract a reviewed target call from a carrier phrase at explicit boundaries.

Only use after checking the full carrier's words and confirming that start/end
are silence boundaries enclosing the complete target call and no extra speech.
"""
import argparse
import json
from pathlib import Path
import numpy as np
from generate import encode, generation_identity, validate_wave, write_json, sha256


# 命令行入口：解析路径/阶段，再执行本地文件读取、推理或审计；失败向调用者传播。
# CLI entry: parse paths/phase, then read files, infer or audit locally; failures propagate.
def main():
    p=argparse.ArgumentParser(description=__doc__)
    # carrier 必须带同名 JSON；start/end 是经复核的秒数，不是采样索引。
    # Carrier requires matching JSON; start/end are reviewed seconds, not sample indexes.
    p.add_argument('--carrier',type=Path,required=True)
    p.add_argument('--start',type=float,required=True)
    p.add_argument('--end',type=float,required=True)
    # work-dir 保存新切片 WAV/元数据；output 的对应成品 MP3 会被替换。
    # Work-dir holds cropped WAV/metadata; the corresponding final MP3 in output will be replaced.
    p.add_argument('--work-dir',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    args=p.parse_args()
    import soundfile as sf
    # 读取来源描述；此脚本不会比较载体实际哈希与 JSON 中 carrierSha256，须先核实。
    # Read provenance; this script does not compare actual carrier hash to carrierSha256, so verify it first.
    meta=json.loads(args.carrier.with_suffix('.json').read_text())
    original,sr=sf.read(args.carrier,dtype='float32')
    # 确保起止顺序和范围合法；该断言不能判断是否切断音节或混入前缀。
    # Check boundary ordering/range; this assertion cannot detect cut syllables or unwanted prefix speech.
    assert 0<=args.start<args.end<=len(original)/sr
    # 秒乘采样率后四舍五入，Python 切片不含终点；再检查切片的时长和能量。
    # Round seconds times sample rate to sample indexes; slicing excludes the end, then validate duration/energy.
    wav=validate_wave(original[round(args.start*sr):round(args.end*sr)],sr)
    # 角色/报牌键来自来源 JSON，必须使用可信的本地制作记录。
    # Voice/call keys come from provenance JSON, so use trusted local authoring records.
    style,call=meta['voice'],meta['call']
    wave_path=args.work_dir/style/f'{call}.wav'
    wave_path.parent.mkdir(parents=True,exist_ok=True)
    sf.write(wave_path,wav,sr,subtype='PCM_16')
    target=args.output/style/f'{call}.mp3'
    # 沿用统一响度与 MP3 编码配置，解码通过后才替换目标。
    # Use shared normalization/MP3 settings; replace the target only after decoding succeeds.
    encode(wave_path,target)
    # 把原始载体元数据与裁剪范围写入新记录，保留来源链而不伪装为直接生成。
    # Store carrier metadata and crop bounds in the new record, preserving provenance rather than claiming direct generation.
    write_json(wave_path.with_suffix('.json'),{
       'identity':generation_identity(style,call),'seed':meta['seed'],
       'referenceSha256':meta['referenceSha256'],'sha256':sha256(target),
       'wavSha256':sha256(wave_path),'sampleRate':sr,'durationSeconds':len(wav)/sr,
       'wavClippingFraction':float(np.mean(np.abs(wav)>=.999)),
       'rms':float(np.sqrt(np.mean(wav**2))),'mp3Bytes':target.stat().st_size,
       'mp3DecodeChecked':True,'carrier':meta,
       'crop':{'startSeconds':args.start,'endSeconds':args.end,
               'method':'Explicit bounds chosen from carrier ASR word timestamps and waveform silence; target call only.'}})
    # 输出路径和新哈希便于核对；后续仍需重新审计，不沿用旧音频复核。
    # Print path/new hash for verification; rerun audits rather than reusing old recording reviews.
    print(target,sha256(target),flush=True)

if __name__=='__main__': main()
