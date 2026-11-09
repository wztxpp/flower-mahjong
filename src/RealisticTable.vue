<script setup>
// 可选二维实桌场景：只负责公开区域、临时平移和已提交动作动画。私有操作仍由App/ChengduTable拥有。
// Optional 2D table scene owns public zones, temporary pan and committed-event animation; App/ChengduTable retain private controls.
// 不接收合法动作、不写服务端；所有隐藏牌/终局摊牌先经过同一纯投影模型。
// No legal-action prop or server write exists here; hidden tiles and terminal reveals pass through the same pure projection.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import MahjongTile from './RealisticTableTile.vue';
import FlyingTile from './MahjongTile.vue';
import RealisticCharacter from './RealisticCharacter.vue';
import { realisticCharacterView } from './realistic-character-catalog.js';
import { realisticFigureModel, realisticFigurePlacement } from './realistic-character-figure.js';
import { realisticPovModel } from './realistic-character-body.js';
import { buildRealisticTableModel, resetRealisticPan, fitRealisticTileGrid } from './realistic-table-layout.js';
import { realisticFlightForEvent } from './realistic-table-events.js';
import { chengduTableStatus } from './chengdu-table-status.js';
import { REALISTIC_FLIGHT_STAGGER_MS } from './realistic-presentation.js';
import { openRealisticPopover, closeRealisticPopovers, dismissRealisticPopoverFallback } from './realistic-popover.js';
import { REALISTIC_ROOM_SCENE, REALISTIC_TABLE_ART, projectRealisticTablePoint, realisticTableProjectionTransform, realisticSceneCamera, clampRealisticScenePan, realisticPrivateTileSize } from './realistic-table-perspective.js';

const props = defineProps({
  state: { type: Object, required: true },
  characterForPlayer: { type: Function, required: true },
  presentationFrame: { type: Object, default: null },
  status: String,
  blocked: Boolean,
  canConfigureStart: Boolean,
  hasPrivateFeedback: Boolean,
  hasPrivateControls: Boolean,
});
const emit = defineEmits(['next-round', 'copy-invite', 'controls-target']);
// 模板ref在真实目标挂载/卸载时通知父级，只提供展示位置，不传递动作或暗牌。
// The template ref announces target mount/unmount to its parent, carrying layout only, never actions or concealed tiles.
const controlsNode = ref(null);
const handBottomOffset = ref(70);
let controlsObserver;
// 原私有DOM的手牌底边是唯一锚点。提示/按钮高度改变时只量布局，绝不读取手牌值或改动作。
// Anchor the original private rack's bottom, not the whole panel. Measure layout only when hints/actions change, never tile values or actions.
function measureControls() {
  const node = controlsNode.value;
  const rack = node?.querySelector?.('.my-hand, .chengdu-hand-tiles');
  if (rack && node.getBoundingClientRect) {
    const offset = rack.getBoundingClientRect().bottom - node.getBoundingClientRect().top;
    if (Number.isFinite(offset) && offset > 0) handBottomOffset.value = offset;
  }
}
function setControlsTarget(node) {
  controlsObserver?.disconnect();
  controlsNode.value = node;
  emit('controls-target', node);
  if (node && controlsObserver) controlsObserver.observe(node);
}
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
const skin = ref('night');
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
// 三/四人所有视角使用同一完整房间，空位变化不能裁掉真实对家或桌下。
// Every three/four-player viewpoint uses one complete room; vacancy changes never crop an opposite player or the under-table scene.
const scene = computed(() => REALISTIC_ROOM_SCENE);
const camera = computed(() => realisticSceneCamera(viewportSize.value.width, viewportSize.value.height, zoom.value, pan.value));
const scale = computed(() => camera.value.scale);
const sceneStyle = computed(() => ({
  width: `${scene.value.width}px`,
  height: `${scene.value.height}px`,
  transform: `translate(${camera.value.x}px, ${camera.value.y}px) scale(${scale.value})`,
}));
const tableArtStyle = { left: `${REALISTIC_TABLE_ART.sceneOffset[0]}px`, top: `${REALISTIC_TABLE_ART.sceneOffset[1]}px`, width: `${REALISTIC_TABLE_ART.sourceSize[0]}px`, height: `${REALISTIC_TABLE_ART.sourceSize[1]}px` };
const tableProjectionStyle = { transform: realisticTableProjectionTransform() };
// 真正可操作手牌沿同一桌面近边锚定，但保持原生可点尺寸；拖动/缩放时随桌边平移，不留第二个底部操作台。
// Anchor actual controls to the same near edge while keeping native click sizes; pan/zoom follows the table rather than a second bottom HUD.
const privateControlsStyle = computed(() => {
  const anchor = projectRealisticTablePoint({ x: 500, y: 1000 });
  const tile = realisticPrivateTileSize(scale.value);
  const width = Math.min(viewportSize.value.width - 12, 1120 * scale.value);
  return {
    left: `${camera.value.x + anchor.x * scale.value - width / 2}px`,
    // 细看放大时近沿可能在视窗外；只向桌布内收回原手牌，保留底下提示，不截断可点击牌。
    // Detail zoom can place the near edge offscreen; pull the original rack inward over the felt and retain its hints.
    top: `${Math.min(camera.value.y + (anchor.y - 20) * scale.value, viewportSize.value.height - 52) - handBottomOffset.value}px`,
    bottom: 'auto',
    width: `${width}px`,
    '--private-tile-width': `${tile.width}px`, '--private-tile-height': `${tile.height}px`,
  };
});
const centerTiles = computed(() => grid(model.value.radishes.length, 200, 80, 28));
const names = computed(() => new Map(model.value.seats.map(({ seat }) => [seat,
  game.value.participantNames?.[seat] || props.state.seats?.find((player) => player?.seat === seat)?.name || `牌友 ${seat + 1}`])));
