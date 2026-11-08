// 隔离验收页只用生产组件和公开素材，不加载牌局 API；绝不随生产构建分发。
// Isolated acceptance uses real components/public art, no game API, and never enters production output.
// 开发页内联模板需要带编译器的 Vue；正式生产组件仍由 Vite 编译。
// This developer-only inline template needs Vue's compiler; production SFCs stay Vite-compiled.
import { createApp, computed, ref } from 'vue/dist/vue.esm-bundler.js';
import CharacterArtwork from '../../src/CharacterArtwork.vue';
import Live2DSettings from '../../src/Live2DSettings.vue';
import { getLive2DConsent } from '../../src/live2d/consent.js';
import { CHARACTERS } from '../../src/character-audio.js';
import { portraitForCharacter } from '../../src/character-portraits.js';
import { LIVE2D_CHARACTERS } from '../../src/live2d/catalog.js';
import { loadLive2DRuntime } from '../../src/live2d/loader.js';
import { auditCoreModel } from '../helpers/live2d-core-audit.js';

createApp({
  components: { CharacterArtwork, Live2DSettings },
  setup() {
    const { enabled: consentEnabled } = getLive2DConsent();
    const id = ref('sweet');
    const reaction = ref('base');
    const report = ref('尚未检查 Core。Core 数值通过不代表实际 WebGL 绘制。');
    const busy = ref(false);
    const shown = ref(true);
    const character = computed(() => {
      const selected = CHARACTERS.find((entry) => entry.id === id.value);
      return { ...selected, portrait: portraitForCharacter(selected, reaction.value), portraitReaction: reaction.value, portraitPhaseKey: `${selected.id}:0` };
    });
    // 通过真实浏览器加载图片，验证同源纹理与背景能解码；不把这些静态图片当模型动画。
    // Decode real browser images to check texture/background URLs, without treating static images as model animation.
    const decodeImage = (url) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error(`Cannot decode ${url}`));
      image.src = url;
    });
    // 诊断页仅使用普通上下文参数，保留实际浏览器失败原因；不用安全开关强行启用。
    // Probe normal contexts and report actual browser failure reasons, without unsafe browser flags.
    function probeGraphics() {
      return ['webgl2', 'webgl'].map((type) => {
        const canvas = document.createElement('canvas');
        let creationMessage = '';
        canvas.addEventListener('webglcontextcreationerror', (event) => { creationMessage = event.statusMessage || ''; });
        const context = canvas.getContext(type);
        const result = { type, available: Boolean(context), creationMessage };
        context?.getExtension('WEBGL_lose_context')?.loseContext();
        return result;
      });
    }
    async function checkCore() {
      // 检查按钮也必须遵循正式许可选择，不能成为未同意时的资源旁路。
      // The audit control also requires production assent, never a pre-consent resource bypass.
      if (!consentEnabled.value || busy.value) return;
      busy.value = true;
      try {
        await loadLive2DRuntime();
        const reports = [];
        for (const descriptor of Object.values(LIVE2D_CHARACTERS).filter((entry) => entry.available)) {
          if (!consentEnabled.value) throw new Error('动态角色已停用，检查已停止');
          const modelUrl = new URL(descriptor.modelUrl, location.href);
          const settingsResponse = await fetch(modelUrl);
          if (!settingsResponse.ok) throw new Error('Model settings unavailable');
          const settings = await settingsResponse.json();
          const mocResponse = await fetch(new URL(settings.FileReferences.Moc, modelUrl));
          if (!mocResponse.ok) throw new Error('MOC unavailable');
          const result = auditCoreModel(globalThis.Live2DCubismCore, await mocResponse.arrayBuffer(), descriptor.verifiedBindings);
          const textures = [];
          for (const texture of settings.FileReferences.Textures) textures.push(await decodeImage(new URL(texture, modelUrl)));
          const background = await decodeImage(descriptor.backgroundUrl);
          reports.push({ id: descriptor.id, ...result, textures, background });
        }
        report.value = JSON.stringify({ scope: 'Actual browser Core and resources only; not WebGL visibility', graphics: probeGraphics(), models: reports }, null, 2);
      } catch (error) {
        report.value = `检查失败：${error.message}`;
      } finally {
        busy.value = false;
      }
    }
    return { consentEnabled, id, reaction, report, busy, shown, character, characters: CHARACTERS, checkCore };
  },
  template: `
    <main style="max-width:900px;margin:24px auto;font-family:system-ui;color:#222">
      <h1>Live2D 本地验收</h1>
      <p>未发布的测试页。必须实际看到局部眨眼、头身和侧发变化才能记录 GPU 视觉通过；原图回退不是通过。</p>
      <Live2DSettings />
      <label>角色 <select v-model="id"><option v-for="entry in characters" :value="entry.id">{{entry.name}} ({{entry.id}})</option></select></label>
      <label>表情 <select v-model="reaction"><option value="base">基础</option><option value="win">胡牌</option><option value="discardLoss">放炮</option></select></label>
      <button @click="shown=!shown">卸载/重建画框</button>
      <section v-if="shown" style="display:flex;gap:20px;margin:20px 0">
        <div style="width:300px;height:280px;border:1px solid #444;--portrait-focus-y:24%"><CharacterArtwork :character="character" /></div>
        <div style="width:300px;aspect-ratio:1254/1050;border:1px solid #444;--portrait-focus-y:50%"><CharacterArtwork :character="character" /></div>
      </section>
      <button @click="checkCore" :disabled="busy || !consentEnabled">检查实际浏览器 Core（不代表 WebGL）</button>
      <pre id="core-report" style="white-space:pre-wrap;overflow-wrap:anywhere">{{report}}</pre>
    </main>`,
}).mount('#live2d-preview');
