<script setup>
// 成都专用牌桌：只展示已裁剪的服务端视图，并把用户选中的原始合法动作交还 App。
// Chengdu-only table: display the filtered server view and return the user's selected authoritative action to App.
// 网络、身份、重连、角色分配和累计账本仍由 App/房间层管理；这里不判胡、不算番、不自动代选。
// App/room layers own transport, identity, reconnects, characters and ledgers; this component never judges wins, scores or chooses automatically.
import { computed, nextTick, ref, watch } from 'vue';
import MahjongTile from './MahjongTile.vue';
import CharacterArtwork from './CharacterArtwork.vue';
import { chengduEventText } from './chengdu-event-text.js';
import { tilePresentation } from './mahjong-tile-presentation.js';
import { roundSummaryView, roundSummaryHandsBySeat } from './round-summary.js';

const props = defineProps({
  state: { type: Object, required: true },
  blocked: Boolean,
  canStart: Boolean,
  characterForPlayer: { type: Function, required: true },
});
const emit = defineEmits(['action', 'start', 'next-round']);
const game = computed(() => props.state.game);
// mySeat 来自引擎本人视图，而非房间槽位；终局补位者不能继承原参赛者的暗手。
// mySeat comes from the engine's private view, not a room slot; finished-game replacements cannot inherit a former hand.
const mySeat = computed(() => props.state.viewerRole === 'spectator' ? null : game.value.mySeat);
const me = computed(() => game.value.players.find((player) => player.seat === mySeat.value));
const hand = computed(() => [...(me.value?.hand || [])].sort((left, right) => left - right));
const legalActions = computed(() => mySeat.value == null ? [] : game.value.legalActions || []);
const selectedIndices = ref([]);
const handActionDockRef = ref(null);
const handScrollRef = ref(null);
const selectedTiles = computed(() => selectedIndices.value.map((index) => hand.value[index]).sort((left, right) => left - right));
const isExchange = computed(() => game.value.phase === 'exchange');
const isFinished = computed(() => game.value.phase === 'finished');
// 已胡退出不代表整局结束；仅双终局快照中的公开摘要允许摊牌，新局/重连始终重新派生。
// Retired winners do not end a blood battle; reveal only public summaries in doubly-finished snapshots, derived anew on restart/reconnect.
const finishedTableHands = computed(() => roundSummaryHandsBySeat(props.state));
// 原参与者名字直接来自同一终局摘要；不能把替补当前昵称附到上局公开手牌。
// Read original names from that same terminal summary, never attaching a replacement occupant's name to the previous hand.
const finishedTableNames = computed(() => new Map((roundSummaryView(props.state)?.players || []).map((player) => [player.seat, player.name])));
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
// 浮层只由实际可显示的原动作决定；等待、已回应和退出后不保留空操作容器。
// Only existing renderable actions open the overlay; waiting, answered and retired states keep no empty action container.
const hasHandActions = computed(() =>
  responseActions.value.length > 0 || dingqueActions.value.length > 0 ||
  legalActions.value.some((action) => action.type === 'discard' || (isExchange.value && action.type === 'exchangeThree')),
);
const recentEvents = computed(() => [...(game.value.history || [])].reverse().slice(0, 30));
// 轮询他人准备进度不会清空本人尚未提交的选择；只有本手牌/阶段/局号变化才重置。
// Other players' preparation updates preserve an unsubmitted selection; reset only when this hand, phase or game changes.
watch(() => `${game.value.id}:${game.value.phase}:${hand.value.join(',')}:${game.value.preparation?.myExchange?.join(',') || ''}`,
  () => { selectedIndices.value = []; });

