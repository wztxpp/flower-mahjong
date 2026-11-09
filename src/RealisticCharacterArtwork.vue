<script setup>
// 独立坐姿的透明原画画框：img始终可见，复用既有Canvas2D局部眼睛/发丝渲染器。
// Transparent independent-view frame: the image stays visible; reuse the existing local-eye/hair Canvas2D renderer.
// 不接收手牌/动作；公开三秒胡/放炮原图仍由已有调度器管理，装饰失败不阻断游戏。
// No hands/actions enter here; the existing scheduler owns three-second reaction originals and decorative failure never blocks play.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { loadPortraitMotionRuntime } from './portrait-motion/loader.js';
import { PortraitController } from './portrait-motion/controller.js';

const props = defineProps({
  character: { type: Object, required: true },
  enabled: { type: Boolean, default: true },
  motionDescriptor: { type: Object, default: null },
  actionDescriptor: { type: Object, default: null },
  action: { type: Object, default: null },
});
// 写实模式自身的开关就是动态许可；不迁移旧SDK状态。 / The realistic-mode switch owns motion enablement, never old SDK state.
const canAnimate = computed(() => props.enabled);
const frame = ref(null);
const canvas = ref(null);
const handCanvas = ref(null);
const handActive = ref(false);
const canvasGeneration = ref(0);
const descriptor = computed(() => props.motionDescriptor);
const reaction = computed(() => props.character.portraitReaction || 'base');
const phaseKey = computed(() => props.character.portraitPhaseKey || props.character.id);
const rendererStatus = ref('original');
let mounted = false;
let visible = false;
let foreground = true;
let reducedMotion = false;
let observer;
let motionQuery;
let handRenderer = null;
let handGeneration = 0;
let handPending = false;
let handReady = false;
let handFailed = false;
let handFrame = null;
let lastHandEvent = null;
let selectHandFrame;

// 手动作独立于眨眼，关闭/离屏/后台时立即停止，不重播已经错过的公开事件。
// Hand actions are independent of blinking and stop immediately when disabled/offscreen/background, without replaying missed events.
function stopHand() {
  if (handFrame !== null) cancelAnimationFrame(handFrame);
  handFrame = null;
  handActive.value = false;
}
function disposeHands() {
  stopHand();
  handGeneration += 1;
  handRenderer?.dispose();
  handRenderer = null;
  handPending = false;
  handReady = false;
}
function canPlayHand() { return mounted && props.enabled && visible && foreground && !reducedMotion; }

// 只预热已批准的本角色/视角动作；迟到模块和图片每次await后复核代次，不影响固定底图。
// Warm only approved actions for this role/view; recheck generations after every await so late modules/images cannot affect the fixed base.
async function syncHands() {
  if (!canPlayHand()) { stopHand(); return; }
  if (!props.actionDescriptor || handPending || handReady || handFailed) return;
  const generation = handGeneration;
  const descriptorSnapshot = props.actionDescriptor;
  handPending = true;
  try {
    const module = await import('./realistic-character-actions.js');
    if (!mounted || generation !== handGeneration || descriptorSnapshot !== props.actionDescriptor) return;
    const renderer = new module.RealisticActionRenderer(handCanvas.value, descriptorSnapshot);
    handRenderer = renderer;
    selectHandFrame = module.realisticHandFrame;
    const prepared = await renderer.prepare();
    if (!mounted || generation !== handGeneration || handRenderer !== renderer) { renderer.dispose(); return; }
    handReady = prepared;
    handPending = false;
  } catch {
    if (generation !== handGeneration) return;
    handRenderer?.dispose();
    handRenderer = null;
    handPending = false;
    handFailed = true;
    stopHand();
  }
}
function playHand(action) {
  if (!handReady || !canPlayHand() || !selectHandFrame) return;
  stopHand();
  const startedAt = performance.now();
  const generation = handGeneration;
  const renderer = handRenderer;
  const tick = (now) => {
    handFrame = null;
    if (!canPlayHand() || generation !== handGeneration || renderer !== handRenderer) { stopHand(); return; }
    const index = selectHandFrame(action.type, now - startedAt, props.actionDescriptor.frames.length);
    if (index === null) { stopHand(); return; }
    try {
      handActive.value = renderer.draw(index);
      handFrame = requestAnimationFrame(tick);
    } catch { stopHand(); handFailed = true; }
  };
  handFrame = requestAnimationFrame(tick);
}

