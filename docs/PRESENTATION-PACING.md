# 动画与语音结束后推进 / Presentation-paced turns

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
