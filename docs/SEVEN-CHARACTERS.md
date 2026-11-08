# 七角色与三/四座位 / Seven characters, three/four seats

基线为 `bc6d296567903e976deb87763ef80953b4502f3e`。角色扩展本身不改变玩法、牌墙、算分或旧局规则快照；整合后的三/四人数由独立的建房参数明确决定。角色立绘和声音的完成状态以实际资产与审计为准，代码接通不等于素材已全部完成。
The baseline is `bc6d296567903e976deb87763ef80953b4502f3e`. Character expansion itself does not change rules, tiles, scoring or saved snapshots; the integrated three/four-seat feature is enabled by explicit room settings. Actual assets and audits determine media completion; wired code alone is not a finished asset pack.

## 角色合同 / Character contract

| 稳定 ID / Stable ID | 名称 / Name | 声音方向 / Voice direction |
|---|---|---|
| sweet | 小桃 | 保留原萝莉音 / Preserve original sweet adult voice |
| elegant | 清岚 | 保留原御姐音 / Preserve original mature voice |
| sunny | 晴禾 | 保留原阳光少女音 / Preserve original bright adult voice |
| landlord | 地主 | 豪爽、老练成年男声 / Confident, seasoned adult man |
| honest | 老实人 | 朴实、温厚成年男声 / Warm, sincere adult man |
| wealthy | 富婆 | 成熟、从容成年女声 / Composed, mature adult woman |
| star | 女明星 | 明亮、有表现力成年女声 / Bright, expressive adult woman |

所有新声音都是虚构成年角色，不模仿真实明星或使用真人样本。原三角色仅更新立绘画风，72条既有MP3必须逐字节保持。
All new voices are fictional adults, without imitating real celebrities or using real-person samples. The original three receive portrait restyling only; their 72 MP3 files must remain byte-identical.

`shared/character-assignment.js` 的 `SEAT_COUNT` 默认值固定为3；`CHARACTER_IDS` 是七人资源池；`LEGACY_CHARACTER_IDS` 固定为 sweet/elegant/sunny。这三个概念不可混用。`characters[seat]` 有本桌3或4项，以绝对座位索引，不使用七人池长度推断人数。
`SEAT_COUNT` is the fixed default of three, `CHARACTER_IDS` is the seven-character roster, and `LEGACY_CHARACTER_IDS` stays sweet/elegant/sunny. These concepts must remain separate. `characters[seat]` has three or four entries indexed by absolute seats, never by the roster size.

## 分配与兼容 / Assignment and compatibility

- 创建/加入成功时即为该占座者分配并保存 `room.seats[seat].characterId`。偏好仍可用就直接选中，否则从未占用角色中均匀抽取；后加入者不能抢走先落座者的角色。开局只把占座映射复制到 `gameMeta.characters`，首局、下一局、刷新及离席重连都不重新抽签。只有真正释放座位并重新加入才产生新角色分配。
  Successful create/join assigns and saves `room.seats[seat].characterId`. Honor an available preference, otherwise draw uniformly from unoccupied roles; later joiners cannot displace seated players. Start only copies occupancy into `gameMeta.characters`, preserving first/next rounds, refresh and detach/resume. Only releasing a seat and joining anew creates a new assignment.
- 缺角色字段的旧大厅先保留有效且唯一的已存角色，再保留可用偏好，最后按旧座位顺序稳定补位；重复/非法字段不产生重复角色，空位不占角色。读取不写回；加入、离开、开局的既有 CAS 先固定这些可见结果，再变更占座，避免新玩家或离席改变其余人的角色。
  Legacy lobbies reserve valid unique saved roles, then available preferences, then stable seat-order fallbacks; invalid/duplicate fields cannot duplicate roles and vacancies reserve none. Reads do not persist. Existing join/leave/start CAS operations freeze visible compatibility identities before changing occupancy so other players remain stable.
