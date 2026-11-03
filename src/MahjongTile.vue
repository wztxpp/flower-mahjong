<script setup>
import { computed } from 'vue'
const props = defineProps({ tile: { type: Number, default: null }, back: Boolean, small: Boolean, selected: Boolean, disabled: Boolean, interactive: Boolean })
const rank = computed(() => props.tile == null ? 0 : props.tile % 9 + 1)
const isBamboo = computed(() => props.tile != null && props.tile < 9)
const label = computed(() => props.back ? '背面牌' : `${rank.value}${isBamboo.value ? '条' : '筒'}`)
const positions = computed(() => {
  const r = rank.value
  if (r === 1) return [[30, 37]]
  if (r === 2) return [[30, 24], [30, 51]]
  if (r === 3) return [[18, 22], [30, 37], [42, 52]]
  if (r === 4) return [[18, 23], [42, 23], [18, 51], [42, 51]]
  if (r === 5) return [[18, 23], [42, 23], [30, 37], [18, 51], [42, 51]]
  if (r === 6) return [[18, 20], [42, 20], [18, 37], [42, 37], [18, 54], [42, 54]]
  if (r === 7) return [[18, 18], [30, 27], [42, 18], [18, 43], [42, 43], [18, 58], [42, 58]]
  if (r === 8) return [[18, 17], [42, 17], [18, 30], [42, 30], [18, 45], [42, 45], [18, 58], [42, 58]]
  return [[16, 20], [30, 20], [44, 20], [16, 37], [30, 37], [44, 37], [16, 54], [30, 54], [44, 54]]
})
</script>

<template>
  <component :is="interactive ? 'button' : 'span'" class="mahjong-tile" :class="{ 'tile-back': back, 'tile-small': small, 'tile-selected': selected, 'tile-interactive': interactive, 'tile-disabled': disabled }" :type="interactive ? 'button' : undefined" :disabled="interactive && disabled" :aria-label="label" :aria-pressed="interactive ? selected : undefined" :title="label">
    <span v-if="back" class="back-pattern"><svg viewBox="0 0 40 60" aria-hidden="true"><path d="M20 7 34 30 20 53 6 30Z M20 17 28 30 20 43 12 30Z"/><path d="M20 0v60M0 30h40"/></svg></span>
    <template v-else>
      <span class="tile-corner" :class="{ 'bamboo-label': isBamboo }">{{ rank }}<small>{{ isBamboo ? '条' : '筒' }}</small></span>
      <svg class="tile-symbols" viewBox="0 0 60 76" aria-hidden="true">
        <g v-if="isBamboo">
          <g v-for="([x,y], i) in positions" :key="i" :transform="`translate(${x},${y})`" :class="rank === 1 || (rank === 7 && i < 3) ? 'bamboo-red' : 'bamboo-green'">
            <template v-if="rank === 1"><path d="M0-18 C-10-14-10 3 0 16 C10 3 10-14 0-18Z" fill="none" stroke-width="2"/><path d="M0-16v32M0-7l-6-5M0 1l6-6M0 9l-5-5" fill="none" stroke-width="1.8"/><path d="m-8 18 8-2 8 2" fill="none" stroke-width="1.5"/></template>
            <template v-else><rect x="-2.2" y="-5.6" width="4.4" height="11.2" rx="1.4" stroke="none"/><path d="M-4-4.8h8M-4 4.8h8M-3 0h6" fill="none" stroke-width="1.3" stroke-linecap="round"/></template>
          </g>
        </g>
        <g v-else>
          <g v-for="([x,y], i) in positions" :key="i" :transform="`translate(${x},${y})`" :class="(rank === 1 || (rank % 2 === 1 && i === Math.floor(rank / 2))) ? 'circle-red' : 'circle-blue'">
            <circle :r="rank === 1 ? 16 : rank < 5 ? 7.2 : 5.4" fill="none" :stroke-width="rank === 1 ? 3 : 2.2"/>
            <circle :r="rank === 1 ? 10 : rank < 5 ? 3.6 : 2.2" fill="none" :stroke-width="rank === 1 ? 1.6 : 1.2"/>
            <circle :r="rank === 1 ? 3.2 : 1" stroke="none"/>
            <path v-if="rank === 1" d="M0-13v6M0 7v6M-13 0h6M7 0h6M-9-9l4 4M5 5l4 4M-9 9l4-4M5-5l4-4" fill="none" stroke-width="1.2"/>
          </g>
        </g>
      </svg>
    </template>
  </component>
</template>
