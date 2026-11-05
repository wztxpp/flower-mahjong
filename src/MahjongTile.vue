<script setup>
import { computed } from 'vue'
import { MAHJONG_PHOTO_URL, photoFaceTransform } from './mahjong-photo-faces.js'

const props = defineProps({ tile: { type: Number, default: null }, back: Boolean, small: Boolean, selected: Boolean, disabled: Boolean, interactive: Boolean })
const rank = computed(() => props.tile == null ? 0 : props.tile % 9 + 1)
const isBamboo = computed(() => props.tile != null && props.tile < 9)
const faceTransform = computed(() => photoFaceTransform(props.tile))
const label = computed(() => props.back ? '背面牌' : faceTransform.value ? `${rank.value}${isBamboo.value ? '条' : '筒'}` : '空白牌')
// The first dots tile reaches the photo's left edge. A matching ivory underlay
// fills only its missing blank corner; all of the rosette artwork is present.
const faceBackground = computed(() => props.tile === 9 ? '#feeed7' : '#fff7e6')
</script>

<template>
  <component :is="interactive ? 'button' : 'span'" class="mahjong-tile" :class="{ 'tile-back': back, 'tile-small': small, 'tile-selected': selected, 'tile-interactive': interactive, 'tile-disabled': disabled }" :type="interactive ? 'button' : undefined" :disabled="interactive && disabled" :aria-label="label" :aria-pressed="interactive ? selected : undefined" :title="label">
    <span v-if="back" class="back-pattern"><svg viewBox="0 0 40 60" aria-hidden="true"><path d="M20 7 34 30 20 53 6 30Z M20 17 28 30 20 43 12 30Z"/><path d="M20 0v60M0 30h40"/></svg></span>
    <svg v-else-if="faceTransform" class="tile-photo-face" viewBox="0 0 60 80" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <rect width="60" height="80" :fill="faceBackground"/>
      <image :href="MAHJONG_PHOTO_URL" width="800" height="800" :transform="faceTransform"/>
      <rect x="0" y="0" width="60" height="80" fill="none" :stroke="faceBackground" stroke-width="2"/>
    </svg>
  </component>
</template>

<style scoped>
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
