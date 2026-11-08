<script setup>
// 非阻塞的显示设置，花麻将和成都共用；展开/收起不算同意，选择不会提交任何麻将动作。
// Nonblocking presentation settings shared by Flower and Chengdu; opening/closing is not assent and choices submit no game actions.
import { ref } from 'vue';
import { LIVE2D_LICENSE_URLS, useLive2DConsent } from './live2d/consent.js';

const { enabled, storageAvailable, accept, decline } = useLive2DConsent();
const details = ref(null);
const summary = ref(null);

// 原生 details 保留键盘操作；选择后回到入口，存储失败时留着提示以免误以为已跨刷新保存。
// Native details preserves keyboard behavior; return focus after a choice, but keep storage-failure guidance visible.
function finishChoice(shouldEnable) {
  if (shouldEnable) accept();
  else decline();
  if (storageAvailable.value) close();
}
function close() {
  if (details.value) details.value.open = false;
  summary.value?.focus();
}
</script>

<template>
  <details ref="details" class="live2d-settings" @keydown.esc.stop.prevent="close">
    <summary ref="summary">动态角色：{{ enabled ? '已启用' : '未启用' }} · 设置</summary>
    <section class="live2d-settings-content" aria-label="Live2D 动态角色设置">
      <h2>启用 Live2D 动态角色</h2>
      <p>动态角色使用 Live2D Cubism Core 和 Framework。请阅读
        <a :href="LIVE2D_LICENSE_URLS.coreChinese" target="_blank" rel="noopener noreferrer">Core 官方许可</a>与
        <a :href="LIVE2D_LICENSE_URLS.frameworkChinese" target="_blank" rel="noopener noreferrer">Framework 官方许可</a>。
        启用时，您同意其中适用于本游戏所含 Live2D 组件使用及保护的条款。
        您也可以不启用动态角色，继续使用静态角色。</p>
      <p class="live2d-settings-note">官方日文原文：
        <a :href="LIVE2D_LICENSE_URLS.coreJapanese" target="_blank" rel="noopener noreferrer">Core 许可</a> ·
        <a :href="LIVE2D_LICENSE_URLS.frameworkJapanese" target="_blank" rel="noopener noreferrer">Framework 许可</a>。
        不支持 WebGL 或系统设置减少动态时，仍显示静态角色。</p>
      <div class="live2d-settings-actions">
        <button type="button" @click="finishChoice(true)">同意并启用动态角色</button>
        <button type="button" @click="finishChoice(false)">不启用，使用静态角色</button>
      </div>
      <p v-if="!storageAvailable" class="live2d-settings-note" role="status">浏览器无法保存选择，本次选择仅在当前页面生效。下次打开时请检查动态角色设置。</p>
    </section>
  </details>
</template>

<style scoped>
/* 普通文档流、不覆盖手牌；窄屏换行，原生 summary 与按钮均保留清楚的键盘焦点。
   Normal document flow never overlays the hand; narrow layouts wrap and all controls retain visible keyboard focus. */
.live2d-settings { margin: 0 0 16px; color: #25473b; font-size: 14px; }
.live2d-settings summary { width: fit-content; max-width: 100%; cursor: pointer; padding: 10px 12px; border: 1px solid #c7d3c5; border-radius: 10px; background: #f6f5ed; }
.live2d-settings-content { margin-top: 8px; padding: 16px; border: 1px solid #c7d3c5; border-radius: 12px; background: #fffdf5; max-width: 760px; }
.live2d-settings h2 { margin: 0 0 10px; font-size: 18px; }
.live2d-settings p { margin: 10px 0; line-height: 1.7; }
.live2d-settings a { color: #1b604b; text-decoration: underline; text-underline-offset: 3px; }
.live2d-settings-note { font-size: 13px; }
.live2d-settings-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.live2d-settings button { min-height: 44px; padding: 10px 14px; border: 1px solid #456c58; border-radius: 8px; background: #fffdf5; color: #25473b; cursor: pointer; font: inherit; }
.live2d-settings button:first-child { color: #fff; background: #245b46; }
.live2d-settings :is(summary, button, a):focus-visible { outline: 3px solid #ba821b; outline-offset: 3px; }
</style>
