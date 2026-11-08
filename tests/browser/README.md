# 三客户端真实浏览器验证

2026-11-06 在 Chromium 中完成。基线为 `5f04991338b49d744377a325a470839780d8487a`，修复版浏览器资产为 `index-BHC1GQuZ.js`。详细结论见 [验收报告](../../docs/SMOOTH-PLAYBACK-VALIDATION.md)。

## 已验证

- 三个独立 localhost origin，共享测试服务器 MemoryStore；三页均读到 `document.hidden === false`、`visibilityState === 'visible'`。这是同一浏览器的三页，不是三台物理设备。
- 基线普通出牌真实请求中，三席均参与 `begin/complete`，屏障 `requiredSeats` 为 `[0,1,2]`。
- 基线给一个客户端的真实 MP3 响应人为延迟 8 秒，其他客户端显示“本机展示已结束，等待其他牌友的动画与语音”，手牌禁用。动作至慢端 complete 约 4.39 秒，实际由媒体请求超时释放，不是成功播放了 8 秒。全员等待的 AX/截图在交互时观察到，但该帧未保存成文件。
- 修复版碰牌：快端从动作到下次合法动作约710 ms；慢端 MP3 响应约延迟3501 ms。快端手牌已可选时，慢端仍显示本机动作排队。普通场景日志中没有任何 presentation POST。
- 人为注入 20 次轮询 HTTP 409：基线进入离线/自动重连横幅；修复版保持实时牌桌并显示操作确认提示。清除注入后继续同步。未把它描述成自然出现的服务端 409。
- 修复版双胡：开局后用仓库 `postHuWinClaim({multiple:true})` 合成夹具初始化 MemoryStore，通过 `assertGameInvariants`，开启该夹具的胡后自动出牌。两名玩家在原 UI 点击胡牌，观察真实双胡飞牌、共胡标记和分数；随后连续发生 1 号位补摸/自动打出、3 号位摸牌/自动打出、2 号位摸牌，牌墙 102→99。双胡日志也没有 presentation POST。

## 明确范围

验证了真实浏览器 UI、合法 API 动作、媒体请求和可见动画。没有录制带音轨视频，也没有测量实际扬声器声音的起止/波形，不能据此保证三设备声学效果。没有执行自然重复出牌请求测试，没有直接捕获反复“已重连”提示。基线 `mutate()` 的 409 与 `refresh()` 的 409 路径不同，不应声称重复出牌 409 必然导致离线。

基线静态服务缺少 `.mp3` MIME 映射；本测试适配器统一补为 `audio/mpeg`，以免把静态测试环境缺陷误判为线上音频问题。没有修改前端状态、播放回调或业务源码，没有读取真实档案或 `.data`。

## 复用隔离服务器

先在目标 checkout 构建匹配的 `dist/client`。从浏览器所在电脑的授权终端运行：

```sh
node /path/to/flower-smooth-playback/tests/browser/isolated-server.mjs \
  /path/to/chosen-checkout 5220 /path/to/validation-output
```

三个地址为 `http://localhost:5220`、`http://localhost:5221`、`http://localhost:5222`。分别在原 UI 输入合成人名，由一页建房、另外两页加入、房主开始，逐页启用语音。三个座位必须使用不同 origin 隔离 localStorage，不能只依赖浏览器会话名称。

双胡和自动出牌专项使用独立进程及新目录：

