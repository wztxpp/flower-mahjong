<script setup>
// 单张麻将的展示组件：接收父组件 props，展示照片牌面或背面，保留原生按钮语义。
// Single-tile presentation component: receive parent props, show a photographed face or back, and preserve native button semantics.
// 阅读路线：docs/FRONTEND-READING-GUIDE.md。 / Reading map: docs/FRONTEND-READING-GUIDE.md.
import { computed } from 'vue';
import { tilePresentation } from './mahjong-tile-presentation.js';

// 这些 props 是父子组件接口；组件只画牌，不判牌，不修改传入数据。
// These props form the parent/child contract; this component draws tiles without judging rules or mutating inputs.
const props = defineProps({
  tile: { type: Number, default: null },
  back: Boolean,
  small: Boolean,
  selected: Boolean,
  disabled: Boolean,
  interactive: Boolean,
});
// 只读目录选择条/筒原图或独立万牌原图；隐藏牌不查询牌面，非法编号显示空白。
// The read-only catalog selects the original or wan atlas; hidden faces are not resolved, invalid IDs stay blank.
const face = computed(() => props.back ? null : tilePresentation(props.tile));
// 读屏、悬停提示与按钮标签共用一份文字；背面绝不暴露牌种。
// Screen readers, tooltips and button labels share text; hidden backs never reveal a tile type.
const label = computed(() =>
  props.back
    ? '背面牌'
    : face.value?.label ?? '空白牌',
);
// 象牙底色仅衔接现有牌壳，牌面图案全部来自原图，不再需要旧一筒的缺角补色。
// Ivory joins the existing tile shell; all artwork comes from the atlas, without the old one-dot corner repair.
const faceBackground = '#fff5df';
</script>

<!-- interactive 决定使用原生 button 或展示用 span；:class 绑定外观，aria-pressed 描述选牌状态。 / interactive selects a native button or display span; :class binds appearance and aria-pressed describes selection. -->
<template>
  <component
    :is="interactive ? 'button' : 'span'"
    class="mahjong-tile"
    :class="{
      'tile-back': back,
      'tile-small': small,
      'tile-selected': selected,
      'tile-interactive': interactive,
      'tile-disabled': disabled,
    }"
    :type="interactive ? 'button' : undefined"
    :disabled="interactive && disabled"
    :aria-label="label"
    :aria-pressed="interactive ? selected : undefined"
    :title="label"
  >
    <!-- 先检查背面，再检查合法牌面；v-if / v-else-if 只会渲染一个分支。 / Check hidden backs before valid faces; v-if / v-else-if renders at most one branch. -->
    <span v-if="back" class="back-pattern"
      ><svg viewBox="0 0 40 60" aria-hidden="true">
        <path d="M20 7 34 30 20 53 6 30Z M20 17 28 30 20 43 12 30Z" />
        <path d="M20 0v60M0 30h40" /></svg
    ></span>
    <svg
      v-else-if="face"
      class="tile-photo-face"
      viewBox="0 0 60 80"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <!-- 底色、变换后的原图、细边框按绘制顺序叠放；viewBox 统一局部坐标。 / Underlay, transformed photo and thin border paint in order; viewBox defines common local coordinates. -->
      <rect width="60" height="80" :fill="faceBackground" />
      <image
        :href="face.url"
        :width="face.width"
        :height="face.height"
        :transform="face.transform"
      />
      <rect
        x="0"
        y="0"
        width="60"
        height="80"
        fill="none"
        :stroke="faceBackground"
        stroke-width="2"
      />
    </svg>
  </component>
</template>

<style scoped>
/* scoped 将此规则限制在本组件；绝对定位依赖外层牌块的定位，overflow 裁掉照片其余部分。
   scoped limits this rule to this component; absolute positioning uses the outer tile and overflow clips the remaining photo. */
.tile-photo-face {
  position: absolute;
  inset: 4% 5% 6%;
  display: block;
  width: 90%;
  height: 90%;
  overflow: hidden;
  border-radius: 2px;
  pointer-events: none;
}
</style>
