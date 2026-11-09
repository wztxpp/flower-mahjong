<script setup>
// 可选二维实桌场景：只负责公开区域、临时平移和已提交动作动画。私有操作仍由App/ChengduTable拥有。
// Optional 2D table scene owns public zones, temporary pan and committed-event animation; App/ChengduTable retain private controls.
// 不接收合法动作、不写服务端；所有隐藏牌/终局摊牌先经过同一纯投影模型。
// No legal-action prop or server write exists here; hidden tiles and terminal reveals pass through the same pure projection.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import MahjongTile from './MahjongTile.vue';
import RealisticCharacter from './RealisticCharacter.vue';
import { buildRealisticTableModel, clampRealisticPan, resetRealisticPan, fitRealisticTileGrid } from './realistic-table-layout.js';
import { realisticFlightForEvent } from './realistic-table-events.js';
import { chengduTableStatus } from './chengdu-table-status.js';
import { REALISTIC_FLIGHT_STAGGER_MS } from './realistic-presentation.js';
import { openRealisticPopover, closeRealisticPopovers, dismissRealisticPopoverFallback } from './realistic-popover.js';

const props = defineProps({
  state: { type: Object, required: true },
  characterForPlayer: { type: Function, required: true },
  presentationFrame: { type: Object, default: null },
  status: String,
  blocked: Boolean,
  canConfigureStart: Boolean,
  hasPrivateFeedback: Boolean,
});
const emit = defineEmits(['next-round', 'copy-invite']);
const model = computed(() => buildRealisticTableModel(props.state));
const game = computed(() => props.state.game);
const isChengdu = computed(() => (game.value.gameMode ?? props.state.gameMode) === 'chengdu');
// 成都进行中提示来自其原牌桌，不使用App只为成都大厅准备的状态文本。
// Chengdu in-game status comes from its original table, not App's lobby-only Chengdu text.
const visibleStatus = computed(() => isChengdu.value ? chengduTableStatus(props.state, props.blocked) : props.status);
const viewport = ref(null);
const viewportSize = ref({ width: 1200, height: 780 });
const pan = ref(resetRealisticPan());
const zoom = ref(1);
const dragging = ref(false);
const reducedMotion = ref(false);
const skin = ref('jade');
const flights = ref([]);
const characterActions = ref({});
const showDetails = ref(false);
let pointer = null;
let observer;
let mediaQuery;
// 挂载时的帧只作基线；切换显示不能把当时已在播放的旧事件当作新事件重放。
// The mounted frame is baseline only; switching presentations never replays the event already in progress.
let lastPresentationSequence = props.presentationFrame?.sequence ?? 0;
const timers = new Set();
// 场景尺寸包含角色留白，而非仅缩放桌面；默认1倍时四边牌区和全部人物都在画面内。
// Scene dimensions include character gutters; default zoom fits all four table edges and characters rather than fitting the felt alone.
// 三人桌没有北侧人物，不保留无用的上方留白；四人桌只为正面角色保留实际需要的高度。
// Three-player tables omit the unused north portrait gutter; four-player tables reserve only its actual portrait height.
const scene = computed(() => ({
  width: 1360,
  height: model.value.seats.length === 3 ? 1160 : 1250,
  tableX: 180,
  tableY: model.value.seats.length === 3 ? 80 : 200,
}));
const scale = computed(() => Math.max(0.01, Math.min(
  viewportSize.value.width / scene.value.width,
  viewportSize.value.height / scene.value.height,
)) * zoom.value);
const sceneStyle = computed(() => ({
  width: `${scene.value.width}px`,
  height: `${scene.value.height}px`,
  '--realistic-table-x': `${scene.value.tableX}px`,
  '--realistic-table-y': `${scene.value.tableY}px`,
  '--realistic-side-player-y': `${scene.value.tableY + 350}px`,
  // 名字与庄家/本人标记可能换行，给固定底部人物标签留足余量，而非只预留图片高度。
  // Names and self/dealer badges may wrap, so reserve label headroom rather than only the portrait height.
  '--realistic-south-player-y': `${scene.value.height - 260}px`,
  transform: `translate(${(viewportSize.value.width - scene.value.width * scale.value) / 2 + pan.value.x}px, ${(viewportSize.value.height - scene.value.height * scale.value) / 2 + pan.value.y}px) scale(${scale.value})`,
}));
const centerTiles = computed(() => grid(model.value.radishes.length, 200, 80, 28));
const names = computed(() => new Map(model.value.seats.map(({ seat }) => [seat,
  game.value.participantNames?.[seat] || props.state.seats?.find((player) => player?.seat === seat)?.name || `牌友 ${seat + 1}`])));