const characters = computed(() => new Map(model.value.seats.map(({ seat }) => [seat, props.characterForPlayer(seat)])));
const selfPov = computed(() => {
  const self = model.value.seats.find((seat) => seat.isSelf);
  return self ? realisticPovModel(realisticCharacterView(characters.value.get(self.seat)?.id, 'south')) : null;
});
const selfPovStyle = computed(() => {
  if (!selfPov.value) return {};
  const [, , width, height] = selfPov.value.viewBox.split(' ').map(Number);
  const displayWidth = selfPov.value.displayWidth;
  const displayHeight = displayWidth * height / width;
  // 高窄屏已能看完整房间时，大腿仍从画面底边延续，不能在半空出现一条平切边。
  // When tall narrow screens fit the full room, thighs still continue off the viewport bottom rather than ending in mid-air.
  const top = Math.max(scene.value.height - displayHeight,
    (viewportSize.value.height - camera.value.y) / scale.value - displayHeight);
  return { top: `${top}px`, bottom: 'auto', left: `${(scene.value.width - displayWidth) / 2}px`, width: `${displayWidth}px`, height: `${displayHeight}px`, aspectRatio: selfPov.value.aspectRatio };
});
// 整源摆位与前后遮挡共享同一位置，牌桌不会单独移动人物的脚。
// Whole-source placement is shared by both occlusion layers; the table never moves an actor's feet independently.
function figureFor(seat) { return realisticFigureModel(realisticCharacterView(characters.value.get(seat.seat)?.id, seat.position)); }
function actorStyle(seat) { return !seat.isSelf ? realisticFigurePlacement(figureFor(seat), seat.position)?.style : undefined; }
function playerLabelStyle(seat) {
  const placement = !seat.isSelf && realisticFigurePlacement(figureFor(seat), seat.position);
  if (!placement) return undefined;
  const positions = { left: [20, 65], right: [1110, 65], north: [810, 20] };
  const [x, y] = positions[seat.position] || [70, 875];
  return { left: `${x - placement.x}px`, top: `${y - placement.y}px`, width: '230px' };
}
const latestDiscardIndex = computed(() => (game.value.discards?.length || 0) - 1);
const meldLabels = { peng: '碰', mingGang: '明杠', anGang: '暗杠', buGang: '补杠', addGang: '加杠' };

