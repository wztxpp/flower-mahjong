# 三客户端真实浏览器验证

2026-11-06 在官方 Chromium 中完成。基线为 `5f04991338b49d744377a325a470839780d8487a`，修复版浏览器资产为 `index-BHC1GQuZ.js`。详细结论见 [验收报告](../../docs/SMOOTH-PLAYBACK-VALIDATION.md)。

## 已验证

- 三个独立 localhost origin，共享测试服务器 MemoryStore；三页均读到 `document.hidden === false`、`visibilityState === 'visible'`。这是同一浏览器的三页，不是三台物理设备。
- 基线普通出牌真实请求中，三席均参与 `begin/complete`，屏障 `requiredSeats` 为 `[0,1,2]`。
- 基线给一个客户端的真实 MP3 响应人为延迟 8 秒，其他客户端显示“本机展示已结束，等待其他牌友的动画与语音”，手牌禁用。动作至慢端 complete 约 4.39 秒，实际由媒体请求超时释放，不是成功播放了 8 秒。全员等待的 AX/截图在交互时观察到，但该帧未保存成文件。
- 修复版碰牌：动作 `11:12:14.948Z`，快端下次合法动作 `11:12:15.658Z`（710 ms）；慢端 MP3 从 `11:12:15.307Z` 延迟到 `11:12:18.807Z`（约 3501 ms）。快端手牌已可选时，慢端仍显示本机动作排队。普通场景日志中没有任何 presentation POST。
- 人为注入 20 次轮询 HTTP 409：基线进入离线/自动重连横幅；修复版保持实时牌桌并显示操作确认提示。清除注入后继续同步。未把它描述成自然出现的服务端 409。
- 修复版双胡：开局后用仓库 `postHuWinClaim({multiple:true})` 合成夹具初始化 MemoryStore，通过 `assertGameInvariants`，开启该夹具的胡后自动出牌。两名玩家在原 UI 点击胡牌，观察真实双胡飞牌、共胡标记和分数；随后连续发生 1 号位补摸/自动打出、3 号位摸牌/自动打出、2 号位摸牌，牌墙 102→99。双胡日志也没有 presentation POST。

## 明确范围

验证了真实浏览器 UI、合法 API 动作、媒体请求和可见动画。没有录制带音轨视频，也没有测量实际扬声器声音的起止/波形，不能据此保证三设备声学效果。没有执行自然重复出牌请求测试，没有直接捕获反复“已重连”提示。基线 `mutate()` 的 409 与 `refresh()` 的 409 路径不同，不应声称重复出牌 409 必然导致离线。

基线静态服务缺少 `.mp3` MIME 映射；本测试适配器统一补为 `audio/mpeg`，以免把静态测试环境缺陷误判为线上音频问题。没有修改前端状态、播放回调或业务源码，没有读取真实档案或 `.data`。

## 复用隔离服务器

先在目标 checkout 构建匹配的 `dist/client`。从浏览器所在电脑的授权终端运行：

```sh
node /path/to/flower-smooth-playback/tests/browser/isolated-server.mjs \
  /path/to/chosen-checkout 5220 /tmp/mahjong-browser-evidence
```

三个地址为 `http://localhost:5220`、`http://localhost:5221`、`http://localhost:5222`。分别在原 UI 输入合成人名，由一页建房、另外两页加入、房主开始，逐页启用语音。不同 `sessionName` 在此次 CUA 环境没有隔离 localStorage，因此必须用不同 origin，不能只依赖会话名。所有浏览器交互通过官方 CUA 完成。

双胡和自动出牌专项使用独立进程及新目录：

```sh
node /path/to/flower-smooth-playback/tests/browser/isolated-server.mjs \
  /path/to/chosen-checkout 5230 /tmp/mahjong-browser-hu double-hu
```

建房、两页加入、开始后，0 号和 2 号客户端分别点击“胡牌”。合成夹具只在明确传入 `double-hu` 时安装，不会加载任何真实牌局文件。

服务器仅监听 127.0.0.1，所有牌局驻留内存。`http.jsonl` 仅记录状态码、路径、公开版本/屏障字段与延时，不记录凭证、请求体或暗手牌快照。不要发布此适配器。

### 显式故障开关

在对应证据目录写 `control.json`，每次更换 `epoch`：

```json
{"epoch":"slow-1","slowClient":1,"audioDelayMs":3500}
```

这只延迟真实 MP3 响应，不伪造播放结束。8 秒测试会超过客户端请求超时，不能用来证明完整播放。

```json
{"epoch":"conflict-1","faultClient":0,"poll409Count":20}
```

这人为返回轮询 409，不是证明生产中自然出现 409。清除故障：

```json
{"epoch":"clear-1"}
```

按 Ctrl+C 停止自己启动的服务器。此次原始 5197 服务、5210–5212 基线、5220–5222 修复、5230–5232 双胡进程均已停止；早期两个沙箱测试进程也以 SIGINT 结束。没有部署服务。