const characters = computed(() => new Map(model.value.seats.map(({ seat }) => [seat, props.characterForPlayer(seat)])));
const latestDiscardIndex = computed(() => (game.value.discards?.length || 0) - 1);
const meldLabels = { peng: '碰', mingGang: '明杠', anGang: '暗杠', buGang: '补杠', addGang: '加杠' };

// 尺寸与牌数决定同区所有牌的等比尺寸；不截断长牌河或长胡牌记录。
// Area dimensions and tile count determine uniform tile size; no long river or win record is truncated.
function grid(count, width, height, maxHeight = 42) {
  const value = fitRealisticTileGrid(count, width, height, 0.72, 3);
  const tileHeight = Math.min(value.tileHeight, maxHeight);
  return {
    display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, value.columns)}, ${tileHeight * 0.72}px)`,
    gridAutoRows: `${tileHeight}px`, gap: `${value.gap}px`,
    '--realistic-tile-width': `${tileHeight * 0.72}px`, '--realistic-tile-height': `${tileHeight}px`,
  };
}
// 垛数按开局固定，空位不回流；牌墙动画锚点与这里的等宽槽使用同一坐标约定。
// Stack count is fixed from the deal and empty slots never reflow; animation anchors share these equal-width cells.
function wallStyle(wall) {
  const slotWidth = wall.zones.wall.width / Math.max(1, wall.slots.length);
  const tileWidth = Math.min(26, Math.max(1, slotWidth - 2));
  return {
    display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, wall.slots.length)}, ${slotWidth}px)`,
    '--realistic-tile-width': `${tileWidth}px`, '--realistic-tile-height': `${tileWidth / 0.72}px`,
  };
}
function zoneStyle(zone) { return { left: `${zone.x}px`, top: `${zone.y}px`, width: `${zone.width}px`, height: `${zone.height}px` }; }
function scoreFor(seat) { return game.value.players.find((player) => player.seat === seat)?.score ?? 0; }
function scoreText(score) { return `${score > 0 ? '+' : ''}${score}`; }
function playerFor(seat) { return game.value.players.find((player) => player.seat === seat); }
// 胡次数读取权威计数；旧v1没有winPile，不能把缺少实体胡牌区误显示为没有胡过。
// Read authoritative hu counts: legacy v1 has no winPile, so an absent physical pile does not imply zero wins.
function playerSummary(seat) {
  if (!isChengdu.value) return `已胡${seat.huCount ?? '—'}次`;
  const player = playerFor(seat.seat);
  if (player?.won) return '已胡退出';
  if (player?.dingqueSuit) return `缺${{ bamboo: '条', dots: '筒', characters: '万' }[player.dingqueSuit]}`;
  if (player?.dingqueSubmitted) return '已定缺';
  if (game.value.preparation?.exchangeSubmittedSeats?.includes(seat.seat)) return '换牌已选';
  return '准备中';
}
function flightStyle(flight) {
  return {
    left: `${flight.from.x}px`, top: `${flight.from.y}px`,
    '--flight-x': `${flight.to.x - flight.from.x}px`, '--flight-y': `${flight.to.y - flight.from.y}px`,
    animationDelay: `${flight.delay}ms`,
  };
}
// 只捕获场景空白/公开牌的主指针；工具、滚动详情与固定手牌不属于拖拽范围。
// Capture only the scene's primary pointer; tools, detail scrolling and the fixed private hand are outside this drag surface.
function beginPan(event) {
  if (event.button !== 0 || event.isPrimary === false || event.target.closest?.('button, input, select, a, details')) return;
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  dragging.value = true;
  viewport.value?.setPointerCapture?.(event.pointerId);
}
function movePan(event) {
  if (!pointer || event.pointerId !== pointer.id) return;
  pan.value = clampRealisticPan({ x: event.clientX - pointer.x, y: event.clientY - pointer.y },
    viewportSize.value.width, viewportSize.value.height, scene.value.width * scale.value, scene.value.height * scale.value);
}
function resetPan() {
  const id = pointer?.id;
  pointer = null;
  dragging.value = false;
  pan.value = resetRealisticPan();
  if (id != null && viewport.value?.hasPointerCapture?.(id)) viewport.value.releasePointerCapture(id);
}
function onPanKey(event) {
  const directions = { ArrowLeft: [-40, 0], ArrowRight: [40, 0], ArrowUp: [0, -40], ArrowDown: [0, 40] };
  if (!directions[event.key]) return;
  event.preventDefault();
  const [x, y] = directions[event.key];
  pan.value = clampRealisticPan({ x: pan.value.x + x, y: pan.value.y + y },
    viewportSize.value.width, viewportSize.value.height, scene.value.width * scale.value, scene.value.height * scale.value);
}
function resize() {
  resetPan();
  const bounds = viewport.value?.getBoundingClientRect();
  if (bounds) viewportSize.value = { width: bounds.width, height: bounds.height };
}
function clearAnimations() {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  flights.value = [];
  characterActions.value = {};
}
function visibilityChanged() { if (document.hidden) { resetPan(); clearAnimations(); } }
function updateMotion() { reducedMotion.value = mediaQuery?.matches === true; if (reducedMotion.value) clearAnimations(); }
watch(zoom, resetPan);
watch(() => `${props.state.id}:${game.value.id}`, () => { resetPan(); clearAnimations(); });
// App只在本段真正取得播放权时发布视觉帧；不能从完整snapshot.history提前播放后续排队语音。
// App publishes a visual frame only when that batch owns playback, never reenacting future queued calls from a full snapshot history.
watch(() => props.presentationFrame, (frame) => {
  if (!frame || !Number.isSafeInteger(frame.sequence) || frame.sequence <= lastPresentationSequence) return;
  lastPresentationSequence = frame.sequence;
  if (frame.reset) { clearAnimations(); return; }
  if (frame.roomId !== props.state.id || frame.gameId !== game.value.id) return;
  if (reducedMotion.value || globalThis.document?.hidden) return;
  const next = (Array.isArray(frame.events) ? frame.events : [])
    .filter((event) => event?.eventKey != null)
    .map((event) => realisticFlightForEvent(event, event.eventKey, model.value)).filter(Boolean);
  next.forEach((flight, index) => {
    const delay = index * REALISTIC_FLIGHT_STAGGER_MS;
    flights.value.push({ ...flight, delay });
    // 同一批公开事件的角色和飞牌按相同延迟启动，不能提前把后面的动作覆盖到前一张飞牌上。
    // Actor motion and tile flights share the batch delay, so a later event cannot overwrite the earlier flight immediately.
    const startCharacterAction = () => {
      characterActions.value = {
        ...characterActions.value,
        [flight.seat]: { type: flight.type, eventKey: flight.eventKey },
      };
    };
    if (delay === 0) startCharacterAction();
    else {
      const startTimer = setTimeout(() => {
        timers.delete(startTimer);
        startCharacterAction();
      }, delay);
      timers.add(startTimer);
    }
    const timer = setTimeout(() => {
      timers.delete(timer);
      flights.value = flights.value.filter((entry) => entry.eventKey !== flight.eventKey);
      if (characterActions.value[flight.seat]?.eventKey === flight.eventKey) {
        const copy = { ...characterActions.value }; delete copy[flight.seat]; characterActions.value = copy;
      }
    }, delay + 1100);
    timers.add(timer);
  });
});
onMounted(() => {
  resize();
  if (globalThis.ResizeObserver) { observer = new ResizeObserver(resize); observer.observe(viewport.value); }
  mediaQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  updateMotion();
  mediaQuery?.addEventListener?.('change', updateMotion);
  window.addEventListener('resize', resize);
  window.addEventListener('blur', resetPan);
  document.addEventListener('visibilitychange', visibilityChanged);
  document.addEventListener('keydown', dismissRealisticPopoverFallback);
  document.addEventListener('pointerdown', dismissRealisticPopoverFallback);
});
onUnmounted(() => {
  resetPan(); clearAnimations(); observer?.disconnect();
  mediaQuery?.removeEventListener?.('change', updateMotion);
  window.removeEventListener('resize', resize);
  window.removeEventListener('blur', resetPan);
  document.removeEventListener('visibilitychange', visibilityChanged);
  document.removeEventListener('keydown', dismissRealisticPopoverFallback);
  document.removeEventListener('pointerdown', dismissRealisticPopoverFallback);
  closeRealisticPopovers();
});
</script>

