# 用户立绘与短暂表情 / User portraits and transient reactions

## 资产与角色 / Assets and characters

用户连续提供每人的基础、胡牌庆祝和放炮失落三张PNG。映射使用原稳定角色ID，角色名称、声音、服务端开局分配及已保存局的映射不变。七组三态共21张已接入：小桃（粉色邻家）、晴禾（黄色少女）、清岚（紫色女性）、女明星（蓝色礼服）、富婆（绿色套装）、老实人（灰衬衫）、地主（中式长袍）。
The supplied base, win and discard-loss PNGs retain stable character IDs, names, voices, server assignment and saved mappings. All 21 images across seven sets are connected: sweet/pink neighbor, sunny/yellow girl, elegant/purple woman, star/blue celebrity, wealthy/green suit, honest/gray shirt and landlord/traditional robe.

`src/character-portraits.js` 的 `CHARACTER_PORTRAITS` 指向 `/characters/<id>-scene-base.png`、`-scene-win.png` 和 `-scene-discard-loss.png`。2026-11-08新一版七组21张均为1254×1050场景图，三态都采用新路径避免命中旧PNG缓存。原 `<id>.png`、前一版三态PNG与历史生成清单保留可追溯性，不再作为有新素材角色的运行时基础图。`portrait-reactions-manifest.json` 记录来源文件名、原始尺寸、字节数和SHA-256，PNG原样复制，没有重画、抠图或改变原背景。原七人生成清单只证明那批历史文件，不冒充新素材来源。
The catalog now uses scene-base/scene-win/scene-discard-loss URLs for the 2026-11-08 replacement set: all 21 scenes are 1254 by 1050. Every reaction has a fresh URL to avoid stale caches. Earlier PNGs and their generation manifest remain historical artifacts. The current manifest records source names, dimensions, sizes and SHA-256; original PNG bytes/backgrounds are preserved without regeneration or cutouts. The previous generated-image manifest is not provenance for these user images.

## 公开事件与隐私 / Public events and privacy

- 立绘仅消费 `presentWins` 收到的已显示、已提交 `hu` 事件，复用 `ActionVoiceCursor` 的局/版本/历史下标去重。不会由按钮、可胡提示、待决回应、分数或付款账触发。
  Reactions consume only displayed committed hu events through presentWins, inheriting the existing cursor's game/revision/history deduplication. Clicks, legal choices, pending responses and payment rows never trigger them.
- 胡者 `seat` 显示庆祝；`discard` / `kongDiscard` 的有效 `fromSeat` 显示放炮。自摸付款者不变脸；抢杠只标赢家，不把未打出的加杠牌说成放炮。
  Winners celebrate; only valid discard/kongDiscard sources receive the loss portrait. Self-draw payers stay unchanged. Rob-kong marks its winner without calling the un-discarded kong tile a discard loss.
- 不读取 `tile`、手牌、听口或待决内容。自摸事件的 `tile:null, hidden:true` 也能换脸。玩家、观众都只使用既有公开投影，不增加接口字段或访问。
  No tile, hand, wait or pending-choice identity is read. Hidden self-draw wins still react. Players and spectators use existing public projections with no new protocol or access.
- 三/四人座位严格校验，四人一炮三响全部处理。local FIFO将同一弃牌最多三名赢家保留在一批；旧花麻将飞牌的两人视觉上限不限制立绘。
  Strict three/four-seat validation supports every triple winner. Local FIFO groups all three winners of one discard; Flower's historical two-flight cap does not cap portraits.

## 时间与生命周期 / Timing and lifecycle

每个绝对座位独立显示约3秒，不增加游戏等待或服务器回执。某座位胡后很快放炮时换为最新表情，并重新计时；其他座位普通动作或胡牌不提前清除它。旧计时器回调用对象身份校验，不能撤下新反馈。普通轮询不会重新计时，飞牌结束也不清立绘。
Each absolute seat reacts for about three seconds without adding action barriers or server acknowledgements. A newer reaction replaces that seat and renews its timer; other seats' actions do not clear it. Per-entry identity rejects stale callbacks. Polling never renews timers, and flight cleanup is independent.

花麻将local模式在队首真正显示该动作时才换图，不在applyState接收未来快照时提前显示。成都不复用花麻将飞牌，仍在其公开胡事件显示时启动同一立绘逻辑。语音关闭/失败不阻止立绘；减少动态效果仍显示静态表情，不新增闪烁或运动。
Flower local mode changes portraits only when its FIFO displays the event, not when applyState receives future history. Chengdu keeps its independent table and no Flower flights, while using the same public-event portrait logic. Mute/audio failure does not suppress static portraits; no new motion/flashing is added.

首次加载或刷新重连只建立历史基线，不补演过去表情。现有前台local短/长网络缺口继续保留队列；切后台/回来、换局、历史缩短、换桌/离开、明确略过和卸载立即清除立绘及计时器。普通非local静默重连沿用原边界。预热只请求本局已分配角色的两张公开反应图，失败不能阻止牌局更新。
Initial loads/reloads baseline history without replay. Existing foreground local transport-gap semantics preserve queued events. Visibility, game/history resets, room departure, explicit skipping and unmount clear timers/reactions; legacy silent-reconnect semantics remain. Preloads fetch only assigned characters' two public reaction images and cannot block game updates.

## 维护与验证 / Maintenance and verification

维护文件：`src/character-portraits.js`、`tests/character-portraits.test.js`、`public/characters/portrait-reactions-manifest.json`，以及 `App.vue` / `character-audio.js` 的接入。规则引擎、服务端、存储、声音文件不变。
Maintained files include the portrait module, unit suite, manifest and App/audio-catalog integration. Engines, server, persistence and audio bytes remain unchanged.