const controller = new PortraitController({
  onStatus: (status) => { rendererStatus.value = status; },
  async createRenderer(onError, isCurrent) {
    // await 前快照节点和角色；迟到模块不能构造到新角色/已卸载画布上。
    // Snapshot node and role before awaiting; late modules cannot construct on a new role or unmounted canvas.
    const currentCanvas = canvas.value;
    const currentDescriptor = descriptor.value;
    const currentPhase = phaseKey.value;
    const { PortraitMotionRenderer } = await loadPortraitMotionRuntime();
    if (!mounted || !isCurrent() || canvas.value !== currentCanvas || descriptor.value !== currentDescriptor) return null;
    return new PortraitMotionRenderer(currentCanvas, onError, currentPhase);
  },
});
const showMotion = computed(() => canAnimate.value && rendererStatus.value === 'motion' && reaction.value === 'base');
const displayStatus = computed(() => showMotion.value ? 'motion' : rendererStatus.value === 'fallback' ? 'fallback' : 'original');

// 原图路径须与素材声明完全吻合；错误角色/表情或加载中的暂态只显示原图。
// The original path must match asset provenance exactly; mismatched roles/reactions or loading states show only original art.
function sync() {
  if (!mounted) return;
  controller.sync({ descriptor: descriptor.value, reaction: reaction.value,
    enabled: canAnimate.value && (reaction.value !== 'base' || props.character.portrait === descriptor.value?.sourceUrl),
    visible, foreground, reducedMotion });
  void syncHands();
}
function visibilityChanged() {
  foreground = !document.hidden;
  sync();
}
function motionChanged() {
  reducedMotion = motionQuery?.matches === true;
  sync();
}

// 换角/相位/原图变化先撤销旧代次，post 再取新节点；同批关闭→开启也不能接纳旧异步结果。
// Role/phase/source changes revoke old generations first; post-flush uses new nodes, including same-batch off/on changes.
watch([descriptor, phaseKey], () => {
  if (mounted) controller.sync({ descriptor: null, enabled: false });
  canvasGeneration.value += 1;
}, { flush: 'sync' });
watch([descriptor, phaseKey, reaction, canAnimate, canvasGeneration, () => props.character.portrait], sync, { flush: 'post' });
watch(canAnimate, (enabled) => {
  if (!enabled) {
    disposeHands();
    handFailed = false;
    sync();
    canvasGeneration.value += 1;
  }
}, { flush: 'sync' });
watch(() => props.actionDescriptor, () => {
  disposeHands();
  handFailed = false;
  lastHandEvent = props.action?.eventKey ?? null;
}, { flush: 'sync' });
watch(() => props.actionDescriptor, syncHands, { flush: 'post' });
watch(() => props.action?.eventKey, (key) => {
  if (key == null || key === lastHandEvent) return;
  lastHandEvent = key;
  playHand(props.action);
});

onMounted(() => {
  mounted = true;
  lastHandEvent = props.action?.eventKey ?? null;
  foreground = !document.hidden;
  motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  reducedMotion = motionQuery?.matches === true;
  document.addEventListener('visibilitychange', visibilityChanged);
  motionQuery?.addEventListener?.('change', motionChanged);
  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      sync();
    });
    observer.observe(frame.value);
  } else {
    visible = true;
  }
  sync();
});
onUnmounted(() => {
  mounted = false;
  observer?.disconnect();
  document.removeEventListener('visibilitychange', visibilityChanged);
  motionQuery?.removeEventListener?.('change', motionChanged);
  controller.dispose();
  disposeHands();
});
</script>

<template>
  <div ref="frame" class="realistic-character-artwork" :data-renderer="displayStatus">
    <img class="realistic-character-artwork-original" :src="character.portrait" :alt="character.name" :style="{ visibility: handActive ? 'hidden' : 'visible' }" />
    <canvas v-if="actionDescriptor" ref="handCanvas" class="realistic-character-hand-canvas" aria-hidden="true"
      :style="{ visibility: handActive ? 'visible' : 'hidden' }" />
    <canvas v-if="canAnimate && descriptor" :key="`canvas:${descriptor.id}:${canvasGeneration}`" ref="canvas"
      class="realistic-character-artwork-canvas" aria-hidden="true" :style="{ visibility: showMotion ? 'visible' : 'hidden' }" />
  </div>
</template>

<style scoped>
/* 两个等比替换元素使用相同cover/焦点；原图不变淡、不平移，透明覆盖不影响触控和读屏。
   Both proportional replaced elements share cover/focus; the original never fades/translates and overlays do not affect input or accessibility. */
.realistic-character-artwork { display: grid; isolation: isolate; width: 100%; height: 100%; overflow: hidden; pointer-events: none; }
.realistic-character-artwork > img,
.realistic-character-artwork > canvas { grid-area: 1 / 1; display: block; width: 100%; height: 100%; min-width: 0; min-height: 0; object-fit: contain; object-position: 50% 100%; }
.realistic-character-artwork-original { z-index: 0; }
.realistic-character-artwork-canvas { z-index: 1; }
.realistic-character-hand-canvas { z-index: 0; }
</style>
