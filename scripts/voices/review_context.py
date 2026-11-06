#!/usr/bin/env python3
# 上下文审计：把现有报牌拼接后本地转写，并保存音频哈希与时间范围。
# Contextual audit: join existing calls for local transcription and record hashes/time ranges.
# 不修改音频、不保证声调；提示词可能影响识别，仍需试听。 / Does not alter audio or guarantee tones; prompts may bias recognition, so listening remains necessary.
# 导读：docs/VOICE-TOOLING-GUIDE.md。 / Reading guide: docs/VOICE-TOOLING-GUIDE.md.
"""Supplement isolated-word ASR with contextual transcription of all expected calls.

This improves recognition of very short Mandarin syllables but remains an
ASR-assisted review, not a human listening test. Does not alter audio assets.
"""
import argparse
from pathlib import Path
import numpy as np
from audit import decode
from generate import ROOT, VOICES, CALLS, sha256, write_json


# 命令行入口：解析路径/阶段，再执行本地文件读取、推理或审计；失败向调用者传播。
# CLI entry: parse paths/phase, then read files, infer or audit locally; failures propagate.
def main():
    p=argparse.ArgumentParser(description=__doc__)
    # 识别只读本地模型；可选 voice 限制本次报告角色，不合并旧报告。
    # ASR reads local weights; optional voice selection limits this report without merging the previous report.
    p.add_argument('--asr-model',type=Path,required=True)
    p.add_argument('--voice',choices=list(VOICES),nargs='+')
    p.add_argument('--threads',type=int,default=2)
    p.add_argument('--output',type=Path,default=ROOT/'public/voices')
    # 默认写 docs 下的上下文报告；不改音频，但会覆盖指定报告文件。
    # Default output is a docs context report; audio stays unchanged, but the selected report is overwritten.
    p.add_argument('--report',type=Path,default=ROOT/'docs/voice-context-audit.json')
    args=p.parse_args()
    from faster_whisper import WhisperModel
    model=WhisperModel(str(args.asr_model),device='cpu',compute_type='int8',
                      cpu_threads=args.threads,local_files_only=True)
    # 历史提示词仍含胡，不能把提示词列表误认为当前可播放清单；实际遍历 CALLS。
    # The historical prompt includes hu; it is not the playable inventory, which comes from CALLS.
    prompt='麻将报牌，一至九条，一至九筒，碰、胡、杠。'
    # 记录识别方法和限制；自动脚本不写人工 review 认证字段。
    # Record ASR method/limitations; this automated script does not create human review certification.
    report={'method':f'{args.asr_model.name} / CPU int8 / Chinese / beam_size=5',
            'initialPrompt':prompt,'interClipSilenceSeconds':0.35,
            'limitations':'Context assists recognition of isolated syllables; this is not subjective listening or a guarantee of pronunciation.',
            'voices':{}}
    # 按指定角色或全部角色构造连续音频；每个角色单独识别。
    # Build a sequence for selected or all voices, transcribing each voice separately.
    for style in (args.voice if args.voice else VOICES):
        pieces=[]
        calls=[]
        # offset 是拼接音频时间游标，用于把审查结果对应回每条原音频。
        # Offset is the joined-audio time cursor used to map review results back to source clips.
        offset=0.0
        # 固定字典顺序决定上下文顺序；记录实际源文件哈希以便识别过期报告。
        # Dictionary order determines context order; record source hashes to detect stale reviews.
        for call,text in CALLS.items():
            path=args.output/style/f'{call}.mp3'
            # 识别输入统一 16 kHz 单声道，与成品 24 kHz 编码不同。
            # Normalize ASR input to 16 kHz mono, distinct from 24 kHz encoded finals.
            wave=decode(path,16000)
            calls.append({'call':call,'text':text,'sha256':sha256(path),
                          'startSeconds':round(offset,4),'endSeconds':round(offset+len(wave)/16000,4)})
            # 5600 个零采样等于 0.35 秒停顿，避免报牌边界直接粘连。
            # 5600 zero samples provide a 0.35 s pause to separate calls.
            pieces.extend([wave,np.zeros(5600,dtype=np.float32)])
            # 游标累加原音频长度和停顿；上方 endSeconds 不把尾部静音算进报牌。
            # Advance by audio duration plus pause; endSeconds above excludes trailing silence.
            offset+=len(wave)/16000+0.35
        combined=np.concatenate(pieces)
        # 禁用 VAD 和前段文本条件，减少短音节被丢弃或跨段文字传递的影响。
        # Disable VAD and previous-text conditioning to limit short-call drops and cross-segment text carryover.
        segments,_=model.transcribe(combined,language='zh',beam_size=5,
            condition_on_previous_text=False,vad_filter=False,no_speech_threshold=None,
            initial_prompt=prompt)
        # 保留每段时间与平均对数概率，便于人工对照，不只保存拼接文本。
        # Retain segment timestamps and mean log probabilities for review, not only the combined transcript.
        segments=[{'start':s.start,'end':s.end,'text':s.text,'avgLogProbability':s.avg_logprob} for s in segments]
        report['voices'][style]={'calls':calls,'segments':segments,'transcript':''.join(s['text'] for s in segments)}
        print(style,report['voices'][style]['transcript'],flush=True)
        # 每完成一个角色落盘一次；中断可能留下部分报告，不能当全量审查通过。
        # Write after each completed voice; interruption may leave a partial report, not a full review pass.
        write_json(args.report,report)

if __name__=='__main__':
    main()