## 保留证据

这些是本次运行产生的工作区文件，不随脚本提交：

- `/workspace/shared/mahjong-browser-evidence/baseline-http.jsonl`
- `/workspace/shared/mahjong-browser-evidence/baseline-poll409-offline.png`
- `/workspace/shared/mahjong-browser-fixed/http.jsonl`
- `/workspace/shared/mahjong-browser-fixed/fast-ready-while-slow-pending.png`
- `/workspace/shared/mahjong-browser-fixed/fixed-poll409-online.png`
- `/workspace/shared/mahjong-browser-hu/http.jsonl`
- `/workspace/shared/mahjong-browser-hu/double-hu-flight.png`

早期 exec 沙箱服务器与官方浏览器不共享 localhost，因此首次导航被拒绝。后来在官方电脑的原生终端启动相同隔离适配器后完成上述实测；这一早期环境阻碍不是最终验收结论。

## 可靠播放恢复复测适配器（2026-11-06）

新增开关只用于隔离 MemoryStore，不连接生产。启动第五参数 `peng` 会在真实 start 后安装已有 `pungUpgradeGame` 守恒夹具；`double-hu` 保留原夹具。

- `{"epoch":"outage-1","faultClient":0,"poll503Ms":9000}`：指定 origin 的 GET 房间轮询连续 9 秒返回明确的合成 HTTP 503。
- `{"epoch":"media-fail-1","audioFailureClient":0,"audio503Count":1}`：指定 origin 的下一次真实 MP3 请求返回 503，其后正常；应先完成预热再开启，避免故障被预热请求消费。
- `{"epoch":"late-page-1","delayPage":0,"pollDelayMs":3500}`：对日志中指定的非秘密页面序号延迟真实 GET 响应。先计算真实快照再延迟传输，不修改快照内容。

HTML 自动加载 `playback-observer.js`，在页面底部“真实音源观察”输出原生 AudioBufferSourceNode.start 成功调用及真实 ended 事件的时间、序号和音频时长。它不调用或替换播放器的 onended、不伪造完成、不改游戏或浏览器存储。一个采样长的解锁静音源也会记录，需与正常 MP3 区分。此观测确认 WebAudio 源启动/结束，不等于扬声器实际发声；URL 和公开动作历史另见 http.jsonl。观察器添加 DOM 与事件监听本身有微小开销，计时不是无插桩声学基准。

同座副页必须通过同 origin 的原房间邀请链接正常恢复，使用浏览器已有会话；不得复制/编造凭证或修改应用存储。不同 origin 是不同座，不可用于证明同座去重。

### 本次真实验收结果与构建分界

以下均为 2026-11-06 UTC 时刻。同一官方 Chromium、三种 localhost origin；同座副页由 Chromium 标签右键菜单“复制”产生，正常继承 sessionStorage 后走原邀请 resume。普通新建同 origin 标签不继承座位凭证，不能替代此操作。没有读取或改写凭证、localStorage、应用内存、音频回调或生产档案。

1. **失败拥有者向健康副页让出声音，已通过，`index-8rmsW6KE.js`。** 12:19:02.445 原页的 sunny/tiao-1 返回显式单次 503；同 origin 健康副页 02.787 得到真实 MP3，原生 start 02.797、ended 04.315（1.52 秒）。失败原页只有解锁静音源，无该语音 start。证据 `failure-owner.json`、`failure-sibling.json`、根 `http.jsonl`。
2. **静音接收多事件后不补历史，已通过，`index-8rmsW6KE.js`。** 第三座静音接收“第二座4条”“第一座2条”和中间摸牌；12:20:59.713 解静音后，直到12:21:09新动作前仅有一个采样长的解锁源。新“第三座5条”12:21:09.546 start，11.221 ended，证明播放器恢复正常而非一直不发声。证据 `muted-before.json`、`muted-after-unmute.json`、`muted-no-backlog.json`、`muted-fresh-audio.json/.png`。
3. **晚基线副页不能吞共享前缀，先发现失败，后修复通过。**
   - 失败构建 `index-CSTcT2rB.js`：原页 GET 延迟20秒；12:22:31.951提交事件1“第二座6条”。新同座复制页12:22:45.185正常 locked resume，手势解锁后12:23:05.444提交事件2“第一座3条”，却只播3条（start05.475，时长0.8秒）。原页12:23:33.831自动恢复后也没有播6条。`order-old-page-before.json` 与 `order-old-page-after.json` 相同，`order-late-page.json` 只有事件2；保留 `order-late-page.png`、`order-old-page-after.png`。这是已修的真实漏播证据，不能算最终通过。
   - 修复构建 `index-BdXC-YIl.js`：旧第三座页 GET 延迟20秒；事件1为“第一座4条”，新第三座复制页先以locked baseline恢复，再正常解锁并提交事件2“第三座2条”。新页先播 sunny/tiao-4：12:26:33.794 start→35.472 ended；再播 elegant/tiao-2：35.482 start→36.536 ended。旧页恢复无重复音源。证据 `order-fixed-new.json`、`order-fixed-old.json`、`order-fixed.png`。
