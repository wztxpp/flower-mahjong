<script setup>
import { computed } from 'vue'
const props = defineProps({ tile: { type: Number, default: null }, back: Boolean, small: Boolean, selected: Boolean, disabled: Boolean, interactive: Boolean })
const rank = computed(() => props.tile == null ? 0 : props.tile % 9 + 1)
const isBamboo = computed(() => props.tile != null && props.tile < 9)
const label = computed(() => props.back ? '背面牌' : `${rank.value}${isBamboo.value ? '条' : '筒'}`)
// Deliberately separate the suits: bamboo is not a recoloured circle layout.
const bambooPositions = computed(() => ({
  2: [[30, 21], [30, 54]],
  3: [[30, 18], [18, 53], [42, 53]],
  4: [[18, 21], [42, 21], [18, 54], [42, 54]],
  5: [[16, 18], [44, 18], [30, 37], [16, 57], [44, 57]],
  6: [[18, 17], [42, 17], [18, 37], [42, 37], [18, 57], [42, 57]],
  7: [[30, 13], [18, 32], [42, 32], [18, 47], [42, 47], [18, 62], [42, 62]],
  9: [[15, 17], [30, 17], [45, 17], [15, 37], [30, 37], [45, 37], [15, 57], [30, 57], [45, 57]],
}[rank.value] || []))
const circlePositions = computed(() => ({
  2: [[30, 21], [30, 54]],
  3: [[16, 17], [30, 37], [44, 57]],
  4: [[17, 21], [43, 21], [17, 54], [43, 54]],
  5: [[16, 18], [44, 18], [30, 37], [16, 57], [44, 57]],
  6: [[18, 15], [42, 15], [18, 39], [42, 39], [18, 60], [42, 60]],
  7: [[15, 13], [30, 22], [45, 31], [18, 46], [42, 46], [18, 63], [42, 63]],
  8: [[18, 13], [42, 13], [18, 29], [42, 29], [18, 46], [42, 46], [18, 62], [42, 62]],
  9: [[15, 16], [30, 16], [45, 16], [15, 37], [30, 37], [45, 37], [15, 58], [30, 58], [45, 58]],
}[rank.value] || []))
const eightBambooSegments = [[13, 18, 23, 31], [23, 31, 30, 17], [30, 17, 37, 31], [37, 31, 47, 18], [13, 58, 23, 45], [23, 45, 30, 59], [30, 59, 37, 45], [37, 45, 47, 58]]
function bambooColor(index) {
  return (rank.value === 5 && index === 2) || (rank.value === 7 && index === 0) || (rank.value === 9 && index % 3 === 1) ? 'tile-ink-red' : 'tile-ink-green'
}
function circleColor(index) {
  if (rank.value === 8 || rank.value === 4) return 'tile-ink-black'
  if (rank.value === 2) return index === 0 ? 'tile-ink-green' : 'tile-ink-black'
  if (rank.value === 3) return ['tile-ink-black', 'tile-ink-red', 'tile-ink-green'][index]
  if (rank.value === 5) return index === 2 ? 'tile-ink-red' : 'tile-ink-black'
  if (rank.value === 6) return index < 2 ? 'tile-ink-green' : 'tile-ink-red'
  if (rank.value === 7) return index < 3 ? 'tile-ink-green' : 'tile-ink-red'
  return index < 3 ? 'tile-ink-green' : index < 6 ? 'tile-ink-red' : 'tile-ink-black'
}
</script>