// 尺寸与牌数决定同区所有牌的等比尺寸；不截断长牌河或长胡牌记录。
// Area dimensions and tile count determine uniform tile size; no long river or win record is truncated.
function grid(count, width, height, maxHeight = 56) {
  const value = fitRealisticTileGrid(count, width, height, 0.72, 3);
  const tileHeight = Math.min(value.tileHeight, maxHeight);
  return {
    display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, value.columns)}, ${tileHeight * 0.72}px)`,
    gridAutoRows: `${tileHeight}px`, gap: `${value.gap}px`,
    '--realistic-tile-width': `${tileHeight * 0.72}px`, '--realistic-tile-height': `${tileHeight}px`,
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
  if (event.button !== 0 || event.isPrimary === false || event.target.closest?.('button, input, select, a, details, #realistic-private-controls')) return;
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, pan: { ...pan.value } };
  dragging.value = true;
  viewport.value?.setPointerCapture?.(event.pointerId);
}
function movePan(event) {
  if (!pointer || event.pointerId !== pointer.id) return;
  pan.value = clampRealisticScenePan({ x: pointer.pan.x + event.clientX - pointer.x, y: pointer.pan.y + event.clientY - pointer.y },
    viewportSize.value.width, viewportSize.value.height, zoom.value);
}
function resetPan() {
  const id = pointer?.id;
  pointer = null;
  dragging.value = false;
  pan.value = resetRealisticPan();
  if (id != null && viewport.value?.hasPointerCapture?.(id)) viewport.value.releasePointerCapture(id);
}
// 为触屏与键盘补充稳定的桌下查看入口；拖拽仍按松手回正，全桌按钮恢复默认取景。
// Provide a stable under-table view for touch and keyboard; dragging still springs back and Full table restores framing.
function viewUnderTable() {
  const initial = realisticSceneCamera(viewportSize.value.width, viewportSize.value.height, zoom.value);
  const lowerEdgePan = Math.min(0, viewportSize.value.height - initial.y - scene.value.height * scale.value);
  pan.value = clampRealisticScenePan({ x: 0, y: lowerEdgePan },
    viewportSize.value.width, viewportSize.value.height, zoom.value);
}
function onPanKey(event) {
  const directions = { ArrowLeft: [-40, 0], ArrowRight: [40, 0], ArrowUp: [0, -40], ArrowDown: [0, 40] };
  // 私有控件的方向键属于原生手牌/动作滚动，不应触发桌面平移。
  // Arrow keys inside private controls belong to native hand/action scrolling, never table panning.
  if (event.target?.closest?.('#realistic-private-controls') || !directions[event.key]) return;
  event.preventDefault();
  const [x, y] = directions[event.key];
  pan.value = clampRealisticScenePan({ x: pan.value.x + x, y: pan.value.y + y },
    viewportSize.value.width, viewportSize.value.height, zoom.value);
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
  if (globalThis.ResizeObserver) {
    observer = new ResizeObserver(resize); observer.observe(viewport.value);
    controlsObserver = new ResizeObserver(measureControls);
    if (controlsNode.value) controlsObserver.observe(controlsNode.value);
  }
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
  resetPan(); clearAnimations(); observer?.disconnect(); controlsObserver?.disconnect();
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
      <div class="realistic-heading"><span class="realistic-live-dot" :class="{ blocked }"></span><strong>{{ isChengdu ? '成都' : '花间' }} · 真实桌</strong><small>{{ state.id }} · {{ model.seats.length }}人 · 余牌 {{ model.wallCount ?? '—' }}</small></div>
      <div class="realistic-view-tools">
        <label>桌布 <select v-model="skin" aria-label="桌布皮肤"><option value="jade">松石绿</option><option value="night">午夜蓝</option><option value="clay">暖陶棕</option></select></label>
        <label class="realistic-zoom">视野 <input v-model.number="zoom" type="range" min="1" max="2" step="0.1" aria-label="桌面放大倍率" /></label>
        <button @click="zoom = 1; resetPan()">全桌</button><button @click="viewUnderTable">桌下</button><button :aria-expanded="showDetails" @click="showDetails = !showDetails">积分 / 牌局</button>
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
        <img class="realistic-table-art" :src="REALISTIC_TABLE_ART.url" :style="tableArtStyle" alt="" aria-hidden="true" />
        <div class="realistic-felt" :style="tableProjectionStyle">
          <div class="realistic-felt-tint" aria-hidden="true"></div>
          <!-- 牌墙按用户要求不绘制；中央余牌仍来自同一公开状态，发牌/摸牌规则不变。
               Walls are intentionally hidden; the public remaining count and all draw/deal rules stay unchanged. -->
          <div v-for="seat in model.seats" :key="seat.seat" class="realistic-seat-plane" :style="{ transform: `rotate(${seat.rotation}deg)` }" :data-realistic-seat="seat.seat" :data-position="seat.position">
            <div v-if="!(hasPrivateControls && seat.isSelf)" class="realistic-zone realistic-hand-zone" :style="zoneStyle(seat.zones.hand)" :aria-label="`${names.get(seat.seat)}的手牌，共${seat.hand.length}张`">
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
          <div v-for="flight in flights" :key="flight.eventKey" class="realistic-tile-flight" :style="flightStyle(flight)" aria-hidden="true"><FlyingTile :tile="flight.tile" :back="flight.hidden" small /><b>{{ flight.label }}</b></div>
        </div>
        <div v-for="seat in model.seats" :key="`character:${seat.seat}`" :style="actorStyle(seat)" class="realistic-player" :class="[`realistic-player-${seat.position}`, { current: game.currentSeat === seat.seat && game.phase !== 'finished' }]">
          <RealisticCharacter v-if="!seat.isSelf" :character="characters.get(seat.seat)" :position="seat.position" :action="characterActions[seat.seat]" :enabled="!reducedMotion" />
          <div class="realistic-player-label" :style="playerLabelStyle(seat)"><span><b>{{ names.get(seat.seat) }}</b><i v-if="seat.isSelf">你</i><i v-if="seat.seat === game.dealerSeat">庄</i></span><strong>{{ scoreText(scoreFor(seat.seat)) }}</strong><small>{{ seat.handCount }}张手牌 · {{ playerSummary(seat) }}</small></div>
        </div>
        <!-- 本人是朝桌面的膝腿前景，不是左下角面朝自己的小人；缺该角色POV时不借用他人的裤鞋。
             The self view is knees facing the table, not a miniature facing the camera; absent identity-specific POV stays absent. -->
        <svg v-if="selfPov" class="realistic-self-pov" :viewBox="selfPov.viewBox" :style="selfPovStyle" aria-hidden="true" data-body-status="approved-first-person" :data-coverage="selfPov.coverage"><image :href="selfPov.url" :width="selfPov.sourceSize[0]" :height="selfPov.sourceSize[1]" /></svg>
      </div>
      <!-- 原私有组件被移入此桌内近沿；不随公开场景缩小，保留可点尺寸与原生横向滚动。
           Original private components move into this near edge; no scene scaling shrinks targets or native horizontal scrolling. -->
      <div :ref="setControlsTarget" id="realistic-private-controls" class="realistic-private-controls" :style="privateControlsStyle"></div>
    </div>
    <div class="realistic-bottomline"><span role="status">{{ blocked ? '正在同步，请稍等' : game.phase === 'finished' ? '本局结束，可查看结算与摊牌' : visibleStatus }}</span><small>拖动查看，松手回正 · 余牌见桌心</small></div>
    <aside v-if="showDetails" class="realistic-details" aria-label="本桌积分与本局状态"><button @click="showDetails = false">关闭</button><h3>本桌累计 · 虚拟积分</h3><p v-for="(row, index) in state.tableScores || []" :key="row.id || index"><span>{{ row.name }}</span><b>{{ scoreText(row.totalScore) }}</b></p><hr /><p v-for="seat in model.seats" :key="seat.seat"><span>{{ names.get(seat.seat) }} · 本局</span><b>{{ scoreText(scoreFor(seat.seat)) }}</b></p><small>经典桌可查看完整历史与玩法说明。切换显示不会离桌或更改牌局。</small></aside>
  </section>
</template>
