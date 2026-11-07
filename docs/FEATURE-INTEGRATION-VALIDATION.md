# 角色、可变牌桌与观战联合验收 / Character, variable-table and spectator integration

## 范围与提交 / Scope and commits

2026-11-07在独立分支 `feature/integrated-characters-tables-spectating` 整合，不push、不合入main、不部署。来源为角色核心 `b5b2641`、立绘 `1656810`、变人数 `3cd47bf` 与文档 `d922e81`、观战 `8be3ac9355f31498bc051c84882838c492911aec`。变人数原分支的角色依赖 `ad027b7` 是 `b5b2641` 的拣入版本，不重复应用。七张立绘已经包含；随后拣入已完成语音提交 `2102cd7`，集成提交为 `cfd27a2`，不复制并行工作树的未提交文件。
On 2026-11-07 the isolated integration branch combined those source commits without pushing, merging main or deploying. The variable-table branch's character dependency is a cherry-picked equivalent, not another change to apply. Seven completed portraits are included. Completed voice source 2102cd7 was subsequently cherry-picked as cfd27a2; uncommitted parallel work was not copied.

## 冲突决策 / Conflict decisions

- 建房同时保存严格校验的3/4人配置和服务端观战签名秘密。玩家仍通过座位凭证鉴权，观众仅持独立只读能力。
  Room creation preserves both validated table settings and the private spectator signing key. Player seat credentials and read-only viewer capabilities remain separate.
- 角色映射按当前局的真实人数生成/读取，七人池不等于座位数。三人旧局缺少新规则时不回填，不改历史或账目；冻结schema1/2源码未变。
  Character maps use actual table size, not the roster size. Legacy saves are not backfilled, and frozen engines remain unchanged.
- 玩家四人视角显示左/对/右三家和四份牌河；只有玩家可获得 `four-player-table`。观众 `mySeat=null`，全席auto-fit布局，绝不标“对家”、显示本人手牌或提供开局/动作按钮。
  Four-seat players get relative left/opposite/right panels and four rivers. Only players receive the relative layout class. Spectators retain null seats, all-seat auto-fit and no own/host/action controls.
- 终局观战使用本局参与者名字；落座人数只算真实占用者，不能把离开的历史名字算成满员。部分座位列表不是人数配置，只接受3/4长度兜底，否则保持默认3人。
  Finished views preserve participant names while occupancy counts actual occupants. Partial seat arrays never become one/two-player configuration.
- 创建/加入/观战入口合并后，观众无需昵称、角色或玩法输入。玩家/观战两类缓存及迟到响应/离席边界保留。文档同时保留三个功能入口。
  Spectator admission requires no name, role or settings. Existing cache, late-response and departure boundaries remain intact.

## 自动检查 / Automated checks

- `npm test`：语音整合后920/920通过，0失败、0跳过。此前918/920的两项缺音频失败已由真实资产补齐，未删除/跳过/弱化测试。manifest为161条当前语音、3条旧胡，共164个MP3。
  After voice integration, all 920 tests pass with no failures or skips. Actual media resolves the two earlier missing-asset failures without relaxing the contracts: 161 active calls and three retained hu clips.
- `node --test tests/spectators.test.js tests/ui.test.js`：153/153通过，覆盖真实三/四人开局、四个新角色一致分配、每个玩家视角及观众、观战越权拒绝、真实出牌名字和只读存储不变。
  Spectator/UI focused coverage passes all 153 cases, including genuine starts and all player/viewer perspectives.
- `node --test tests/invitation-copy.test.js`：15/15通过。整合时曾把部分座位列表长度误作人数，导致角色人数校验异常；已在UI人数回退中修复，并全量复跑。
  All fifteen invitation tests pass after correcting the partial-seat fallback discovered during integration.
- `npm run lint`：退出0，0错误，4个既有警告（worker匿名默认导出、引擎kongDiscard/wasRepeat、rob-kong测试passAll），另有既有Next pages目录提示。
  Lint succeeds with the four pre-existing warnings and existing Next pages notice.
- `npm run build`：通过，最终浏览器产物 `index-CMjajt4k.js` / `index-C5mphHvq.css`。`git diff --check`通过。
  Production browser/Worker build and whitespace checks pass. No repository-wide TypeScript success is claimed.

## 初次真实浏览器检查（语音到齐前） / Initial browser check before voice delivery

官方Chromium与五个独立localhost origin（5380–5384）共享隔离MemoryStore，联合牌桌流程使用规则文案修正前的 `index-BZjgrH0t.js` / `index-C5mphHvq.css`，最终仅规则弹窗文案与对应派生开关改变，详见下方复测。不是五台物理设备，未连接生产数据。通过以下真实UI操作验收：
Official Chromium used five isolated origins sharing a synthetic MemoryStore and the pre-rule-text assets index-BZjgrH0t.js/index-C5mphHvq.css, not five physical devices or production data. The final text-only change received a separate browser smoke pass below.