<template>
  <component :is="interactive ? 'button' : 'span'" class="mahjong-tile" :class="{ 'tile-back': back, 'tile-small': small, 'tile-selected': selected, 'tile-interactive': interactive, 'tile-disabled': disabled, 'tile-eight-circles': !back && !isBamboo && rank === 8 }" :type="interactive ? 'button' : undefined" :disabled="interactive && disabled" :aria-label="label" :aria-pressed="interactive ? selected : undefined" :title="label">
    <span v-if="back" class="back-pattern"><svg viewBox="0 0 40 60" aria-hidden="true"><path d="M20 7 34 30 20 53 6 30Z M20 17 28 30 20 43 12 30Z"/><path d="M20 0v60M0 30h40"/></svg></span>
    <template v-else>
      <span class="tile-corner" :class="{ 'bamboo-label': isBamboo }" aria-hidden="true">{{ rank }}<small>{{ isBamboo ? '条' : '筒' }}</small></span>
      <svg class="tile-symbols" viewBox="0 0 60 76" aria-hidden="true">
        <g v-if="isBamboo">
          <g v-if="rank === 1" class="bamboo-bird">
            <path d="M31 28C17 17 8 22 10 34c2 12 13 19 24 20L21 66l16-6 8 3-4-15c7-8 4-17-1-21l-1-8-6 3Z" class="tile-ink-green" stroke-width="1.4" stroke-linejoin="round"/>
            <path d="M15 31c5 1 12 7 17 17M14 37c5 1 9 5 14 9M20 26c5 2 9 6 12 13M29 49l-4 10M34 51l-3 11" fill="none" stroke="#f6f2df" stroke-width="1.7" stroke-linecap="round"/>
            <path d="m32 19 2-7 4 6 4-4-1 9M40 29l9 4-8 2" class="tile-ink-red" stroke-width="1" stroke-linejoin="round"/>
            <circle cx="36.5" cy="27" r="2.2" fill="#fffdf3"/><circle cx="37" cy="27" r="1" fill="#202825"/>
            <path d="m34 53 1 8-6 3m9-13 3 8 6 3" class="tile-ink-red" fill="none" stroke-width="1.8" stroke-linecap="round"/>
          </g>
          <g v-else-if="rank === 8" class="tile-ink-green" fill="none" stroke-linecap="round">
            <g v-for="([x1, y1, x2, y2], i) in eightBambooSegments" :key="i">
              <path :d="`M${x1} ${y1}L${x2} ${y2}`" stroke-width="4.1"/>
              <path :d="`M${x1 + (x2-x1)*.48 - 2.3} ${y1 + (y2-y1)*.48 + 1.7}l4.6 -3.4`" stroke-width="1.4"/>
            </g>
          </g>
          <g v-for="([x,y], i) in bambooPositions" v-else :key="i" :transform="`translate(${x},${y})`" :class="bambooColor(i)">
            <path d="M-2.3-6.5Q0-8 2.3-6.5L2.1 6.5Q0 8-2.1 6.5Z" stroke-width=".8"/>
            <path d="M-4-5.8h8M-3.4 0h6.8M-4 5.8h8" fill="none" stroke-width="1.7" stroke-linecap="round"/>
            <path d="M-.5-4v2M-.5 2v2" fill="none" stroke="#fffdf3" stroke-width=".8" stroke-linecap="round"/>
          </g>
        </g>
        <g v-else-if="rank === 1" transform="translate(30,38)">
          <circle r="21" class="tile-ink-green" fill="none" stroke-width="3.2"/><circle r="16.2" class="tile-ink-green" fill="none" stroke-width="1.6"/>
          <path v-for="n in 12" :key="n" :transform="`rotate(${n * 30})`" d="M0-19c-6 5-6 9 0 13 6-4 6-8 0-13Z" class="tile-ink-green" fill="none" stroke-width="1.2"/>
          <circle r="7" class="tile-ink-red" stroke-width="1"/><circle r="2.4" fill="#fffdf3"/>
        </g>
        <g v-else>
          <g v-for="([x,y], i) in circlePositions" :key="i" :transform="`translate(${x},${y})`" :class="circleColor(i)">
            <circle :r="rank < 5 ? 8.1 : rank < 7 ? 6.4 : 5.7" fill="none" :stroke-width="rank < 5 ? 2.6 : 2.1"/>
            <circle :r="rank < 5 ? 4.5 : rank < 7 ? 3.1 : 2.5" fill="none" stroke-width="1.15"/>
            <circle r="1" stroke="none"/>
          </g>
        </g>
      </svg>
    </template>
  </component>
</template>