// 撤下或禁用正在聚焦的动作后回到稳定手牌区域；仅本局本座位有效，不能抢新弹层或用户刚移动的焦点。
// Return a removed or disabled focused action to the stable hand only within this round/seat, never stealing from a new modal or newer user focus.
watch(
  [legalActions, hasHandActions, () => props.state.id, () => game.value.id, mySeat, () => props.blocked],
  async ([, , roomId, gameId, seat], [, , previousRoomId, previousGameId, previousSeat]) => {
    if (roomId !== previousRoomId || gameId !== previousGameId || seat !== previousSeat || seat == null) return;
    const pageDocument = globalThis.document;
    const focused = pageDocument?.activeElement;
    if (!focused || !handActionDockRef.value?.contains?.(focused)) return;
    await nextTick();
    if ((focused.isConnected && !focused.disabled) || isFinished.value || mySeat.value !== seat || props.state.id !== roomId || game.value.id !== gameId) return;
    if (pageDocument.querySelector?.('[aria-modal="true"]')) return;
    const currentFocus = pageDocument.activeElement;
    if (currentFocus && currentFocus !== focused && currentFocus !== pageDocument.body) return;
    if (handScrollRef.value?.isConnected) handScrollRef.value.focus({ preventScroll: true });
  },
);

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
    <div class="chengdu-play-heading stable-scroll" tabindex="0" role="region" aria-label="成都本局玩法、余牌与庄家">
      <span>成都麻将 · {{ game.rules.endCondition === 'firstWin' ? '首胡结束' : '血战到底' }}</span>
      <span>余牌 {{ game.wallCount }} 张 · 庄家 {{ nameFor(game.dealerSeat) }}</span>
    </div>
    <div class="chengdu-board" :class="{ 'chengdu-audience': mySeat == null }">
      <!-- 各席只画本人获准手牌以外的公开区域；暗手数量不转成牌种。 / Seat panels contain public zones only; counts never become concealed identities. -->
      <article v-for="player in game.players" :key="player.seat" class="chengdu-seat"
        :class="[`chengdu-seat-${positionFor(player.seat)}`, { 'chengdu-seat-current': game.currentSeat === player.seat, 'chengdu-seat-won': player.won }]"
        :aria-label="`${nameFor(player.seat)}的公开牌区`">
        <!-- 对手独立高画框与公开牌区分开，观众看到全部角色；本人完整立绘只在手牌下方。
             Opponent tall frames stay separate from public tiles; viewers see all roles and self art appears only below the private hand. -->
        <div v-if="player.seat !== mySeat" class="character-portrait chengdu-character-portrait"
          :class="`character-${characterForPlayer(player.seat).id}`">
          <CharacterArtwork :character="characterForPlayer(player.seat)" />
        </div>
        <!-- 身份栏保留真实玩家昵称、座位与头像，不再重复显示角色名片。
             Keep player nicknames, seats and avatars in the identity row without repeating character-name labels. -->
        <div class="chengdu-player-heading stable-scroll" tabindex="0" role="region" :aria-label="`${nameFor(player.seat)}的身份与积分`"><img :src="characterForPlayer(player.seat).portrait" :alt="characterForPlayer(player.seat).name" />
          <div><strong>{{ nameFor(player.seat) }}</strong><small>{{ mySeat === player.seat ? '你' : `座位 ${player.seat + 1}` }}</small></div>
          <b>{{ player.score > 0 ? '+' : '' }}{{ player.score }}</b></div>
        <div class="chengdu-seat-meta stable-scroll" tabindex="0" role="region" :aria-label="`${nameFor(player.seat)}的公开状态`"><span v-if="player.seat === game.dealerSeat">庄家</span><span>手牌 {{ player.handCount }} 张</span>
          <span v-if="player.dingqueSuit">缺{{ suitLabels[player.dingqueSuit] }}</span><span v-else-if="player.dingqueSubmitted">已定缺</span>
          <span v-if="game.preparation?.exchangeSubmittedSeats?.includes(player.seat)">换牌已选</span><strong v-if="player.won">已胡 · 本局退出</strong></div>
        <!-- 成都原牌桌仅显示暗手张数；只在整局结束后添加公开手牌，不改变进行中或已胡退出的布局。
             Chengdu normally shows concealed counts only; add hands only after full finish, preserving live and retired-player layouts. -->
        <div v-if="finishedTableHands.has(player.seat)" class="finished-table-hand-label">本局：{{ finishedTableNames.get(player.seat) }} · 结束时手牌</div>
        <div v-if="state.phase === 'finished' && isFinished" class="finished-table-hand stable-scroll"
          tabindex="0" role="region" :data-table-hand-seat="player.seat"
          :aria-label="`${finishedTableNames.get(player.seat) || `${player.seat + 1}号位`}的结束时手牌`" aria-description="可横向滚动查看全部手牌">
          <template v-if="finishedTableHands.has(player.seat)">
            <MahjongTile v-for="(tile, tileIndex) in finishedTableHands.get(player.seat)" :key="tileIndex" :tile="tile" small />
            <span v-if="!finishedTableHands.get(player.seat).length" class="finished-table-hand-empty">无剩余手牌</span>
          </template>
          <span v-else class="finished-table-hand-empty">结束时手牌未记录</span>
        </div>
        <!-- 空牌到碰杠/胡牌共用同高公开视窗；投影里的隐藏牌仍只显示背面。
             Empty, melded and won states share a stable viewport; projected hidden tiles still render only backs. -->
        <div class="chengdu-public-cards stable-scroll" tabindex="0" role="region" :aria-label="`${nameFor(player.seat)}的碰杠与胡牌，可滚动查看`">
        <div v-if="player.melds.length" class="chengdu-melds" aria-label="碰杠区"><div v-for="(meld, index) in player.melds" :key="index"><small>{{ actionLabels[meld.type] }}</small><MahjongTile v-for="(tile, tileIndex) in meld.tiles" :key="tileIndex" :tile="tile" :back="tile == null" small /></div></div>
        <div v-if="player.won" class="chengdu-win"><span>{{ player.won.source === 'selfDraw' ? '自摸' : player.won.source === 'robKong' ? '抢杠胡' : '胡牌' }} · {{ player.won.points }}分/付款方</span><MahjongTile v-if="player.won.tile != null" :tile="player.won.tile" small /><span v-else>牌面未公开</span></div>
        </div>
        <div class="chengdu-river stable-scroll" tabindex="0" role="region" :aria-label="`${nameFor(player.seat)}的弃牌区，可滚动查看全部记录`"><MahjongTile v-for="(discard, index) in (game.discards || []).filter((entry) => entry.seat === player.seat && !entry.claimed)" :key="index" :tile="discard.tile" small :class="{ 'chengdu-winning-discard': discard.winning }" /></div>
      </article>
      <div class="chengdu-table-center"><strong>{{ game.phase === 'exchange' ? '换三张' : game.phase === 'dingque' ? '定缺' : isFinished ? '终局' : '成都' }}</strong><span v-if="game.preparation?.exchangeDirection">本局换牌：{{ directionLabels[game.preparation.exchangeDirection] }}</span><span>{{ game.rules.fanCap }}番封顶 · 自摸{{ game.rules.selfDraw === 'addBase' ? '加底' : '加番' }}</span></div>
    <!-- 本人手牌留在桌面；下方独立立绘与操作区不重叠，私有内容仍受me.hand守卫。
         Keep own cards on the table; the separate art below never overlaps controls, and me.hand still guards private content. -->
    <div v-if="me?.hand" class="own-player-area chengdu-own-area"
      :class="`character-${characterForPlayer(mySeat).id}`">
    <section class="chengdu-hand-panel" aria-label="我的手牌与操作">
      <!-- 48px原说明槽仅用前24px显示完整紧凑说明；其余留白与手牌上沿共用给绝对定位动作。
           Keep the existing48px note slot with complete compact text in its first24px; remaining edge space hosts absolute actions. -->
      <div class="chengdu-hand-note">
      <div class="chengdu-hand-note-content stable-scroll" tabindex="0" role="region" aria-label="手牌操作说明" :aria-description="status">
      <p v-if="isExchange">同色3张 · 已选{{ selectedIndices.length }}/3 · 提交不可改</p>
      <p v-else-if="game.phase === 'dingque'">选择缺门 · 提交不可改</p>
      <p v-else><span v-if="me.dingqueSuit">缺{{ suitLabels[me.dingqueSuit] }}</span></p>
      </div>
      </div>
      <!-- 原动作/权限不变，等待时无浮层；回合提示与按钮共用一行原生横滚，接牌说明保留在下方。
           Preserve original actions/guards and unmount while idle; turn cues and buttons share one native run, with claims below. -->
      <div class="hand-interaction-area">
      <div v-if="hasHandActions" ref="handActionDockRef" class="hand-action-dock">
      <div class="chengdu-action-bar stable-scroll" tabindex="0" role="region" aria-label="成都合法动作" aria-description="可横向滚动查看全部动作">
        <span v-if="game.phase === 'turn' && !me.won && game.currentSeat === mySeat" class="hand-turn-prompt" role="status" aria-live="polite"><span class="my-turn-pill">轮到你了</span></span>
        <button v-if="isExchange && legalActions.some((action) => action.type === 'exchangeThree')" class="button gold" :disabled="blocked || !selectedAction" @click="submit(selectedAction)">确认换三张</button>
        <button v-if="legalActions.some((action) => action.type === 'discard')" class="button gold" :disabled="blocked || !selectedAction" @click="submit(selectedAction)">确认出牌{{ selectedAction ? ` · ${labelFor(selectedAction.tile)}` : '' }}</button>
        <button v-for="action in dingqueActions" :key="action.suit" class="button" :disabled="blocked" @click="submit(action)">定缺{{ suitLabels[action.suit] }}</button>
        <button v-for="action in responseActions" :key="`${action.type}:${action.tile ?? ''}`" class="button" :class="{ gold: action.type === 'hu' }" :disabled="blocked" @click="submit(action)">{{ actionLabel(action) }}</button>
      </div>
      </div>
      <div ref="handScrollRef" class="chengdu-hand character-hand-table stable-scroll" tabindex="0" role="region" aria-label="本人私有手牌" aria-description="可横向滚动查看全部手牌">
        <div class="chengdu-hand-tiles"><MahjongTile v-for="(tile, index) in hand" :key="index" :tile="tile" interactive
          :selected="selectedIndices.includes(index)" :disabled="blocked || (!isExchange && !legalActions.some((action) => action.type === 'discard' && action.tile === tile)) || (isExchange && !legalActions.some((action) => action.type === 'exchangeThree'))"
          @click="chooseTile(index)" /></div>
      </div>
      </div>
      <div v-if="game.rules.exchangeThree" class="chengdu-receipt-slot stable-scroll" tabindex="0" role="region" aria-label="我的换牌结果">
      <div v-if="game.preparation?.receivedExchange" class="chengdu-exchange-receipt"><span>收到的三张：</span><MahjongTile v-for="(tile, index) in game.preparation.receivedExchange.tiles" :key="index" :tile="tile" small /></div>
      </div>
      <div class="chengdu-waits stable-scroll" tabindex="0" role="region" aria-label="我的听牌与接牌提示"><p v-if="game.claim" class="passive-claim" role="status" aria-live="polite">{{ nameFor(game.claim.fromSeat) }}{{ game.claim.source === 'robKong' ? '尝试补杠' : '打出' }}{{ labelFor(game.claim.tile) }} · 等待回应</p><p v-if="game.waitTiles?.length && !me.won">当前听牌：{{ game.waitTiles.map(labelFor).join('、') }}</p></div>
    </section>
    <!-- 本人画框只显示原图，角色名称仍留在图片替代文本和入座选择器中。
         The own frame shows only original art; character names remain in image alternatives and the seating selector. -->
    <figure class="own-character-display" aria-label="你的角色立绘">
      <div class="own-character-art"><CharacterArtwork class="own-character-scene"
        :character="characterForPlayer(mySeat)" /></div>
    </figure>
    </div>
    </div>
    <div class="chengdu-details">
      <section aria-labelledby="chengdu-ledger-title"><h3 id="chengdu-ledger-title">本桌累计 · 虚拟积分</h3><ul class="chengdu-ledger stable-scroll" tabindex="0" aria-label="本桌累计积分，可滚动查看"><li v-for="(row, index) in state.tableScores || []" :key="row.id || index"><span>{{ row.name }}</span><strong>{{ row.totalScore > 0 ? '+' : '' }}{{ row.totalScore }}</strong></li></ul></section>
      <section aria-labelledby="chengdu-events-title"><h3 id="chengdu-events-title">本局动态</h3><ol class="chengdu-history stable-scroll" tabindex="0" aria-label="本局动态，可滚动查看"><li v-for="(event, index) in recentEvents" :key="index">{{ eventText(event) }}</li><li v-if="!recentEvents.length">等待四家完成准备。</li></ol></section>
    </div>
    <!-- 状态与终局信息位于全部牌区、手牌及账本之后；真实DOM顺序同时服务视觉和键盘阅读。
         Place status and final results after all tiles, hand controls and ledgers; DOM order serves visual and keyboard reading alike. -->
    <footer class="chengdu-table-footer" aria-label="成都牌桌状态与结算">
      <div class="chengdu-status stable-scroll" tabindex="0" role="status" aria-live="polite">{{ mySeat == null && !isFinished ? '仅看公开牌面 · ' : '' }}{{ status }}</div>
      <template v-if="!me?.hand">
        <div class="chengdu-claim-slot stable-scroll" tabindex="0" role="region" aria-label="当前接牌提示，可滚动查看"
          :aria-description="game.claim ? '等待所有有资格的牌友回应' : undefined">
        <div v-if="game.claim" class="chengdu-claim"><span>{{ nameFor(game.claim.fromSeat) }}{{ game.claim.source === 'robKong' ? '尝试补杠' : '打出' }}</span><MahjongTile :tile="game.claim.tile" small /></div>
        </div>
      </template>
      <section v-if="isFinished" class="chengdu-finish" aria-label="成都本局结算">
        <h3>{{ game.finishReason === 'wallExhausted' ? '流局结算完成' : '本局结算完成' }}</h3><p>以上为本局虚拟积分；已发生的胡牌、杠牌与流局结算均已计入。结束时手牌见各家牌区。</p>
        <ul v-if="game.settlement?.payments?.length"><li v-for="(payment, index) in game.settlement.payments" :key="index">{{ nameFor(payment.from) }} → {{ nameFor(payment.to) }}：{{ payment.points }}分 · {{ paymentLabels[payment.reason] || '流局结算' }}</li></ul>
        <button v-if="canStart" class="button gold" :disabled="blocked || state.seats.filter(Boolean).length < 4" @click="emit('start')">开始下一局</button><p v-else>等待房主开始下一局。</p>
        <!-- 弹层归 App 管理；普通玩家/观众也可关闭看结算或返回大厅，不因此获得开局权限。
             App owns the dialog; players/viewers may review settlement or leave without gaining start authority. -->
        <button class="button" data-next-round-trigger @click="emit('next-round')">下一局选择</button>
      </section>
    </footer>
  </section>