1. 建4人、2.5副、神龙9桌，三位朋友选择地主/老实人/女明星加入，房主富婆；四人一致，所有新立绘实际加载。3/4不可开局，4/4可开局。
   Create the configured table and join four selected new roles; portraits load and occupancy gates work.
2. 第四席有三名对手、一位对家、四牌河和本人牌区；观众有四席牌背、四牌河，没有相对四人样式、对家标记、本人牌区或玩家动作。1180px视口无整页横向溢出（scrollWidth1165）。
   Fourth-seat and spectator DOM/visual checks confirm distinct layouts, complete panels, privacy and no desktop horizontal overflow.
3. 观众在未满桌时加入不占座，四人开局仍留在观战。房主真实打出2条后，观众收到“整合东家打出2条”和“整合北家摸了一张牌”，逆时针推进可见。
   Viewer admission does not occupy a seat; real discard/draw events synchronize using participant names.
4. 观战刷新恢复，规则弹窗可关闭，返回大厅后浏览器Back恢复观战模式/四席，未使玩家离席。测试后通过原终端Ctrl+C停服。
   Reload, modal dismissal, lobby exit and Back preserve viewer identity without player departures; the server was stopped afterward.

该初次检查时，语音未完成在浏览器中也真实出现“语音加载失败·重试”，不把页面可运行说成新声音已验收。未完成移动/窄屏、20张长杠浏览器、自然自摸/终局、三人新桌的本轮真实浏览器复测；相关逻辑仅有自动测试。最初访问shell环境的localhost不可达，改用已有官方原生终端运行同一测试服务器后成功；临时适配器缺observer文件造成的一次500已补齐测试文件，不属于业务路由失败。
At that initial check, incomplete voices visibly reported loading failure and were not signed off. This browser pass does not cover mobile/narrow layouts, twenty-tile melds, natural wins/finish or a fresh three-player browser round. Shell/browser localhost namespaces differ; running the existing test adapter in the official native terminal enabled the test. An initial missing test observer file was repaired before acceptance, separate from application behavior.

## 规则弹窗补充修正 / Snapshot-aware rule text correction

联合浏览器检查发现旧文案仍将首胡前胡/杠描述为互斥。已按 `preHuActionChoice` 严格true显示完整合法选择，false/缺字段保留旧限制；`concealedKongAfterPungDiscard` 独立控制碰后先出牌再暗杠的说明。只改展示，不修改动作白名单、规则快照或冻结schema1/2。
The browser check exposed stale pre-win hu/kong wording. Explicit true now describes all legal choices; false/missing keeps the old restriction. The independent post-peng flag controls its own explanation. This changes presentation only, not action allowlists, snapshots or frozen engines.

新增UI回归覆盖两个开关true/false/缺字段的九种组合、大厅新默认、schema1/2保留原说明，以及读取前后rules相等。最终 `index-CMjajt4k.js` 在官方Chromium复测：大厅3人/2副/6门槛的规则窗显示首胡前完整选择及碰后暗杠限制，不再出现旧互斥句；关闭后回到大厅，服务再次停止。最终全量及专项数字为上节920/153，全部已在该改动后重跑。
The added UI regression covers all nine flag combinations, lobby defaults, frozen versions and unchanged rules objects. Chromium smoke-tested the final bundle's default three-player rule dialog, new wording, absent stale sentence and dismissal. The server was stopped again; all 920 aggregate and 153 focused checks above were rerun after the change.

## 完整语音包复验 / Complete voice-pack verification

语音提交 `2102cd7` 已拣入为 `cfd27a2`。两处文档冲突保留三/四人及观战说明，并链接角色分支历史验收。新92个MP3与来源提交逐字节相同；旧72个MP3逐一通过固定SHA-256基线对照，原三个角色音频目录无diff。未改音频运行时代码、规则或测试门槛。
Voice source 2102cd7 is integrated as cfd27a2. Both documentation conflicts preserve variable-table/spectator context and the original branch's review. All 92 additions exactly match source bytes; all 72 original files match the fixed hashes with no old-directory diff. Runtime audio code, game rules and test thresholds are unchanged.

本轮重新执行全量920项、lint及build，结果见上节。最终 `node --test tests/voice-assets.test.js tests/spectators.test.js tests/ui.test.js` 为158/158通过；新增制作脚本通过Python语法编译，未导入模型。另使用已有FFmpeg完整解码164个MP3，全部为有限、非静音采样且在0.2–6.5秒范围内；新92条合计123.28秒。该检查不运行模型、不重新生成媒体，也不把自动ASR当作发音真值。
The aggregate checks above were rerun. The final combined voice-assets/spectator/UI command passed 158/158, and the added generation script passed Python syntax compilation without importing models. Installed FFmpeg also decoded all 164 MP3s into finite, non-silent samples within 0.2–6.5 seconds; the 92 additions total 123.28 seconds. No models or synthesis were rerun, and ASR is not treated as pronunciation truth.

