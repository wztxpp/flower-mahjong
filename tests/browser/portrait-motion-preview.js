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
    const hairOnly = ref(false);
    const hairExtremesOnly = ref(true);
    const visiblePictures = computed(() => pictures.value.filter((picture) => picture.id === id.value).filter((picture) => {
      if (hairOnly.value) return picture.name === 'original-open' || (picture.name.startsWith('hair') &&
        (!hairExtremesOnly.value || ['hair-geometry:-1', 'hair-geometry:0.5', 'hair-geometry:1'].includes(picture.name)));
      return !endpointsOnly.value || ['original-open', 'closed', 'eye:eye100'].includes(picture.name);
    }));
    const benchHost = ref(null);
    const mixedBenchmark = ref(true);
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
          pictures.value.push(...result.results.map((item) => ({ id: entry.id, name: item.name, src: item.preview, eyes: item.eyePreview, hair: item.hairPreviews })));
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
        report.value = `检查失败：${error.stack || error.message}`;
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
        // 混合压力覆盖四个动区最大的角色，不用同一小ROI的重复实例代替最坏可见桌面。
        // Mixed stress covers the four largest animated areas, rather than repeating a small ROI as the worst visible table.
        const area = (value) => [...value.eyes.map((eye) => eye.targetRect), ...value.hairRegions.map((region) => region.rect)]
          .reduce((sum, rect) => sum + rect[2] * rect[3], 0);
        const entries = mixedBenchmark.value ? Object.values(PORTRAIT_MOTION_CHARACTERS).sort((a, b) => area(b) - area(a)).slice(0, 4) : Array(4).fill(entry);
        for (let seat = 0; seat < 4; seat += 1) {
          const entry = entries[seat];
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
          const loadStarted = performance.now();
          await renderer.load(entry);
          const measurement = { id: entry.id, loadMs: performance.now() - loadStarted, geometryMemory: renderer.geometryMemory, durations: [], closedFrames: 0, eyeFrameCounts: {}, transitions: [], previousEyeFrame: undefined, minHairPosition: 1, maxHairPosition: -1 };
          measurements.push(measurement);
          const renderFrame = renderer.renderFrame.bind(renderer);
          // 仅包裹真实调用计时，不伪造绘制、帧结束或浏览器时钟。
          // Time the real call only, without fabricating drawing, frame completion or the browser clock.
          renderer.renderFrame = (values) => {
            const started = performance.now();
            renderFrame(values);
            if (measuring) {
              measurement.durations.push(performance.now() - started);
              const hairPosition = renderer.lastControls?.hairPosition ?? renderer.lastControls?.hair ?? 0;
              measurement.minHairPosition = Math.min(measurement.minHairPosition, hairPosition);
              measurement.maxHairPosition = Math.max(measurement.maxHairPosition, hairPosition);
              const frameId = renderer.lastControls?.blinkFrameId ?? (values.blink >= 0.5 ? 'legacy-closed' : null);
              const key = frameId || 'original-open';
              measurement.eyeFrameCounts[key] = (measurement.eyeFrameCounts[key] || 0) + 1;
              if (frameId === 'eye100' || frameId === 'legacy-closed') measurement.closedFrames += 1;
              if (frameId !== measurement.previousEyeFrame) {
                measurement.transitions.push({ atMs: performance.now(), frameId });
                measurement.previousEyeFrame = frameId;
              }
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
          ids: entries.map((value) => value.id),
          elapsedMs,
          errors,
          instances: measurements.map(({ id, loadMs, geometryMemory, durations, closedFrames, eyeFrameCounts, transitions, minHairPosition, maxHairPosition }) => {
            const sorted = [...durations].sort((a, b) => a - b);
            return {
              id,
              loadMs,
              geometryMemory,
              minHairPosition,
              maxHairPosition,
              renderCalls: durations.length,
              closedFrames,
              eyeFrameCounts,
              transitions: transitions.map((entry) => ({ atMs: entry.atMs - started, frameId: entry.frameId })),
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
    return { id, reaction, shown, busy, report, visiblePictures, endpointsOnly, hairOnly, hairExtremesOnly, character, descriptor, characters: CHARACTERS, audit, benchHost, benchmark, mixedBenchmark, measureFour, scaledReport, checkScaled };
  },
  template: `
    <main style="max-width:1100px;margin:24px auto;padding:0 16px;font-family:system-ui;color:#222">
      <h1>原图局部动态验收</h1>
      <p>不是 Live2D。原图始终保留，ImageGen只提供眼睑中间形态；头发候选区分真实生成供体与原纹理几何动画。</p>
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
      <p>下方固定帧来自同一个生产 renderer。眼区逐张显示ImageGen供体，不做透明混合；hair-geometry是原纹理连续采样，不能称ImageGen画稿。局部像素保护不等于自然度或可感知运动通过。</p>
      <label><input type="checkbox" v-model="endpointsOnly" />仅显示睁眼和闭眼端点</label>
      <label><input type="checkbox" v-model="hairOnly" />只看头发原生裁切</label>
      <label><input type="checkbox" v-model="hairExtremesOnly" />发区仅看原图、负极值、半摆、正极值</label>
      <label><input type="checkbox" v-model="mixedBenchmark" />四实例使用四种最大动区角色</label>
      <p>图像仅显示当前选择角色；下方JSON保留本次检查的全部角色。切换角色查看对应固定帧。</p>
      <section style="display:flex;flex-wrap:wrap;gap:10px"><figure v-for="picture in visiblePictures" :key="picture.id+picture.name" style="margin:0;width:260px"><figcaption>{{picture.id}} / {{picture.name}}</figcaption><img :src="picture.src" :alt="picture.id+' '+picture.name" style="width:100%;display:block" /><div v-if="hairOnly" style="display:flex;gap:4px;flex-wrap:wrap"><img v-for="(crop,index) in picture.hair" :src="crop" :alt="picture.id+' '+picture.name+' 发区 '+index" style="max-width:100%;height:auto" /></div><img v-if="!hairOnly" :src="picture.eyes" :alt="picture.id+' '+picture.name+' 眼部原生裁切'" style="width:100%;display:block;margin:6px 0 14px" /></figure></section>
      <pre id="pixel-report" style="white-space:pre-wrap;overflow-wrap:anywhere">{{report}}</pre>
      <div ref="benchHost" style="display:flex;gap:12px;flex-wrap:wrap"></div>
      <pre id="benchmark-report" style="white-space:pre-wrap;overflow-wrap:anywhere">{{benchmark}}</pre>
      <pre id="scaled-report" style="white-space:pre-wrap;overflow-wrap:anywhere">{{scaledReport}}</pre>
    </main>`,
}).mount('#portrait-motion-preview');