- 已保存合法三/四人映射原样复制，不重新抽签。不合法/缺失映射只在读取视图时按本桌人数回退（旧三人顺序，四人追加地主），不写回、不补规则、不重算历史。三个引擎版本均保留此边界。
  Valid saved three/four-person maps are copied without rerolling. Missing/malformed maps receive a size-aware view-only fallback (the original three, with landlord fourth) without persistence, rule backfills or history recalculation, across all three engines.
  当前局原参与者按凭证匹配，始终沿该局已显示映射（含旧兜底），即使占座字段不同；真正换入的人使用自己的落座映射，不改旧局。下一局复制当前占座角色，归档原映射保持原样。
  Credential-matched current participants keep the game’s visible mapping, including old fallbacks, even if occupant fields differ. Replacements use their own occupancy mapping without changing the old game. The next round copies current occupancy; archived mappings stay intact.
- 大厅、本人和对手头像都使用稳定ID；任意观察者看到同一绝对座位的角色一致。声音按同一ID读取资源，只有明确四人映射允许座位3；座位4–6永不有效。胡牌预热最多取本局3/4人的9/12条，不预热整池。
  Lobby/self/opponent portraits use stable IDs and agree across viewers. Audio uses the same IDs; only an explicit four-entry map enables seat three, and seats four through six remain invalid. Warming fetches at most nine/twelve assigned calls, never the whole roster.

## 资产路径与验收 / Assets and verification

头像为 `public/characters/<id>.png`，沿用现有透明立绘布局。音频为 `public/voices/<id>/<call>.mp3`，每人23条：`tiao-1` 至 `tiao-9`、`tong-1` 至 `tong-9`、`peng`、`gang`、`zimo`、`fangpao`、`qianggang`。原三人的旧 `hu.mp3` 只保留兼容，不新增或播放旧胡。
Portraits are PNGs at `public/characters/<id>.png`, retaining the transparent-portrait layout. Each voice has 23 calls under `public/voices/<id>/`: nine bamboo, nine dots, peng, gang, zimo, fangpao and qianggang. The original three legacy hu clips remain for compatibility only.

完整资源期望161条当前语音、3条旧胡，共164个MP3与7张PNG。不得用静音、旧角色复制、变调或虚假清单代替新配音。语音制作与真实自动审计见 [语音工具指南](VOICE-TOOLING-GUIDE.md)；ASR与哈希检查不等于人工试听。
The complete pack expects 161 active calls plus three legacy hu clips, totaling 164 MP3s and seven PNGs. Silence, duplicated old voices, pitch shifting and fabricated manifests are not substitutes. See the [voice tooling guide](VOICE-TOOLING-GUIDE.md); ASR and hashes do not constitute human listening.

维护测试：`tests/character-assignment.test.js` 穷举512种偏好、概率、服务端权限/隐私/重连和三个旧引擎；`tests/character-audio.test.js` 覆盖七人三座位路径和预热边界；`tests/ui.test.js` 编译真实Vue模板，验证七项预览与三视角；`tests/voice-assets.test.js` 严格检查全部成品及清单。`tests/fixtures/original-voice-hashes.json` 是基线72条MP3的SHA-256，只是公开静态素材指纹，不含个人牌局数据。
Maintained tests cover all 512 preference combinations, probabilities, server identity/privacy/reconnects, all legacy engines, seven-by-three audio mappings, bounded warming, real Vue templates/previews/viewers, and all final assets/manifests. The original-voice fixture holds SHA-256 values for 72 public baseline MP3s and no personal game data.

## 显式四人调用接口 / Explicit four-seat integration

旧批量分配工具仍保留显式参数与公平性测试，但实际房间不再在开局调用：`assignCharacters(preferences, chooseIndex, seatCount=3)`、`gameCharacters(mapping, seatCount=3)`、`characterForSeat(seat, seatCount=3)`只允许3或4。旧调用缺省仍为3；四人兜底为原三角色加地主，前三项不变。不得从七人池长度推算人数。
The legacy batch helper retains explicit parameters and fairness tests, but live rooms no longer call it at start: the assignment, saved-map and seat-fallback helpers accept only three or four seats and default to three. Four-seat fallback adds landlord after the original three, without altering legacy calls or inferring seats from the roster.

