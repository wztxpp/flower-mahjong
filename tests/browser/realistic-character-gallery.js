// 测试专用大图画廊，复用隔离服务器的API拒绝边界；只挂载真实角色，不创建房间或模拟游戏动作。
// Test-only large gallery reuses the isolated server API rejection boundary; mount real actors without rooms or simulated game actions.
import { createApp, h } from 'vue';
import RealisticCharacter from '/src/RealisticCharacter.vue';
import { REALISTIC_CHARACTER_IDS } from '/src/realistic-character-catalog.js';
createApp({ render() {
  return h('section', REALISTIC_CHARACTER_IDS.flatMap((id) => ['north', 'left', 'right'].map((position) => h('article', [
    h('h2', `${id} / ${position === 'north' ? 'front' : position}`),
    h('div', { class: 'art' }, [h(RealisticCharacter, {
      character: { id, name: id, portrait: `/characters/${id}-scene-base.png`, portraitReaction: 'base', portraitPhaseKey: `${id}:${position}` },
      position, enabled: true,
    })]),
  ]))));
} }).mount('#app');
