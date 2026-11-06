# 平滑分段与本地保序播放 / Smooth segments and local ordered playback

## 当前默认模式 / Current default mode

新版浏览器在开局和动作中发送 `presentation: true, presentationMode: 'local'`。`gameMeta.presentationMode` 是传输展示能力，不是新麻将规则；公开响应顶层 `presentationMode` 在没有待展示段时也保留。新版 schema 3 的段 `presentation.mode` 为 local，不再等待三位玩家的声音、页面所有权或完成回执。
The current browser requests local presentation on starts/actions. The saved mode is a transport capability, not a Mahjong rule. Public responses retain the mode even without a segment. Local schema-three segments never await all players' audio, playback ownership or receipts.

引擎仍使用原 `applyPresentedAction` / `continuePresentedGame` 分段，未改牌型、计分、动作优先级或自动出牌规则。服务端在普通出牌/碰/杠后留650毫秒，单胡2800毫秒、同批双胡4500毫秒，下一次合法读取/动作请求到期才续一段；新段从该次实际续进时重新计时，不会因长时间无人轮询一次追赶整串自动回合。没有请求时仍不自行运行。真实接牌窗口继续等所有有资格玩家的选择；这些短节拍不是自动替玩家过牌。
The unchanged staged engine retains scoring, priority and automatic-discard rules. Server cadence is 650ms for ordinary segments, 2800ms for one win and 4500ms for simultaneous winners. An eligible read/action lazily advances one expired segment; the next deadline begins then, without catching up an entire unattended automatic chain. Real claim windows still await actual eligible choices, never automatic passes.

这些时间是自动链的节拍，不是“估计声音已经播完”。每个浏览器独立等待自己的真实音频完成与现有动画 finished；一个声音下载慢的设备只推迟自己的操作，不阻挡其他设备。CSS、胡牌飞牌、高亮、原字幕时长没有改变。
These durations pace automatic chains, not guesses that audio has completed. Each browser independently awaits its own real audio and existing animation completion. A slow download delays only that browser's controls. CSS, win flights, highlights and original caption durations are unchanged.

## 接收状态与展示状态 / Received and displayed states

`receivedState` 保存最新已鉴权、按 revision 去重的本人快照；`state` 是页面当前展示快照。`ActionVoiceCursor` 从权威 history 生成唯一 eventKey，`queueLocalPresentation` 把所有新公开播报事件按顺序排入本地 FIFO。后来的快照只追加，不再取消当前声音。一次轮询跨过多段时也不挑最后一条；同一弃牌的双胡成组，后来的自摸另组。胡牌区下标根据本次快照中后续同座胡的数量定位，避免多次胡全部飞到最后一张。
receivedState stores the latest authenticated private projection, while state is the frame being displayed. The authoritative history cursor assigns unique event keys, and every new public announcement enters a local FIFO. Later snapshots append rather than cancel. Polls spanning several segments retain every announcement, shared-discard winners stay together, and later self-draws remain separate. Win indexes account for subsequent same-seat wins instead of targeting the final tile repeatedly.

已收到的分段快照随队列保留；若一次读取跨过多个服务端段，只能用该次收到的权威牌面配合逐条事件字幕/准确胡牌位置，不伪造未收到的历史暗手牌。队列排空后才切到 receivedState 的最新按钮；轮询版本也用 receivedState，避免反复下载已消费事件。
Received segment snapshots are retained with queued work. If a poll spans several server segments, the actual received board accompanies sequential event captions and accurate win positions; unseen historical concealed hands are never invented. Controls switch to the latest received snapshot only after the queue drains, and polling uses the received revision.

`CharacterAudio.enqueueOrdered` 与旧 `enqueueLive` 分开：新模式全部按序播放，不取“最后普通动作/最后两次胡”，不被550/650毫秒旧时效丢掉。每条音频独立加载，单条失败不吞掉同批其他赢家；下载仍限4秒，异常播放仍限15秒，失败不会阻塞后续队列。显式静音/未解锁期间不积累以后突发的声音。普通动作即使无声也保留350毫秒可取消字幕，避免慢轮询多条事件在微任务里闪完。
The new enqueueOrdered API is distinct from legacy enqueueLive: it retains every call, avoids latest-only selection and removes legacy 550/650ms freshness drops. Each clip loads independently, so one failure does not swallow another winner. Four-second load and fifteen-second playback safeguards remain. Explicit mute/locked periods do not create unexpected future speech. Even silent ordinary actions retain a cancellable 350ms caption, preventing multiple delayed-poll events from disappearing within microtasks.