<template>
  <section class="realistic-table" :class="`realistic-skin-${skin}`" aria-label="二维真实麻将桌">
    <div class="realistic-toolbar">
      <div class="realistic-heading"><span class="realistic-live-dot" :class="{ blocked }"></span><strong>{{ isChengdu ? '成都' : '花间' }} · 真实桌</strong><small>{{ state.id }} · {{ model.seats.length }}人</small></div>
      <div class="realistic-view-tools">
        <label>桌布 <select v-model="skin" aria-label="桌布皮肤"><option value="jade">松石绿</option><option value="night">午夜蓝</option><option value="clay">暖陶棕</option></select></label>
        <label class="realistic-zoom">视野 <input v-model.number="zoom" type="range" min="1" max="2" step="0.1" aria-label="桌面放大倍率" /></label>
        <button @click="zoom = 1; resetPan()">全桌</button><button :aria-expanded="showDetails" @click="showDetails = !showDetails">积分 / 牌局</button>
        <button data-realistic-invite @click="emit('copy-invite')">复制邀请</button>
        <button v-if="hasPrivateFeedback" popovertarget="realistic-hand-feedback" @click.prevent="openRealisticPopover('realistic-hand-feedback')">胡牌判断 / 结算</button>
        <button v-if="canConfigureStart" popovertarget="realistic-start-options" @click.prevent="openRealisticPopover('realistic-start-options')">下一局配置</button>
        <button v-if="game.phase === 'finished'" @click="emit('next-round')">本局结算 / 下一局</button>
      </div>
    </div>
    <div ref="viewport" class="realistic-viewport" :class="{ dragging, 'reduced-motion': reducedMotion }"
      tabindex="0" role="region" aria-label="可拖动的二维桌面，松手回正；方向键移动，松键回正"
      @pointerdown="beginPan" @pointermove="movePan" @pointerup="resetPan" @pointercancel="resetPan" @lostpointercapture="resetPan"
      @keydown="onPanKey" @keyup="resetPan" @blur="resetPan">
      <div class="realistic-scene" :style="sceneStyle">
        <div class="realistic-room-pattern" aria-hidden="true"></div>
        <div class="realistic-felt">
          <div class="realistic-felt-inlay" aria-hidden="true"></div>
          <!-- 无论三人四人都有四面墙；空垛保留位置，只从公开数量确定的前/后端逐步减少。
               Both player counts retain four walls; empty stacks keep their slots as public front/tail counts shrink. -->
          <div v-for="wall in model.walls" :key="`wall:${wall.position}`" class="realistic-seat-plane" :style="{ transform: `rotate(${wall.rotation}deg)` }">
            <div class="realistic-zone realistic-wall-zone" :style="zoneStyle(wall.zones.wall)" :aria-label="`${wall.position}牌墙示意段，${wall.wallCount ?? '未知'}张，开口为展示约定`">
              <small>牌墙 · {{ wall.wallCount ?? '?' }}</small>
              <div class="realistic-wall-stacks" :style="wallStyle(wall)">
                <span v-for="slot in wall.slots" :key="slot.index" class="realistic-wall-stack" :class="{ double: slot.remainingLayers === 2, empty: slot.remainingLayers === 0 }"><MahjongTile v-if="slot.remainingLayers" back small /></span>
              </div>
            </div>
          </div>
          <div v-for="seat in model.seats" :key="seat.seat" class="realistic-seat-plane" :style="{ transform: `rotate(${seat.rotation}deg)` }" :data-realistic-seat="seat.seat" :data-position="seat.position">
            <div class="realistic-zone realistic-hand-zone" :style="zoneStyle(seat.zones.hand)" :aria-label="`${names.get(seat.seat)}的手牌，共${seat.hand.length}张`">
              <div class="realistic-tiles" :style="grid(seat.hand.length, seat.zones.hand.width, seat.zones.hand.height)">
                <MahjongTile v-for="(tile, index) in seat.hand" :key="index" :tile="tile.tile" :back="tile.hidden" small />
              </div>
            </div>
            <div class="realistic-zone realistic-river-zone" :style="zoneStyle(seat.zones.river)" :aria-label="`${names.get(seat.seat)}的牌河，${seat.discards.length}张`">
              <small>牌河 · {{ seat.discards.length }}</small>
              <div class="realistic-tiles" :style="grid(seat.discards.length, seat.zones.river.width, seat.zones.river.height)">
                <MahjongTile v-for="tile in seat.discards" :key="tile.index" :tile="tile.tile" :back="tile.hidden" small :class="{ 'realistic-latest-discard': tile.index === latestDiscardIndex }" />
              </div>
            </div>
            <div class="realistic-zone realistic-meld-zone" :style="zoneStyle(seat.zones.melds)" :aria-label="`${names.get(seat.seat)}的碰杠区，玩家视角左下`">
              <small>碰 / 杠</small><span v-if="!seat.melds.length" class="realistic-empty-zone">左下 · 碰杠区</span>
              <div class="realistic-melds" :style="grid(seat.melds.reduce((count, meld) => count + meld.tiles.length, 0), seat.zones.melds.width, seat.zones.melds.height)">
                <template v-for="(meld, meldIndex) in seat.melds" :key="meldIndex"><MahjongTile v-for="(tile, tileIndex) in meld.tiles" :key="`${meldIndex}:${tileIndex}`" :tile="tile.tile" :back="tile.hidden" small :class="{ 'realistic-meld-first': tileIndex === 0 }" :data-meld-type="meldLabels[meld.type] || meld.type" /></template>
              </div>
            </div>
            <div class="realistic-zone realistic-win-zone" :style="zoneStyle(seat.zones.wins)" :aria-label="`${names.get(seat.seat)}的胡牌区，玩家视角右下`">
              <small>胡牌 · {{ seat.wins.length }}<template v-if="model.radishMode === 'personal'"> / 个人萝卜 {{ seat.personalRadishes.length }}</template></small><span v-if="!seat.wins.length && !seat.personalRadishes.length" class="realistic-empty-zone">右下 · 胡牌区</span>
              <div class="realistic-tiles" :style="grid(seat.wins.length, seat.zones.wins.width, model.radishMode === 'personal' ? 30 : seat.zones.wins.height)">
                <span v-for="(tile, index) in seat.wins" :key="index" class="realistic-win-tile" :data-win-seat="seat.seat" :data-win-index="index"><MahjongTile :tile="tile.tile" :back="tile.hidden" small /><i v-if="tile.virtual" title="共胡记录，并非额外实体牌">共</i></span>
              </div>
              <!-- 旧版个人萝卜留在各自右下区，保留计分归属，不合并成新版共享池。
                   Legacy personal radishes stay in each owner's lower-right zone rather than masquerading as a shared pool. -->
              <div v-if="model.radishMode === 'personal'" class="realistic-personal-radishes" :aria-label="`${names.get(seat.seat)}的个人萝卜，${seat.personalRadishes.length}张`">
                <div class="realistic-tiles" :style="grid(seat.personalRadishes.length, seat.zones.wins.width, 35)"><MahjongTile v-for="(tile, index) in seat.personalRadishes" :key="index" :tile="tile.tile" :back="tile.hidden" small /></div>
              </div>
            </div>
          </div>
          <div class="realistic-center">
            <div class="realistic-compass" aria-hidden="true"><span>北</span><span>西</span><b>花間</b><span>东</span><span>南</span></div>
            <strong class="realistic-wall-total">{{ model.wallCount ?? '—' }}<small>余牌</small></strong>
            <div v-if="model.radishMode === 'shared'" class="realistic-radishes" aria-label="全桌共享萝卜区"><span>萝卜 <b>{{ model.radishes.length }}</b><small v-if="model.pendingRadishes"> · 待翻 {{ model.pendingRadishes }}</small></span><div class="realistic-tiles" :style="centerTiles"><MahjongTile v-for="(tile, index) in model.radishes" :key="index" :tile="tile.tile" :back="tile.hidden" small /></div></div>
            <p v-else-if="model.radishMode === 'personal'" class="realistic-chengdu-rules">个人萝卜<br />分别在各家右下区</p>
            <p v-else-if="isChengdu" class="realistic-chengdu-rules">{{ game.rules.endCondition === 'firstWin' ? '首胡结束' : '血战到底' }}<br />{{ game.rules.fanCap }}番封顶 · 定缺</p>
          </div>
          <div v-for="flight in flights" :key="flight.eventKey" class="realistic-tile-flight" :style="flightStyle(flight)" aria-hidden="true"><MahjongTile :tile="flight.tile" :back="flight.hidden" small /><b>{{ flight.label }}</b></div>
        </div>
        <div v-for="seat in model.seats" :key="`character:${seat.seat}`" class="realistic-player" :class="[`realistic-player-${seat.position}`, { current: game.currentSeat === seat.seat && game.phase !== 'finished' }]">
          <RealisticCharacter :character="characters.get(seat.seat)" :position="seat.position" :action="characterActions[seat.seat]" :enabled="!reducedMotion" />
          <div class="realistic-player-label"><span><b>{{ names.get(seat.seat) }}</b><i v-if="seat.isSelf">你</i><i v-if="seat.seat === game.dealerSeat">庄</i></span><strong>{{ scoreText(scoreFor(seat.seat)) }}</strong><small>{{ seat.handCount }}张手牌 · {{ playerSummary(seat) }}</small></div>
        </div>
      </div>
    </div>
    <div class="realistic-bottomline"><span role="status">{{ blocked ? '正在同步，请稍等' : game.phase === 'finished' ? '本局结束，可查看结算与摊牌' : visibleStatus }}</span><small>拖动查看，松手回正 · 牌墙按公开余牌示意</small></div>
    <aside v-if="showDetails" class="realistic-details" aria-label="本桌积分与本局状态"><button @click="showDetails = false">关闭</button><h3>本桌累计 · 虚拟积分</h3><p v-for="(row, index) in state.tableScores || []" :key="row.id || index"><span>{{ row.name }}</span><b>{{ scoreText(row.totalScore) }}</b></p><hr /><p v-for="seat in model.seats" :key="seat.seat"><span>{{ names.get(seat.seat) }} · 本局</span><b>{{ scoreText(scoreFor(seat.seat)) }}</b></p><small>经典桌可查看完整历史与玩法说明。切换显示不会离桌或更改牌局。</small></aside>
  </section>
</template>
