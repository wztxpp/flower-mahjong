<script setup>
// 成都专用牌桌：只展示已裁剪的服务端视图，并把用户选中的原始合法动作交还 App。
// Chengdu-only table: display the filtered server view and return the user's selected authoritative action to App.
// 网络、身份、重连、角色分配和累计账本仍由 App/房间层管理；这里不判胡、不算番、不自动代选。
// App/room layers own transport, identity, reconnects, characters and ledgers; this component never judges wins, scores or chooses automatically.
import { computed, ref, watch } from 'vue';
import MahjongTile from './MahjongTile.vue';
import { chengduEventText } from './chengdu-event-text.js';
import { tilePresentation } from './mahjong-tile-presentation.js';

const props = defineProps({
  state: { type: Object, required: true },
  blocked: Boolean,
  canStart: Boolean,
  characterForPlayer: { type: Function, required: true },
});
const emit = defineEmits(['action', 'start']);
const game = computed(() => props.state.game);
// mySeat 来自引擎本人视图，而非房间槽位；终局补位者不能继承原参赛者的暗手。
// mySeat comes from the engine's private view, not a room slot; finished-game replacements cannot inherit a former hand.
const mySeat = computed(() => props.state.viewerRole === 'spectator' ? null : game.value.mySeat);
const me = computed(() => game.value.players.find((player) => player.seat === mySeat.value));
const hand = computed(() => [...(me.value?.hand || [])].sort((left, right) => left - right));
const legalActions = computed(() => mySeat.value == null ? [] : game.value.legalActions || []);
const selectedIndices = ref([]);
const selectedTiles = computed(() => selectedIndices.value.map((index) => hand.value[index]).sort((left, right) => left - right));
const isExchange = computed(() => game.value.phase === 'exchange');
const isFinished = computed(() => game.value.phase === 'finished');
const suitLabels = { bamboo: '条', dots: '筒', characters: '万' };
const directionLabels = { clockwise: '顺时针', opposite: '对家', counterclockwise: '逆时针' };
const actionLabels = { hu: '胡牌', pass: '过', peng: '碰', mingGang: '明杠', anGang: '暗杠', buGang: '补杠' };
const paymentLabels = { flowerPig: '查花猪', notReady: '查叫', kongRefund: '退杠', anGang: '暗杠', mingGang: '明杠', buGang: '补杠', hu: '胡牌' };
// 不重建合法性：选牌仅寻找服务端已给出的动作；连续同牌用下标区分实体选择。
// Never reconstruct legality: match selections to server actions, using indices to distinguish identical physical copies.
const selectedAction = computed(() => legalActions.value.find((action) => isExchange.value
  ? action.type === 'exchangeThree' && JSON.stringify(action.tiles) === JSON.stringify(selectedTiles.value)
  : action.type === 'discard' && selectedIndices.value.length === 1 && action.tile === selectedTiles.value[0]));
const responseActions = computed(() => legalActions.value.filter((action) => Object.hasOwn(actionLabels, action.type)));
const dingqueActions = computed(() => legalActions.value.filter((action) => action.type === 'dingque'));
const recentEvents = computed(() => [...(game.value.history || [])].reverse().slice(0, 30));
// 轮询他人准备进度不会清空本人尚未提交的选择；只有本手牌/阶段/局号变化才重置。
// Other players' preparation updates preserve an unsubmitted selection; reset only when this hand, phase or game changes.
watch(() => `${game.value.id}:${game.value.phase}:${hand.value.join(',')}:${game.value.preparation?.myExchange?.join(',') || ''}`,
  () => { selectedIndices.value = []; });