`enqueueOrdered(events)` 返回 `{ events: [{ eventKey, status }] }`，与输入顺序一致。只有事件全部片段自然触发 `onended` 才是 `success`；下载/解码/启动错误及播放看门狗是 `failed`，运行中取消是 `cancelled`，无语音或入队时未就绪是 `skipped`。清理后仍保留已完成事件的结果。旧 `enqueueLive` 保持 `Promise<void>`，不能把其完成当作新协议的成功证明。
`enqueueOrdered(events)` returns per-input `{ events: [{ eventKey, status }] }`. Only natural `onended` for every clip yields success. Load/decode/start errors and watchdogs fail; interrupted work is cancelled; silent or initially disabled input is skipped. Cancellation preserves already completed outcomes. Legacy enqueueLive still returns Promise<void>, not proof of success.

## 同座位完整前缀 / Same-seat complete prefix

`src/shared-playback.js` 的 `SharedPlaybackCoordinator` 在每次快照登记完整公开 history 投影，用 `room:game:index` 识别事件。共享键为 `huajian-ordered-voice-v2:<room>:<seat>`；记录包含 gameId、revision、floor、逐历史下标 outcomes 和 pages 活跃时间，不存整份快照、暗手牌或凭证。Web Locks 把同源同浏览器同座位的声音与记录更新串行化；不锁画面或服务端，不协调不同设备。
SharedPlaybackCoordinator registers the complete public history projection on every snapshot, identifying events by room:game:index. Its version-two room/seat key stores game ID, revision, baseline floor, indexed outcomes and page activity, never full snapshots, concealed hands or credentials. Web Locks serialize same-origin/browser/seat audio and ledger writes, not visuals, server progress or separate devices.

`playThrough` 从共享 floor 检查到本批最后事件的完整前缀，一次只播一个有声事件。较晚加入的页面不能用自己的新基线覆盖同局记录中仍未完成的前缀；例如先拿到事件2的页面，仍需从已有共享起点补齐事件1。真正首次没有共享记录或切换到新局时才建立静默共享基线；同局已有记录不能凭页面活跃时间超时推进 floor。明确旧模式边界仍可前移 floor，因为旧播放器负责那段历史。无声事件不需要语音成功记录。
playThrough checks the complete prefix from the shared floor through the requested batch, one voiced event at a time. A later sibling baseline cannot erase an unfinished prefix in the same-game ledger: receiving event 2 still requires processing event 1 from the established floor. Only a genuine first entry without a ledger or a new game establishes a fresh silent shared baseline. Page-activity expiry never advances an existing same-game floor. An explicit legacy boundary may still advance it because the legacy player owns that history. Silent events need no successful-audio record.

这是保守取舍：页面活跃时间过期不能证明页面已经关闭，也可能只是前台断网。如果所有页面确已关闭，但同局共享记录仍留未完成前缀，后来新页面收到同局新现场事件时可能带出该未完成前缀。达到待播阈值仍可主动略过；不能把超时当作已播放或可靠离席证据。
This deliberately favors preserving unfinished work: expired page activity may mean foreground disconnection rather than closure. If every page really closed but the same-game ledger retains an unfinished prefix, a later page's new live event may bring that prefix into playback. Explicit skipping remains available at the pending threshold. Expiry is neither successful playback nor reliable evidence of departure.

只有真实音频结果 `success` 才写成功终态，不在请求播放或取得锁时提前记账。失败头部释放锁，给同座位其他有资格页面1200毫秒接力窗口；同一页面不重复尝试同一失败事件。后续声音不能越过未决头部。窗口结束记录明确失败/跳过终态，之后不允许迟到重试把声音播成2→1；这是有界故障恢复，不是保证每条声音可用。取消可保留此前成功结果，双胡只接力未成功的赢家。
Only an actual success outcome writes terminal success, never merely requesting playback or acquiring a lock. A failed head releases the lock for a 1200ms eligible-sibling retry window; the same page does not retry that failed event. Later speech cannot overtake a pending head. Expiry records explicit terminal failure/skip and forbids late replay after later events. This bounds faults without promising available audio. Cancellation preserves earlier success; simultaneous wins recover only the unsuccessful winner.