```sh
node /path/to/flower-smooth-playback/tests/browser/isolated-server.mjs \
  /path/to/chosen-checkout 5230 /path/to/double-hu-output double-hu
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

测试结束后按 Ctrl+C 停止自己启动的隔离服务器，确认进程退出；不要停止不属于本次测试的服务，也不要部署测试适配器。

## 证据与运行边界

脱敏原始日志和截图仅保存在测试者本地，不随仓库发布；公开结论与验收限制见上方链接的验收报告。
Redacted raw logs and screenshots remain local to the tester and are not published with the repository; the linked report contains public results and limits.

隔离服务器应在浏览器所在电脑启动，确保两者访问同一个 localhost；连接环境不一致时先确认运行位置，不把连接失败当作业务功能结论。
Run the isolated server on the browser computer so both use the same localhost. Verify the execution location before interpreting connection failures as application behavior.

## 可靠播放恢复复测适配器（2026-11-06）

新增开关只用于隔离 MemoryStore，不连接生产。启动第五参数 `peng` 会在真实 start 后安装已有 `pungUpgradeGame` 守恒夹具；`double-hu` 保留原夹具。

- `{"epoch":"outage-1","faultClient":0,"poll503Ms":9000}`：指定 origin 的 GET 房间轮询连续 9 秒返回明确的合成 HTTP 503。
- `{"epoch":"media-fail-1","audioFailureClient":0,"audio503Count":1}`：指定 origin 的下一次真实 MP3 请求返回 503，其后正常；应先完成预热再开启，避免故障被预热请求消费。
- `{"epoch":"late-page-1","delayPage":0,"pollDelayMs":3500}`：对日志中指定的非秘密页面序号延迟真实 GET 响应。先计算真实快照再延迟传输，不修改快照内容。

HTML 自动加载 `playback-observer.js`，在页面底部“真实音源观察”输出原生 AudioBufferSourceNode.start 成功调用及真实 ended 事件的时间、序号和音频时长。它不调用或替换播放器的 onended、不伪造完成、不改游戏或浏览器存储。一个采样长的解锁静音源也会记录，需与正常 MP3 区分。此观测确认 WebAudio 源启动/结束，不等于扬声器实际发声；URL 和公开动作历史另见 http.jsonl。观察器添加 DOM 与事件监听本身有微小开销，计时不是无插桩声学基准。

同座副页必须通过同 origin 的原房间邀请链接正常恢复，使用浏览器已有会话；不得复制/编造凭证或修改应用存储。不同 origin 是不同座，不可用于证明同座去重。

### 公开验收结果与构建分界

以下为2026-11-06的隔离合成验收。同座副页应通过浏览器正常复制标签或受支持的恢复流程继承同一会话；不同origin代表不同座位，不能用来证明同座去重。测试不读取或改写凭证、应用存储、音频回调或生产档案。
These isolated synthetic checks use normal browser duplication/resume for same-seat sessions. Different origins represent different seats and cannot prove same-seat deduplication. Tests do not inspect credentials, alter application storage/callbacks or access production records.

1. **失败拥有者向健康副页让出声音，通过，`index-8rmsW6KE.js`。** 原页一次MP3请求返回合成503，健康同座副页正常下载并完成真实音源，失败原页未重复启动该音源。
2. **静音接收多事件后不补历史，通过，`index-8rmsW6KE.js`。** 静音接收多次公开动作，解静音后没有补播积压；下一条新动作的真实音源正常开始并结束。
3. **晚基线副页不能吞共享前缀，修复后通过。** `index-CSTcT2rB.js`曾只播放较新事件，不能算通过。`index-BdXC-YIl.js`在旧页轮询延迟、同座副页正常恢复解锁后，按顺序播放两条新事件；旧页恢复无重复音源。
4. **超过5秒前台故障仍保留已收到队列，通过，`index-BdXC-YIl.js`。** 使用独立服务和守恒双胡夹具；目标页已收到含双胡与自动弃牌的7条公开历史后，注入9秒轮询503。已收音源仍顺序排空，其中一个跨网络恢复完整结束，没有清队列、跳播或重复。

第四项的故障开关为：

```json
{"epoch":"hu-queue-gap","slowClient":0,"audioDelayMs":3900,"faultClient":0,"outageAfterHistoryCount":7,"queuedOutageMs":9000}
```

开关先真实返回指定长度的历史，再让后续轮询失败。HTTP日志的 `received-queue-outage-armed` 明确标记起点。此设置避免手工故障注入晚于积压结束。

双胡抽查同属最终 `BdXC-YIl`：真实UI两人点胡，观察双胡字幕、共胡标记和积分+1/-2/+1。**102→99是剩余牌墙张数，不是积分**，来自两位已胡者连续补摸/自动打出和另一座位摸牌。快页手牌可选时慢页仍离线且本机动作排队；截图不是精确同时帧，不用于声称同步声学表现。测试请求没有presentation POST。此前710ms只属于先前碰牌测试，不声称在最终构建重测得到同一数值。

### 验收限制与清理

原始日志和截图仅保存在测试者本地，不发布其本地位置。早期手工注入发生在积压结束后，属于不足采样，不能证明上述第四项；该结论只依据收到指定历史后再注入故障的复测。
Raw logs and screenshots remain local without publishing their locations. Earlier manual injection happened after the backlog drained and is insufficient evidence; the fourth result uses the controlled received-history threshold.

未做实际扬声器录音或波形分析，也未在真实浏览器构造“超过30秒断网且仍有未播积压再开副页”的组合；这部分只由自动测试覆盖。真实MP3超时有限，不能人为伪造结束或拉长音轨来充当该实测。start/ended观察顺序也受原生事件监听器调用顺序影响；同毫秒下一源start先于本观察器ended日志不等于声学重叠。

完成后停止所有本次自建服务，保留其他项目进程。可对适配器与观察器运行 `node --check` 和 scoped ESLint；完整 `npm test`、`npm run lint`、`npm run build` 另行记录，不能把浏览器验收混称为已完成全部检查。
Stop only the servers created for this validation. Syntax/scoped lint and full repository checks must be recorded separately from browser acceptance.

## 万牌组件隔离验收 / Isolated wan component acceptance

`wan-preview.html`、`wan-preview.js`、`wan-preview-narrow.html` 与 `wan-preview-server.mjs` 只用于真实MahjongTile和生产CSS/声音资源验收，不导入App/API/FileStore，不生成可玩的成都桌。普通页展示九万的大/小规格及背面；窄屏页用390px iframe触发真实CSS媒体查询。按钮串行播放63条真实MP3，并逐条显示自然ended、媒体错误或超时，不代表主观音色认证。
The four preview files inspect the actual component, production CSS and audio without App/APIs/FileStore or a playable Chengdu table. The main page shows nine wan faces at regular/small sizes and concealed backs; a 390px iframe exercises responsive CSS. The button serially plays 63 real clips and records natural ended/error/timeout results, not subjective voice certification.

在目标仓库目录运行 `node tests/browser/wan-preview-server.mjs`，访问 `http://localhost:5374/tests/browser/wan-preview.html` 或 `wan-preview-narrow.html`。服务器显式关闭主Vite配置，使用独立127.0.0.1端口；若终端与浏览器不共享localhost，须从浏览器所在电脑的授权原生终端启动。完成后停止自建进程，禁止部署这些页面。验证范围见 [集成验收](../../docs/CHENGDU-INTEGRATION-VALIDATION.md)。
Run the server script from the target repository and open either page on localhost port 5374. It disables the main Vite config and binds a separate loopback port. If the tool shell/browser do not share localhost, start it through an authorized native terminal on the browser computer. Stop the process afterward and never deploy these pages. See the integration validation for actual scope.