声音层仅在公开映射长度恰为4时允许第四位，并预热最多12条胡法语音，仍最多3个并行请求。角色提交本身未把房间改成四人；整合版实际建房/规则/界面人数由[可变牌桌](VARIABLE-TABLES.md)的房间配置和新局快照明确启用。第四座位专项含4096种偏好组合、合法边界和预热检查。
The audio layer accepts seat four only for a four-entry public map and warms at most 12 win calls with three concurrent requests. The character commit alone does not create four-player rooms; the integrated variable-table feature enables sizes through explicit configuration and new-game snapshots. Tests cover 4096 four-seat preference combinations, seat bounds and preloads.

## 立绘来源 / Portrait provenance

七张立绘于2026-11-07依用户提供的清线条、赛璐璐二维动画参考生成；参考仅用于画风，不复制其中角色。原三位保留可识别的粉色双马尾、单肩藏蓝礼服、黄绿运动夹克。新四位为原创虚构成年人。所有PNG为1024×1536 RGBA，保留原透明通道，不使用后处理假透明。
Seven portraits were generated on 2026-11-07 using the user's clean-line, cel-shaded 2D anime reference for style only. The original three retain pink twin tails, the one-shoulder navy dress and the yellow/green sports jacket. All four new characters are fictional adults. PNGs are 1024×1536 RGBA with the generated transparency preserved.

`public/characters/SEVEN-CHARACTER-PROMPTS.json` 保存完整制作提示；`public/characters/seven-character-manifest.json` 保存路径、尺寸、SHA-256及透明度检查。此前PROMPTS及清岚修订记录仍保留作历史来源。无推送、发布或真人形象授权主张。
The prompt JSON preserves authoring directions and the manifest records paths, dimensions, SHA-256 and alpha checks. Earlier prompt/elegant-revision records remain as history. This does not claim publication or real-person likeness rights.

## 联合验收 / Integration verification

角色、变人数与观战的联合结果、完整语音复验以及浏览器覆盖范围见 [联合验收报告](FEATURE-INTEGRATION-VALIDATION.md)。
See the [integration report](FEATURE-INTEGRATION-VALIDATION.md) for combined character/table/spectator results, complete voice-pack verification and browser coverage.

角色来源分支当时的最终测试、语音限制和未完成浏览器项见 [七角色验收记录](SEVEN-CHARACTERS-QA.md)。
See [the verification record](SEVEN-CHARACTERS-QA.md) for the source branch’s historical final tests, voice-review limits and then-uncompleted browser checks.

## 用户三态立绘更新 / Supplied three-state portrait update

以上生成清单保留其历史文件来源。新的基础/胡牌/放炮立绘采用用户原PNG及独立清单，覆盖运行时目录，不改变角色ID或声音；当前素材与完整事件/生命周期契约见 [立绘指南](CHARACTER-PORTRAIT-REACTIONS.md)。
The generated manifest above remains historical provenance. Supplied PNG sets use a separate catalog/manifest without changing IDs or voices; the new guide records current assets and lifecycle contracts.

## 落座身份回归 / Seated-identity regression

`tests/character-assignment.test.js` 新增顺序落座的全部三/四席偏好组合、冲突偏好、只读旧大厅补位、并发抢座、首局与下一局、真实 FileStore 重启、终局换人和旧局快照隐私。矩阵为花麻将3/4席、成都既有4席；以合法动作推进终局，不修改规则或手牌夹具。界面与整体验证见 [落座与立绘验收](CHARACTER-SEATING-VALIDATION.md)。
The character suite now covers every three/four-seat sequential preference combination, conflicting preferences, read-only legacy recovery, joining races, first/next rounds, real FileStore reloads, replacements and old-game privacy. The matrix is Flower three/four seats and existing Chengdu four seats, reaching finish with legal actions rather than rewriting rules or hands. See [seating/portrait validation](CHARACTER-SEATING-VALIDATION.md).
