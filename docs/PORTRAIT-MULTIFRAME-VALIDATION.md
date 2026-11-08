# 多帧原图动画验收 / Multi-frame original-art validation

2026-11-08，本地候选基于 main `712f00e`，本报告不是发布记录。
Local candidate dated 2026-11-08, based on main `712f00e`; this is not a publication record.

## 实际交付 / Implemented result

七人保留原始睁眼PNG；每人四张ImageGen眼睑供体与原图构成五种形态，按闭合/睁开九段序列播放，不用透明叠化制造“半闭眼”。标签20/50/80不是精确闭合百分比。紫衣80采用重新生成的v2。眼部atlas共910,021字节，局部裁剪逐像素可追溯。
Seven unchanged open-eye originals plus four ImageGen eyelid donors per character provide five actual shapes in a nine-segment closing/opening sequence. No alpha blend fabricates half-closed eyes. Numeric pose labels are approximate, and elegant uses the revised eye80 donor. Local eye atlas crops are pixel-traceable; the seven atlases total 910,021 bytes.

头发使用原图纹理连续局部几何反采样，每时刻只有一个位置。发根、末端和蒙版边界固定，不摇整图。ImageGen头发供体及烘焙帧叠化出现双线而被淘汰，不能宣称现有发丝动画全部由ImageGen制作，也不是Live2D。
Hair uses continuous local inverse sampling of original texture, with a single pose per instant and pinned roots, ends and mask boundaries. Rejected generated-pose/baked-pose alpha transitions produced double outlines. Current hair motion is neither wholly ImageGen-generated nor Live2D.

## 已执行 / Executed checks

- `npm test`：1304/1304；`npm run lint`：0错误、4个原有警告；`npm run build`通过；`git diff --check`通过。
  1304 tests pass, lint has zero errors/four baseline warnings, build and diff checks pass.
- 真实Chrome Canvas2D：七人各14个源分辨率姿态，共98帧，允许眼/发区外差异0；原始姿态0变化。证据在 `verification/portrait-multiframe/browser-seven-continuous-pixels.json`。
  Actual Chrome Canvas2D: 98 source-resolution poses, zero changes outside permitted eye/hair regions and an unchanged neutral pose.
- 七人各四种实际缩放/DPR，共28例，闭眼→原图、摆发→原图、stop→原图全部残留alpha为0。
  All 28 real scaled/DPR cases clear overlay alpha after closed, sway and stop states.
- 真实四个最大动区角色、200px、8秒：各239次绘制，约29.87次/秒；P95为0.2–0.3ms，最大单次3ms，无renderer错误；四眼供体均实际呈现。计时只含draw调用，不等于浏览器总帧耗时。
  Four largest animated areas at 200px: 239 draws each in eight seconds, approximately 29.87 draws/s; P95 0.2–0.3ms, worst draw 3ms, no renderer errors, and every eye donor displayed. Draw timing is not total browser frame cost.
- 该四实例几何局部资源合计1,305,640字节，不含全部眼帧、解码峰值或浏览器内存。限并发2图、DPR/画布与区域预算、释放及超时路径均有测试。
  Geometry-local resources total 1,305,640 bytes, excluding full eye-frame resources, decode peaks and browser memory. Loading concurrency, budgets, cleanup and timeout paths are covered.
- 实际组件：胡牌/放炮显示对应原图；回base恢复；A→B→A换角、卸载/重建通过；关闭设置刷新后仍原图，重新启用及刷新恢复动态。离屏主角保持原图，进入可见区才播放。
  Actual components preserve win/discard-loss originals and resume base motion. Role changes, remounts and persisted off/on settings pass; offscreen portraits stay static.
- 本轮隔离内存牌桌：三人花麻将开局、选择/打出3条、手牌14→13；四人成都开局、四家定缺、打出3筒、手牌14→13及等待回应通过。最终素材再次验证两模式布局、自贡重连及选牌；最后追加“打出5条”未执行，不计作通过。没有生产牌局或积分写入。
  Isolated in-memory game smoke passed Flower start/discard and Chengdu start/dingque/discard, with hand counts and responses checked. Final assets were rechecked in both layouts and Flower reconnection/selection; the extra final 5-tiao discard was not executed and is not claimed passed. No production state was written.
- 21张原始基本/胡/放炮PNG逐字节保持，规则、服务端、音频、App及成都桌面逻辑和锁文件无差异。构建排除旧SDK/模型与本地诊断页。
  All 21 original PNGs are byte-identical. Rules, server, audio, app/table game logic and lockfile are unchanged. Builds exclude old SDK/models and local diagnostics.

## 视觉与范围 / Visual scope and limits

七人五眼态逐帧及实际播放、头发原生裁切与260px原/负极值/半摆/正极值已检查，未见叠图双线、根肩裂缝或面部衣帽移动。长发变化更明显；短发及小侧发依然克制。地主200px时灰鬓发尤其微弱，场峰上限约1.2–1.3显示像素，不能说七人都大幅摆发。
All eye shapes and playback, native hair crops and 260px neutral/extreme/half poses were reviewed without observed crossfade double lines, root/shoulder gaps or face/clothing/hat movement. Long locks move more visibly; short side locks remain subtle. Landlord's 200px side-lock field upper bound is only around 1.2–1.3 display pixels, not a dramatic swing.

30fps目标不保证每次卡顿都显示所有40ms中间态；最终短测试有一次调度停顿跳过回程80态，其他完整周期呈现全部形态。没有真实手机、长时温升/电池或所有浏览器性能认证。像素保护和正Jacobian不等于主观自然度保证。
The 30fps target cannot guarantee every 40ms pose under stalls; one final-test scheduling pause skipped a reopening eye80, while other complete cycles showed every shape. Real-mobile, long-duration thermal/battery and cross-browser certification were not performed. Pixel protection and a positive Jacobian do not guarantee subjective naturalness.

## 可恢复性 / Recovery

素材包已私有保存并重新下载验证272成员SHA，从独立下载包重建七人56个ROI和全部atlas，哈希与候选完全一致。报告 `verification/portrait-multiframe/asset-recovery-verification.json`。源码另存完整无前置历史bundle，并重新下载验证；具体私有备份身份由交付记录保存，不写入公开仓库。
The privately saved asset package was downloaded and verified across 272 members; all seven characters, 56 crops and atlases reproduce exactly from that isolated package. Source is separately persisted as a complete prerequisite-free bundle with download verification; private storage identifiers stay out of the repository.