## Live2D 重建隔离验收 / Isolated Live2D rebuild acceptance

`live2d-preview-server.mjs` 的5460–5463端口共享MemoryStore，可从真实App建立三/四席合成测试桌；`live2d-preview.html/js` 使用实际CharacterArtwork组件、官方Core和各自moc3，按钮把资源/192帧数值及普通WebGL上下文探测结果写入可见DOM。`tests/helpers/live2d-core-audit.js` 是Node与浏览器共用的真实Core检查，不模拟模型。缺WebGL时只准记为原图回退，不能称GPU可见通过。完整结果和未验范围见 [Live2D验收](../../docs/LIVE2D-VALIDATION.md)。
The four origins share only synthetic in-memory rooms. The isolated page uses the real component and official Core, exposing resource, 192-frame and ordinary-context results in visible DOM. Core audits are not mocked models and do not prove GPU rendering. See the validation report for exact boundaries. None of these helpers are included in the production build.

许可选择回归可传可选日志路径和起始端口：`node tests/browser/live2d-preview-server.mjs /path/to/resource-log.jsonl 5470`。只记录 SDK / 模型 / renderer 静态路径和状态，不记录 API、参数或凭证。新 origin 正常验证首次访问，无需改写浏览器存储；明确同意前诊断按钮也不可运行。实际结果见 [选择流程验收](../../docs/verification/live2d-consent-browser.md)。
For consent regression, optional arguments select a resource-only log and four fresh origins. The diagnostic button also requires explicit assent. Use a new origin instead of editing browser storage; see the linked actual results. Stop the isolated server after testing.


