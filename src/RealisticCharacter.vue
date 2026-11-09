<script setup>
// 写实人物入口只选择经过审查的独立坐姿，不改变角色身份、声音或游戏状态。
// The realistic actor entry selects reviewed independent poses without changing identity, audio or game state.
// 有新视角后胡/放炮也保留该视角；缺表情供体只暂停眼发，绝不跳回带背景的正面原图。
// Once a new view exists, wins/losses retain it; missing expression donors pause idle motion instead of jumping to a full-scene front image.
import { computed, useId } from 'vue';
import CharacterArtwork from './CharacterArtwork.vue';
import RealisticCharacterArtwork from './RealisticCharacterArtwork.vue';
import { REALISTIC_CHARACTER_IDS, realisticCharacterView, realisticViewForPosition } from './realistic-character-catalog.js';
import { realisticBodyModel } from './realistic-character-body.js';
const props = defineProps({
  character: { type: Object, required: true },
  position: { type: String, default: 'north' },
  action: { type: Object, default: null },
  enabled: { type: Boolean, default: true },
});
const included = computed(() => REALISTIC_CHARACTER_IDS.includes(props.character.id));
const view = computed(() => realisticCharacterView(props.character.id, props.position));
const viewCharacter = computed(() => ({ ...props.character, portrait: view.value?.baseUrl || props.character.portrait }));
const body = computed(() => realisticBodyModel(view.value));
const upperClipId = `realistic-upper-${useId()}`;
</script>
<template>
  <div class="realistic-character" :class="{ 'has-full-body': body }" :data-character="character.id" :data-view="realisticViewForPosition(position)"
    :data-body-status="body ? 'approved-full-body' : 'half-body'" :style="body?.canvasStyle"
    :data-art-status="view ? 'approved-base' : included ? 'original-fallback' : 'unavailable'">
    <!-- 上下身在同一完整画布中定位；上身仍由原组件绘制，不能把眨眼画布改成长腿画布。
         Both layers share one full canvas; the original component keeps its upper-art coordinates and motion aspect. -->
    <div v-if="body?.chairStyle" class="realistic-character-chair" :style="body.chairStyle" aria-hidden="true"><i></i><i></i></div>
    <svg v-if="body" class="realistic-body-lower" :viewBox="body.lowerViewBox" :style="body.lowerStyle" preserveAspectRatio="none" aria-hidden="true">
      <image :href="body.lowerBodyUrl" :width="body.lowerSourceSize[0]" :height="body.lowerSourceSize[1]" />
    </svg>
    <svg v-for="(patch, index) in body?.sleevePatches || []" :key="index" class="realistic-body-sleeve" :viewBox="patch.viewBox" :style="patch.style" aria-hidden="true"><image :href="patch.url" :width="patch.sourceSize[0]" :height="patch.sourceSize[1]" /></svg>
    <svg v-if="body?.upperClipPolygons" class="realistic-body-clip" aria-hidden="true"><defs><clipPath :id="upperClipId" clipPathUnits="objectBoundingBox"><polygon v-for="(polygon, index) in body.upperClipPolygons" :key="index" :points="polygon" /></clipPath></defs></svg>
    <div class="realistic-body-upper" :style="body ? { ...body.upperStyle, clipPath: body.upperClipPolygons ? `url(#${upperClipId})` : undefined } : undefined">
      <RealisticCharacterArtwork v-if="view" :character="viewCharacter" :motion-descriptor="view.motion || null"
        :enabled="enabled" :action="action" :action-descriptor="view.action || null" />
      <CharacterArtwork v-else-if="included" :character="character" :enabled="enabled" />
      <span v-else class="realistic-character-unavailable" aria-label="此角色写实素材暂未制作" />
    </div>
  </div>
</template>
<style scoped>
/* 座位布局归外层牌桌；这里不镜像、不做整图漂浮，排除角色只留空位而不换人。
   The table owns seat placement; no mirroring or whole-image floating, and excluded identities leave an empty seat rather than a replacement. */
.realistic-character { width: 100%; height: 100%; pointer-events: none; overflow: hidden; }
.realistic-character.has-full-body { position: relative; height: auto !important; overflow: visible; }
.realistic-body-upper { width: 100%; height: 100%; position: relative; z-index: 3; }
.has-full-body .realistic-body-upper, .realistic-body-lower { position: absolute; }
.realistic-body-lower { z-index: 1; overflow: hidden; }
.realistic-body-sleeve { position: absolute; z-index: 3; overflow: hidden; }
.realistic-body-clip { position: absolute; width: 0; height: 0; pointer-events: none; }
.realistic-character-chair { position: absolute; z-index: 0; border-top: 9px solid #735634; }
.realistic-character-chair::before { content: ''; position: absolute; left: 0; right: 0; top: -75%; height: 75%; border: 7px solid #6f5234; border-bottom: 0; border-radius: 12px 12px 0 0; }
.realistic-character-chair i { position: absolute; top: 0; bottom: 0; width: 8%; background: linear-gradient(90deg,#3b2d1f,#765739); border-radius: 0 0 3px 3px; }
.realistic-character-chair i:first-child { left: 4%; }
.realistic-character-chair i:last-child { right: 4%; }
</style>