</template>

<style scoped>
/* 成都布局完全隔离于花麻将选择器；窄屏改为线性座位而不缩小点击目标。 */
/* Scope Chengdu styles away from Flower; narrow screens use linear seats instead of shrinking touch targets. */
.chengdu-play { margin-top: 24px; }
.chengdu-play-heading, .chengdu-player-heading, .chengdu-seat-meta, .chengdu-action-bar, .chengdu-claim, .chengdu-win, .chengdu-exchange-receipt { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.chengdu-play-heading { justify-content: space-between; margin-bottom: 8px; height: 48px; align-content: flex-start; align-items: flex-start; font-size: 13px; line-height: 1.7; }
.chengdu-hand-panel p, .chengdu-finish p { color: #b7c9c3; font-size: 13px; line-height: 1.7; }
.chengdu-board { display: grid; grid-template-columns: minmax(0, 1fr) minmax(150px, 1.1fr) minmax(0, 1fr); gap: 10px; padding: 10px; border: 1px solid #42665a; border-radius: 16px; background: radial-gradient(ellipse at center, #244f42, #112d27); }
.chengdu-seat { min-width: 0; background: #102b25e8; border: 1px solid #456358; border-radius: 14px; padding: 14px; }
.chengdu-seat-self { grid-area: 3 / 2; }.chengdu-seat-left { grid-area: 2 / 1; }.chengdu-seat-opposite { grid-area: 1 / 2; }.chengdu-seat-right { grid-area: 2 / 3; }
.chengdu-seat-current { border-color: #edc878; box-shadow: 0 0 0 2px #edc87830; }.chengdu-seat-won { background: #383324; }
.chengdu-player-heading img { width: 42px; height: 48px; border-radius: 9px; object-fit: cover; }.chengdu-player-heading div { flex: 1; min-width: 65px; }.chengdu-player-heading small { display: block; color: #b7c9c3; margin-top: 4px; }.chengdu-player-heading b { color: #edc878; font-size: 22px; }
.chengdu-character-portrait { margin: 0 0 12px; }
.chengdu-seat-meta { margin: 6px 0; font-size: 12px; color: #cfddd5; }.chengdu-seat-meta strong { color: #edc878; }
.chengdu-table-center { grid-area: 2 / 2; align-self: center; text-align: center; color: #e1c58a; }.chengdu-table-center strong, .chengdu-table-center span { display: block; margin: 8px; }.chengdu-table-center strong { font-size: 32px; }
.chengdu-river, .chengdu-melds { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 10px; }.chengdu-melds small { display: block; }.chengdu-winning-discard { outline: 2px solid #e1c58a; }
.chengdu-status { padding: 16px; margin: 14px 0; border-radius: 12px; background: #2f493e; color: #f5e8c6; font-weight: 600; }.chengdu-claim { justify-content: center; margin-bottom: 14px; }
.chengdu-hand-panel, .chengdu-finish, .chengdu-details section { border: 1px solid #3c554d; border-radius: 16px; padding: 20px; background: #142c27; margin-top: 16px; }
.chengdu-hand { display: flex; gap: 5px; overflow-x: auto; padding: 12px 4px 18px; }.chengdu-hand :deep(.mahjong-tile) { flex-shrink: 0; }.chengdu-action-bar { margin-top: 14px; }.chengdu-action-bar button { min-height: 44px; }.chengdu-play button:focus-visible { outline: 3px solid #f4d589; outline-offset: 4px; }
.chengdu-exchange-receipt { margin-top: 12px; font-size: 13px; }.chengdu-win { font-size: 12px; margin-top: 8px; }
.chengdu-details { display: grid; grid-template-columns: 1fr 1.5fr; gap: 16px; }.chengdu-details h3, .chengdu-finish h3, .chengdu-hand-panel h3 { margin: 0 0 12px; }.chengdu-details ul, .chengdu-details ol { padding-left: 20px; font-size: 13px; line-height: 1.8; }.chengdu-details ul { padding: 0; list-style: none; }.chengdu-details ul li { display: flex; justify-content: space-between; }.chengdu-details ol { max-height: 360px; overflow-y: auto; }.chengdu-audience { grid-template-columns: repeat(2, minmax(0, 1fr)); }.chengdu-audience .chengdu-table-center { grid-area: auto; grid-column: 1 / -1; }
/* 本人场景跨完整桌面；状态已移到页脚，私有内容仍受me.hand守卫，观众没有此区域。
   Own scenes span the board; status lives in the footer and me.hand still guards all private content. */
.chengdu-own-area { grid-column: 1 / -1; }
.chengdu-own-area { margin-top: 0; border-color: transparent; background: transparent; box-shadow: none; }
.chengdu-own-area .chengdu-hand-panel { margin: 0; border: 0; padding: 10px 12px; background: transparent; }
.chengdu-hand-note p { display: flex; flex-wrap: wrap; gap: 4px 10px; }
.chengdu-commit-note { color: #b7c9c3; }
.chengdu-own-turn { color: #f4d589; }
/* 定缺与普通动作沿用绿色桌面按钮，避免全局浅色按钮配上继承浅字。
   Missing-suit and regular actions use green table buttons rather than global light buttons with inherited light text. */
.chengdu-own-area .chengdu-action-bar .button:not(.gold) { color: #fff0d1; background: linear-gradient(#275d4c, #153f32); border-color: #b7a06d; }
.chengdu-own-area .chengdu-action-bar .button.gold { color: #352a18; background: linear-gradient(#f0d491, #c8a25e); border-color: #edcf88; }

/* 固定槽位而非截断内容：每次摸打、碰杠、退出或准备阶段变化都只更新局部内容。
   Fixed slots, not truncated content: draw/discard, meld, retirement and preparation changes only update local contents. */
.chengdu-player-heading { height: 76px; overflow: auto; align-content: flex-start; }
.chengdu-player-heading b { font-variant-numeric: tabular-nums; }
.chengdu-seat-meta { height: 48px; overflow: auto; align-content: flex-start; }
.chengdu-public-cards { height: 96px; padding: 4px; }
.chengdu-public-cards > :first-child { margin-top: 0; }
.chengdu-river { height: 150px; align-content: flex-start; padding: 4px 4px 10px; }
.chengdu-river :deep(.mahjong-tile) { flex-shrink: 0; }
.chengdu-status { height: 66px; margin: 0; overflow: auto; }
.chengdu-claim-slot { height: 64px; }
.chengdu-claim { min-height: 64px; margin: 0; }
.chengdu-hand-note { height: 48px; }
.chengdu-hand-note p { margin: 0; }
.chengdu-hand { height: 128px; }
.chengdu-receipt-slot { height: 62px; }
.chengdu-receipt-slot .chengdu-exchange-receipt { margin: 4px 0 0; }
.chengdu-action-bar { height: 68px; flex-wrap: nowrap; justify-content: flex-start; padding: 3px 4px 6px; }
.chengdu-action-bar > button { flex-shrink: 0; white-space: nowrap; }
/* 只用起始自动边距靠右；超长动作组仍从第一个按钮开始滚动，不出现负坐标。
   A start-only auto margin right-aligns fitting actions; longer groups scroll from the first button without negative coordinates. */
.chengdu-action-bar > :first-child { margin-inline-start: auto; }
.chengdu-waits { height: 44px; }
.chengdu-waits p { margin: 6px 0 0; }
.chengdu-details .chengdu-history { height: 280px; max-height: 280px; }
.chengdu-details .chengdu-ledger { height: 160px; }

/* 与花麻将共用无框动作带；真实牌组按内容定宽，过长时auto边距归零，首尾均可滚到。
   Share Flower's frameless dock; intrinsic-width tile lists center when fitting and reset auto margins on overflow. */
.chengdu-own-area .chengdu-hand { display: block; height: 114px; }
.chengdu-hand-tiles { display: flex; width: max-content; min-width: 0; margin-inline: auto; gap: 5px; }
.chengdu-own-area .hand-action-dock > .chengdu-action-bar { margin-top: 0; }
.chengdu-own-area .hand-action-dock .button:not(.gold) { color: var(--hand-accent-light); background: var(--hand-action-surface); border-color: var(--hand-accent); }
.chengdu-own-area .hand-action-dock .button.gold { color: var(--hand-accent-ink); background: linear-gradient(160deg, var(--hand-accent-light), var(--hand-accent)); border-color: var(--hand-accent-light); }

/* 说明压在既有48px槽的前24px，完整长文可滚；成都较高手牌使用34px上沿，因此仍留2px安全间隔。
   Notes use the first24px of the existing48px slot and scroll if long; Chengdu's taller hand uses34px top space, retaining a2px gap. */
.chengdu-hand-note-content { height: 24px; }
.chengdu-hand-note-content p { display: block; margin: 0; font-size: 11px; line-height: 18px; white-space: nowrap; }
.chengdu-own-area .hand-action-dock { bottom: calc(100% - 30px); }
.chengdu-own-area .chengdu-hand { padding: 34px 4px 6px; }
.chengdu-own-area .chengdu-action-bar > * { flex-shrink: 0; }

/* 页脚保持普通文档流，不能覆盖手牌或用视觉order改变焦点顺序。
   Keep the footer in normal flow, never overlaying hands or using visual order to disagree with focus order. */
.chengdu-table-footer { margin-top: 16px; min-width: 0; }
.chengdu-table-footer .chengdu-claim-slot { margin-top: 8px; }

@media (max-width: 900px) { .chengdu-board { grid-template-columns: repeat(2, minmax(0, 1fr)); }.chengdu-seat-self, .chengdu-seat-left, .chengdu-seat-opposite, .chengdu-seat-right { grid-area: auto; }.chengdu-table-center { grid-area: auto; grid-column: 1 / -1; order: -1; } }
@media (max-width: 560px) { .chengdu-board, .chengdu-audience, .chengdu-details { grid-template-columns: minmax(0, 1fr); }.chengdu-board { padding: 10px; }.chengdu-hand-panel, .chengdu-finish, .chengdu-details section { padding: 14px; }.chengdu-hand-tiles { gap: 3px; }.chengdu-turn-note { font-size: 12px; } }
/* 普通手机标题和两行状态也应完整显示；各阶段始终预留同高，超长姓名仍可局部滚动。
   Fit normal phone headings and two-line statuses in fixed slots across phases; unusually long names remain locally scrollable. */
@media (max-width: 560px) {
  .chengdu-play-heading { height: 72px; }
  .chengdu-status { height: 88px; }
  .chengdu-action-bar { gap: 6px; }
}
/* 手机四个常规回应不应因几像素留白而横滚；只收间距/左右内边距，保留字大小、44px高度和长动作滚动。
   Four ordinary phone responses should not overflow because of spare spacing; compact gaps/side padding only, retaining text size,44px height and long-action scrolling. */
@media (max-width: 360px) {
  .chengdu-action-bar { gap: 5px; }
  .chengdu-action-bar > button { padding-inline: 8px; }
}
</style>
