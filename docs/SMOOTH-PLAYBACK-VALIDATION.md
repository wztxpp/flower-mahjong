# 平滑播放验收 / Smooth-playback validation

## 基线与范围 / Baseline and scope

- 基线 / Baseline: `5f04991338b49d744377a325a470839780d8487a`.
- 本地分支 / Local branch: `fix/smooth-playback-20261106`.
- 仅隔离合成 MemoryStore 牌局；未访问真实用户牌局、生产档案或部署。 / Only isolated synthetic MemoryStore rooms were used; no real games, production records or deployment.
- 三个真实 Chromium 页面通过不同 localhost origin 隔离身份；均检查为 visible，不冒称三台物理设备。 / Three real Chromium pages use different localhost origins for isolated identities and were checked visible; these are not three physical devices.
- 规则引擎三个版本、style.css、tabletop.css 与基线逐字节相同。 / All three engines and both CSS files are byte-identical to baseline.

## 已完成自动检查 / Completed automated checks

- `npm test`: 749/749通过。 / 749/749 pass.
- `npm run lint`: 0错误、4项既有警告。 / No errors and four pre-existing warnings.
- `npm run build`: Vue/Worker生产构建通过。 / Vue/Worker production build passes.
- `git diff --check`: 通过。 / Passes.
- 没有声称全项目TypeScript检查通过；项目原有模板类型限制未纳入本次改动。 / No repository-wide TypeScript pass is claimed; known template typing limits are outside this change.

新增重点验证包括完整本地FIFO、两条赢家语音独立失败、超过650ms的冷下载、取消后新代、音画先后两种完成顺序、跨段多次胡定位、普通无声字幕、同座锁竞争、精确事件去重、GET心跳/租约竞争、身份重验、未知写入结果不重试、local节拍、真实claim和旧局/续局兼容。
Focused coverage includes complete FIFO delivery, independent winner-clip failures, cold downloads beyond 650ms, cancellation generations, both audio/visual completion orders, multi-win indexes, silent captions, sibling lock races, exact-event deduplication, authenticated GET contention, unknown write outcomes, local cadence, real claims and compatibility.

## 第一阶段真实浏览器对照 / First-stage real-browser comparisons

本节对应本地修复提交 `af4c442`，后续边界修复另列于下；不把不同构建的证据混称一次验收。
This section covers local fix af4c442. Later boundary fixes are listed separately below; evidence from different builds is not presented as one run.

### 慢音频 / Slow media

基线人为把第三客户端实际MP3响应延迟8秒。客户端4秒下载上限会先触发，因此这不是“完整等8秒”的结论。快端碰牌后确实显示“本机展示已结束，等待其他牌友的动画与语音”，11张手牌禁用；服务端约4.39秒后才放行。
The baseline artificially delayed one client's actual MP3 response by eight seconds. Its four-second client timeout fired first, so this does not prove eight seconds of playback waiting. A fast page visibly showed the all-player waiting message with eleven disabled hand tiles after peng; authority released after about 4.39 seconds.

修复版把慢端实际MP3响应延迟3.5秒。快端碰牌后710毫秒已得到9个合法动作，约2.2秒时快端手牌可选而慢端仍显示“本机动作按顺序播放”。本场景没有任何 `/presentation` POST；声音慢不会形成全员回执屏障。
With the fix, an actual MP3 response was delayed 3.5 seconds. The fast page obtained nine legal actions 710ms after peng; at about 2.2 seconds its hand was selectable while the slow page still showed local sequential playback. The scenario made no presentation-receipt POSTs, confirming no all-seat audio barrier.

### 轮询409 / Polling 409

测试适配器显式注入普通 `STALE_STATE` 409，未伪称线上自然发生。基线真实显示黄色断线/自动重连条并禁用操作；修复版连续20个注入409只显示同步状态，没有假离线黄条。真实心跳CAS竞争的产生与服务端修复由独立MemoryStore确定性测试验证。
The adapter explicitly injected ordinary STALE_STATE 409 responses; these were not presented as organic production failures. The baseline showed a yellow offline/reconnect banner and disabled controls. Twenty injected conflicts in the fixed version showed synchronization without the false offline banner. Separate deterministic MemoryStore tests cover the actual heartbeat CAS race and server fix.

### 双胡与自动链 / Simultaneous wins and automatic turns

隔离测试适配器在合成新局使用 `postHuWinClaim({multiple:true})` 并通过 `assertGameInvariants`，没有修改浏览器状态或真实牌局。两页分别点击原UI的“胡牌”；实际捕获原飞牌动画、双胡字幕、共胡引用，积分为+1/-2/+1。之后真实UI历史依次出现一号位摸后自动打出一条、三号位摸后自动打出一条，再到二号位摸牌可操作。截图为 `double-hu-flight.png`。
The isolated adapter used the invariant-checked synthetic double-win fixture at a test start, without changing browser application state or real games. Two pages clicked the original Hu controls. Existing flights, dual captions and the shared-win reference appeared with scores +1/-2/+1. The real history then showed seat zero's automatic one-bamboo discard, seat two's automatic one-bamboo discard, and seat one's actionable draw. Evidence: double-hu-flight.png.

