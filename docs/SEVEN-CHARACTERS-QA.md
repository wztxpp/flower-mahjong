# 七角色验收记录 / Seven-character verification

日期 / Date: 2026-11-07
基线 / Baseline: `bc6d296567903e976deb87763ef80953b4502f3e`
分支 / Branch: `feature/seven-characters`
范围 / Scope: 七角色、七张统一画风立绘、四套新声音；默认三座位与显式四座位集成接口。 / Seven characters, seven restyled portraits, four new voices, default-three and explicit-four-seat integration interfaces.

## 已通过 / Passed

- 基线 `npm test`：801/801。最终角色分支 `npm test`：811/811，0失败。最终测试在女明星八/九筒替换及审计同步之后重新执行。
  Baseline tests passed 801/801; final character-branch tests passed 811/811, rerun after the two star-voice replacements and audit updates.
- `npm run lint`：0错误，4个既有警告（worker默认匿名导出、game中的kongDiscard/wasRepeat、rob-kong测试中的passAll），以及模板pages目录提示。没有新增依赖或修改npm锁文件。
  Lint has no errors and four existing warnings, plus the retained template pages-directory notice. No npm dependencies or lockfile were changed.
- `npm run build`：Vue客户端与Worker生产构建通过。`python -m py_compile scripts/voices/extend_characters.py` 与 `git diff --check` 通过。
  Production Vue/Worker build, Python syntax compilation and diff whitespace checks passed.
- 512种三人偏好组合的全部随机分支、公平概率、无竞争偏好、冲突唯一分配；4096种显式四人偏好组合、默认三人不升级。覆盖服务端开局、刷新/重连、并发请求、旧三引擎映射与隐私。
  Tests cover exhaustive three-seat random branches/probabilities, 4096 explicit four-seat preference combinations, unchanged defaults, server starts/reconnects/concurrency and all three legacy engines/privacy boundaries.
- 七角色各三座位音频路径、四号座位显式映射、预热最多三并发；真实Vue组件SSR中的七项选择/预览及三个观察视角。
  All character/seat audio paths, explicit fourth-seat mapping, bounded preloads, and real Vue SSR choices/previews/viewers passed.
- 七张1024×1536 RGBA PNG逐张查看；图像来源清单SHA-256、尺寸和透明格式测试通过。沿用原contain/top立绘布局与头像center 20%裁切，没有伪造浏览器截图。
  All seven PNGs were visually inspected and checked against provenance hashes/dimensions/alpha format. Existing portrait/thumbnail crop rules remain; no browser screenshot was fabricated.
- 新92条真实MP3，共123.28秒、1,571,344字节；全部164文件中161条当前语音、3条旧胡；原72个音频与基线逐字节一致。全部解码、时长、非静音、削波、独立哈希及来源交叉检查通过，资源测试5/5。
  The 92 new MP3s total 123.28 seconds and 1,571,344 bytes. All 164 files include 161 active calls plus three retained hu clips; the original 72 are byte-identical. Decoding/acoustic/hash/provenance checks and all five asset tests passed.

## 语音审查边界 / Voice-review limits

四角色分别使用独立原创成年声线参考和固定官方Qwen模型。没有复制旧声线、变调冒充、真人模仿、付费API或静音占位。原始逐条和完整上下文ASR保存在两份voice-characters审计JSON。
Four independently designed fictional adult references use pinned official Qwen models. No old-voice copies, pitch-shifted substitutes, real-person imitation, paid APIs or silent placeholders were used. Both audit reports retain raw isolated and contextual ASR.

女明星八/九筒曾在上下文识别为“八头/九头”，同一参考重新生成后为同音“八桶/九桶”。50项孤立ASR字面差异原样保留，多数是字形/同音差异，不能说成50条发音错误，也不能因此证明正确。地主“强杠”等声调仍需实际试听。**未完成人工主观试听，不认证声调、音色表演或每条发音完全正确。**
The two star calls improved from head-like transcriptions to homophonic bucket-like transcriptions after regeneration. Fifty literal isolated-ASR differences remain, many orthographic/homophonic; neither error nor correctness is certified by that count. Tones such as landlord's rob-kong remain listening-review items. **Human subjective listening was not completed.**

## 未完成的浏览器验收 / Browser verification not completed

真实浏览器宽/窄屏布局、触控和音响播放未完成。沙箱内Vite报告启动后，独立浏览器访问127.0.0.1返回ERR_CONNECTION_REFUSED；工作区域名terminal.local被浏览器拒绝为ERR_BLOCKED_BY_CLIENT，显式主机绑定也返回EADDRNOTAVAIL。没有换路绕过拒绝。测试服务已停止。
Real browser wide/narrow layout, touch and speaker playback were not completed. The isolated preview was unreachable at loopback; the workspace hostname was blocked by the browser and explicit hostname binding also failed. No denied route was bypassed, and preview processes were stopped.

SSR、源图检查、CSS几何约定与自动语音审计不能代替真实设备验收。集成变人数或观战分支后需在允许的可达预览里复查所有人数/视角及声音开关、刷新和反复切换。
SSR, source-image review, CSS geometry and automated audio audits do not replace real-device checks. After integrating variable seats or spectating, recheck all sizes/viewers, sound toggles, reloads and repeated transitions in an authorized reachable preview.

## 发布状态 / Publication

仅本地提交；未push、未合并远端、未部署、未改生产牌局或数据库。所有模型、环境、参考WAV保留在仓库外，网站仅包含成品与公开来源记录。
Local commits only: no push, remote merge, deployment or production-state/database change. Models, environments and intermediate references remain outside the repository.