每批 `audioEligible` 和登记 ticket 固定接收时的声音资格。已有页面在静音/未解锁期间实际收到的新后缀永久拒绝本页后来补播，但健康副页仍有机会播放；取得锁后还要动态复核当前资格。一次静音/主动略过的多个下标共用截止时间，不逐条叠加1200毫秒。每页原胡牌动画和字幕继续独立展示。
Batch audioEligible and registration tickets freeze receipt-time eligibility. New suffixes actually received by an established page while muted/locked never revive on that page after unmuting, while an eligible sibling may play them. Readiness is also checked after acquiring the lock. Indices suppressed by one mute/skip receipt share a deadline rather than accumulating 1200ms each. Each page retains its own win animations and captions.

全新页面的首次 locked 基线不是本页新入队事件，因此不会把整段已有 history 加入永久拒绝集合。该基线 ticket 仍静默，单纯解锁也不触发补播；解锁后收到下一条新现场事件时，才可能从已有共享 floor 代副页补齐未完成前缀。这不放宽已有页面之后真正静音/锁定期间新后缀的拒绝规则，也不撤销主动略过。
A brand-new page's initial locked baseline is not newly queued input and therefore does not permanently deny its entire existing history. That baseline ticket stays silent, and unlocking alone starts no replay. The next live event received after unlocking may recover a sibling's unfinished prefix from the established shared floor. Later suffixes actually received while muted/locked remain denied, and explicit skipping is not undone.

缺少 Web Locks、无法访问存储或共享设施报错时明确降级为页内串行及页内记录，并调用 onDegraded；跨标签可能重复声音。不宣称跨页恰好一次，即使正常共享也不能把浏览器崩溃、输出设备故障等当作可验证的听觉成功。音频失败不能改变规则或积分。
Missing locks, inaccessible storage or shared-facility errors explicitly degrade to page-local serialization and records, invoking onDegraded; sibling speech may duplicate. Cross-tab exactly-once is not promised, and even normal coordination cannot verify acoustic success across crashes or output-device faults. Audio failure never changes rules or scores.

## 前台网络缺口与主动略过 / Foreground gaps and explicit skip

同一前台 local 会话不按网络缺口长度自动清理已收到的队列或游标，超过5秒也继续按序处理，恢复后从权威新历史补齐。本地待播段数（包含当前段）加共享补齐前缀计数达到8时显示“略过并看最新牌面”；只有玩家点击才取消本页待播、切到已收到的最新牌面，并把当前已知历史登记为本页明确略过，后续轮询不偷偷补播。按钮不是自动出牌或服务端完成回执。
The same foreground local session retains received queues/cursors regardless of transport-gap length, including gaps over five seconds, then consumes new authoritative history on recovery. When local pending segments including the active one plus shared prefix recovery reach eight, the UI offers an explicit skip-to-latest button. Clicking cancels this page's backlog, shows the latest received board and records a local skip of known history so later polls cannot revive it. It never plays a move or sends a server completion receipt.

`onPendingPrefix` 只报告当前 batch 之外、共享 floor 到该 batch 末端之间尚未终态的有声事件，排除本批事件和已成功/失败终态项。App 把 `sharedPendingPrefixCount` 与 `localPendingPresentationCount` 相加得到 `pendingPresentationCount`；补播完成或取消时清零。因此本地只看到一个新批次、实际还需补40条共享前缀时，也能显示主动略过入口，不再把这段积压藏起来。此显示计数混合本地段与额外共享有声事件，不是服务端回合数。
onPendingPrefix reports only nonterminal voiced events outside the current batch, between the shared floor and that batch's end, excluding requested events and terminal outcomes. App sums sharedPendingPrefixCount and localPendingPresentationCount into pendingPresentationCount and clears recovery counts on completion/cancellation. A page with one new local batch but forty unfinished shared-prefix events therefore exposes the skip control instead of hiding that backlog. This display combines local segments and extra shared voiced events, not server turns.