4. **超过5秒前台故障仍保留已收到队列，已通过，`index-BdXC-YIl.js`。** 使用独立5250–5252服务及守恒双胡夹具。目标第一页在12:29:08.306已收到7条公开历史（包含两次胡和两次自动弃牌），随后自动注入9秒轮询503。已收音频仍顺序排空：第一弃牌 sunny/tiao-1 在11.539 start→13.055 ended；第二弃牌 elegant/tiao-1下载13.059→16.960、16.964 start→18.328 ended。GET在17.402恢复200，第二音源跨恢复完整结束，无清队列、跳播或重复。证据 `hu/http.jsonl`、`hu/slow-audio.json`、`hu/slow-offline-pending.png`、`hu/recovered.png`。

第四项的故障开关为：

```json
{"epoch":"hu-queue-gap","slowClient":0,"audioDelayMs":3900,"faultClient":0,"outageAfterHistoryCount":7,"queuedOutageMs":9000}
```

开关先真实返回指定长度的历史，再让后续轮询失败。HTTP日志的 `received-queue-outage-armed` 明确标记起点。此设置避免手工故障注入晚于积压结束。

双胡抽查同属最终 `BdXC-YIl`：真实 UI 两人点胡，观察双胡字幕、共胡标记、积分 +1/-2/+1；**102→99是剩余牌墙张数，不是积分**，来自两位已胡者连续补摸/自动打出和第二座摸牌。`hu/double-hu-flight.png` 留图。快第二座四条语音在12:29:10.453全部 ended；约13秒的AX观察显示其手牌可选，慢第一页仍离线且本机动作排队。`hu/fast-audio.json`、`hu/fast-ready-while-slow-pending.png`、`hu/slow-offline-pending.png` 留存；快页截图本身不是精确同时帧，时序以已记录AX和音源/HTTP日志为准。所有本次双胡请求中 presentation POST 数为0。原710ms性能数值仍只归属于上方此前测试，没有宣称在最终构建重复测得710ms。

### 证据解释与清理

全部本次证据位于 `/workspace/shared/mahjong-recovery-browser-evidence/`，`hu/` 是单独进程。`outage-observed.json`、`outage-recovered.json` 属于早期手工注入的不足采样：注入时积压已经结束，**不可用它们证明第四项**。强边界只引用后来的 `hu/` 实测。

未做实际扬声器录音或波形分析，也未在真实浏览器构造“超过30秒断网且仍有未播积压再开副页”的组合；这部分只由自动测试覆盖。真实MP3超时有限，不能人为伪造结束或拉长音轨来充当该实测。start/ended观察顺序也受原生事件监听器调用顺序影响；同毫秒下一源start先于本观察器ended日志不等于声学重叠。

5240–5242与5250–5252两个自建服务均已在原生Terminal Ctrl+C停止，分别通过该标签出现 `^C` 和shell提示符截图确认。未部署。最后对适配器与观察器执行 `node --check` 及 scoped ESLint通过；ESLint仅输出仓库既有 pages目录提示。完整npm test/lint/build由父任务统一验收，此浏览器工作没有重复宣称运行。

## 万牌组件隔离验收 / Isolated wan component acceptance

`wan-preview.html`、`wan-preview.js`、`wan-preview-narrow.html` 与 `wan-preview-server.mjs` 只用于真实MahjongTile和生产CSS/声音资源验收，不导入App/API/FileStore，不生成可玩的成都桌。普通页展示九万的大/小规格及背面；窄屏页用390px iframe触发真实CSS媒体查询。按钮串行播放63条真实MP3，并逐条显示自然ended、媒体错误或超时，不代表主观音色认证。
The four preview files inspect the actual component, production CSS and audio without App/APIs/FileStore or a playable Chengdu table. The main page shows nine wan faces at regular/small sizes and concealed backs; a 390px iframe exercises responsive CSS. The button serially plays 63 real clips and records natural ended/error/timeout results, not subjective voice certification.

在目标仓库目录运行 `node tests/browser/wan-preview-server.mjs`，访问 `http://localhost:5374/tests/browser/wan-preview.html` 或 `wan-preview-narrow.html`。服务器显式关闭主Vite配置，使用独立127.0.0.1端口；若工具shell与官方浏览器不共享localhost，须从浏览器所在电脑的授权原生终端启动。完成后停止自建进程，禁止部署这些页面。验证范围见 [集成验收](../../docs/CHENGDU-INTEGRATION-VALIDATION.md)。
Run the server script from the target repository and open either page on localhost port 5374. It disables the main Vite config and binds a separate loopback port. If the tool shell/browser do not share localhost, start it through an authorized native terminal on the browser computer. Stop the process afterward and never deploy these pages. See the integration validation for actual scope.
