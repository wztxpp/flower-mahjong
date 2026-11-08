<script setup>
// 终局只读总览：牌面与数字全部来自服务端摘要的展示副本，不提交动作、不订阅网络、不改变规则。
// Read-only terminal overview: tiles/numbers come from a server-summary display copy, with no actions, network or rules.
import MahjongTile from './MahjongTile.vue';
import { ref } from 'vue';
import { roundScoreText, roundScoreTone, roundMeldLabel, roundWinLabel, roundTileLabel, roundSummaryPortrait } from './round-summary.js';

defineProps({ summary: { type: Object, required: true } });

// 失败只记在当前弹层实例，不改摘要；最多七条固定原图路径，防止轮询不断重试损坏图片。
// Failures stay inside this dialog instance, never the summary; at most seven fixed paths prevent polling from retrying broken art.
const failedPortraits = ref(new Set());
function portraitSource(player) {
  const source = roundSummaryPortrait(player.characterId);
  return source && !failedPortraits.value.has(source) ? source : null;
}
function markPortraitFailed(characterId) {
  const source = roundSummaryPortrait(characterId);
  if (source) failedPortraits.value.add(source);
}
</script>

<template>
  <!-- 整体只有一个纵向滚动入口；牌面自然换行，避免每人多条滚动条。原弹层焦点圈包含此入口和原生详情。
       One vertical viewport contains naturally wrapping tiles, avoiding per-player scrollbars; the modal focus loop includes it and native details. -->
  <div class="round-summary" tabindex="0" role="region" aria-label="本局每位玩家的结算与终局手牌" data-round-summary-scroll>
    <article v-for="player in summary.players" :key="player.seat" class="round-player" :class="{ 'round-player-illustrated': portraitSource(player) }" :aria-labelledby="`round-player-${player.seat}`" :data-round-summary-seat="player.seat">
      <!-- 原画只作背景，绝对定位不增加高度或压缩牌；无角色/加载失败时整层撤下，内容和键盘路径保持不变。
           Original art is an out-of-flow background, never added height or tile compression; unknown/failed art removes the layer without changing content/focus. -->
      <div v-if="portraitSource(player)" class="round-player-art" aria-hidden="true" data-round-summary-art>
        <img :src="portraitSource(player)" alt="" draggable="false" decoding="async" data-round-summary-portrait @error="markPortraitFailed(player.characterId)" />
      </div>
      <div class="round-player-top">
        <h3 :id="`round-player-${player.seat}`" class="round-player-name"><span class="round-seat">{{ player.seat + 1 }}</span>{{ player.name }}</h3>
        <dl class="round-player-stats">
          <div><dt>胡牌</dt><dd>{{ player.huCount === null ? '未记录' : `${player.huCount} 次` }}</dd></div>
          <div><dt>神龙</dt><dd :class="{ 'round-unavailable': player.dragons.status !== 'settled' }">{{ player.dragons.status === 'notApplicable' ? '不适用' : player.dragons.count === null ? '未记录' : `${player.dragons.count} 组` }}</dd></div>
          <div><dt>本局净分</dt><dd class="round-net-score" :class="`round-${roundScoreTone(player.roundScore)}`">{{ roundScoreText(player.roundScore) }}</dd></div>
          <div><dt>本桌累计</dt><dd :class="`round-${roundScoreTone(player.tableScore)}`">{{ roundScoreText(player.tableScore) }}</dd></div>
        </dl>
      </div>
      <div class="round-tile-line">
        <span class="round-zone-label">结束时手牌</span>
        <div v-if="player.finalHand?.length" class="round-tile-zone" role="group" :aria-label="`${player.name}的终局手牌，共${player.finalHand.length}张`">
          <div class="round-tile-run"><MahjongTile v-for="(tile, index) in player.finalHand" :key="index" :tile="tile" small /></div>
        </div>
        <span v-else class="round-empty">{{ player.finalHand === null ? '手牌未记录' : '无剩余手牌' }}</span>
      </div>
      <div v-if="player.melds === null || player.melds.length" class="round-tile-line">
        <span class="round-zone-label">副露</span>
        <span v-if="player.melds === null" class="round-empty">副露未记录</span>
        <div v-else class="round-tile-zone" role="group" :aria-label="`${player.name}的终局副露`">
          <div class="round-tile-run round-meld-run">
            <div v-for="(meld, meldIndex) in player.melds" :key="meldIndex" class="round-meld">
              <span class="round-meld-label">{{ roundMeldLabel(meld.type) }}</span>
              <MahjongTile v-for="(tile, tileIndex) in meld.tiles || []" :key="tileIndex" :tile="tile" small />
              <span v-if="meld.tiles === null" class="round-empty">牌面未记录</span>
            </div>
          </div>
        </div>
      </div>
      <!-- 胡牌是记录引用，不加回手牌；成都自摸已含在手牌时明确标注，防止误数实体牌。
           Wins are references, never appended to the hand; mark Chengdu self-draw tiles already included in it. -->
      <p v-if="player.wins === null" class="round-empty round-wins-missing">胡牌明细未记录</p>
      <details v-else-if="player.wins.length" class="round-win-details" :open="player.wins.length <= 4">
        <summary tabindex="0">胡牌记录<span class="round-win-note">{{ player.wins.length }} 张记录</span></summary>
        <div class="round-tile-run round-win-run" role="group" :aria-label="`${player.name}的胡牌记录，非额外手牌`">
          <div v-for="(win, index) in player.wins" :key="index" class="round-win" :title="roundWinLabel(win)">
            <MahjongTile v-if="win.tile !== null" :tile="win.tile" small />
            <span v-else class="round-empty">牌面未记录</span>
            <span class="round-win-label">{{ roundWinLabel(win) }}</span>
          </div>
        </div>
      </details>
      <div v-if="player.dragons.status === 'settled' && (player.dragons.details === null || player.dragons.details.length)" class="round-dragon-details">
        <span class="round-zone-label">神龙</span>
        <span v-if="player.dragons.details === null" class="round-empty">神龙明细未记录</span>
        <ul v-else :aria-label="`${player.name}的神龙结算明细`">
          <li v-for="(dragon, index) in player.dragons.details" :key="index">{{ roundTileLabel(dragon.tile) }} × {{ dragon.count ?? '未记录' }}<span v-if="dragon.pointsPerOpponent !== null"> · 每家付 {{ dragon.pointsPerOpponent }} 分</span></li>
        </ul>
      </div>
    </article>
  </div>
