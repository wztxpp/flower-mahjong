<script setup>
// Vue包装只连接权威投影、既有FIFO和原控件目标；Three不拥有动作、请求或规则。
// This wrapper connects authoritative projection, existing FIFO and original control targets; Three owns no actions, requests or rules.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import MahjongTile from './MahjongTile.vue';
import { buildThreeTableModel } from './three-table/adapter.js';
import { createFrameGate } from './three-table/lifecycle.js';
import { chengduTableStatus } from './chengdu-table-status.js';
import { openRealisticPopover, closeRealisticPopovers, dismissRealisticPopoverFallback } from './realistic-popover.js';

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
const emit = defineEmits(['next-round', 'copy-invite', 'controls-target', 'fallback']);
const model = computed(() => buildThreeTableModel(props.state));
const game = computed(() => props.state.game);
const isChengdu = computed(() => (game.value.gameMode ?? props.state.gameMode) === 'chengdu');
const visibleStatus = computed(() => isChengdu.value ? chengduTableStatus(props.state, props.blocked) : props.status);
const viewport = ref(null);
const showDetails = ref(false);
const focused = ref(false);
const ready = ref(false);
const artStatus = ref('角色：已批准原画2.5D · 摸牌人物动画暂停');
const skin = ref('#316a5c');
const activeView = ref('player');
const acceptFrame = createFrameGate(props.presentationFrame?.sequence ?? 0);
let renderer = null;
let disposed = false;
let mediaQuery;

// Teleport搬同一份DOM，不复制手牌动作路径。卸载先归还目标，经典显示立即可用。
// Teleport moves the same DOM, never duplicates hand actions. Returning the target on unmount restores classic immediately.
function setControlsTarget(node) { emit('controls-target', node); }
function fallback() {
  if (disposed) return;
  renderer?.dispose();
  renderer = null;
  emit('fallback', true);
}
function updateScene() { renderer?.update(model.value, props.characterForPlayer, props.hasPrivateControls); }
function setView(name) {
  if (focused.value) return;
  activeView.value = name;
  renderer?.setView(name);
}
function setFocus(enabled) { focused.value = enabled; renderer?.setFocus(enabled); }
function onKey(event) {
  if (event.key === 'Escape') {
    if (showDetails.value) showDetails.value = false;
    else if (focused.value) setFocus(false);
  }
  dismissRealisticPopoverFallback(event);
}
function updateMotion() { renderer?.setReducedMotion(mediaQuery?.matches === true); }
watch(model, updateScene, { deep: true });
watch(() => props.hasPrivateControls, updateScene);
watch(skin, (color) => renderer?.setSkin(color));
watch(() => `${props.state.id}:${game.value.id}`, () => { renderer?.present([]); setFocus(false); setView('player'); });
watch(() => props.presentationFrame, (frame) => {
  const events = acceptFrame(frame, model.value);
  if (events !== null) renderer?.present(events);
});

onMounted(async () => {
  mediaQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  mediaQuery?.addEventListener?.('change', updateMotion);
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', dismissRealisticPopoverFallback);
  try {
    // 仅进入真实桌才加载Three，切回经典/卸载后的异步结果不得创建新画布。
    // Load Three only on entry; an async result after classic switching/unmount must not create a canvas.
    const { createThreeTableRenderer } = await import('./three-table/renderer.js');
    if (disposed) return;
    renderer = createThreeTableRenderer(viewport.value, {
      onFailure: fallback,
      onArtError: (message) => { artStatus.value = message; },
      reducedMotion: mediaQuery?.matches === true,
    });
    updateScene();
    ready.value = true;
  } catch {
    fallback();
  }
});
onUnmounted(() => {
  disposed = true;
  renderer?.dispose();
  renderer = null;
  emit('controls-target', null);
  mediaQuery?.removeEventListener?.('change', updateMotion);
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('pointerdown', dismissRealisticPopoverFallback);
  closeRealisticPopovers();
});
</script>