// 座位显示从本人下方开始按顺时针排列：左手+1、对家+2、右手+3；观众不虚构本人。
// From the viewer at bottom, clockwise seats are left+1/opposite+2/right+3; spectators receive no invented own seat.
function positionFor(seat) {
  if (mySeat.value == null) return 'audience';
  return ['self', 'left', 'opposite', 'right'][(seat - mySeat.value + 4) % 4];
}
function nameFor(seat) {
  return game.value.participantNames?.[seat] || props.state.seats?.find((player) => player?.seat === seat)?.name || `牌友 ${seat + 1}`;
}
function labelFor(tile) {
  return tilePresentation(tile)?.label || '隐藏牌';
}
function actionLabel(action) {
  return `${actionLabels[action.type] || '动作'}${action.tile == null ? '' : ` ${labelFor(action.tile)}`}`;
}
function chooseTile(index) {
  if (props.blocked || !legalActions.value.length || me.value?.won) return;
  if (isExchange.value) {
    if (selectedIndices.value.includes(index)) selectedIndices.value = selectedIndices.value.filter((selected) => selected !== index);
    else if (selectedIndices.value.length < 3) selectedIndices.value = [...selectedIndices.value, index];
  } else if (legalActions.value.some((action) => action.type === 'discard' && action.tile === hand.value[index])) {
    selectedIndices.value = selectedIndices.value[0] === index ? [] : [index];
  }
}
// 发出前再次核对当前白名单，避免旧点击处理器或观众误发；App 继续负责单飞和版本冲突。
// Recheck the current allowlist before emitting, guarding stale handlers/spectators; App handles single-flight and version conflicts.
function submit(action) {
  if (props.blocked || mySeat.value == null || !action) return;
  const current = legalActions.value.find((candidate) => JSON.stringify(candidate) === JSON.stringify(action));
  // 动作是纯 JSON；序列化复制也会去除 Vue 响应式代理，避免 structuredClone 对代理抛错。
  // Actions are plain JSON; serialization also unwraps Vue proxies that structuredClone cannot copy.
  if (current) emit('action', JSON.parse(JSON.stringify(current)));
}
const status = computed(() => {
  if (props.blocked) return '正在同步或处理操作，请稍等';
  if (isFinished.value) return game.value.finishReason === 'wallExhausted' ? '牌墙已尽，本局流局结算完成' : '本局结束';
  if (mySeat.value == null) return game.value.phase === 'exchange' ? '等待四家选择换牌' :
    game.value.phase === 'dingque' ? '等待四家定缺' : game.value.phase === 'claim' ? '等待牌友回应' : `等待${nameFor(game.value.currentSeat)}出牌`;
  if (game.value.phase === 'exchange') return game.value.preparation?.myExchange
    ? '换牌已提交，等待其他牌友' : '换三张：选择同一花色的三张牌';
  if (game.value.phase === 'dingque') return me.value?.dingqueSubmitted ? '定缺已提交，等待其他牌友' : '定缺：选择本局要打缺的花色';
  if (me.value?.won) return '你已胡牌，本局不再摸打或胡牌';
  if (game.value.phase === 'claim') return game.value.claim?.hasResponded ? '回应已提交，等待其他牌友' :
    legalActions.value.length ? '这张牌，等你回应' : '等待牌友回应';
  if (game.value.currentSeat === mySeat.value) return '轮到你：选择一张合法手牌，再确认出牌';
  return `等待${nameFor(game.value.currentSeat)}出牌`;
});
// 日志只使用投影中的白名单字段；隐藏牌不拼接名称，也不显示任意服务端 text。
// Logs use projected allowlist fields only; never name a hidden tile or render arbitrary server text.
function eventText(event) {
  return chengduEventText(event, game.value.players.map((player) => nameFor(player.seat)));
}
</script>