切后台、离桌、换局及历史缩短仍取消本页媒体和旧票据，建立对应静默基线，不积压后台历史。取消代数保护迟到音频、动画和锁等待，不停止健康副页，也不删除共享成功。旧屏障模式仍使用其原有离线/五秒静默重连边界，不能与 local 网络恢复混淆。
Backgrounding, leaving, game changes and shortened history still cancel page media/tickets and establish the appropriate silent baseline without background backlogs. Generations invalidate stale audio, animations and lock waits without stopping healthy siblings or deleting shared success. Legacy barriers retain their original offline/five-second silent reconnect boundary, distinct from local recovery.

## 读取竞争与重连 / Read contention and reconnection

原 GET 会先写展示租约，再用旧 revision touch 心跳，遇其他请求的正常提交便返回409。前端把所有409当离线，下一次成功闪“已重新连接”，且可能静默消费新事件。现在本地模式根本不写展示租约；心跳/资料绑定遇明确未写入的 CAS 冲突会有界重读并重新验权。繁忙时返回最新已验权快照，后续再续租/续段。抛错、undefined、写后丢响应等未知结果不可重试。离席、换座、房间消失及档案身份不匹配仍立即拒绝。
Previously, a GET could write a lease and then lose a heartbeat revision race, producing 409. The UI misclassified it as offline, flashed reconnection and could consume new events silently. Local mode removes presentation lease writes. Proven heartbeat/profile CAS nonwrites trigger bounded authenticated rereads; sustained contention returns an authenticated snapshot and defers maintenance. Unknown results are never retried. Departures, replacement credentials, missing rooms and profile mismatches still reject.

前端收到普通409只标记同步，不改 offline，不清声音游标，也不弹重连通知。真正网络错误仍显示连接状态；动作结果不确定时只读取确认，绝不自动重发打牌动作。
Ordinary 409 replies indicate synchronization without toggling offline, clearing audio cursors or announcing reconnection. Real transport errors still report connectivity. Uncertain actions are synchronized, never automatically resubmitted.

## 旧局与混合版本 / Saved games and mixed clients

已有 v20 屏障不能直接删除。新版浏览器按原 begin/complete 路径完成当前旧段；到下一个真实动作才启用 local，原 rules/history/分数均不重写。local 模式一旦启用不能被旧请求降级，其所有播放回执均幂等无效，不会提前或到期推动段落。schema1/2冻结引擎和未开启展示的旧调用不变。旧浏览器自身不认识本地队列，可能不播 local 段，应刷新所有玩家页面获得完整效果。
Saved v20 barriers are not deleted. The new browser completes them through legacy begin/complete handling, opting into local mode at a subsequent real action without rewriting rules, history or scores. Local mode cannot be downgraded, and playback receipts cannot advance its segments. Frozen schema-one/two and never-opted-in legacy calls remain unchanged. Older browsers lack ordered local playback and should be refreshed for complete media behavior.

## 维护与验证 / Maintenance and verification

`tests/shared-playback.test.js` 覆盖完整前缀、晚基线、真实 CharacterAudio 下载失败接力、终态禁止迟到倒序、双胡部分成功、固定静音资格、主动略过、取消和无锁/无存储降级。它使用注入式锁/存储/音频设备，不证明所有浏览器的实际设备行为；最终运行结果另见验收报告。
The shared-playback suite covers complete prefixes, late baselines, real CharacterAudio fetch-failure recovery, terminal no-late-retry ordering, partial double-win success, frozen mute eligibility, explicit skip, cancellation and degraded facilities. Injected locks/storage/audio devices do not prove every browser or physical device; final run results belong in the validation report.