## 证据和限制 / Evidence and limits

公开HTTP时间线只记录状态码、版本、段ID和媒体路径/耗时，不保存凭证或暗手牌。截图包括 `baseline-poll409-offline.png`、`fast-ready-while-slow-pending.png`、`fixed-poll409-online.png`；由本次验收的证据附件交付，不将生成图片或原始日志混入业务源码。
Public HTTP traces contain status, revision, segment IDs and media paths/timing, never credentials or concealed hands. Screenshots are delivered as evidence separately from maintained source.

截图、页面真实状态和HTTP日志可证实UI/网络行为，不等于录制了系统输出音轨。音频解码、播放完成回调、超时及保序机制同时由实际音频类的注入式测试验证。真机移动端、不同网络环境、声学主观体验仍未验证。
Screenshots, real page state and HTTP traces establish UI/network behavior, not a recorded system audio track. Real audio-class injection tests separately verify decoding/playback-completion mechanics, bounds and ordering. Physical mobile devices, distinct network conditions and subjective acoustic experience remain unverified.

服务端只保存固定段节拍，不保证全球同时播放。local同前台会话的网络缺口不自动丢队列；后台、换桌/换局保留明确生命周期取消。媒体不可用时保留视觉事件和故障提示，失败头部有1200毫秒同座接力窗口后记录失败终态，不能承诺无法下载的声音仍能播放。无Web Locks/存储时只保证页内顺序，多个副页可能重复发声。
The server paces segments rather than synchronizing worldwide playback. Foreground local transport gaps never automatically discard queues; background/room/game lifecycle cancellation remains explicit. Unavailable media retains visuals/failure feedback and a bounded 1200ms sibling-recovery window before terminal failure. Unavailable bytes cannot be heard. Without locks/storage, ordering is page-local and sibling audio can duplicate.

同座新副页可能补齐既有共享起点的语音前缀；每页画面仍按实际收到的本地事件展示，不重建未收到的历史暗牌，也不声称多页画面同时同步。没有可靠全页关闭证明时，已有同局起点不会因30秒过期而前移，因此重开同局后下一现场事件可能补播未完成前缀；本地加共享待播达到8段可主动略过。
A new sibling may recover an established voice prefix while each page renders its actually received event queue. Unseen historical concealed hands are never reconstructed, and sibling visuals are not globally synchronized. Without reliable proof that every page closed, a same-game floor never advances on a thirty-second timeout. A reopened game may recover unfinished speech on its next live event; eight local-plus-shared pending segments expose explicit skip.


## 独立审查后的边界修复 / Boundary repairs after independent review

四项原缺陷均有代码与回归：大于5秒前台网络恢复保留已收到待播；音频每事件真实成功才共享记账、失败可由副页恢复；完整公共历史前缀保证共享声音顺序；静音期间新收到的事件不因取消静音而复活。另修30秒过期误重置共享起点、旧模式基线取消竞态、新副页首次浏览器音频锁定误否决旧前缀，以及共享隐藏积压未计入略过按钮。
Code and regressions cover all four original defects: preserve received speech across foreground gaps over five seconds; record only actual per-event audio success with sibling recovery; order shared audio by the complete public history prefix; and never revive muted-period new events on unmute. Additional repairs cover thirty-second floor resets, legacy-baseline cancellation, an initially autoplay-locked new sibling wrongly denying old shared history, and hidden shared backlog missing from the skip control.

当前自动验证构建为 `index-BdXC-YIl.js`。17项较早共享测试已扩为22项；UI使用实际音频返回结构，并共享同一Storage模拟同座副页，不把每次setup创建的独立存储误当成同浏览器。真实浏览器再次揭示locked基线缺陷后才增加该回归，不能以初版全绿推断真实多页已通过。
The current automated-validation build is index-BdXC-YIl.js. Shared tests grew from seventeen to twenty-two; UI mocks use actual audio result shapes and one shared Storage object for siblings. The initial locked-baseline regression was added after the real browser exposed it, not inferred from the earlier green suite.

### 第二阶段真实浏览器结果 / Second-stage real-browser results

全部使用隔离合成牌局、真实原版MP3、Chromium原生复制标签和正常手势解锁。测试观察器只在原生 source.start 成功后记录，并监听 ended；不替换应用回调、不写应用状态。HTTP故障均由本地适配器明确注入，不声称线上自然复现。
All runs use isolated synthetic games, original MP3 bytes, Chromium's native duplicate-tab flow and normal user-gesture unlock. The observer records after genuine source.start and listens for ended without replacing application callbacks/state. Local HTTP faults are explicitly injected, not claimed as organic production failures.