### 最终构建真实浏览器 / Final-build real browser

官方Chromium再次使用五个独立localhost origin（5380–5384）与隔离MemoryStore，运行最终 `index-CMjajt4k.js` / `index-C5mphHvq.css`。真实UI建4人、2.5副、神龙9桌，绝对座位0–3分别地主、老实人、富婆、女明星；第五端观战，不占座。不是五台物理设备，不使用生产牌局。临时观察器仅包装原生音源start并监听真实ended；原方法失败不会记录成功，未伪造结束或改播放器状态。一次约0.000023秒的解锁音源不算报牌。
Official Chromium used five isolated origins and the final build with a synthetic MemoryStore. Four genuine UI-selected seats map to landlord/honest/wealthy/star, plus a seatless viewer. These are not physical devices or production rooms. The temporary observer records native starts and actual ended events without faking completion; tiny unlock buffers are excluded from announcement counts.

- 通过真实出牌/碰牌操作触发8条不同音频：地主一条、五条；老实人二条；富婆三条、四条；女明星八筒、九筒、碰。前7条在四个玩家页面均观察到对应非零长度音源start→ended，单条约0.72–2.40秒；第8条为刷新后观众页面的地主五条播放验证（见下项）。服务器音频请求对应正确角色路径。这里的播放验收是浏览器原生解码/播放生命周期，不声称听到实体扬声器或已主观确认声调。
  Eight distinct real actions exercise two landlord calls, one honest, two wealthy and three star calls, including both revised star dot calls and peng. All four player pages record real starts/ends for the first seven calls at roughly 0.72–2.40 seconds; the eighth is the post-refresh viewer check below. HTTP paths match the expected roles. This verifies browser playback lifecycle, not physical speakers or subjective tone accuracy.
- 观众也收到四角色公开报牌和姓名动态。静音期间富婆四条仍更新牌河/日志，但没有新增报牌音源或请求该片段；重新开启只执行解锁，未补播静音期间的报牌，随后老实人二条正常播放。
  The viewer receives public named events and all four voices. Muted wealthy-four-bamboo still updates visuals with no new announcement source or clip request; unmute does not replay it, and the next honest call plays normally.
- 刷新恢复只读观战并要求重新解锁；解锁后没有补播已有历史，之后地主五条按真实新动作播放完成。退出到大厅、浏览器Back恢复观战且仍4/4玩家，未使任何人离席；关闭规则窗后布局恢复，快照显示4人/180张/每种10张及新选择文案。
  Viewer reload restores read-only identity with a fresh unlock, without historical replay; the subsequent landlord call completes. Exit/Back retains four seated players. The snapshot-aware rule dialog shows the correct table and choice wording and dismisses normally.
- 四玩家各有本人牌区、四人相对布局及一个对家；观众四角色立绘加载，只有牌背/公开牌区，没有本人操作、四人相对样式或对家标记。1180px视口文档宽1165px，无整页横向溢出。
  All players retain their own controls and one opposite seat. The viewer loads all portraits with concealed backs/public zones and no player controls or relative-seat layout. There is no full-page horizontal overflow at the tested desktop width.
- 本轮记录150次MP3请求、29条不同路径，全部HTTP200（含预热和刷新重复）；其余记录状态均为200/201，无4xx/5xx。预热不等于实际播放，未将12条新角色胡法预热算作胡牌声验收。五个本轮测试页已关闭，原生终端Ctrl+C停服并确认回到提示符。
  All 150 logged MP3 requests across 29 paths succeed, including preloads/reloads; logged API responses are also 200/201 with no errors. Preloads are not counted as actual win-call playback. All five test tabs were closed and the server stopped, with the prompt visibly restored.

## 尚未验证与发布状态 / Remaining limits and publication

没有完成人工逐条主观试听，不能认证音色表演或每个声调/发音完全正确。源分支保留的50项孤立ASR字面差异及地主“抢杠”等不确定项仍有效，浏览器八/九筒播放成功也不是发音认证。本轮没有真实浏览器胡牌、杠牌、自然终局、三人新桌、移动/窄屏和20张长杠验收；对应逻辑由自动测试覆盖，不能混称浏览器通过。
Human per-clip subjective review remains incomplete. The original isolated-ASR differences and uncertain calls remain documented; successful star playback does not certify pronunciation. This browser pass did not exercise wins, kongs, natural finish, a fresh three-player round, mobile/narrow layouts or twenty-tile melds. Automated coverage is not described as browser coverage.

整合、字节完整性、全量自动检查和上述浏览器范围均已完成。没有push、合入main、部署或生产数据修改；发布仍需单独授权。
Integration, byte integrity, full automated checks and the stated browser scope are complete. No push, main merge, deployment or production-state changes occurred; publication remains separately authorized.