新增 `tests/ordered-audio.test.js` 覆盖真实音频类注入式顺序、慢加载、两赢家部分失败、取消、静音与故障上限。`tests/presentation-network.test.js` 覆盖真实 API/MemoryStore 竞争、身份重验、local 节拍、真正 claim、旧段和续局。`tests/ui.test.js` 新增编译真实组件的 FIFO、跨多段双胡/续胡、409、长短前台断网、主动略过、隐藏/离桌和同座标签页测试；旧屏障测试保留其明确 legacy 请求。`tests/browser/` 为隔离真实浏览器服务器与操作说明，运行结果单独记录，不能把注入式测试称作真实浏览器通过。
New audio and API suites cover ordered media, partial failures, cancellation, bounded recovery, identity checks, local cadence, real claims and compatibility. Compiled-component cases cover FIFO, missed-poll bursts, wins, 409s, long/short foreground gaps, explicit skipping, visibility/navigation and sibling tabs while retaining explicitly legacy barrier tests. The browser directory contains isolated-server instructions; real-browser observations are reported separately from simulated tests.

---

以下保留旧模式的精确恢复协议，只有尚未启用 local 的旧局使用，不代表当前默认体验。
The following preserves the exact recovery protocol for games not yet using local mode, not the current default experience.

# v20 旧屏障兼容 / Legacy v20 barrier compatibility

## 用户可见行为 / Visible behavior

当前浏览器会在开局及每次动作请求携带 `presentation: true`。schema 3 牌局在出牌、碰、已成立的杠和整批胡牌后先展示结果，所有参与等待的活跃前台座位完成画面和声音后，再进行下一段判定或摸牌。胡后自动打出也逐张展示，不再一次跳过一串自动回合。无需玩家额外点击“继续”。
The current browser opts in with `presentation: true` on start/action. Schema-three games present each discard, peng, committed kong, and complete win batch before continuing. Every participating active foreground seat finishes its visuals and audio before the next judgment/draw. Automatic post-win discards are presented individually, without an extra Continue button.

出牌时尚未计算对手的接牌选项，也没有摸出下家的牌。已经成立动作的牌区和即时分数立即保存；完成展示不重复移动牌或收费。胡、杠、碰优先级、逆时针顺序、多人胡顺序、手动过牌选项及隐私不变。
Before discard presentation completes, opponents' claim options have not been calculated and the next tile has not been drawn. Committed tiles and immediate payments are already saved; presentation completion never repeats either. Claim priority, saved direction, simultaneous winners, manual passing and privacy are unchanged.

## 三层协作 / Three cooperating layers

1. `shared/game.js` 的 `applyPresentedAction` 与原 `applyAction` 共用校验和规则，显式传递本次展示选项。保存的 `game.presentation` 仅描述下一步：`discard` 带弃牌索引，`hu/kong/peng` 带座位。暂停时 `getLegalActions` 返回空数组。`continuePresentedGame` 复制状态并推进到下一次展示边界或真实选择点，保留原动作的引擎 revision。
   `applyPresentedAction` shares validation/rules with `applyAction`, explicitly passing transient pacing options. `game.presentation` records a discard index or a hu/kong/peng seat. Legal actions are empty while paused. `continuePresentedGame` copies and resumes to the next presentation or real decision, retaining the original engine revision.
2. `server/api.js` 保存独立的 `room.presentation`，含唯一 ID、局 ID、所需座位、已完成座位、播放实例归属和截止时间。所有续进、认领和回执写入都走房间 CAS。`POST /presentation` 不接收麻将动作或他人座位选择；旧 ID 不能推进新一段，重复回执不能重复结算。
   The API persists a separate room gate with unique/game IDs, required/completed seats, playback owners and expiry. Claims, receipts and continuations use room CAS. `/presentation` accepts no Mahjong action or other-seat selection; old IDs cannot advance newer gates and duplicate receipts cannot settle twice.
3. `src/App.vue` 只让可见、在线且拥有新媒体事件的页面用 `phase: 'begin'` 与页面实例 `clientId` 原子认领播放权。后台页或仅有重连基线的页面不认领。服务端通过每个页面独立上报的短租约选出优先实例，可发声前台优先于无声前台，同级以 ID 稳定排序；客户端不再依靠固定让位延时竞争。同座位另一个标签页只同步牌面，不重复播放或提前确认。取得播放权后并行等待语音 Promise、字幕显示期及实际浏览器动画的 `finished`。全部结束后发送同 ID 完成回执，仍等其他座位完成。
   Visible online pages with fresh media claim playback using `phase: 'begin'` and a page-instance `clientId`. Hidden/baseline-only pages never claim. The server elects a preferred instance from independent page leases, preferring audible foreground pages over silent ones and stable client IDs for ties; clients no longer race through a fixed yield delay. Another tab using that seat remains silent and cannot acknowledge early. The owner waits concurrently for the voice promise, caption lifetime and actual animation `finished`, then acknowledges that ID and waits for the other seats.

