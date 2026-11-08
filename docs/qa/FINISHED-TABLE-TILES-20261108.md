# 终局牌面与牌桌摊牌 / Terminal tile and table-reveal QA

## 修复 / Changes

- 胡牌记录使用纵向 flex；旧的 `flex-basis:26px`（窄屏 24px）错误地约束高度。改为不伸缩，使手牌、副露和自摸/接炮记录一致保持桌面 26×36、窄屏 24×33。没有替换牌图。
  The fixed flex basis constrained height inside vertical win groups. Non-flexing tiles now preserve the existing 26×36 desktop and 24×33 narrow-screen sizes in all three zones; artwork is unchanged.
- 花麻将对手牌背区及成都终局手牌条仅使用已结束摘要的真实 `finalHand`。房间和局阶段必须同时 finished；跨模式、重复/非法座位、缺记录均不猜牌。进行中、成都仅有人胡而未全局结束、新局不摊牌。
  Table strips use only recorded final hands after both finish gates. Invalid/ambiguous/missing rows stay concealed; live games, partially retired Chengdu games and subsequent rounds never reveal them.
- 终局牌条显示原本局参与者名字，避免换座后把旧手牌归给替补。保留所有实体牌及重复牌，不把胡牌引用补入手牌；牌面固定 30×40，超宽可键盘横向查看。
  Labels use original round participants rather than replacement occupants. Every physical tile remains present; win references are not appended. Fixed 30×40 faces remain horizontally reachable when necessary.
- 弹框“返回牌桌”仅关闭，不退出会话或跳转大厅；原“同桌再来一局”、房主与忙碌限制保留。牌桌入口可重新查看结算，轮询不擅自重开弹框。
  Return to table dismisses the modal without leaving or navigation; existing restart authority, busy guards and reopen behavior remain intact.
- 实测发现终局牌条 64px 高度不足以同时容纳牌面、阴影与系统横向滚动条，改为预留 76px。390px 成都旧 clientHeight/scrollHeight 为 54/56，修后为 66/66，没有隐藏纵向溢出。只影响结束后的牌条，行牌中布局不变。
  A 76px terminal-only height reserves tile, shadow and scrollbar room. The measured narrow Chengdu row changed from 54/56 to 66/66 client/scroll height without hiding overflow; ongoing layout is unchanged.

## 浏览器范围 / Browser coverage

数据见 [浏览器 JSON](finished-table-tiles-browser-20261108.json)。所有昵称、牌面、分数均为合成数据，通过真实 Vue 组件的纯视图页面操作，服务端禁止 `/api`，未执行真实房间出牌、开局或离桌。
The linked JSON records synthetic view-only checks using real Vue components with API requests blocked. No real room actions were performed.

- 原版六组复现：两玩法 × 1280/390/320px，胡牌牌面分别错误压成 26×26 和 24×24。
  Six baseline cases reproduced square win tiles at desktop and narrow widths.
- 35 组功能检查：三/四人花麻将、成都、旧 schema1/2、两玩法观战；正常、缺字段、缺摘要、长名字/多胡/超长牌列。覆盖结束前不摊牌、返回牌桌、重开弹框、轮询、下一局清除。
  Thirty-five functional cases cover both modes, legacy engines, observers and incomplete/long summaries, including close/reopen/poll/new-game transitions.
- 预留高度修正后重跑全部 35 组几何：各牌区比例正确，终局牌条无纵向溢出，摘要无横向溢出，底部按钮在视口内。
  All 35 geometry cases were repeated after reserving scrollbar height: correct tile sizes, no vertical row overflow, no horizontal summary overflow and visible footers.
- 两玩法 320×420 长局键盘实测：方向键到牌条末尾及开头，末张/首张可见；Tab/Shift+Tab 留在弹框；Enter 返回后焦点恢复牌桌入口。
  Keyboard checks reached both ends of long strips and verified modal focus containment and restoration.
- 14 组行牌中布局审计：两玩法、旧版和观战 × 桌面/390px，共 182 次状态采样，原有牌河增长/提示变化/滚动保持检查通过。
  Fourteen ongoing-layout groups, totaling 182 stage samples, passed growth, status and scroll-retention checks.

## 限制 / Limits

实际浏览器为桌面 Chromium，使用真实窄 iframe 视口；没有实体手机、Safari 或多人生产网络验收。窄卡片中的完整长手牌仍需横向滚动，未挤压、隐藏或截断牌。旧记录缺真实手牌仍显示未记录。
Testing used desktop Chromium with actual narrow iframe viewports, not physical phones, Safari or production multiplayer networking. Complete long hands can require horizontal scrolling; tiles are not compressed or clipped, and missing historical hands remain unavailable.

## 原画背景补充 / Original-art background follow-up

服务端仅从本局原始 `gameMeta.characters` 的完整、合法、唯一 3/4 人映射追加 `characterId`；不使用补默认的公开 `game.characters` 或现任占座者。前端固定白名单取既有 base 原图，绝对定位并加暖白渐变，不新增高度、不加载动画。旧局缺角色与图加载失败均撤去装饰，文字、牌面、焦点与数据保留。
The server adds characterId only from the complete valid original round mapping, never public default-filled characters or replacement seats. The client uses fixed existing base-art paths with an out-of-flow gradient layer, no added height or animation. Missing history and image errors remove decoration without altering content, focus or data.

背景冻结后重跑 35 组几何检查均通过；七角色 × 两玩法共 14 组实际图片载入、装饰语义和点击穿透检查通过。另保存 8 组最终完整关闭/重开/轮询/新局检查，涵盖两玩法、观战、长局与缺记录。实际查看了桌面花麻将、390px 成都及 320px 花麻将，人物可辨识，数字和牌面清楚。一次额外长批次触发浏览器工具超时，未计通过；之后分小批重新记录了这 8 组结果。
All 35 geometry cases passed again with backgrounds. Fourteen asset checks covered seven roles in both modes; eight final flows covered modal reopening, polling and new-round privacy. Desktop Flower, 390px Chengdu and 320px Flower were visually inspected. An extra long tool batch timed out and is excluded; the eight recorded flows were rerun in short batches.

新增专项覆盖原始映射、稀疏/未知/重复角色、同名替补、旧记录、七角色实际 SSR、真实 Vue 图片失败和最薄遮罩的最坏对比度（至少 4.5:1）。独立审查使用真实合法终局比对原摘要，删除新增角色字段后内容一致，未更改原输入。
New tests cover original mappings, malformed/unknown/duplicate roles, replacements, legacy records, all-role SSR, actual Vue image failures and worst-case text contrast of at least 4.5:1. Independent real-engine comparisons preserve the original summary exactly after excluding the added field, without mutating inputs.

## 最终检查 / Final checks

- `npm test`：1511/1511 通过，无失败/跳过。 / Passed with no failures or skips.
- `npm run lint`：0 错误，3 条既有警告。 / Zero errors and three pre-existing warnings.
- `npm run build`、`git diff --check`：通过。 / Passed.
- 独立相关测试：287 项通过。 / 287 relevant tests independently passed.
- 不改规则引擎、牌图/原画、数据库或持久化结构；服务端只新增终局角色 ID 投影。未推送或部署。
  No engine, artwork, database or persistence changes; the sole server addition is terminal character-ID projection. Not pushed or deployed.