- **失败页接力，构建8rmsW6KE。** 首个同座页MP3在12:19:02.445 UTC返回503，健康副页02.787返回200、02.797真实start，持续1.52秒并ended；失败页没有该声音start。证据：failure-owner.json、failure-sibling.json及http.jsonl。
  **Failed-owner recovery, build 8rmsW6KE.** The first sibling's MP3 failed with 503 at 12:19:02.445 UTC. The healthy sibling received 200 at 02.787, genuinely started at 02.797 and ended after the 1.52-second clip; the failed page never started it. Evidence: failure-owner.json, failure-sibling.json and http.jsonl.
- **取消静音不补旧声，构建8rmsW6KE。** 静音期间收到多次弃牌/摸牌，12:20:59取消静音后10秒仅出现单采样解锁源，没有旧MP3；12:21:09的新弃牌正常start/ended。证据：muted-before.json、muted-after-unmute.json、muted-no-backlog.json、muted-fresh-audio.json与对应截图。
  **No muted backlog, build 8rmsW6KE.** Several discards/draws arrived muted. For ten seconds after unmuting at 12:20:59, only the single-sample unlock source appeared, with no old MP3. A fresh discard at 12:21:09 started/ended normally. Evidence: the muted-* observations and screenshot.
- **真实首次locked副页排序，最终构建BdXC-YIl。** 前一构建CSTcT2rB确实漏掉事件1，保留order-late-page与order-old-page证据为失败记录。修复后旧页GET延迟20秒，新副页在事件1后正常加载、解锁并先收到事件2：先播放4条（12:26:33.794→35.472），再播放2条（35.482→36.536）。旧页随后恢复没有重复。证据：order-fixed-new.json、order-fixed-old.json、order-fixed.png。
  **Initially locked sibling order, final build BdXC-YIl.** The previous CSTcT2rB build genuinely lost event 1; order-late-page and order-old-page remain failure evidence. After repair, a new sibling loads normally after event 1, unlocks and receives event 2 before an old page delayed 20 seconds. It voices 4-bamboo from 12:26:33.794 to 35.472, then 2-bamboo from 35.482 to 36.536. The recovered old page produces no duplicate. Evidence: order-fixed-new.json, order-fixed-old.json and order-fixed.png.
- **已收到队列跨9秒轮询故障，最终构建BdXC-YIl。** 目标页12:29:08.306已收到history长度7，含双胡与两次自动弃牌；适配器随后让它的轮询503约9秒。第一弃牌11.539 start、13.055 ended；第二弃牌下载13.059→16.960，16.964 start、18.328 ended。17.402恢复快照没有取消正在播放的第二条。快页10.453已播完四条声音，稍后手牌可选，目标页仍离线且本地排队；全程0次presentation POST。原双胡飞牌与共胡展示也已捕获。证据：hu/slow-audio.json、hu/fast-audio.json、hu/http.jsonl、hu/slow-offline-pending.png、hu/fast-ready-while-slow-pending.png、hu/double-hu-flight.png、hu/recovered.png。
  **Received queue across nine seconds of polling failure, final build BdXC-YIl.** The target received history length 7, including dual wins and two automatic discards, at 12:29:08.306 before roughly nine seconds of 503 polls. Its first discard starts at 11.539 and ends 13.055; the second loads 13.059–16.960, starts 16.964 and ends 18.328. Recovery at 17.402 does not cancel it. The fast page completes all four voices by 10.453 and has selectable tiles while the target remains offline/queued. There are zero presentation POSTs. Existing double-win flights/shared-win rendering were captured. Evidence: the hu/ JSON, HTTP trace and named screenshots.

首次普通操作的断网试跑在注入时队列已经排空，因此不算“已收到队列跨断网”通过；最终双胡自动链才覆盖这一强边界。60秒断网加新副页、40条隐藏前缀和主动略过由自动回归覆盖，未冒称真实浏览器完成这三项。四项浏览器结果来自上述明确构建，最终构建未重复第一、第二项；相关最终代码仍通过完整自动检查。系统扬声器输出音轨、手机真机和不同物理设备仍未录制/验证。
The first ordinary-action outage trial had no remaining queue and does not count as the strong backlog test; the final dual-win automatic chain supplies that evidence. Sixty-second gaps with a new sibling, forty hidden voices and explicit skip are automated-regression coverage, not claimed real-browser passes. The four browser findings belong to their stated builds; the final build did not repeat the first two, while its complete automated checks pass. System-output audio tracks, physical mobile devices and separate physical computers remain unverified.