`owners` 中的页面 ID 不是身份凭证；所有操作仍须通过原座位与个人凭证鉴权。客户端只提供播放回执，不能指定合法动作、暗牌或分数。公开游戏视图仅包含展示 stage，不返回完整续进对象。
Page IDs in `owners` are not credentials; normal seat/profile authentication still applies. A receipt cannot set moves, concealed tiles or scores. The public game view exposes only the presentation stage, not the full continuation object.

## 中断与上限 / Interruptions and bounds

- 静音、未解锁、无语音和加载失败不会悬挂媒体等待。未开始播放的后台页和空基线页不抢占播放权；已登记为后台或无新媒体的座位不加入未开始的播放等待；没有新鲜页面报告时只保留 1.5 秒发现窗口。开始播放后切后台会停止本机媒体；若仅在认领请求中切后台，则用 `phase: release` 归还播放权，不提交完成，以便同座位前台页真正播放。均不补播历史或替玩家选择“过”。
  Mute, locked/unavailable audio and load failure cannot hang media completion. Hidden/baseline-only pages do not claim unused playback; known hidden/unready seats do not hold an unstarted gate, while missing telemetry gets only a 1.5-second discovery window. Hiding after playback starts stops media. Hiding while ownership is in flight instead sends `phase: release`, never completion, so a foreground sibling can play. Neither replays history nor chooses a pass.
- 音频下载最多四秒；正常播放依赖 `onended`。异常播放采用音频时长加一秒、最多十五秒的看门狗；先停止并断开声音，再释放等待。两位赢家的语音依次播放且都需结束。
  Downloads are bounded to four seconds. Normal playback uses `onended`; a duration-plus-one-second watchdog capped at fifteen seconds stops/disconnects before releasing. Both sequential winner clips must finish.
- 正常字幕保留单胡 2.8 秒、双胡 4.5 秒，此外等待所有对应有限 CSS 动画。十秒仍未结束的异常动画会被明确取消并撤下，不等待页面的无限转圈动画。
  Single/double-win captions last 2.8/4.5 seconds, additionally awaiting their finite CSS animations. Stalled visuals are explicitly cancelled/removed after ten seconds; infinite page spinners are excluded.
- 已经有播放拥有者的服务端屏障最多四十秒。已开始的页面断线或崩溃且没有完成回执时，后续读取或动作请求惰性恢复已提交动作；没有后台 Worker 定时器。没有任何请求时不会自行推进，下一次读取才恢复。主动离席不再阻挡展示，但后续需要该玩家真实选择时仍会等待，绝不自动判过。
  Owned server gates expire after forty seconds. A later read/action lazily resumes a committed action if a page that already began playback disconnects or crashes. No Worker background timer runs; no requests means no advancement until the next read. Explicit departure releases presentation waits but never skips a later real player decision.
- 本地使用服务端 `remainingMs` 而非比较两端墙钟；到截止时先停止媒体再确认。关闭/换桌使旧异步回调失效。确认丢包后只在同步验证同一屏障仍存在时重试，不重发打牌动作。
  Local deadlines use server `remainingMs`, stopping media before acknowledging. Navigation invalidates old callbacks. Lost receipts retry only after synchronization verifies the same gate, never replaying a move.

## 兼容与验证 / Compatibility and verification

