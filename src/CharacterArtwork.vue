<script setup>
// 两玩法共用的装饰画框：原图永远可用，只有模型真实绘制且背景就绪才切换到透明画布。
// Shared decorative frame: original art stays available until a real model draw and its background are ready.
// 不接收手牌或合法动作；公开 portraitReaction 仍由原有三秒调度器管理。
// No hands or legal actions enter this component; the existing three-second scheduler owns public reactions.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useLive2DConsent } from './live2d/consent.js';
import { live2DCharacterFor } from './live2d/catalog.js';
import { loadLive2DRuntime } from './live2d/loader.js';
import { PortraitController } from './live2d/portrait-controller.js';

const props = defineProps({
  character: { type: Object, required: true },
  enabled: { type: Boolean, default: true },
});
// enabled 只是宿主显示开关，必须同时获得本地明确同意；独立画框也不能默认加载 SDK。
// enabled is only a host display switch; explicit local assent is also required, including standalone frames.
const { enabled: consentEnabled } = useLive2DConsent();
const canUseLive2D = computed(() => props.enabled && consentEnabled.value);
const frame = ref(null);
const canvas = ref(null);
const canvasGeneration = ref(0);
const background = ref(null);
const descriptor = computed(() => live2DCharacterFor(props.character.id));
const reaction = computed(() => props.character.portraitReaction || 'base');
const backgroundReady = ref(false);
const requestedRuntime = ref(false);
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
    // 必须在 await 之前快照节点；换角后销毁旧实例不能丢失新实例正在用的同一 GL context。
    // Snapshot DOM before awaiting: disposing an old role must never lose a new role's shared GL context.
    const currentCanvas = canvas.value;
    const currentDescriptor = descriptor.value;
    const phaseKey = props.character.portraitPhaseKey || props.character.id;
    requestedRuntime.value = true;
    const { Live2DRenderer } = await loadLive2DRuntime();
    if (!mounted || !isCurrent() || canvas.value !== currentCanvas || descriptor.value !== currentDescriptor) return null;
    return new Live2DRenderer(currentCanvas, onError, phaseKey);
  },
});

const showLive2D = computed(() => canUseLive2D.value && rendererStatus.value === 'live2d' && backgroundReady.value && reaction.value === 'base');
const displayStatus = computed(() => showLive2D.value ? 'live2d' : rendererStatus.value === 'fallback' ? 'fallback' : 'original');

function sync() {
  if (!mounted) return;
  controller.sync({ descriptor: descriptor.value, reaction: reaction.value, enabled: canUseLive2D.value, visible, foreground, reducedMotion });
}

// 节点身份比 URL 更严格：A→B→A 时，第一次 A 的迟到事件也不能污染当前 A。
// Node identity is stricter than URL equality: an old A event cannot affect a current A after A→B→A.
function backgroundLoaded(event) {
  if (!canUseLive2D.value || event.currentTarget !== background.value) return;
  backgroundReady.value = true;
}
function backgroundFailed(event) {
  if (!canUseLive2D.value || event.currentTarget !== background.value) return;
  backgroundReady.value = false;
  controller.fail();
}
function visibilityChanged() {
  foreground = !document.hidden;
  sync();
}
function motionChanged() {
  reducedMotion = motionQuery?.matches === true;
  sync();
}

// 角色和表情同一批变化时必须等新画布挂载，否则 pre watcher 会捕获旧节点。
// Batched role and reaction changes must wait for the new canvas, not capture an old node in a pre watcher.
watch([descriptor, reaction, canUseLive2D, canvasGeneration], ([nextDescriptor], [previousDescriptor]) => {
  if (nextDescriptor !== previousDescriptor || !canUseLive2D.value) {
    backgroundReady.value = false;
    requestedRuntime.value = false;
  }
  sync();
}, { flush: 'post' });

// 撤销同意同步失效资源；启用仍等 post watcher 获取当前 canvas 节点。
// Withdrawal invalidates resources synchronously; enabling still waits for the post watcher and current canvas.
watch(canUseLive2D, (enabled) => {
  if (!enabled) {
    sync();
    // dispose 会丢失旧 GL context；即使同一批 false→true，下一次也必须挂载全新 canvas/背景节点。
    // dispose loses the old GL context; even same-batch false→true must mount fresh canvas/background nodes.
    canvasGeneration.value += 1;
    requestedRuntime.value = false;
    backgroundReady.value = false;
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
    <img v-if="canUseLive2D && descriptor && requestedRuntime" :key="`background:${descriptor.id}:${canvasGeneration}`" ref="background"
      class="character-artwork-background" :src="descriptor.backgroundUrl" alt="" aria-hidden="true"
      :style="{ visibility: showLive2D ? 'visible' : 'hidden' }" @load="backgroundLoaded" @error="backgroundFailed" />
    <canvas v-if="canUseLive2D && descriptor" :key="`canvas:${descriptor.id}:${canvasGeneration}`" ref="canvas" class="character-artwork-canvas" aria-hidden="true"
      :style="{ visibility: showLive2D ? 'visible' : 'hidden' }" />
    <img class="character-artwork-original" :src="character.portrait" :alt="character.name"
      :style="{ opacity: showLive2D ? 0 : 1 }" />
  </div>
</template>

<style scoped>
/* 同一网格层保持原图比例及触控边界，透明模型不包含背景，读屏始终只读角色名字。
   Shared grid layers preserve proportions and hit boundaries; model alpha excludes background and only art supplies accessible text. */
.character-artwork { display: grid; isolation: isolate; width: 100%; height: 100%; overflow: hidden; pointer-events: none; }
.character-artwork > img,
.character-artwork > canvas { grid-area: 1 / 1; display: block; width: 100%; height: 100%; min-width: 0; min-height: 0; object-fit: cover; object-position: 50% var(--portrait-focus-y, 24%); }
.character-artwork-background { z-index: 0; }
.character-artwork-canvas { z-index: 1; }
.character-artwork-original { z-index: 2; }
</style>
