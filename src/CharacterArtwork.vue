<script setup>
// 两玩法共用的原图画框：img 始终完全可见，Canvas2D 只叠加审查过的小眼睑和头发区域。
// Shared original-art frame: img stays fully visible; Canvas2D overlays only reviewed small eyelid and hair regions.
// 不接收手牌/动作；公开三秒胡/放炮原图仍由已有调度器管理，装饰失败不阻断游戏。
// No hands/actions enter here; the existing scheduler owns three-second reaction originals and decorative failure never blocks play.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { usePortraitMotionSettings } from './portrait-motion/settings.js';
import { portraitMotionFor } from './portrait-motion/catalog.js';
import { loadPortraitMotionRuntime } from './portrait-motion/loader.js';
import { PortraitController } from './portrait-motion/controller.js';

const props = defineProps({
  character: { type: Object, required: true },
  enabled: { type: Boolean, default: true },
});
const { enabled: motionEnabled } = usePortraitMotionSettings();
const canAnimate = computed(() => props.enabled && motionEnabled.value);
const frame = ref(null);
const canvas = ref(null);
const canvasGeneration = ref(0);
const descriptor = computed(() => portraitMotionFor(props.character.id));
const reaction = computed(() => props.character.portraitReaction || 'base');
const phaseKey = computed(() => props.character.portraitPhaseKey || props.character.id);
const rendererStatus = ref('original');
let mounted = false;
let visible = false;
let foreground = true;
let reducedMotion = false;
let observer;
let motionQuery;

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
    sync();
    canvasGeneration.value += 1;
  }
}, { flush: 'sync' });

onMounted(() => {
  mounted = true;
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
});
</script>

<template>
  <div ref="frame" class="character-artwork" :data-renderer="displayStatus">
    <img class="character-artwork-original" :src="character.portrait" :alt="character.name" />
    <canvas v-if="canAnimate && descriptor" :key="`canvas:${descriptor.id}:${canvasGeneration}`" ref="canvas"
      class="character-artwork-canvas" aria-hidden="true" :style="{ visibility: showMotion ? 'visible' : 'hidden' }" />
  </div>
</template>

<style scoped>
/* 两个等比替换元素使用相同cover/焦点；原图不变淡、不平移，透明覆盖不影响触控和读屏。
   Both proportional replaced elements share cover/focus; the original never fades/translates and overlays do not affect input or accessibility. */
.character-artwork { display: grid; isolation: isolate; width: 100%; height: 100%; overflow: hidden; pointer-events: none; }
.character-artwork > img,
.character-artwork > canvas { grid-area: 1 / 1; display: block; width: 100%; height: 100%; min-width: 0; min-height: 0; object-fit: cover; object-position: 50% var(--portrait-focus-y, 24%); }
.character-artwork-original { z-index: 0; }
.character-artwork-canvas { z-index: 1; }
</style>
