<script setup>
// 非阻塞的显示设置，花麻将和成都共用；展开/收起不算启用，选择不会提交任何麻将动作。
// Nonblocking presentation settings shared by Flower and Chengdu; opening/closing is not enablement and choices submit no game actions.
import { ref } from 'vue';
import { usePortraitMotionSettings } from './portrait-motion/settings.js';

const { enabled, storageAvailable, enable, disable } = usePortraitMotionSettings();
const details = ref(null);
const summary = ref(null);

// 原生 details 保留键盘操作；选择后回到入口，存储失败时留着提示以免误以为已跨刷新保存。
// Native details preserves keyboard behavior; return focus after a choice, but keep storage-failure guidance visible.
function finishChoice(shouldEnable) {
  if (shouldEnable) enable();
  else disable();
  if (storageAvailable.value) close();
}
function close() {
  if (details.value) details.value.open = false;
  summary.value?.focus();
}
</script>

<template>
  <details ref="details" class="portrait-motion-settings" @keydown.esc.stop.prevent="close">
    <summary ref="summary">动态角色：{{ enabled ? '已启用' : '未启用' }} · 设置</summary>
    <section class="portrait-motion-settings-content" aria-label="原图局部动态设置">
      <h2>原图局部动态</h2>
      <p>保留原始立绘，只在眼睑处眨眼、让局部头发轻微摆动。人物、身体和背景不移动。</p>
      <p class="portrait-motion-settings-note">默认使用静态原图。启用后仅在画面可见时播放；系统设置减少动态、资源缺失或加载失败时仍显示原图。</p>
      <div class="portrait-motion-settings-actions">
        <button type="button" @click="finishChoice(true)">启用局部动态</button>
        <button type="button" @click="finishChoice(false)">不启用，使用静态角色</button>
      </div>
      <p v-if="!storageAvailable" class="portrait-motion-settings-note" role="status">浏览器无法保存选择，本次选择仅在当前页面生效。下次打开时请检查动态角色设置。</p>
    </section>
  </details>
</template>

<style scoped>
/* 普通文档流、不覆盖手牌；窄屏换行，原生 summary 与按钮均保留清楚的键盘焦点。
   Normal document flow never overlays the hand; narrow layouts wrap and all controls retain visible keyboard focus. */
.portrait-motion-settings { margin: 0 0 16px; color: #25473b; font-size: 14px; }
.portrait-motion-settings summary { width: fit-content; max-width: 100%; cursor: pointer; padding: 10px 12px; border: 1px solid #c7d3c5; border-radius: 10px; background: #f6f5ed; }
.portrait-motion-settings-content { margin-top: 8px; padding: 16px; border: 1px solid #c7d3c5; border-radius: 12px; background: #fffdf5; max-width: 760px; }
.portrait-motion-settings h2 { margin: 0 0 10px; font-size: 18px; }
.portrait-motion-settings p { margin: 10px 0; line-height: 1.7; }
.portrait-motion-settings a { color: #1b604b; text-decoration: underline; text-underline-offset: 3px; }
.portrait-motion-settings-note { font-size: 13px; }
.portrait-motion-settings-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.portrait-motion-settings button { min-height: 44px; padding: 10px 14px; border: 1px solid #456c58; border-radius: 8px; background: #fffdf5; color: #25473b; cursor: pointer; font: inherit; }
.portrait-motion-settings button:first-child { color: #fff; background: #245b46; }
.portrait-motion-settings :is(summary, button, a):focus-visible { outline: 3px solid #ba821b; outline-offset: 3px; }
</style>
