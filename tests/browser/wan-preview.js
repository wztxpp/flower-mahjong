// 真实Vue组件与生产样式的隔离展示；不导入App、不请求API、不使用存储。
// Isolated real Vue component and production styles; no App, APIs or storage.
import { createApp, h, ref } from 'vue';
import MahjongTile from '../../src/MahjongTile.vue';
import { CHARACTERS, clipForEvent } from '../../src/character-audio.js';
import '../../src/style.css';
import '../../src/tabletop.css';

createApp({
  setup() {
    const results = ref([]);
    const running = ref(false);
    // 用户点击后串行播放63个真实资源，以ended确认完成；错误和超时明确记录。
    // After a click, play 63 real clips serially; ended confirms completion, with explicit errors/timeouts.
    async function checkAudio() {
      if (running.value) return;
      running.value = true;
      results.value = [];
      for (const character of CHARACTERS) {
        for (let tile = 18; tile <= 26; tile += 1) {
          const url = clipForEvent({ type: 'discard', seat: 0, tile }, [character.id, 'sweet', 'sunny']);
          const result = await new Promise((resolve) => {
            const audio = new Audio(url);
            // 低音量保留实际播放路径，不把静音解码冒充主观试听。
            // Low volume preserves actual playback, without claiming subjective listening certification.
            audio.volume = 0.05;
            let settled = false;
            const timer = setTimeout(() => finish('timeout'), 10000);
            function finish(status) {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              audio.pause();
              resolve({ url, status, duration: audio.duration, currentTime: audio.currentTime });
            }
            audio.onended = () => finish('ended');
            audio.onerror = () => finish('media-error');
            audio.play().catch((error) => finish(error.name));
          });
          results.value.push(result);
        }
      }
      running.value = false;
    }
    // 只给展示容器留白，不覆盖牌块尺寸；窄屏通过独立iframe触发真实媒体查询。
    // Space the showcase only, preserving tile dimensions; an iframe triggers real narrow viewport queries.
    return () => h('main', { style: 'padding:18px;background:#e8e5d8;min-height:100vh;color:#183c31' }, [
      h('h1', { style: 'font-size:22px' }, '万牌组件隔离验收 / Isolated component QA'),
      h('p', '非可玩成都桌；无API与房间数据。Not gameplay or online acceptance.'),
      ...[false, true].map((small) => h('section', [
        h('h2', { style: 'font-size:17px;margin:16px 0 8px' }, small ? '小牌 / Small' : '普通牌 / Regular'),
        h('div', { class: small ? 'discard-tiles' : '', style: 'display:flex;flex-wrap:wrap;gap:8px' },
          Array.from({ length: 9 }, (_, index) => h(MahjongTile, { tile: index + 18, small }))),
      ])),
      h('h2', { style: 'font-size:17px;margin:16px 0 8px' }, '隐藏背面 / Hidden backs'),
      h('div', { style: 'display:flex;gap:8px' }, [h(MahjongTile, { tile: 18, back: true }), h(MahjongTile, { tile: 26, back: true, small: true })]),
      h('button', { onClick: checkAudio, disabled: running.value, style: 'margin:20px 0;padding:10px' }, '验证63条真实万牌音频 / Play 63 clips'),
      h('p', { id: 'audio-summary' }, `${results.value.length}/63; ended: ${results.value.filter((result) => result.status === 'ended').length}; running: ${running.value}`),
      h('pre', { id: 'audio-results', style: 'white-space:pre-wrap;font-size:11px' }, JSON.stringify(results.value, null, 2)),
    ]);
  },
}).mount('#app');
