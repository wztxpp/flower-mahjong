<script setup>
// 终局只读总览：牌面与数字全部来自服务端摘要的展示副本，不提交动作、不订阅网络、不改变规则。
// Read-only terminal overview: tiles/numbers come from a server-summary display copy, with no actions, network or rules.
import MahjongTile from './MahjongTile.vue';
import { roundScoreText, roundScoreTone, roundMeldLabel, roundWinLabel, roundTileLabel } from './round-summary.js';

defineProps({ summary: { type: Object, required: true } });
</script>

<template>
  <!-- 整体只有一个纵向滚动入口；牌面自然换行，避免每人多条滚动条。原弹层焦点圈包含此入口和原生详情。
       One vertical viewport contains naturally wrapping tiles, avoiding per-player scrollbars; the modal focus loop includes it and native details. -->
  <div class="round-summary" tabindex="0" role="region" aria-label="本局每位玩家的结算与终局手牌" data-round-summary-scroll>
    <article v-for="player in summary.players" :key="player.seat" class="round-player" :aria-labelledby="`round-player-${player.seat}`" :data-round-summary-seat="player.seat">
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
/* 只作用于终局总览：无嵌套卡片或人物装饰，以对齐的数字、细分隔和牌面组织信息。
   Terminal-only layout uses aligned numbers, light separators and tiles rather than nested cards or character decoration. */
.round-summary { min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; scrollbar-gutter: stable; padding-right: 5px; }
.round-player { padding: 15px 0; }
.round-player + .round-player { border-top: 1px solid #8a795827; }
.round-player:first-child { padding-top: 4px; }
.round-player:last-child { padding-bottom: 4px; }
.round-player-top { display: grid; grid-template-columns: minmax(110px, 1fr) minmax(310px, 1.8fr); align-items: start; gap: 12px; margin-bottom: 10px; }
.round-player-name { min-width: 0; display: flex; align-items: baseline; gap: 8px; margin: 3px 0 0; font-size: 15px; font-weight: 650; line-height: 1.5; color: #294b3b; overflow-wrap: anywhere; }
.round-seat { flex: none; color: #6d624d; font-size: 11px; font-weight: 500; font-variant-numeric: tabular-nums; }
.round-player-stats { display: grid; grid-template-columns: .8fr .8fr 1fr 1fr; gap: 10px; margin: 0; text-align: right; }
.round-player-stats dt { color: #6d624d; font-size: 11px; line-height: 1.6; white-space: nowrap; }
.round-player-stats dd { margin: 2px 0 0; font-size: 15px; font-weight: 600; line-height: 1.4; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.round-player-stats .round-net-score { font-size: 18px; line-height: 1.17; }
.round-positive { color: #276548; }
.round-negative { color: #a34237; }
.round-neutral { color: #665f4d; }
.round-player-stats .round-unavailable { color: #6d624d; font-size: 12px; font-weight: 400; }
.round-tile-line { display: grid; grid-template-columns: 60px minmax(0, 1fr); align-items: start; gap: 8px; margin-top: 9px; }
.round-zone-label { flex: 0 0 60px; padding-top: 3px; color: #6d624d; font-size: 11px; line-height: 1.5; }
.round-tile-zone { min-width: 0; padding: 1px 1px 3px; }
.round-tile-run { min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 3px; }
.round-tile-run :deep(.mahjong-tile) { width: 26px; height: 36px; flex: 0 0 26px; border-radius: 4px; }
.round-meld-run { gap: 14px; }
.round-meld { display: flex; flex-wrap: wrap; max-width: 100%; align-items: center; gap: 3px 2px; }
.round-meld-label { color: #6d624d; font-size: 10px; margin-right: 3px; }
.round-win-details { margin: 10px 0 0 68px; }
.round-win-details summary { width: fit-content; max-width: 100%; cursor: pointer; color: #6d624d; font-size: 11px; padding-block: 4px; }
.round-win-note { margin-left: 8px; color: #6d624d; font-size: 10px; }
.round-win-run { align-items: start; gap: 10px 12px; padding-top: 6px; }
.round-wins-missing { margin: 8px 0 0 68px; }
.round-win { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.round-win-label { color: #6d624d; font-size: 10px; line-height: 1.3; white-space: nowrap; }
.round-empty { color: #6d624d; font-size: 12px; line-height: 1.6; }
.round-dragon-details { display: flex; align-items: baseline; gap: 9px; margin-top: 8px; color: #775f32; font-size: 12px; }
.round-dragon-details ul { list-style: none; display: flex; flex-wrap: wrap; gap: 4px 15px; margin: 0; padding: 0; }
.round-dragon-details li { overflow-wrap: anywhere; }
.round-summary:focus-visible, .round-win-details summary:focus-visible { outline: 2px solid #447459; outline-offset: -2px; border-radius: 4px; }
/* 小屏先显示姓名，再保留四列数字；牌不压扁、自然换行，所有内容通过唯一纵向区可达。
   Phones stack names above four metrics; tiles keep their shape and wrap within the single reachable vertical region. */
@media (max-width: 600px) {
  .round-player-top { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .round-player-stats { text-align: left; gap: 8px; }
  .round-player-name { font-size: 14px; }
  .round-player-stats dd { font-size: 14px; }
  .round-player-stats .round-net-score { font-size: 17px; }
  .round-tile-run :deep(.mahjong-tile) { width: 24px; height: 33px; flex-basis: 24px; }
  .round-player { padding: 14px 0; }
}
/* 最窄屏把宽度留给带正负号的积分；六位整数不应被拆成容易误读的两行。
   The narrowest layout reserves space for signed scores so six-digit integers do not split into misleading lines. */
@media (max-width: 360px) {
  .round-player-stats { grid-template-columns: .65fr .65fr 1.35fr 1.35fr; gap: 6px; }
  .round-player-stats .round-net-score { font-size: 15px; line-height: 1.4; }
}
</style>