### 无框手牌与角色色 / Frameless hand and role palettes

稳定牌桌预览新增“本人角色”七角色选择，只替换合成快照0号位公开角色映射；不改其他座位、实际游戏、API封锁或14阶段自动矩阵。手动“短手牌居中”用于足宽牌组的左右间距，“他家补杠回应”用于currentSeat为他家时胡/过及抢杠上下文。自动审计仍使用默认小桃，不能声称自动矩阵验证了七个主题。切不同case显式卸载/重挂纯视图以规避原有跨模板v-memo复用，同case阶段不重挂，故不会掩盖局内跳动。
The stable preview adds seven own-role choices, changing only synthetic seat zero's public role mapping. Other seats, real games, API blockade and the fourteen-stage matrix stay unchanged. Manual short-hand and rob-kong views check fitting-list centering and another seat's response window. Automatic audits still use default Sweet and do not establish seven-theme coverage. Different fixture cases remount explicitly to avoid pre-existing cross-template v-memo reuse; same-case stages do not remount or hide in-game movement.

### 终局总览纯视图 / Terminal-summary view-only checks

稳定牌桌预览继续使用原 `stable-table-preview-server.mjs`，默认5518，可传独立端口。它只导入真实App/CSS与合成视图，不接触API/存储。所有HTTP方法的 `/api` 路径仍返回403；客户端fetch仍限制同源非API资源，原生产开局/离桌按钮点击仍被拦截。新增例外仅为原下一局入口、弹层关闭及原生只读详情。AST改写仍严格核对原两个生命周期和一个api函数，模板/样式不改写；隔离掉onMounted后只重新注册实际 `onKey`，卸载配对移除，不恢复轮询、网络、初始化或媒体流程。
The existing preview server still loads real App/CSS with synthetic views only. Server/client API boundaries and blocked gameplay/departure controls remain. Only the existing local choice trigger, close button and native details are usable. AST guards still require exactly two original lifecycle hooks and one API function, without rewriting templates/styles. The isolated preview registers only the actual keyboard handler and removes it on unmount, never restoring network lifecycles.

先选择玩法、真实宽度1280/390/320及高度760/560/420，点“切换合成画面”；再选择正常、缺字段、长内容或整个摘要缺失样例。“载入并查看终局”只显示既有终局并调用原 `openNextRound`；“模拟现场终局”先注入同局进行中、再注入终局，观察玩家自动打开与观众不自动打开。“同局轮询”只增加本地视图revision，“切换新局”替换游戏ID并清理旧弹层。关闭后同局轮询不应重开，手动入口仍可用。切换新局不调用任何开局API。
Apply a mode and real viewport width/height before loading a normal, missing-field, long or absent summary. Loading opens a finished snapshot manually; simulated live finish injects active then terminal views of one game. Polling changes only local revision, and new-game simulation changes the synthetic ID without an API action. Dismissed same-game polls must not reopen the dialog; spectators never auto-open.

“记录弹层DOM”输出真实边界、唯一内容滚动区的client/scroll尺寸、玩家文字、details状态和当前焦点，不改焦点或滚动。外层可见JSON保持有界，完整数据留在原始JSON节点。人工验证Tab/Shift+Tab首尾循环、Escape、关闭恢复、长胡牌详情展开/收起、320px换行、420px短屏底部按钮可达。正式验收前冻结src与预览代码，重启服务器并reload；HMR重挂App会清空隔离session，不能把热更新造成的重置当成生产离桌。此夹具不能证明真实开局请求或生产网络成功，相关行为由已有模拟请求及API回归覆盖。
The measurement button records real geometry, scroll dimensions, text, details and focus without changing them. Perform actual key and visual checks separately. Freeze source/preview files, restart and reload before final acceptance: HMR remounts clear the isolated session and are not evidence of a production departure bug. This fixture cannot establish real starts or production network success; existing request/API tests cover those contracts.