<template>
  <section class="chengdu-play" aria-label="成都麻将牌桌">
    <div class="chengdu-play-heading">
      <div><span class="eyebrow">成都麻将 · {{ game.rules.endCondition === 'firstWin' ? '首胡结束' : '血战到底' }}</span><h2>{{ isFinished ? '本局成绩' : '万条筒，四方坐定' }}</h2></div>
      <span>余牌 {{ game.wallCount }} 张 · 庄家 {{ nameFor(game.dealerSeat) }}</span>
    </div>
    <p class="chengdu-turn-note">行牌逆时针：自己 → 右手边 → 对家 → 左手边。胡过即退出本局行动。</p>
    <div class="chengdu-board" :class="{ 'chengdu-audience': mySeat == null }">
      <!-- 各席只画本人获准手牌以外的公开区域；暗手数量不转成牌种。 / Seat panels contain public zones only; counts never become concealed identities. -->
      <article v-for="player in game.players" :key="player.seat" class="chengdu-seat"
        :class="[`chengdu-seat-${positionFor(player.seat)}`, { 'chengdu-seat-current': game.currentSeat === player.seat, 'chengdu-seat-won': player.won }]"
        :aria-label="`${nameFor(player.seat)}的公开牌区`">
        <!-- 对手独立高画框与公开牌区分开，观众看到全部角色；本人完整立绘只在手牌下方。
             Opponent tall frames stay separate from public tiles; viewers see all roles and self art appears only below the private hand. -->
        <div v-if="player.seat !== mySeat" class="character-portrait chengdu-character-portrait"
          :class="`character-${characterForPlayer(player.seat).id}`">
          <img :src="characterForPlayer(player.seat).portrait" :alt="characterForPlayer(player.seat).name" />
        </div>
        <div class="chengdu-player-heading"><img :src="characterForPlayer(player.seat).portrait" :alt="characterForPlayer(player.seat).name" />
          <div><strong>{{ nameFor(player.seat) }}</strong><small>{{ mySeat === player.seat ? '你' : `座位 ${player.seat + 1}` }} · {{ characterForPlayer(player.seat).name }}</small></div>
          <b>{{ player.score > 0 ? '+' : '' }}{{ player.score }}</b></div>
        <div class="chengdu-seat-meta"><span v-if="player.seat === game.dealerSeat">庄家</span><span>手牌 {{ player.handCount }} 张</span>
          <span v-if="player.dingqueSuit">缺{{ suitLabels[player.dingqueSuit] }}</span><span v-else-if="player.dingqueSubmitted">已定缺</span>
          <span v-if="game.preparation?.exchangeSubmittedSeats?.includes(player.seat)">换牌已选</span><strong v-if="player.won">已胡 · 本局退出</strong></div>
        <div v-if="player.melds.length" class="chengdu-melds" aria-label="碰杠区"><div v-for="(meld, index) in player.melds" :key="index"><small>{{ actionLabels[meld.type] }}</small><MahjongTile v-for="(tile, tileIndex) in meld.tiles" :key="tileIndex" :tile="tile" :back="tile == null" small /></div></div>
        <div v-if="player.won" class="chengdu-win"><span>{{ player.won.source === 'selfDraw' ? '自摸' : player.won.source === 'robKong' ? '抢杠胡' : '胡牌' }} · {{ player.won.points }}分/付款方</span><MahjongTile v-if="player.won.tile != null" :tile="player.won.tile" small /><span v-else>牌面未公开</span></div>
        <div class="chengdu-river" aria-label="弃牌区"><MahjongTile v-for="(discard, index) in (game.discards || []).filter((entry) => entry.seat === player.seat && !entry.claimed)" :key="index" :tile="discard.tile" small :class="{ 'chengdu-winning-discard': discard.winning }" /></div>
      </article>
      <div class="chengdu-table-center"><strong>{{ game.phase === 'exchange' ? '换三张' : game.phase === 'dingque' ? '定缺' : isFinished ? '终局' : '成都' }}</strong><span v-if="game.preparation?.exchangeDirection">本局换牌：{{ directionLabels[game.preparation.exchangeDirection] }}</span><span>{{ game.rules.fanCap }}番封顶 · 自摸{{ game.rules.selfDraw === 'addBase' ? '加底' : '加番' }}</span></div>
    <div class="chengdu-status" role="status" aria-live="polite">{{ mySeat == null && !isFinished ? '仅看公开牌面 · ' : '' }}{{ status }}</div>
    <div v-if="game.claim" class="chengdu-claim"><span>{{ nameFor(game.claim.fromSeat) }}{{ game.claim.source === 'robKong' ? '尝试补杠' : '打出' }}</span><MahjongTile :tile="game.claim.tile" small /><span>等待所有有资格的牌友回应</span></div>
    <!-- 本人手牌留在桌面；下方独立立绘与操作区不重叠，私有内容仍受me.hand守卫。
         Keep own cards on the table; the separate art below never overlaps controls, and me.hand still guards private content. -->
    <div v-if="me?.hand" class="own-player-area chengdu-own-area"
      :class="`character-${characterForPlayer(mySeat).id}`">
    <section class="chengdu-hand-panel" aria-labelledby="chengdu-hand-title">
      <h3 id="chengdu-hand-title">你的手牌<span v-if="me.dingqueSuit"> · 缺{{ suitLabels[me.dingqueSuit] }}</span></h3>
      <p v-if="isExchange">先选同一花色三张，再确认。已选 {{ selectedIndices.length }}/3 张；提交后不能修改。</p>
      <p v-else-if="game.phase === 'dingque'">定缺提交后不能修改。四家都选好后公开花色并开始行牌。</p>
      <p v-else-if="!isFinished && !me.won">须先打完缺门牌。只有服务端允许的手牌和动作可用。</p>
      <div class="chengdu-hand character-hand-table" aria-label="本人私有手牌">
        <MahjongTile v-for="(tile, index) in hand" :key="index" :tile="tile" interactive
          :selected="selectedIndices.includes(index)" :disabled="blocked || (!isExchange && !legalActions.some((action) => action.type === 'discard' && action.tile === tile)) || (isExchange && !legalActions.some((action) => action.type === 'exchangeThree'))"
          @click="chooseTile(index)" />
      </div>
      <div v-if="game.preparation?.receivedExchange" class="chengdu-exchange-receipt"><span>收到的三张：</span><MahjongTile v-for="(tile, index) in game.preparation.receivedExchange.tiles" :key="index" :tile="tile" small /></div>
      <div class="chengdu-action-bar" aria-label="成都合法动作">
        <button v-if="isExchange && legalActions.some((action) => action.type === 'exchangeThree')" class="button gold" :disabled="blocked || !selectedAction" @click="submit(selectedAction)">确认换三张</button>
        <button v-if="legalActions.some((action) => action.type === 'discard')" class="button gold" :disabled="blocked || !selectedAction" @click="submit(selectedAction)">确认出牌{{ selectedAction ? ` · ${labelFor(selectedAction.tile)}` : '' }}</button>
        <button v-for="action in dingqueActions" :key="action.suit" class="button" :disabled="blocked" @click="submit(action)">定缺{{ suitLabels[action.suit] }}</button>
        <button v-for="action in responseActions" :key="`${action.type}:${action.tile ?? ''}`" class="button" :class="{ gold: action.type === 'hu' }" :disabled="blocked" @click="submit(action)">{{ actionLabel(action) }}</button>
      </div>
      <p v-if="game.waitTiles?.length && !me.won" class="chengdu-waits">当前听牌：{{ game.waitTiles.map(labelFor).join('、') }}</p>
    </section>
    <figure class="own-character-display" aria-label="你的角色立绘">
      <div class="own-character-art"><img class="own-character-scene"
        :src="characterForPlayer(mySeat).portrait" :alt="characterForPlayer(mySeat).name" /></div>
      <figcaption>{{ characterForPlayer(mySeat).name }}<span>{{ characterForPlayer(mySeat).style }}</span></figcaption>
    </figure>
    </div>
    </div>
    <section v-if="isFinished" class="chengdu-finish" aria-label="成都本局结算">
      <h3>{{ game.finishReason === 'wallExhausted' ? '流局结算完成' : '本局结算完成' }}</h3><p>以上为本局虚拟积分；已发生的胡牌、杠牌与流局结算均已计入。暗手仍不公开。</p>
      <ul v-if="game.settlement?.payments?.length"><li v-for="(payment, index) in game.settlement.payments" :key="index">{{ nameFor(payment.from) }} → {{ nameFor(payment.to) }}：{{ payment.points }}分 · {{ paymentLabels[payment.reason] || '流局结算' }}</li></ul>
      <button v-if="canStart" class="button gold" :disabled="blocked || state.seats.filter(Boolean).length < 4" @click="emit('start')">开始下一局</button><p v-else>等待房主开始下一局。</p>
    </section>
    <div class="chengdu-details">
      <section aria-labelledby="chengdu-ledger-title"><h3 id="chengdu-ledger-title">本桌累计 · 虚拟积分</h3><ul><li v-for="(row, index) in state.tableScores || []" :key="row.id || index"><span>{{ row.name }}</span><strong>{{ row.totalScore > 0 ? '+' : '' }}{{ row.totalScore }}</strong></li></ul></section>
      <section aria-labelledby="chengdu-events-title"><h3 id="chengdu-events-title">本局动态</h3><ol><li v-for="(event, index) in recentEvents" :key="index">{{ eventText(event) }}</li></ol><p v-if="!recentEvents.length">等待四家完成准备。</p></section>
    </div>
  </section>