专项测试覆盖映射、隐藏牌、无效输入、三响、同座替换、独立到期、过期回调、预热与PNG字节；真实App编译测试覆盖local队列不提前显示、重复/过期快照、重连基线、生命周期清理、成都玩家/观众、三响和略过。完整命令：`npm test`、`npm run lint`、`npm run build`。自动测试不冒充真实浏览器布局验收。
Focused tests cover mapping/privacy/invalid inputs, triple wins, per-seat replacement/expiry, stale callbacks, preloads and original PNG bytes. Compiled-App tests cover FIFO timing, duplicate/stale receipts, reconnect baselines, cancellation, Chengdu players/spectators and skip. Required aggregate commands remain test/lint/build; automated checks do not claim browser-layout verification.

## 本次自动验收 / Automated acceptance

2026-11-08，基于成都整合提交 `45bac16` 的七组21图版本：
The seven-set/21-image version based on Chengdu integration commit `45bac16` was checked on 2026-11-08:

- `npm test`：1180/1180通过，无跳过；包含花麻将旧schema、成都、CAS/隐私/重连和12项新增立绘专项。
  All 1180 tests passed with none skipped, including legacy Flower schemas, Chengdu, CAS/privacy/reconnect and 12 new portrait-focused cases.
- `npm run lint`：0错误，4条既有warning（Worker默认导出、花麻将2个未用变量、抢杠测试1个未用辅助函数），另保留平台pages目录提示。
  Zero errors; four pre-existing warnings and the platform pages-directory notice remain.
- `npm run build`：Vue客户端与Worker构建通过；`git diff --check`通过。
  Browser/Worker production build and whitespace checks passed.
- 全21张PNG已逐张看图确认基础/胡/放炮，并按原字节SHA-256校验；所有既有声音哈希回归通过。
  All 21 original PNGs were visually identified and byte-hash verified; all existing voice hash regressions passed.
- 未在本实现任务中做真实浏览器布局/人工试听、全仓TypeScript检查或部署。源码提交由发布任务合并后继续发布验收。
  This implementation did not perform real-browser layout/manual listening, repository-wide TypeScript checking or deployment. The release task integrates the source commit and owns publication verification.

## 独立场景画框 / Independent scene frames

用户对v27反馈后，花麻将对手顶部框与成都对手新增大图使用 `object-fit: cover`、宽高100%，等比满框。桌面框高240–340px，手机180–240px，覆盖旧92–124px横条。默认焦点上方24%、晴禾33%、清岚20%，只改变裁切，PNG原字节不变。
Following feedback on v27, Flower and Chengdu opponent portraits use proportional cover at full width/height in taller frames: 240–340px desktop and 180–240px phone rather than old 92–124px strips. Focal points adjust only cropping; PNG bytes stay unchanged.

本人的真实手牌仍在table-surface/chengdu-board内；独立 `own-character-display` figure排在整个手牌操作区之后，下方按1254/1050原图比例展示主角。图片采用普通流，不再绝对定位到本人区或充当手牌背景；无需覆盖文字的整区渐变遮罩。牌区保持统一绿色桌毡，原选牌、出牌、胡碰杠、诊断与动作守卫不变。
Own actual cards remain inside their board, followed by a standalone figure showing the main character at the source image ratio. The image uses normal flow, never a whole-area background or control overlay. Cards keep shared green felt, original actions, diagnostics and guards.

大厅保留落座身份摘要，不画游戏主角大图；观众无本人区域。终局仍显示获准本人手牌和独立主角。替补占座面板读取自己的落座角色，原牌局与观战仍按旧game.characters显示原参与者。角色不重抽的服务端合同见 [七角色](SEVEN-CHARACTERS.md)。
Lobbies keep seated summaries without a game-size own frame, and spectators have no own area. Finished rounds retain authorized own cards and art. Replacement summaries use their seated character while original game/spectator panels retain original participants; see the server assignment guide.

## 轻量场景动态 / Lightweight scene motion

仅对手与本人独立画框内的PNG使用10/12秒缓慢呼吸、极小平移和旋转。文字、牌、按钮、焦点与点击区域不动；1.035–1.045倍放大防止运动露边。人物图只在自己的画框内被 `overflow: clip` 裁切，不能滚动或盖住手牌。
Only PNGs inside opponent/self frames breathe and drift over 10/12-second cycles. Text, cards, buttons, focus and hit targets stay still; slight overscan prevents edge gaps. Clip applies only within the portrait's own frame, never over the hand.

`prefers-reduced-motion: no-preference`才启用，reduce恢复静止。胡/放炮仍来自既有公开事件和三秒静态图切换；没有新JS计时器、服务端回执或等待。它是PNG的CSS运动，不是Live2D或新增骨骼模型。
Motion activates only with no-preference and stops under reduce. Existing public events drive three-second win/loss image swaps without new timers or game barriers. This is CSS motion of PNGs, not Live2D or a rigged model.

结构/生命周期/座位身份回归在 `tests/portrait-layout.test.js`、`tests/ui.test.js`、`tests/chengdu-ui.test.js`，全模式座位持久化在 `tests/character-assignment.test.js`。真实浏览器与自动检查范围见 [当前验收](CHARACTER-SEATING-VALIDATION.md)；[v27验收](CHARACTER-SCENE-VALIDATION.md)保留当时实现与历史证据，不代表新的独立画框布局。
Structural, lifecycle and identity regressions cover both real templates and components; assignment tests cover persistence. See current validation for executed checks; the v27 report remains historical evidence of its earlier background design.
