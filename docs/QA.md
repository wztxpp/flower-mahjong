# 验证记录 · 0.2.0

日期：2026-11-03。所有自动化牌局和线上测试房都是专门建立的合成数据，不读取用户未定位牌局的暗牌。

## 自动化

- 最终本地全套148项测试通过：51项v2规则、36项保持不变的旧规则、50项HTTP/API与D1、11项Vue界面/轮询回归。
- 两个引擎各100局完整模拟，每步检查144张实体、每种八张与积分零和。
- 新规则覆盖自动摸牌/胡后自动摸打、胡杠互斥、胡后不可碰、杠高于碰且同级顺位、多家同时胡完整支付再结束、第五张杠、每种即时杠分、重复动作不重复记分或翻萝卜。
- 计分覆盖1/2/3/4/5/6/7/8番对应1/2/4/8/10/12/14/16分，以及更高番；四张/五张同牌跨三牌区加番、虚拟胡牌记账、萝卜累计、神龙和大单钓配置边界。
- 三名独立Bearer客户端通过真实HTTP验证座位、隐私、刷新重连和并发；两套独立HTTP处理器共享真实SQLite D1适配器，验证CAS下的重复胡只结算一次。
- 旧牌局无版本/版本1均逐字保留其game状态；读取重连不迁移，完成后新局才切换v2。更高未知版本拒绝操作。
- UI测试覆盖空座位增量回复、350毫秒目标轮询、后台降频、不重叠读取、成功动作不额外GET、未知提交结果只读回不重放、黑八筒、个人胡牌区、旧规则提示和计分文案。
- npm run build及git diff --check通过。测试环境Node24，Vue3/Vite构建；没有实体Windows或手机测试。

## 本地浏览器

- Chromium三个独立标签页创建、加入同一房间；满三人后房主开局。
- 各端只显示本人牌面，对手显示牌背；个人胡牌区、公共河牌、计分与私有诊断区域可见。
- 三名玩家依次实际选牌、确认出牌，服务器自动摸下一张，轮转0→1→2→0，牌墙104→103→102→101；无“摸一张”按钮。
- 刷新东家标签页恢复本人座位和14张手牌，没有重复发牌或新增座位。
- 私有诊断可以展开；规则弹窗打开关闭后回到同一房间，弹层移除。
- 浏览器发现未满桌时空座位导致增量轮询异常，已修复并新增回归；最终构建后重测正常。

## 线上与性能

- 同一公开站点版本3已发布，健康接口为0.2.0，无需平台登录。
- 新建合成房间的三名独立HTTP客户端通过自动摸牌、认证隐私、重连、第四人拒绝、重复/过期/非法操作及63字节增量回复检查。
- 线上浏览器确认新版首页、建房及第二位落座；后续第三端操作遇浏览器控制接口超时，未冒称完成线上浏览器全局操作。上面的完整三端浏览器轮转是在本地同源代码上完成。
- 生产性能基线和修订后的实测见 [PERFORMANCE.md](PERFORMANCE.md)。操作HTTP P50/P95由144/614ms变为121/177ms，其他玩家完整刷新由170/2242ms变为94/390ms；同版本回复平均2782字节变为63字节。
- HTTP测试不等同于用户手机的点击到绘制时延；小样本不能承诺所有地区或长期时延。

## 未覆盖与已知边界

- 实体手机、Windows、长期真人跨地域对局、压力/恶意负载未验证；响应式CSS与组件测试不能替代真实手机。
- 浏览器随机牌局未逐个手点所有特殊胡/杠/虚拟共胡组合；这些由规则、HTTP及Vue组件测试覆盖。
- 原B玩家无法胡的现场没有房号/截图，未复现原根因；新增诊断不等于已证明原现场修复。
- 离线但待回应的玩家不会自动过；没有踢人、旁观、机器人或账号找回。
- 本地FileStore只允许单进程写；互联网托管使用HTTPS与D1原子版本更新。
- 不明确桌规保留可配置暂定值，见RULES.md；不声称地方统一标准。

## 0.5.0 角色语音回归

- 角色偏好：所有 64 种三人偏好组合；非冲突偏好保留、同选公平随机、全随机六种排列等概率、角色互不重复。
- API：偏好输入验证、开局保存映射、三端相同映射、并发开局、离桌/恢复、文件存储重启、旧局只读兼容、不改变 v0.4.2 规则。
- 音频：18 牌名及碰胡杠映射，所有杠类型，同一修订内多人胡和自动出牌；初始快照、刷新、重连、隐藏期间不重播，延迟后台请求不能消耗前台静默基线。
- 播放：用户手势解锁、串行队列、静音/离桌取消、下载 4 秒超时、后台/系统暂停后重新解锁、错误后的下一条恢复。音频不存在或格式错误不会改用浏览器朗读。
- 资产：63 个独立 MP3，三套各 21 条，路径全覆盖，文件哈希互异；三张不同 PNG 立绘。生成与发音审核详见 public/voices/manifest.json。
- 浏览器：已检查偏好下拉、立绘预览/牌桌布局、解锁按钮、同浏览器重复落座保护。浏览器实际三设备扬声器和真机 iOS/Android 音频仍需设备端体验，不以模拟测试冒称真机验证。

## v0.6.0 rules regression

329 automated tests pass, including 24 dedicated special-pattern cases. Verified 清七对 first and repeat wins at five fan / ten points, original same-tile group tiers frozen with pure suit, current radishes recalculated, big-single and all-triplets exclusion, repeated identical peng, special waits, private-view masking, old-room compatibility, and exact five-dot kong-discard lock regression through engine and API. No historical scores or live game data are rewritten.

## Pending kong-discard payer correction

336 tests pass, zero skipped. Added a screenshot-equivalent seat-three nine-circle win (eight received, not sixteen), all six source/winner seat arrangements, ordinary/repeat/final/big-single and simultaneous wins under true/false/missing payment flags, API duplicate/reconnect checks and latest-rules UI wording. Genuine kong replacement selfdraw and immediate kong fees stay unchanged. New payer regressions fail against the published engine, proving they detect the old defect. Production build passes. No public deployment or historical score repair is included in this local fix.

## v0.6.1 final integrated verification

356 tests pass with zero failures or skips. Includes the second screenshot: seat 2 supplement-kong then automatic seven-circle discard; seat 3 wins 8 fan / 16 + 18 radishes = 34 from seat 2 alone, whether unrelated seat 1 has won or not. Immediate kong fees remain separate. Mandatory post-hu concealed/supplement/fifth-tile kongs reject pass and direct discard, including HTTP stale-client attempts, and remain mandatory on reconnect. Real engine views render no decline button. Truly winning draws retain the existing choice. Forty-two simultaneous-win priority combinations verify fixed clockwise priority without changing the correct engine order. All 69 MP3s are distinct and present; original 63 are unchanged. Six new clips pass decode/non-silence/context-recognition checks; subjective listening has not been certified. Production build passed. Historical scores are not backfilled.