`gameMeta.presentationEnabled` 是本局传输/展示能力，不是玩法规则。一旦本局启用，旧浏览器后续省略字段也不能绕过暂停。未启用的旧客户端整局及直接 `applyAction` 调用保留即时推进；schema 1/2 的冻结引擎不改。未登记播放能力的旧浏览器只有短发现窗口，无法保证它自身旧版音画与新版完成回执同步，应刷新所有客户端以取得完整效果。存档不改 rules，不重洗、不重算旧账；屏障与播放归属经 JSON 保存后可以重启恢复。
`gameMeta.presentationEnabled` is a per-game transport/presentation capability, not a rule. Once enabled, older clients cannot bypass it by omitting the flag. Never-opted-in older sessions and direct `applyAction` retain immediate advancement; frozen schema-one/two engines are untouched. Unregistered older browsers get only short discovery and cannot provide the new media-completion guarantee; refresh every client for full behavior. Saved rules, deals and prior scores are not rewritten. JSON persistence preserves gates and ownership across restarts.

`tests/presentation-game.test.js` 把分段状态全部推进后与即时引擎逐字段比较；覆盖连续自动弃牌、手动过牌、碰杠、抢杠、多人胡及完整固定种子牌局。`tests/presentation-api.test.js` 覆盖三个独立凭证、多端完成、CAS、旧回执、超时、离席、重启、隐私、混合客户端及同座位认领竞争。`tests/ui.test.js` 覆盖音画结束顺序、实际动画 Promise、重复轮询、无声音、重连、请求丢包及离桌；音频自身的完成/取消/异常由 `tests/character-audio.test.js` 检查。
Engine tests compare fully drained staged state/history with immediate results, including complete seeded games. API tests cover credentials, all-seat completion, CAS, stale receipts, expiry, departure, restart, privacy, mixed clients and same-seat ownership. UI tests cover both completion orders, animation promises, polling, silent/reconnect paths, lost requests and navigation. Audio tests cover playback completion, cancellation and faults.

### 前台租约与短期恢复 / Foreground leases and short recovery

浏览器的每个房间请求上报 `X-Presentation-Client/Visible/Audio/Game/Ready/Gate`。各座位分别保存最多八个页面记录，五秒内为新鲜租约，内容相同的报告在一秒内合并写入。后台副页只更新自己的记录，不会让同座位前台失去资格；未开始播放的座位根据 `preferredClients` 选举，已有 owner 不会因另一个页面转后台或租约到期而被替换或删除。
Each room request reports client, visibility, audio, game, readiness and gate headers. Each seat retains at most eight independent page records with five-second leases and one-second write coalescing. A hidden sibling changes only its own record. Unstarted playback uses preferredClients election; an existing owner is never displaced by sibling visibility or lease expiry.

已知仅后台/未就绪的座位立即不再阻挡未开始的展示。没有新鲜遥测的未知页面给开段后 1.5 秒发现期；若仍无可播页面，后续轮询即可恢复，无需每步等四十秒。前台失联但尚未开始的过期租约也会释放等待；已开始的媒体仍完整等待自己的完成或原四十秒故障上限。轮询是惰性的，无任何请求时不自行推进。
Known hidden/unready-only seats immediately stop holding unstarted playback. Unknown pages get 1.5 seconds from gate creation to register; subsequent polling resumes without a forty-second delay per action. Expired foreground leases release only unstarted waits. Started media retains completion protection and its forty-second fault ceiling. Recovery remains lazy and needs a request.

`Ready:false` 与 `Gate` 一起表示只是不播放当前已知段，不能把紧接着的新自动出牌误判成不可播。没有 gateId 的未就绪记录仍不参与。完成慢语音时发送的旧 gateId 不会导致下一段漏播。前台音频不能用租约超时提前判完成；后台页也不能提交他人的完成。
Ready:false with a gate scopes abstention to that known segment, not the next automatic discard. Unready records without gate IDs remain ineligible. Finishing a slow voice on an old gate cannot suppress the next event. Lease expiry never completes owned foreground media, and hidden pages cannot acknowledge another owner's playback.

租约 CAS 会改变房间 revision。新版动作额外提交 `gameId` 和 `gameRevision`：提供任一字段就必须完整匹配当前局及引擎版本，才能在仅遥测导致的房间版本差异下继续；旧版无证明动作和开局仍严格检查房间 revision。真正动作竞争仍由引擎版本、合法动作校验和最终房间 CAS 防重。
Presence CAS changes room revision. Modern actions additionally submit gameId/gameRevision; supplying either requires both to exactly match the current game and engine revision before tolerating telemetry-only room differences. Legacy actions without proof and starts keep strict room-revision checks. Engine revisions, legal-action validation and final room CAS still reject competing moves.

