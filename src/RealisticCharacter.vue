<script setup>
// 写实人物入口只选择经过审查的独立坐姿，不改变角色身份、声音或游戏状态。
// The realistic actor entry selects reviewed independent poses without changing identity, audio or game state.
// 有新视角后胡/放炮也保留该视角；缺表情供体只暂停眼发，绝不跳回带背景的正面原图。
// Once a new view exists, wins/losses retain it; missing expression donors pause idle motion instead of jumping to a full-scene front image.
import { computed } from 'vue';
import CharacterArtwork from './CharacterArtwork.vue';
import RealisticCharacterArtwork from './RealisticCharacterArtwork.vue';
import { REALISTIC_CHARACTER_IDS, realisticCharacterView, realisticViewForPosition } from './realistic-character-catalog.js';
const props = defineProps({
  character: { type: Object, required: true },
  position: { type: String, default: 'north' },
  action: { type: Object, default: null },
  enabled: { type: Boolean, default: true },
});
const included = computed(() => REALISTIC_CHARACTER_IDS.includes(props.character.id));
const view = computed(() => realisticCharacterView(props.character.id, props.position));
const viewCharacter = computed(() => ({ ...props.character, portrait: view.value?.baseUrl || props.character.portrait }));
</script>
<template>
  <div class="realistic-character" :data-character="character.id" :data-view="realisticViewForPosition(position)"
    :data-art-status="view ? 'approved-base' : included ? 'original-fallback' : 'unavailable'">
    <RealisticCharacterArtwork v-if="view" :character="viewCharacter" :motion-descriptor="view.motion || null"
      :enabled="enabled" :action="action" :action-descriptor="view.action || null" />
    <CharacterArtwork v-else-if="included" :character="character" :enabled="enabled" />
    <span v-else class="realistic-character-unavailable" aria-label="此角色写实素材暂未制作" />
  </div>
</template>
<style scoped>
/* 座位布局归外层牌桌；这里不镜像、不做整图漂浮，排除角色只留空位而不换人。
   The table owns seat placement; no mirroring or whole-image floating, and excluded identities leave an empty seat rather than a replacement. */
.realistic-character { width: 100%; height: 100%; pointer-events: none; overflow: hidden; }
</style>