</template>

<style scoped>
/* 成都布局完全隔离于花麻将选择器；窄屏改为线性座位而不缩小点击目标。 */
/* Scope Chengdu styles away from Flower; narrow screens use linear seats instead of shrinking touch targets. */
.chengdu-play { margin-top: 24px; }
.chengdu-play-heading, .chengdu-player-heading, .chengdu-seat-meta, .chengdu-action-bar, .chengdu-claim, .chengdu-win, .chengdu-exchange-receipt { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.chengdu-play-heading { justify-content: space-between; margin-bottom: 8px; }
.chengdu-play-heading h2 { margin: 6px 0; }
.chengdu-turn-note, .chengdu-hand-panel p, .chengdu-finish p { color: #b7c9c3; font-size: 13px; line-height: 1.7; }
.chengdu-board { display: grid; grid-template-columns: minmax(0, 1fr) minmax(150px, 1.1fr) minmax(0, 1fr); gap: 12px; padding: 18px; border: 1px solid #42665a; border-radius: 24px; background: radial-gradient(ellipse at center, #244f42, #112d27); }
.chengdu-seat { min-width: 0; background: #102b25e8; border: 1px solid #456358; border-radius: 14px; padding: 14px; }
.chengdu-seat-self { grid-area: 3 / 2; }.chengdu-seat-left { grid-area: 2 / 1; }.chengdu-seat-opposite { grid-area: 1 / 2; }.chengdu-seat-right { grid-area: 2 / 3; }
.chengdu-seat-current { border-color: #edc878; box-shadow: 0 0 0 2px #edc87830; }.chengdu-seat-won { background: #383324; }
.chengdu-player-heading img { width: 42px; height: 48px; border-radius: 9px; object-fit: cover; }.chengdu-player-heading div { flex: 1; min-width: 65px; }.chengdu-player-heading small { display: block; color: #b7c9c3; margin-top: 4px; }.chengdu-player-heading b { color: #edc878; font-size: 22px; }
.chengdu-character-portrait { margin: 0 0 12px; }
.chengdu-seat-meta { margin: 12px 0; font-size: 12px; color: #cfddd5; }.chengdu-seat-meta strong { color: #edc878; }
.chengdu-table-center { grid-area: 2 / 2; align-self: center; text-align: center; color: #e1c58a; }.chengdu-table-center strong, .chengdu-table-center span { display: block; margin: 8px; }.chengdu-table-center strong { font-size: 32px; }
.chengdu-river, .chengdu-melds { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 10px; }.chengdu-melds small { display: block; }.chengdu-winning-discard { outline: 2px solid #e1c58a; }
.chengdu-status { padding: 16px; margin: 14px 0; border-radius: 12px; background: #2f493e; color: #f5e8c6; font-weight: 600; }.chengdu-claim { justify-content: center; margin-bottom: 14px; }
.chengdu-hand-panel, .chengdu-finish, .chengdu-details section { border: 1px solid #3c554d; border-radius: 16px; padding: 20px; background: #142c27; margin-top: 16px; }
.chengdu-hand { display: flex; gap: 5px; overflow-x: auto; padding: 12px 4px 18px; }.chengdu-hand :deep(.mahjong-tile) { flex-shrink: 0; }.chengdu-action-bar { margin-top: 14px; }.chengdu-action-bar button { min-height: 44px; }.chengdu-play button:focus-visible { outline: 3px solid #f4d589; outline-offset: 4px; }
.chengdu-exchange-receipt { margin-top: 12px; font-size: 13px; }.chengdu-win { font-size: 12px; margin-top: 8px; }
.chengdu-details { display: grid; grid-template-columns: 1fr 1.5fr; gap: 16px; }.chengdu-details h3, .chengdu-finish h3, .chengdu-hand-panel h3 { margin: 0 0 12px; }.chengdu-details ul, .chengdu-details ol { padding-left: 20px; font-size: 13px; line-height: 1.8; }.chengdu-details ul { padding: 0; list-style: none; }.chengdu-details ul li { display: flex; justify-content: space-between; }.chengdu-details ol { max-height: 360px; overflow-y: auto; }.chengdu-audience { grid-template-columns: repeat(2, minmax(0, 1fr)); }.chengdu-audience .chengdu-table-center { grid-area: auto; grid-column: 1 / -1; }
/* 本人场景与状态属于完整桌面的一行；私有内容仍受me.hand守卫，观众没有此区域。
   Own scene/status span the shared board; me.hand still guards private content so spectators never receive it. */
.chengdu-status, .chengdu-claim, .chengdu-own-area { grid-column: 1 / -1; }
.chengdu-own-area { margin-top: 0; }
.chengdu-own-area .chengdu-hand-panel { margin: 0; border: 0; background: transparent; }
.chengdu-own-area h3, .chengdu-own-area .chengdu-hand-panel > p { width: fit-content; max-width: 100%; padding: 6px 9px; border-radius: 7px; background: #09291fc9; }
/* 定缺与普通动作沿用绿色桌面按钮，避免全局浅色按钮配上继承浅字。
   Missing-suit and regular actions use green table buttons rather than global light buttons with inherited light text. */
.chengdu-own-area .chengdu-action-bar .button:not(.gold) { color: #fff0d1; background: linear-gradient(#275d4c, #153f32); border-color: #b7a06d; }
.chengdu-own-area .chengdu-action-bar .button.gold { color: #352a18; background: linear-gradient(#f0d491, #c8a25e); border-color: #edcf88; }

@media (max-width: 900px) { .chengdu-board { grid-template-columns: repeat(2, minmax(0, 1fr)); }.chengdu-seat-self, .chengdu-seat-left, .chengdu-seat-opposite, .chengdu-seat-right { grid-area: auto; }.chengdu-table-center { grid-area: auto; grid-column: 1 / -1; order: -1; } }
@media (max-width: 560px) { .chengdu-board, .chengdu-audience, .chengdu-details { grid-template-columns: minmax(0, 1fr); }.chengdu-board { padding: 10px; }.chengdu-hand-panel, .chengdu-finish, .chengdu-details section { padding: 14px; }.chengdu-hand { gap: 3px; }.chengdu-turn-note { font-size: 12px; } }
</style>