<template>
  <section class="realistic-table" :class="{ 'three-focus': focused }" aria-label="Three.js 三维麻将桌">
    <div class="realistic-toolbar">
      <div class="realistic-heading"><strong>{{ isChengdu ? '成都' : '花间' }} · 三维真实桌</strong><small>{{ state.id }} · {{ model.seats.length }}人 · 余牌 {{ model.wallCount ?? '—' }}<template v-if="model.radishMode === 'shared'"> · 萝卜 {{ model.radishes.length }} · 待翻 {{ model.pendingRadishes ?? '—' }}</template></small></div>
      <div class="realistic-view-tools" aria-label="视角与牌局工具">
        <button :aria-pressed="focused" @click="setFocus(!focused)">{{ focused ? '退出专注' : '专注打牌' }}</button>
        <template v-if="!focused"><button v-for="view in [{ id: 'player', name: '全桌' }, { id: 'top', name: '俯视' }, { id: 'left', name: '左座' }, { id: 'right', name: '右座' }, { id: 'north', name: '对座' }, { id: 'orbit', name: '环顾' }]" :key="view.id" :aria-pressed="activeView === view.id" @click="setView(view.id)">{{ view.name }}</button></template>
        <label>桌布<select v-model="skin" aria-label="桌布颜色"><option value="#316a5c">松石绿</option><option value="#315872">午夜蓝</option><option value="#794751">暖酒红</option></select></label>
        <button :aria-expanded="showDetails" @click="showDetails = !showDetails">积分 / 公开牌区</button>
        <button data-realistic-invite @click="emit('copy-invite')">复制邀请</button>
        <button v-if="hasPrivateFeedback" @click="openRealisticPopover('realistic-hand-feedback')">胡牌判断 / 结算</button>
        <button v-if="canConfigureStart" @click="openRealisticPopover('realistic-start-options')">下一局配置</button>
        <button v-if="game.phase === 'finished'" @click="emit('next-round')">本局结算 / 下一局</button>
        <button @click="emit('fallback')">经典桌</button>
      </div>
    </div>
    <div ref="viewport" class="realistic-viewport" aria-label="可拖动环顾的三维桌面"></div>
    <p v-if="!ready" class="three-loading" role="status">正在准备三维牌桌…</p>
    <div class="three-seat-status" aria-label="各家公开状态"><span v-for="seat in model.seats" :key="seat.seat" :class="{ current: game.currentSeat === seat.seat }">{{ seat.name }}<b v-if="seat.isSelf"> · 你</b><b v-if="seat.seat === game.dealerSeat"> · 庄</b> · {{ seat.handCount ?? '—' }}张 · 胡{{ seat.huCount ?? '—' }} · {{ seat.score > 0 ? '+' : '' }}{{ seat.score }}</span></div>
    <!-- 原始可操作手牌/动作仍在可滚动原生层，专注、旋转与小屏都不能遮挡它。
         Original interactive hands/actions stay in a native scrolling layer across focus, orbit and narrow screens. -->
    <div :ref="setControlsTarget" id="realistic-private-controls" class="realistic-private-controls"></div>
    <div class="realistic-bottomline"><span role="status">{{ blocked ? '正在同步，请稍等' : game.phase === 'finished' ? '本局结束，可查看结算与摊牌' : visibleStatus }}</span><small>{{ artStatus }}</small></div>
    <aside v-if="showDetails" class="realistic-details" aria-label="积分与公开牌区"><button @click="showDetails = false">关闭</button><h3>本桌累计 · 虚拟积分</h3><p v-for="(row, index) in state.tableScores || []" :key="row.id || index">{{ row.name }} · {{ row.totalScore }}</p>
      <section v-for="seat in model.seats" :key="seat.seat"><h4>{{ seat.name }} · 本局 {{ seat.score }}</h4>
        <p>手牌 {{ seat.handCount ?? '—' }}张 · 胡 {{ seat.huCount ?? '—' }}次</p>
        <div class="three-detail-tiles"><MahjongTile v-for="(tile, index) in seat.hand" :key="index" :tile="tile.tile" :back="tile.hidden" small /></div>
        <p>碰 / 杠</p><div v-for="(meld, index) in seat.melds" :key="index" class="three-detail-tiles"><span>{{ meld.type }}</span><MahjongTile v-for="(tile, tileIndex) in meld.tiles" :key="tileIndex" :tile="tile.tile" :back="tile.hidden" small /></div>
        <p>牌河 {{ seat.discards.length }}张</p><div class="three-detail-tiles"><MahjongTile v-for="tile in seat.discards" :key="tile.index" :tile="tile.tile" :back="tile.hidden" small /></div>
        <p>胡牌记录</p><div class="three-detail-tiles"><span v-for="(tile, index) in seat.wins" :key="index"><MahjongTile :tile="tile.tile" :back="tile.hidden" small /><small v-if="tile.virtual">共胡引用</small></span></div>
        <template v-if="model.radishMode === 'personal'"><p>个人萝卜 {{ seat.personalRadishes.length }}张</p><div class="three-detail-tiles"><MahjongTile v-for="(tile, index) in seat.personalRadishes" :key="index" :tile="tile.tile" :back="tile.hidden" small /></div></template>
      </section>
      <template v-if="model.radishMode === 'shared'"><h4>共享萝卜 {{ model.radishes.length }}张 · 待翻 {{ model.pendingRadishes ?? '—' }}</h4><div class="three-detail-tiles"><MahjongTile v-for="(tile, index) in model.radishes" :key="index" :tile="tile.tile" :back="tile.hidden" small /></div></template>
    </aside>
  </section>
</template>
