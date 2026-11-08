// 本地可见诊断页：使用真实组件、真实Canvas2D renderer与独立区域审计，绝不发布。
// Visible local diagnostics use the real component, real Canvas2D renderer and independent region audit; never publish this page.
import { createApp, computed, nextTick, ref } from 'vue/dist/vue.esm-bundler.js';
import CharacterArtwork from '../../src/CharacterArtwork.vue';
import PortraitMotionSettings from '../../src/PortraitMotionSettings.vue';
import { CHARACTERS } from '../../src/character-audio.js';
import { portraitForCharacter } from '../../src/character-portraits.js';
import { PORTRAIT_MOTION_CHARACTERS, portraitMotionFor } from '../../src/portrait-motion/catalog.js';
import { PortraitMotionRenderer } from '../../src/portrait-motion/renderer.js';
import { auditPortraitMotion, auditScaledClear } from '../helpers/portrait-motion-browser-audit.js';

createApp({
  components: { CharacterArtwork, PortraitMotionSettings },
  setup() {
    const id = ref('sweet');
    const reaction = ref('base');
    const shown = ref(true);
    const busy = ref(false);
    const report = ref('尚未运行原生 Canvas2D 像素验收。');
    const pictures = ref([]);
    const endpointsOnly = ref(true);
    const visiblePictures = computed(() => pictures.value.filter((picture) => !endpointsOnly.value || ['original-open', 'closed'].includes(picture.name)));
    const benchHost = ref(null);
    const benchmark = ref('尚未测量。这里只测此浏览器，不代表手机性能。');
    const scaledReport = ref('尚未检查显示缩放归零。');
    async function checkScaled() {
      if (busy.value) return;
      busy.value = true;
      try {
        const reports = [];
        for (const entry of Object.values(PORTRAIT_MOTION_CHARACTERS)) reports.push(...await auditScaledClear(PortraitMotionRenderer, entry));
        scaledReport.value = JSON.stringify({ scope: 'Actual browser scaled overlay alpha clearing', reports }, null, 2);
      } catch (error) { scaledReport.value = `检查失败：${error.message}`; }
      finally { busy.value = false; }
    }
    const character = computed(() => {
      const entry = CHARACTERS.find((item) => item.id === id.value);
      return { ...entry, portrait: portraitForCharacter(entry, reaction.value), portraitReaction: reaction.value, portraitPhaseKey: `${entry.id}:0` };
    });
    const descriptor = computed(() => portraitMotionFor(id.value));
    async function audit(all = false) {
      if (busy.value) return;
      busy.value = true;
      pictures.value = [];
      try {
        const descriptors = all ? Object.values(PORTRAIT_MOTION_CHARACTERS) : [descriptor.value];
        const reports = [];
        for (const entry of descriptors) {
          if (!entry) throw new Error('该角色素材尚未放行');
          const result = await auditPortraitMotion({
            Renderer: PortraitMotionRenderer,
            descriptor: entry,
            sourceUrl: entry.sourceUrl,
            width: entry.width,
            height: entry.height,
            eyePolygons: entry.eyes.map((eye) => eye.maskPolygon),
            hairPolygons: entry.hairRegions.map((region) => region.maskPolygon),
          });
          pictures.value.push(...result.results.map((item) => ({ id: entry.id, name: item.name, src: item.preview, eyes: item.eyePreview })));
          reports.push({ id: entry.id, ...result, results: result.results.map((item) => ({
            name: item.name,
            changedPixels: item.changedPixels,
            outsideAllowedPixels: item.outsideAllowedPixels,
            overlayPixels: item.overlayPixels,
            maximumChannelDifference: item.maximumChannelDifference,
            passed: item.passed,
          })) });
        }
        report.value = JSON.stringify({ scope: 'Actual browser Canvas2D pixel audit', reports }, null, 2);
      } catch (error) {
        report.value = `检查失败：${error.message}`;
      } finally {
        busy.value = false;
      }
    }
    async function measureFour() {
      if (busy.value || !descriptor.value) return;
      busy.value = true;
      const renderers = [];
      const measurements = [];
      const errors = [];
      const wasShown = shown.value;
      shown.value = false;
      await nextTick();
      let measuring = false;
      benchHost.value.replaceChildren();
      try {
        const entry = descriptor.value;
        for (let seat = 0; seat < 4; seat += 1) {
          const frame = document.createElement('div');
          frame.style.cssText = `position:relative;width:200px;aspect-ratio:${entry.width}/${entry.height};flex:0 0 200px`;
          const original = document.createElement('img');
          original.src = entry.sourceUrl;
          original.alt = `${entry.id} 基准实例 ${seat + 1}`;
          original.style.cssText = 'display:block;width:100%;height:100%';
          const canvas = document.createElement('canvas');
          canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
          frame.append(original, canvas);
          benchHost.value.append(frame);
          const renderer = new PortraitMotionRenderer(canvas, (error) => { errors.push(error.message); }, `${entry.id}:${seat}`);
          renderers.push(renderer);
          await renderer.load(entry);
          const measurement = { durations: [], closedFrames: 0 };
          measurements.push(measurement);
          const renderFrame = renderer.renderFrame.bind(renderer);
          // 仅包裹真实调用计时，不伪造绘制、帧结束或浏览器时钟。
          // Time the real call only, without fabricating drawing, frame completion or the browser clock.
          renderer.renderFrame = (values) => {
            const started = performance.now();
            renderFrame(values);
            if (measuring) {
              measurement.durations.push(performance.now() - started);
              if (values.blink >= 0.5) measurement.closedFrames += 1;
            }
          };
        }
        benchHost.value.scrollIntoView({ block: 'center' });
        const started = performance.now();
        measuring = true;
        for (const renderer of renderers) renderer.start();
        benchmark.value = '正在可见区域运行四实例 8 秒。';
        await new Promise((resolve) => setTimeout(resolve, 8000));
        const elapsedMs = performance.now() - started;
        measuring = false;
        for (const renderer of renderers) renderer.stop();
        benchmark.value = JSON.stringify({
          scope: 'Four actual Canvas2D instances in this cloud browser, not mobile/GPU performance',
          id: entry.id,
          elapsedMs,
          errors,
          instances: measurements.map(({ durations, closedFrames }) => {
            const sorted = [...durations].sort((a, b) => a - b);
            return {
              renderCalls: durations.length,
              closedFrames,
              effectiveCallsPerSecond: durations.length * 1000 / elapsedMs,
              averageDrawMs: durations.reduce((sum, value) => sum + value, 0) / durations.length,
              p95DrawMs: sorted[Math.floor((sorted.length - 1) * 0.95)],
              maxDrawMs: Math.max(...durations),
            };
          }),
        }, null, 2);
      } catch (error) {
        benchmark.value = `测量失败：${error.message}`;
      } finally {
        for (const renderer of renderers) renderer.dispose();
        shown.value = wasShown;
        busy.value = false;
      }
    }
    return { id, reaction, shown, busy, report, visiblePictures, endpointsOnly, character, descriptor, characters: CHARACTERS, audit, benchHost, benchmark, measureFour, scaledReport, checkScaled };
  },
  template: `
    <main style="max-width:1100px;margin:24px auto;padding:0 16px;font-family:system-ui;color:#222">
      <h1>原图局部动态验收</h1>
      <p>不是 Live2D。原图始终保留，只使用生成闭眼的眼睑区域及原发丝的局部变化。</p>
      <PortraitMotionSettings />
      <label>角色 <select v-model="id"><option v-for="entry in characters" :value="entry.id">{{entry.name}} ({{entry.id}})</option></select></label>
      <label>表情 <select v-model="reaction"><option value="base">基础</option><option value="win">胡牌</option><option value="discardLoss">放炮</option></select></label>
      <button @click="shown=!shown">卸载/重建画框</button>
      <p>素材：{{ descriptor ? '已配置，可核查实际效果' : '未放行，必须保留原图' }}</p>
      <section v-if="shown" style="display:flex;gap:16px;flex-wrap:wrap;margin:20px 0">
        <figure style="margin:0;width:300px"><figcaption>原始静态对照</figcaption><img :src="character.portrait" :alt="character.name+' 原图'" style="width:100%;display:block" /></figure>
        <figure style="margin:0;width:300px"><figcaption>实际组件 · 本人比例</figcaption><div style="aspect-ratio:1254/1050;--portrait-focus-y:50%"><CharacterArtwork :character="character" /></div></figure>
        <figure style="margin:0;width:240px"><figcaption>实际组件 · 对手裁切</figcaption><div style="height:280px;--portrait-focus-y:24%"><CharacterArtwork :character="character" /></div></figure>
      </section>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button @click="audit(false)" :disabled="busy || !descriptor">检查当前角色原生像素</button>
        <button @click="audit(true)" :disabled="busy">检查全部已配置角色</button>
        <button @click="measureFour" :disabled="busy || !descriptor">测量四实例 8 秒</button>
        <button @click="checkScaled" :disabled="busy">检查七人缩放归零</button>
      </div>
      <p>下方固定帧来自同一个生产 renderer。使用睁眼/闭眼两端帧短眨眼，不伪造半闭眼；threshold只检查控制阈值。局部像素保护不等于美观保证。</p>
      <label><input type="checkbox" v-model="endpointsOnly" />仅显示睁眼和闭眼端点</label>
      <section style="display:flex;flex-wrap:wrap;gap:10px"><figure v-for="picture in visiblePictures" :key="picture.id+picture.name" style="margin:0;width:260px"><figcaption>{{picture.id}} / {{picture.name}}</figcaption><img :src="picture.src" :alt="picture.id+' '+picture.name" style="width:100%;display:block" /><img :src="picture.eyes" :alt="picture.id+' '+picture.name+' 眼部原生裁切'" style="width:100%;display:block;margin:6px 0 14px" /></figure></section>
      <pre id="pixel-report" style="white-space:pre-wrap;overflow-wrap:anywhere">{{report}}</pre>
      <div ref="benchHost" style="display:flex;gap:12px;flex-wrap:wrap"></div>
      <pre id="benchmark-report" style="white-space:pre-wrap;overflow-wrap:anywhere">{{benchmark}}</pre>
      <pre id="scaled-report" style="white-space:pre-wrap;overflow-wrap:anywhere">{{scaledReport}}</pre>
    </main>`,
}).mount('#portrait-motion-preview');
