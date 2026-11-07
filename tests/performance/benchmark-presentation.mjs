/** Compare Vue component patch CPU with an in-memory renderer. No browser/layout/network claim.
 * Usage: node tests/performance/benchmark-presentation.mjs [baseline-git-ref]
 * Only synthetic public table state and one private test hand are used.
 */ // 内存 Vue 渲染器的 CPU 对比，不代表浏览器绘制或真实网络耗时。
// CPU comparison with an in-memory Vue renderer, not browser painting or real network latency.
// 阅读说明见 docs/TESTING-READING-GUIDE.md；固定种子与凭证仅为测试，不应移入真实用户数据。
// See docs/TESTING-READING-GUIDE.md; seeded data and test credentials must stay separate from real user data.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import * as Vue from "vue";
import { parse, compileScript, compileTemplate } from "@vue/compiler-sfc";
import * as Audio from "../../src/character-audio.js";
// 当前App还依赖共享播放协调器；旧基准缺少此依赖会在编译阶段失败。
// Current App also imports shared playback; omitting it makes the old harness fail during compilation.
import * as SharedPlayback from "../../src/shared-playback.js";
// 注入与真实 App 相同的开局配置模块，保证测试装载器不会漏掉新增依赖。
// Inject the same start-options module as the actual App so the test loader includes its new dependency.
import * as StartOptions from "../../shared/start-options.js";
// 基准测试装载实际媒体目录，保持与生产组件相同的依赖图。
// Load the real media catalog so the benchmark uses the production component's dependency graph.
import * as TilePresentation from "../../src/mahjong-tile-presentation.js";
// 基线取自本地 Git 对象；比较前应确认该提交存在，脚本不会联网获取缺失提交。
// Read the baseline from local Git objects; confirm it exists first. The script does not fetch a missing revision.
const baseline = process.argv[2] || "1de15e9a43ce373a4b408d3fd6b8cddd2aa9247c";
// 安装不保存数据的存储替身，避免基准依赖真实浏览器账号或历史会话。
// Install nonpersisting storage substitutes so the benchmark does not depend on real browser identity/session data.
const storage = {
  getItem: () => null,
  setItem() {},
  removeItem() {},
};
globalThis.window = {
  location: {
    href: "https://synthetic.invalid/",
    search: "",
  },
  sessionStorage: storage,
  localStorage: storage,
};
globalThis.document = {
  hidden: false,
  activeElement: {
    blur() {},
  },
  body: {
    style: {},
  },
};
// 编译给定版本的 Vue 组件源码；注入同一批测试依赖以便公平比较。
// Compile the supplied Vue component version with shared test dependencies for a fair comparison.
function component(file, source, dependencies = {}) {
  const { descriptor } = parse(source);
  const script = compileScript(descriptor, {
    id: file,
  });
  const template = compileTemplate({
    source: descriptor.template.content,
    filename: file,
    id: file,
    compilerOptions: {
      bindingMetadata: script.bindings,
    },
  });
  // 真实组件模板编译失败应立即报错，不继续用残缺渲染函数测试。
  // Fail immediately on template compilation errors instead of testing an incomplete renderer.
  if (template.errors.length) throw Error(String(template.errors));
  const modules = {
    vue: {
      ...Vue,
      onMounted() {},
      onUnmounted() {},
    },
    ...dependencies,
  };
  const imports = (code) =>
    code
      .replace(
        /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,
        (_, bindings, module) =>
          `const {${bindings.replace(/\s+as\s+/g, ":")}} = modules[${JSON.stringify(module)}];`,
      )
      .replace(
        /import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g,
        (_, binding, module) =>
          `const ${binding}=modules[${JSON.stringify(module)}];`,
      );
  const c = new Function(
    "modules",
    imports(script.content).replace("export default", "return"),
  )(modules);
  c.render = new Function(
    "modules",
    `${imports(template.code).replace("export function render", "function render")}\nreturn render;`,
  )(modules);
  return c;
}
const tile = component(
  "MahjongTile.vue",
  readFileSync(new URL("../../src/MahjongTile.vue", import.meta.url), "utf8"),
  {
    "./mahjong-tile-presentation.js": TilePresentation,
  },
);
const icon = component(
  "Icon.vue",
  readFileSync(new URL("../../src/Icon.vue", import.meta.url), "utf8"),
);
const deps = {
  "./MahjongTile.vue": tile,
  "./Icon.vue": icon,
  "./character-audio.js": Audio,
  "./shared-playback.js": SharedPlayback,
  "../shared/start-options.js": StartOptions,
};
// 旧版与当前版共用当前牌组件等依赖；比较的是 App 差异，不是整站历史资产差异。
// Both versions share current tile/component dependencies; this compares App changes, not all historical site assets.
const before = component(
  "App.vue",
  execFileSync("git", ["show", `${baseline}:src/App.vue`], {
    encoding: "utf8",
  }),
  deps,
);
const after = component(
  "App.vue",
  readFileSync(new URL("../../src/App.vue", import.meta.url), "utf8"),
  deps,
);
const node = (type, text = "") => ({
  type,
  text,
  props: {},
  children: [],
  parent: null,
  tagName: type.toUpperCase(),
  style: {},
  // 新建房表单包含原生select；模拟只读选项集合，供Vue的v-model指令挂载而非模拟浏览器布局。
  // The creation form contains native selects; expose options for Vue v-model mounting, not browser layout.
  get options() {
    return this.children.filter((child) => child.type === 'option');
  },
  get value() {
    return this.props.value ?? '';
  },
  set value(value) {
    this.props.value = value;
  },
  addEventListener() {},
  removeEventListener() {},
  setAttribute() {},
  removeAttribute() {},
  getAttribute() {
    return null;
  },
});
// 维护假 DOM 的父子关系和锚点位置；移动节点前先从旧父节点移除。
// Maintain synthetic DOM parent/child and anchor order, removing moved nodes from their old parent first.
function insert(child, parent, anchor = null) {
  // 移动已有节点之前先从旧父节点删除，避免同一节点同时出现在两处。
  // Detach an existing node from its old parent before moving it, avoiding duplicate placement.
  if (child.parent) {
    const list = child.parent.children;
    list.splice(list.indexOf(child), 1);
  }
  const index = anchor ? parent.children.indexOf(anchor) : -1;
  parent.children.splice(index < 0 ? parent.children.length : index, 0, child);
  child.parent = parent;
}
// 下列宿主操作模拟 DOM 插入、删除与属性更新，覆盖 Vue patch 流程但不执行浏览器布局或绘制。
// These host operations simulate DOM insertion/removal/property updates, exercising Vue patching without browser layout or paint.
const renderer = Vue.createRenderer({
  patchProp: (el, k, prev, next) => {
    el.props[k] = next;
  },
  insert,
  remove(el) {
    // 仅从存在的父级移除节点，安全处理尚未挂载或已移除的节点。
    // Remove from a parent only when one exists, tolerating unmounted/already removed nodes.
    if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1);
  },
  createElement: (tag) => node(tag),
  createText: (text) => node("text", text),
  createComment: (text) => node("comment", text),
  setText: (el, text) => {
    el.text = text;
  },
  setElementText: (el, text) => {
    el.text = text;
    el.children = [];
  },
  parentNode: (el) => el.parent,
  nextSibling: (el) =>
    el.parent?.children[el.parent.children.indexOf(el) + 1] || null,
  insertStaticContent(html, parent, anchor) {
    const el = node("static", html);
    insert(el, parent, anchor);
    return [el, el];
  },
});
// 构造固定规模的合成公开快照与一手私有测试牌；不读取服务器。
// Build a fixed-size synthetic public snapshot and one private test hand without reading a server.
const snapshot = () => ({
  id: "ABCDEF23",
  revision: 1,
  you: 0,
  hostSeat: 0,
  phase: "playing",
  seats: [0, 1, 2].map((seat) => ({
    seat,
    name: `Synthetic ${seat}`,
    connected: true,
  })),
  game: {
    id: "benchmark",
    schemaVersion: 3,
    phase: "turn",
    turnStep: "discard",
    currentSeat: 0,
    drawnTile: 3,
    wallCount: 42,
    characters: ["sweet", "elegant", "sunny"],
    rules: {
      autoDiscardAfterHu: true,
    },
    players: [0, 1, 2].map((seat) => ({
      seat,
      handCount: 13,
      hand:
        seat === 0
          ? [0, 1, 2, 3, 4, 4, 5, 9, 10, 11, 12, 13, 14, 17]
          : undefined,
      huCount: 0,
      score: 0,
      melds: [],
      radishes: [],
      winPile: [],
    })),
    discards: Array.from(
      {
        length: 60,
      },
      (_, index) => ({
        seat: index % 3,
        tile: index % 18,
      }),
    ),
    history: Array.from(
      {
        length: 150,
      },
      (_, index) => ({
        revision: Math.floor(index / 3),
        type: index % 2 ? "draw" : "discard",
        seat: index % 3,
        tile: index % 18,
        message: `Synthetic event ${index}`,
      }),
    ),
    sharedRadishes: [1, 2, 3, 6, 8, 12],
    firstHuRadishesRevealed: true,
    legalActions: [
      {
        type: "discard",
        tile: 0,
      },
      {
        type: "discard",
        tile: 4,
      },
    ],
    waitTiles: [],
  },
});
// 挂载到内存渲染器，先预热再记录选牌和状态更新耗时，最后清理房间与组件。
// Mount to the in-memory renderer, warm up, time selection/state updates, then clear room context and unmount.
async function measure(component) {
  const app = renderer.createApp(component);
  app.mount(node("root"));
  const scope = app._instance.setupState;
  scope.session = {
    roomId: "ABCDEF23",
    token: "b".repeat(64),
  };
  let state = snapshot();
  scope.applyState(state);
  await Vue.nextTick();
  const selection = [],
    updates = [];
  for (let i = 0; i < 240; i++) {
    const begin = performance.now();
    scope.selectHand(i % 2 ? 0 : 4, i % 2 ? 0 : 4);
    await Vue.nextTick();
    // 跳过预热样本，只统计稳定阶段，降低首次编译和初始化对结果的影响。
    // Exclude warmup samples to reduce first-compile and initialization effects.
    if (i >= 40) selection.push(performance.now() - begin);
  }
  for (let i = 0; i < 120; i++) {
    state = structuredClone(state);
    state.revision++;
    state.game.history.push({
      revision: state.revision + 50,
      type: "pass",
      seat: i % 3,
      message: `Synthetic update ${i}`,
    });
    const begin = performance.now();
    scope.applyState(state);
    await Vue.nextTick();
    // 跳过预热样本，只统计稳定阶段，降低首次编译和初始化对结果的影响。
    // Exclude warmup samples to reduce first-compile and initialization effects.
    if (i >= 40) updates.push(performance.now() - begin);
  }
  scope.resetRoomContext();
  app.unmount();
  return {
    selection,
    updates,
  };
}
// 每轮交替先测旧版/新版，减少固定执行顺序带来的热机偏差。
// Alternate which version runs first each round to reduce fixed-order warmup bias.
const all = {
  before: {
    selection: [],
    updates: [],
  },
  after: {
    selection: [],
    updates: [],
  },
};
for (
  let round = 0;
  round < 6;
  round++ // 逐项覆盖 round%2?[['after',after],['before',before]]:[['before',before],['after',after]]；同一组检查用于每个样本，顺序以代码列出的集合为准。
)
  // Exercise each entry in round%2?[['after',after],['before',before]]:[['before',before],['after',after]] with the same checks, preserving the listed order.
  for (const [label, c] of round % 2
    ? [
        ["after", after],
        ["before", before],
      ]
    : [
        ["before", before],
        ["after", after],
      ]) {
    const result = await measure(c);
    // 逐项覆盖 ['selection','updates']；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in ['selection','updates'] with the same checks, preserving the listed order.
    for (const key of ["selection", "updates"])
      all[label][key].push(...result[key]);
  }
// 排序样本后取分位数与最大值；原地排序只用于本次测量数组。
// Sort the measurement array in place to obtain quantiles and maximum values.
function stats(values) {
  values.sort((a, b) => a - b);
  const q = (n) => +values[Math.floor(values.length * n)].toFixed(3);
  return {
    samples: values.length,
    p50: q(0.5),
    p95: q(0.95),
    max: +values.at(-1).toFixed(3),
  };
}
// 输出样本数与耗时分位数，同时声明测量不包含浏览器绘制、网络或音频。
// Report sample counts/latency quantiles and explicitly exclude browser painting, network and audio.
console.log(
  JSON.stringify(
    {
      baseline,
      method:
        "Vue 3 client component patch, synthetic in-memory host, 60 discards / 150 initial history events, one appended event per snapshot; six alternating runs; per-run warmup 40; milliseconds; same current tile component in before/after; excludes browser paint, layout, image decode, networking and audio",
      before: {
        selectionMs: stats(all.before.selection),
        snapshotMs: stats(all.before.updates),
      },
      after: {
        selectionMs: stats(all.after.selection),
        snapshotMs: stats(all.after.updates),
      },
    },
    null,
    2,
  ),
);