## 动作提交与租约竞争 / Action commits racing leases

现代 v3 动作携带完整、匹配的 `gameId` / `gameRevision` 证明时，读取房间之后发生的纯遥测 CAS 冲突可以最多尝试四次提交（首次加三次重试）。每次重新读取房间，比较剔除房间 `revision` / `updatedAt` 及各座位 `lastSeen` / `presentationClients` 后的完整快照。只有这些遥测字段变化才可重试；完整游戏内容、局 ID、参与者、离席、房主、档案、生命周期或播放屏障任一变化都拒绝，不能只比较引擎 revision，因为展示续行可以保留该版本号。

A modern v3 action with complete matching `gameId` / `gameRevision` proof may attempt at most four commits (the first plus three retries) after telemetry-only CAS races. Each retry rereads and compares the full room after removing only room `revision` / `updatedAt` and seat `lastSeen` / `presentationClients`. Any game content, game identity, participant, detach, host, archive, lifecycle, or presentation-gate change rejects the retry. Engine revision alone is insufficient because presentation continuation can retain it.

每轮从最新房间重新构造副本并计算动作，失败副本的积分、事件、屏障与完成时间全部丢弃。个人房间索引首次关联后不重复调用，最终参与者绑定与动作一起提交。只重试 `commit` 在 CAS 严格返回 `false` 后生成并标记的 `ApiError: STALE_STATE` 冲突；同名存储抛错、非布尔返回及其他存储异常（包括提交后响应丢失）结果不确定，一律不重试。无 proof 的旧客户端继续严格使用原房间 CAS，旧版本引擎不启用此重试。

Each attempt rebuilds from the latest room and recalculates the move, discarding scores, events, gates, and finish time from failed candidates. The profile-room index is linked once; the final participant binding commits with the move. Only `ApiError: STALE_STATE` conflicts generated and marked by `commit` after CAS returns strictly `false` are retried. Identically named storage exceptions, nonboolean returns, and other storage failures, including a lost response after committing, are uncertain and never retried. Legacy clients without proof retain strict room CAS; older engine versions do not receive this retry.

专项测试在动作 CAS 前插入真实租约 GET，关闭重试时稳定得到 409，启用后得到 200 且只提交一次。另覆盖完整状态变化拒绝、四次上限、个人索引只关联一次和提交后抛错不重试。

Focused tests insert a real lease GET before action CAS: disabling retries deterministically gives 409, while enabling them gives 200 with one committed move. They also cover rejection of nontelemetry changes, the four-attempt bound, one profile-index link, and no retry after commit-then-throw.


## 开局前后的租约边界 / Lease boundaries around game start

展示租约只在进行中的牌局登记。大厅与终局仍处理正常在线心跳，但不写入页面可见性、音频或续租时间，也不因此提升 room.revision。此前终局的三方轮询会持续制造新版本，使房主的“同桌再来一局”反复返回 409；停止无用租约即可保留严格开局版本和 CAS，而不引入自动重开或放宽权限。新局创建后恢复租约，旧局 ID 的页面记录不能参与新局选举。
Presentation leases register only during an active game. Lobbies and finished rooms still process normal online heartbeats, but do not write page visibility/audio/renewal telemetry or bump room.revision for it. Previously, three-player polling after finish continually created revisions and caused repeated 409 responses to another-round requests. Suppressing unnecessary leases preserves strict start revisions and CAS without automatic restarting or weaker authorization. Registration resumes after the new game is created; old game IDs cannot participate in its election.

回归用真实规则打完的合成终局，验证三方连续轮询、切前后台、开局读取与 CAS 之间插入轮询、单次归档、旧账保留，以及房主、满员、真实版本冲突和重复开局保护。
Regressions finish a synthetic game through real legal moves, then cover repeated three-player polling, visibility changes, a poll inserted between start read and CAS, one archive, preserved prior results, and unchanged host/full-seat/stale-version/duplicate-start protections.