</template>

<style scoped>
/* 只作用于终局总览：沿用数字/牌面的无框布局，人物原画只是绝对定位底层，不改变内容尺寸。
   Terminal-only styling preserves the frameless number/tile layout; original artwork sits behind it without changing content dimensions. */
.round-summary { min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; scrollbar-gutter: stable; padding-right: 5px; }
.round-player { position: relative; isolation: isolate; padding: 15px 0; }
/* 渐变最薄处仍有74%暖白遮罩，深色文字对最坏黑像素也至少4.5:1；手机进一步加厚遮罩。
   The light overlay stays at least74% opaque, retaining4.5:1 text contrast even over black pixels; phones strengthen it further. */
.round-player-illustrated { --round-muted: #48402f; --round-positive: #1a5034; --round-negative: #7c2c25; --round-neutral: #48402f; --round-dragon: #58401f; }
.round-player-art { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: -1; background: #fffaf0; }
.round-player-art img { position: absolute; top: 0; right: 0; width: 64%; height: 100%; object-fit: cover; object-position: 50% 28%; }
.round-player-art::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, rgba(255, 250, 240, 1) 0%, rgba(255, 250, 240, .94) 36%, rgba(255, 250, 240, .74) 100%); }
.round-player + .round-player { border-top: 1px solid #8a795827; }
.round-player:first-child { padding-top: 4px; }
.round-player:last-child { padding-bottom: 4px; }
.round-player-top { display: grid; grid-template-columns: minmax(110px, 1fr) minmax(310px, 1.8fr); align-items: start; gap: 12px; margin-bottom: 10px; }
.round-player-name { min-width: 0; display: flex; align-items: baseline; gap: 8px; margin: 3px 0 0; font-size: 15px; font-weight: 650; line-height: 1.5; color: #294b3b; overflow-wrap: anywhere; }
.round-seat { flex: none; color: var(--round-muted, #6d624d); font-size: 11px; font-weight: 500; font-variant-numeric: tabular-nums; }
.round-player-stats { display: grid; grid-template-columns: .8fr .8fr 1fr 1fr; gap: 10px; margin: 0; text-align: right; }
.round-player-stats dt { color: var(--round-muted, #6d624d); font-size: 11px; line-height: 1.6; white-space: nowrap; }
.round-player-stats dd { margin: 2px 0 0; font-size: 15px; font-weight: 600; line-height: 1.4; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.round-player-stats .round-net-score { font-size: 18px; line-height: 1.17; }
.round-positive { color: var(--round-positive, #276548); }
.round-negative { color: var(--round-negative, #a34237); }
.round-neutral { color: var(--round-neutral, #665f4d); }
.round-player-stats .round-unavailable { color: var(--round-muted, #6d624d); font-size: 12px; font-weight: 400; }
.round-tile-line { display: grid; grid-template-columns: 60px minmax(0, 1fr); align-items: start; gap: 8px; margin-top: 9px; }
.round-zone-label { flex: 0 0 60px; padding-top: 3px; color: var(--round-muted, #6d624d); font-size: 11px; line-height: 1.5; }
.round-tile-zone { min-width: 0; padding: 1px 1px 3px; }
.round-tile-run { min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 3px; }
/* 手牌/副露横排、胡牌及标签竖排；flex:none采用牌自身宽高，避免固定basis在竖排中把宽度当高度。
   Hands/melds use rows and wins/labels use columns; flex:none respects each tile's dimensions instead of reusing width as column height. */
.round-tile-run :deep(.mahjong-tile) { width: 26px; height: 36px; flex: none; border-radius: 4px; }
.round-meld-run { gap: 14px; }
.round-meld { display: flex; flex-wrap: wrap; max-width: 100%; align-items: center; gap: 3px 2px; }
.round-meld-label { color: var(--round-muted, #6d624d); font-size: 10px; margin-right: 3px; }
.round-win-details { margin: 10px 0 0 68px; }
.round-win-details summary { width: fit-content; max-width: 100%; cursor: pointer; color: var(--round-muted, #6d624d); font-size: 11px; padding-block: 4px; }
.round-win-note { margin-left: 8px; color: var(--round-muted, #6d624d); font-size: 10px; }
.round-win-run { align-items: start; gap: 10px 12px; padding-top: 6px; }
.round-wins-missing { margin: 8px 0 0 68px; }
.round-win { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.round-win-label { color: var(--round-muted, #6d624d); font-size: 10px; line-height: 1.3; white-space: nowrap; }
.round-empty { color: var(--round-muted, #6d624d); font-size: 12px; line-height: 1.6; }
.round-dragon-details { display: flex; align-items: baseline; gap: 9px; margin-top: 8px; color: var(--round-dragon, #775f32); font-size: 12px; }
.round-dragon-details ul { list-style: none; display: flex; flex-wrap: wrap; gap: 4px 15px; margin: 0; padding: 0; }
.round-dragon-details li { overflow-wrap: anywhere; }
.round-summary:focus-visible, .round-win-details summary:focus-visible { outline: 2px solid #447459; outline-offset: -2px; border-radius: 4px; }
/* 小屏先显示姓名，再保留四列数字；牌不压扁、自然换行，所有内容通过唯一纵向区可达。
   Phones stack names above four metrics; tiles keep their shape and wrap within the single reachable vertical region. */
@media (max-width: 600px) {
  .round-player-art img { width: 76%; object-position: 50% 24%; }
  .round-player-art::after { background: linear-gradient(90deg, rgba(255, 250, 240, .98) 0%, rgba(255, 250, 240, .9) 38%, rgba(255, 250, 240, .82) 100%); }
  .round-player-top { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .round-player-stats { text-align: left; gap: 8px; }
  .round-player-name { font-size: 14px; }
  .round-player-stats dd { font-size: 14px; }
  .round-player-stats .round-net-score { font-size: 17px; }
  .round-tile-run :deep(.mahjong-tile) { width: 24px; height: 33px; }
  .round-player { padding: 14px 0; }
}
/* 最窄屏把宽度留给带正负号的积分；六位整数不应被拆成容易误读的两行。
   The narrowest layout reserves space for signed scores so six-digit integers do not split into misleading lines. */
@media (max-width: 360px) {
  .round-player-stats { grid-template-columns: .65fr .65fr 1.35fr 1.35fr; gap: 6px; }
  .round-player-stats .round-net-score { font-size: 15px; line-height: 1.4; }
}
</style>
