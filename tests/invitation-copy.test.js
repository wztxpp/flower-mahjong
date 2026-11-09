import * as RoundSummaryModule from '../src/round-summary.js';
import * as MotionCatalog from '../src/portrait-motion/catalog.js';
import * as MotionLoader from '../src/portrait-motion/loader.js';
import * as MotionSettings from '../src/portrait-motion/settings.js';
import * as MotionController from '../src/portrait-motion/controller.js';
import * as ChengduEventTextModule from '../src/chengdu-event-text.js';
// 注入与真实 App 相同的开局配置模块，保证测试装载器不会漏掉新增依赖。
// Inject the same start-options module as the actual App so the test loader includes its new dependency.
import * as StartOptionsModule from "../shared/start-options.js";
import * as ChengduRoomSettingsModule from "../shared/chengdu-room-settings.js";
// 邀请复制的浏览器能力降级与用户可见反馈。
// Invitation copying, browser-capability fallbacks and visible feedback.
// 阅读说明见 docs/TESTING-READING-GUIDE.md；固定种子与凭证仅为测试，不应移入真实用户数据。
// See docs/TESTING-READING-GUIDE.md; seeded data and test credentials must stay separate from real user data.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as Vue from "vue";
import * as Live2DConsent from "../src/live2d/consent.js";
import * as CharacterAudioModule from "../src/character-audio.js";
import * as CharacterPortraitModule from "../src/character-portraits.js";
import * as SharedPlaybackModule from "../src/shared-playback.js";
// 测试装载器跟随真实组件的媒体目录依赖，不在复制邀请测试里另造牌面映射。
// Follow the real component's media dependency rather than duplicating its mapping in invitation tests.
import * as MahjongPresentationModule from "../src/mahjong-tile-presentation.js";
import { parse, compileScript, compileTemplate } from "@vue/compiler-sfc";

// Compile the shipped SFCs, as ui.test.js does. A small in-memory Vue renderer
// exercises real button handlers and template refs without a browser, clipboard,
// API requests, or a parallel presentation model.
// 编译实际 Vue 单文件组件，并把导入替换为测试依赖；不是另写一套假的界面逻辑。
// Compile the real Vue SFC and substitute test dependencies for imports rather than duplicating the UI logic.
function compileComponent(filename, dependencies = {}) {
  const { descriptor } = parse(
    readFileSync(new URL(`../src/${filename}`, import.meta.url), "utf8"),
  );
  const script = compileScript(descriptor, {
    id: filename,
  });
  const template = compileTemplate({
    source: descriptor.template.content,
    filename,
    id: filename,
    compilerOptions: {
      bindingMetadata: script.bindings,
      hoistStatic: false,
    },
  });
  assert.deepEqual(template.errors, []);
  const modules = {
    vue: {
      ...Vue,
      onMounted() {},
      onUnmounted() {},
    },
    ...dependencies,
  };
  // 仅重写编译产物的 import 以注入测试依赖；正则是测试装载器的一部分，不能当成通用 JavaScript 解析器。
  // Rewrite compiled imports only to inject test dependencies; these regexes are a harness loader, not a general JavaScript parser.
  const load = (code) =>
    code
      .replace(
        /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,
        (_, bindings, module) =>
          `const {${bindings.replace(/\s+as\s+/g, ":")}} = modules[${JSON.stringify(module)}];`,
      )
      .replace(
        /import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g,
        (_, binding, module) =>
          `const ${binding} = modules[${JSON.stringify(module)}];`,
      );
  const component = new Function(
    "modules",
    load(script.content).replace("export default", "return"),
  )(modules);
  component.render = new Function(
    "modules",
    `${load(template.code).replace("export function render", "function render")}\nreturn render;`,
  )(modules);
  return component;
}
const Tile = compileComponent("MahjongTile.vue", {
  "./mahjong-tile-presentation.js": MahjongPresentationModule,
});
const Icon = compileComponent("Icon.vue");
// 牌桌patch回归使用当前生产画框/设置组件，避免旧Live2D装载表产生无效节点掩盖真实更新。
// Table-patch regressions load current production artwork/settings, avoiding invalid nodes from the retired Live2D harness.
const CharacterArtwork = compileComponent('CharacterArtwork.vue', {
  './portrait-motion/settings.js': MotionSettings,
  './portrait-motion/catalog.js': MotionCatalog,
  './portrait-motion/loader.js': MotionLoader,
  './portrait-motion/controller.js': MotionController,
});
const PortraitMotionSettings = compileComponent('PortraitMotionSettings.vue', { './portrait-motion/settings.js': MotionSettings });
const ChengduTable = compileComponent("ChengduTable.vue", {
  "./CharacterArtwork.vue": CharacterArtwork,
  "./round-summary.js": RoundSummaryModule,
  "./chengdu-event-text.js": ChengduEventTextModule,
  "./MahjongTile.vue": Tile,
  "./mahjong-tile-presentation.js": MahjongPresentationModule,
});
const Live2DSettings = compileComponent("Live2DSettings.vue", { "./live2d/consent.js": Live2DConsent });
const RoundSummary = compileComponent("RoundSummary.vue", {
  "./round-summary.js": RoundSummaryModule,
  "./MahjongTile.vue": Tile,
});
const App = compileComponent("App.vue", {
  "./CharacterArtwork.vue": CharacterArtwork,
  "./PortraitMotionSettings.vue": PortraitMotionSettings,
  "./RoundSummary.vue": RoundSummary,
  "./round-summary.js": RoundSummaryModule,
  "./Live2DSettings.vue": Live2DSettings,
  "./chengdu-event-text.js": ChengduEventTextModule,
  "./MahjongTile.vue": Tile,
  "./Icon.vue": Icon,
  "./ChengduTable.vue": ChengduTable,
  "./character-audio.js": CharacterAudioModule,
  "./character-portraits.js": CharacterPortraitModule,
  "./shared-playback.js": SharedPlaybackModule,
  "../shared/start-options.js": StartOptionsModule,
  "../shared/chengdu-room-settings.js": ChengduRoomSettingsModule,
});
// 保存属性描述符而不只是值，恢复时保留可写性和访问器语义。
// Save property descriptors, not just values, to restore writability and accessor semantics.
const originalDescriptors = Object.fromEntries(
  [
    "window",
    "document",
    "navigator",
    "sessionStorage",
    "localStorage",
    "fetch",
    "setTimeout",
    "clearTimeout",
  ].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
);
const mounted = [];
const PUBLIC_ORIGIN = "https://flower-mahjong-wztxpp.squaresong.chatgpt.site";
const ROOM_A = "ABCDEF23";
const ROOM_B = "GHJKLM23";
const TOKEN = "b".repeat(64);
const PROFILE = "a".repeat(64);
const findAll = (node, predicate) =>
  [
    node,
    ...(node.children || []).flatMap((child) => findAll(child, predicate)),
  ].filter(predicate);
const textOf = (node) => node.text + node.children.map(textOf).join("");
// 构造内存 DOM 节点与最小焦点/选中文本接口，使复制按钮走真实组件处理函数。
// Build an in-memory DOM node with minimal focus/selection APIs so copy buttons invoke real component handlers.
function hostNode(tag, text = "") {
  return Vue.markRaw({
    tag,
    text,
    children: [],
    parent: null,
    props: {},
    // 节点连接性来自真实host父链；浮层撤下时子按钮也必须被视为断开。
    // Derive connection from the host parent chain, including descendants of a removed overlay.
    get isConnected() { return this.tag === 'root' || Boolean(this.parent?.isConnected); },
    get disabled() { return Boolean(this.props.disabled); },
    contains(candidate) { for (let node = candidate; node; node = node.parent) if (node === this) return true; return false; },
    selectionStart: 0,
    selectionEnd: 0,
    addEventListener() {},
    removeEventListener() {},
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      return findAll(this, (node) =>
        selector
          .split(",")
          .some(
            (part) =>
              part.trim() === node.tag ||
              (part.trim() === `${node.tag}:not(:disabled)` && !node.props.disabled) ||
              (part.trim() === '[tabindex="0"]' && node.props.tabindex === "0"),
          ),
      );
    },
    focus(options) {
      this.focusOptions = options;
      document.activeElement = this;
      this.props.onFocus?.({
        target: this,
      });
    },
    select() {
      this.selectionStart = 0;
      this.selectionEnd = String(this.props.value || "").length;
    },
    blur() {
      // 仅清除当前节点持有的焦点，不让旧节点 blur 抹掉新节点的焦点。
      // Clear focus only when this node owns it, so a stale blur cannot erase newer focus.
      if (document.activeElement === this) document.activeElement = null;
    },
  });
}
// 下列宿主操作模拟 DOM 插入、删除与属性更新，覆盖 Vue patch 流程但不执行浏览器布局或绘制。
// These host operations simulate DOM insertion/removal/property updates, exercising Vue patching without browser layout or paint.
const renderer = Vue.createRenderer({
  createElement: (tag) => hostNode(tag),
  createText: (text) => hostNode("#text", text),
  createComment: (text) => hostNode("#comment", text),
  setText: (node, text) => {
    node.text = text;
  },
  setElementText: (node, text) => {
    node.text = text;
    node.children = [];
  },
  parentNode: (node) => node.parent,
  nextSibling: (node) =>
    node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
  patchProp: (node, key, before, value) => {
    node.props[key] = value;
    // 模拟原生disabled使按钮失焦，覆盖watch更新前捕获；真实浏览器另验证其原生行为。
    // Model disabled-button blur to exercise pre-patch capture; independent browser checks verify native behavior.
    if (key === 'disabled' && value && document.activeElement === node) document.activeElement = document.body;
  },
  insert(node, parent, anchor = null) {
    // 仅在节点已挂到父级时移除旧引用，未挂载节点无需删除。
    // Remove the old reference only for a parented node; unmounted nodes need no detachment.
    if (node.parent)
      node.parent.children.splice(node.parent.children.indexOf(node), 1);
    node.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    // 找不到锚点时追加到末尾；有锚点时按指定位置插入，模拟 DOM 顺序。
    // Append when no anchor is found; otherwise insert at the anchor to preserve DOM order.
    if (index < 0) parent.children.push(node);
    else parent.children.splice(index, 0, node);
  },
  remove(node) {
    // 仅在节点已挂到父级时移除旧引用，未挂载节点无需删除。
    // Remove the old reference only for a parented node; unmounted nodes need no detachment.
    if (node.contains(document.activeElement)) document.activeElement = document.body;
    if (node.parent)
      node.parent.children.splice(node.parent.children.indexOf(node), 1);
    node.parent = null;
  },
});
// 准备模拟浏览器并把场景注入组件响应式状态，返回供交互和渲染检查的 scope。
// Prepare the mock browser, inject scenario state and return the scope used for interaction/render checks.
function setup({
  url = `${PUBLIC_ORIGIN}/?room=OLDROOM2&token=do-not-share&tracking=old#private`,
  writeText = async () => {},
  userAgent = "Desktop test",
  initialState = null,
} = {}) {
  const timers = [];
  const setLocation = (value) => {
    const next = new URL(value, PUBLIC_ORIGIN);
    Object.assign(window.location, {
      href: next.href,
      origin: next.origin,
      pathname: next.pathname,
      search: next.search,
      hash: next.hash,
    });
  };
  globalThis.window = {
    location: {},
    history: {
      replaceState(a, b, value) {
        setLocation(value);
      },
      pushState(a, b, value) {
        setLocation(value);
      },
    },
    addEventListener() {},
    removeEventListener() {},
  };
  setLocation(url);
  globalThis.document = {
    body: {
      style: {},
    },
    activeElement: hostNode("button"),
    hidden: false,
    addEventListener() {},
    removeEventListener() {},
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard:
        writeText === null
          ? undefined
          : {
              writeText,
            },
      userAgent,
    },
  });
  const storage = () => {
    const items = new Map();
    return {
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => items.set(key, value),
      removeItem: (key) => items.delete(key),
    };
  };
  window.sessionStorage = globalThis.sessionStorage = storage();
  window.localStorage = globalThis.localStorage = storage();
  globalThis.fetch = () => {
    throw new Error("Invitation tests must not make network requests");
  };
  globalThis.setTimeout = (callback, delay) => {
    timers.push({
      callback,
      delay,
      cancelled: false,
    });
    return timers.length;
  };
  globalThis.clearTimeout = (id) => {
    // 只取消已登记的模拟定时器，避免清理不存在的任务时抛异常。
    // Cancel only a registered mock timer, tolerating cleanup of absent tasks.
    if (timers[id - 1]) timers[id - 1].cancelled = true;
  };
  let scope;
  const app = renderer.createApp({
    ...App,
    setup(props, context) {
      scope = App.setup(props, context);
      scope.session.value = {
        roomId: ROOM_A,
        token: TOKEN,
        name: "房主",
      };
      scope.playerToken.value = PROFILE;
      scope.state.value = initialState || {
        id: ROOM_A,
        revision: 1,
        phase: "lobby",
        you: 0,
        hostSeat: 0,
        seats: [
          {
            seat: 0,
            name: "房主",
            connected: true,
          },
        ],
        game: null,
      };
      return scope;
    },
  });
  const root = hostNode("root");
  app.mount(root);
  document.querySelector = (selector) => selector === '[aria-modal="true"]'
    ? findAll(root, (node) => node.props['aria-modal'] === true || node.props['aria-modal'] === 'true')[0] || null : null;
  mounted.push(app);
  const buttons = () =>
    findAll(
      root,
      (node) =>
        node.tag === "button" &&
        /复制邀请|复制链接，邀请朋友|邀请链接已复制|^已复制$/.test(
          textOf(node),
        ),
    );
  const input = () =>
    findAll(
      root,
      (node) => node.tag === "input" && node.props.id === "invite-link",
    )[0];
  return {
    scope,
    root,
    timers,
    setLocation,
    buttons,
    input,
  };
}
// 等待有限轮微任务，使模拟请求及响应式回调完成；不进行真实网络等待。
// Drain a bounded number of microtasks so mocked requests/reactive callbacks finish, without real network waits.
async function settle() {
  for (let i = 0; i < 5; i++) await Vue.nextTick();
}
afterEach(() => {
  // 逐项覆盖 mounted.splice(0)；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in mounted.splice(0) with the same checks, preserving the listed order.
  for (const app of mounted.splice(0)) app.unmount();
  // 逐项覆盖 Object.entries(originalDescriptors)；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in Object.entries(originalDescriptors) with the same checks, preserving the listed order.
  for (const [key, descriptor] of Object.entries(originalDescriptors)) {
    // 原来存在该全局属性才恢复描述符；原来不存在则由另一分支删除。
    // Restore descriptors only for originally present globals; otherwise remove the temporary property.
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});
// 场景：三个邀请按钮均复制仅含当前房间的完整公开链接
// Scenario: all three invitation buttons copy the full public URL with only the current room
test("all three invitation buttons copy the full public URL with only the current room", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const writes = [];
  const { scope, buttons } = setup({
    writeText: async (value) => writes.push(value),
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(buttons().length, 3);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  // 逐项覆盖 buttons()；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in buttons() with the same checks, preserving the listed order.
  for (const button of buttons()) await button.props.onClick();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(writes, Array(3).fill(`${PUBLIC_ORIGIN}/?room=${ROOM_A}`));
  // 逐项覆盖 writes；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in writes with the same checks, preserving the listed order.
  for (const text of writes) {
    assert.deepEqual([...new URL(text).searchParams], [["room", ROOM_A]]);
    assert.equal(new URL(text).hash, "");
    assert.equal(text.includes(TOKEN) || text.includes(PROFILE), false);
  }
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.equal(scope.copyDone.value, true);
});
// 场景：邀请链接保留当前来源域和部署路径
// Scenario: invitation URL preserves the current origin and deployment path
test("invitation URL preserves the current origin and deployment path", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const writes = [];
  const { scope } = setup({
    url: "https://another.example/mahjong/play?room=OLDROOM2&token=secret#old",
    writeText: async (value) => writes.push(value),
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.copyInvite();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(writes, [
    `https://another.example/mahjong/play?room=${ROOM_A}`,
  ]);
});
// 场景：当前权威房间优先于旧链接和旧保存会话，并随状态响应式更新
// Scenario: current authoritative room wins over old URL and old saved session, and updates reactively
test("current authoritative room wins over old URL and old saved session, and updates reactively", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const writes = [];
  const { scope } = setup({
    writeText: async (value) => writes.push(value),
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.copyInvite();
  // 准备：构造该变体的规则、牌局或对照快照，保持旧历史与当前输入分离。
  // Arrange this variant’s rules, game or comparison snapshot, keeping saved history separate from current input.
  scope.state.value = {
    ...scope.state.value,
    id: ROOM_B,
  };
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  await scope.copyInvite();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(writes, [
    `${PUBLIC_ORIGIN}/?room=${ROOM_A}`,
    `${PUBLIC_ORIGIN}/?room=${ROOM_B}`,
  ]);
});
// 场景：权威房间状态不可用时，使用会话中的房间
// Scenario: session room is used if authoritative room state is not available
test("session room is used if authoritative room state is not available", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const { scope } = setup();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.state.value = null;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.shareUrl.value, `${PUBLIC_ORIGIN}/?room=${ROOM_A}`);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.session.value = {
    ...scope.session.value,
    roomId: ROOM_B,
  };
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.shareUrl.value, `${PUBLIC_ORIGIN}/?room=${ROOM_B}`);
});
// 场景：复制成功提示等待剪贴板写入完成，并在 2.5 秒后消失
// Scenario: copy success waits for clipboard completion and expires after 2.5 seconds
test("copy success waits for clipboard completion and expires after 2.5 seconds", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let finish;
  const { scope, timers } = setup({
    writeText: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const copying = scope.copyInvite();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.copyDone.value, false);
  assert.equal(scope.showInvite.value, false);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  finish();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await copying;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.copyDone.value, true);
  assert.equal(timers.at(-1).delay, 2500);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  timers.at(-1).callback();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.copyDone.value, false);
});
// 场景：重复复制成功会重置已复制提示的显示时长
// Scenario: repeat success restarts the copied indicator lifetime
test("repeat success restarts the copied indicator lifetime", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const { scope, timers } = setup();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.copyInvite();
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const first = timers.at(-1);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.copyInvite();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(first.cancelled, true);
  assert.equal(scope.copyDone.value, true);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  timers.at(-1).callback();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.copyDone.value, false);
});
// 逐项覆盖 下列集合；同一组检查用于每个样本，顺序以代码列出的集合为准。
// Exercise each entry in the following collection with the same checks, preserving the listed order.
for (const [name, writeText, userAgent] of [
  [
    "rejected clipboard",
    async () => {
      throw new Error("NotAllowedError");
    },
    "Desktop test",
  ],
  [
    "missing clipboard API with a phone user agent",
    null,
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
  ],
]) {
  // 场景：${name} 在只读的手动复制字段中显示准确链接
  // Scenario: ${name} shows the exact link in a read-only manual-copy field
  test(`${name} shows the exact link in a read-only manual-copy field`, async () => {
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.
    const { scope, root, input } = setup({
      writeText,
      userAgent,
    });
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    await scope.copyInvite();
    await settle();
    // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
    // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
    assert.equal(scope.copyDone.value, false);
    assert.equal(scope.showInvite.value, true);
    assert.match(textOf(root), /浏览器未允许自动复制，请选中下方链接并复制/);
    assert.equal(input().props.value, `${PUBLIC_ORIGIN}/?room=${ROOM_A}`);
    assert.ok(input().props.readonly === "" || input().props.readonly === true);
    assert.equal(input().selectionStart, 0);
    assert.equal(input().selectionEnd, input().props.value.length);
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.
    input().selectionEnd = 0;
    input().focus();
    // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
    // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
    assert.equal(input().selectionEnd, input().props.value.length);
  });
  // 场景：${name} 将焦点保留在已选中的手动复制字段
  // Scenario: ${name} leaves focus on the selected manual-copy field
  test(`${name} leaves focus on the selected manual-copy field`, async () => {
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.
    const { scope, input } = setup({
      writeText,
      userAgent,
    });
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    await scope.copyInvite();
    await settle();
    // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
    // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
    assert.equal(
      document.activeElement?.props.id,
      "invite-link",
      "The dialog close button must not steal focus after the input is selected",
    );
    assert.equal(input().selectionEnd, input().props.value.length);
  });
}
// 场景：重试失败会清除此前的成功提示
// Scenario: a failed retry clears any previous success indicator
test("a failed retry clears any previous success indicator", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let reject = false;
  const { scope } = setup({
    writeText: async () => {
      // 按测试参数选择拒绝分支，分别覆盖晚到成功与晚到失败的处理。
      // Select the rejection branch to cover late success and late failure separately.
      if (reject) throw new Error("NotAllowedError");
    },
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.copyInvite();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.copyDone.value, true);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  reject = true;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.copyInvite();
  await settle();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.showInvite.value, true);
  assert.equal(
    scope.copyDone.value,
    false,
    "The failed attempt must not retain an earlier copied label",
  );
});
// 场景：离开房间清除已复制状态，并忽略延迟到达的剪贴板成功结果
// Scenario: leaving the room clears copied state and ignores a delayed clipboard success
test("leaving the room clears copied state and ignores a delayed clipboard success", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let finish;
  const { scope, timers } = setup({
    writeText: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const copying = scope.copyInvite();
  scope.resetRoomContext();
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  finish();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await copying;
  await settle();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.copyDone.value, false);
  assert.equal(scope.showInvite.value, false);
  assert.equal(
    timers.filter((timer) => !timer.cancelled && timer.delay === 2500).length,
    0,
  );
});
// 场景：离开房间忽略延迟到达的剪贴板失败结果，且不重新打开对话框
// Scenario: leaving the room ignores a delayed clipboard failure and never reopens the dialog
test("leaving the room ignores a delayed clipboard failure and never reopens the dialog", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let fail;
  const { scope } = setup({
    writeText: () =>
      new Promise((resolve, reject) => {
        fail = reject;
      }),
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const copying = scope.copyInvite();
  scope.resetRoomContext();
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  fail(new Error("NotAllowedError"));
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await copying;
  await settle();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.copyDone.value, false);
  assert.equal(scope.showInvite.value, false);
});
// 场景：房间上下文变化时重置复制成功提示
// Scenario: a successful copy indicator is reset when the room context changes
test("a successful copy indicator is reset when the room context changes", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const { scope, timers } = setup();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.copyInvite();
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const indicator = timers.at(-1);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.resetRoomContext();
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  await settle();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.copyDone.value, false);
  assert.equal(indicator.cancelled, true);
});

// Ordinary room actions also advance the request epoch, but are not a navigation.

// 场景：普通房间动作不会让已复制提示无限停留
// Scenario: ordinary room actions do not leave the copied indicator stuck indefinitely
test("ordinary room actions do not leave the copied indicator stuck indefinitely", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const { scope, timers } = setup();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.copyInvite();
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const indicator = timers.at(-1);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      state: {
        ...scope.state.value,
        revision: 2,
      },
    }),
  });
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  await scope.mutate({}, true);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  indicator.callback();
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  assert.equal(
    scope.copyDone.value,
    false,
    "Copy feedback must expire even when starting or playing a hand advances the request epoch",
  );
});


// 真实组件同实例patch：只改变摘要/阶段，不替换普通玩家对象，防止静态SSR漏掉缓存与旧牌残留。
// Patch the actual mounted component without replacing public player objects, catching caches/stale faces that initial SSR cannot reveal.
for (const caseId of ['flower-3', 'flower-4', 'flower-legacy-1', 'flower-legacy-2', 'flower-spectator', 'chengdu-4', 'chengdu-spectator']) {
  test(`terminal table ${caseId} reveals, updates, withdraws and resets without remounting`, async () => {
    const { stableTableSnapshot } = await import('./helpers/stable-table-fixtures.js');
    const { terminalSummaryFixture } = await import('./helpers/round-summary-fixtures.js');
    const state = stableTableSnapshot(caseId, 'finished').state;
    delete state.game.roundSummary;
    const { scope, root } = setup({ initialState: state });
    await settle();
    const originalPlayers = scope.state.value.game.players;
    const rows = () => findAll(root, node => node.props['data-table-hand-seat'] != null);
    const faces = row => findAll(row, node => node.props.class === 'tile-photo-face');
    assert.ok(rows().length);
    assert.ok(rows().every(row => faces(row).length === 0));
    scope.state.value.game.roundSummary = terminalSummaryFixture(state, 'long');
    await settle();
    assert.equal(scope.state.value.game.players, originalPlayers);
    for (const row of rows()) {
      assert.equal(faces(row).length, caseId.startsWith('chengdu') ? 14 : 20);
      assert.match(row.props['aria-label'], /结束时手牌/);
      assert.equal(findAll(row, node => node.tag === 'button').length, 0, 'reveals are not interactive game controls');
    }
    scope.state.value.game.roundSummary.players.forEach(player => { player.finalHand = [0, 0, 1]; });
    await settle();
    assert.ok(rows().every(row => faces(row).length === 3), 'summary-only polls update the existing card');
    delete scope.state.value.game.roundSummary;
    await settle();
    assert.ok(rows().every(row => faces(row).length === 0), 'missing summary removes all formerly revealed faces');
    scope.state.value.game.roundSummary = terminalSummaryFixture(state);
    await settle();
    assert.ok(rows().every(row => faces(row).length > 0));
    scope.state.value.phase = 'playing';
    await settle();
    assert.ok(rows().every(row => faces(row).length === 0), 'the outer room phase alone retracts reveals');
    scope.state.value.game.id = 'new-terminal-snapshot';
    scope.state.value.phase = 'finished';
    await settle();
    assert.ok(rows().every(row => faces(row).length > 0));
    scope.state.value.game.phase = 'turn';
    await settle();
    assert.ok(rows().every(row => faces(row).length === 0), 'mixed phases retract reveals immediately');
    scope.state.value.phase = 'playing';
    scope.state.value.game.id = 'synthetic-next-round';
    await settle();
    assert.ok(rows().every(row => faces(row).length === 0), 'a new live game cannot reuse the stale summary');
    assert.equal(findAll(root, node => String(node.props.class).includes('finished-table-hand-label')).length, 0);
    scope.resetRoomContext();
  });
}


// 同一真实组件实例撤下动作：保留手牌节点、无网络/代选，并拒绝抢占较新的焦点或弹层。
// Remove actions in the same real component instance: preserve hand nodes, never send/choose, and yield to newer focus/modal ownership.
for (const caseId of ['flower-3', 'flower-legacy-1', 'flower-legacy-2', 'chengdu-4']) {
  for (const scenario of ['region', 'button', 'replacement', 'other-focus', 'modal', 'new-game', 'spectator']) {
    test(`action overlay ${caseId}/${scenario} recovers only its own removed focus`, async () => {
      const { stableTableSnapshot } = await import('./helpers/stable-table-fixtures.js');
      const original = stableTableSnapshot(caseId, 'claim').state;
      const { scope, root } = setup({ initialState: original });
      await settle();
      const hasClass = (node, name) => String(node.props.class || '').split(/\s+/).includes(name);
      const dock = findAll(root, (node) => hasClass(node, 'hand-action-dock'))[0];
      const hand = findAll(root, (node) => hasClass(node, 'character-hand-table'))[0];
      const target = scenario === 'region' ? dock.children.find((node) => hasClass(node, 'action-row') || hasClass(node, 'chengdu-action-bar'))
        : findAll(dock, (node) => node.tag === 'button')[0];
      assert.ok(dock && hand && target);
      target.focus();
      const next = structuredClone(original);
      next.game.legalActions = scenario === 'replacement' ? [{ type: 'pass' }] : [];
      if (scenario === 'new-game') next.game.id += '-another';
      if (scenario === 'spectator') { next.viewerRole = 'spectator'; next.you = null; next.game.mySeat = null; delete next.game.players[0].hand; }
      let other;
      if (scenario === 'other-focus') {
        other = findAll(root, (node) => node.tag === 'button' && !dock.contains(node) && !hand.contains(node))[0];
        other.focus();
      }
      scope.state.value = next;
      if (scenario === 'modal') scope.showRules.value = true;
      await settle();
      assert.equal(target.isConnected, false, 'the test must actually remove the previously focused node');
      if (['region', 'button', 'replacement'].includes(scenario)) {
        assert.equal(document.activeElement, hand);
        assert.equal(hand.isConnected, true);
        assert.deepEqual(hand.focusOptions, { preventScroll: true });
      } else if (scenario === 'other-focus') assert.equal(document.activeElement, other);
      else if (scenario === 'modal') assert.equal(scope.modalRef.value.contains(document.activeElement), true);
      else assert.notEqual(document.activeElement, hand, 'round/viewer changes must not force an old hand focus');
      if (scenario !== 'spectator') assert.equal(findAll(root, (node) => hasClass(node, 'character-hand-table'))[0], hand, 'hand viewport remains mounted');
      if (scenario !== 'replacement') assert.equal(findAll(root, (node) => hasClass(node, 'hand-action-dock')).length, 0);
      scope.resetRoomContext();
    });
  }
  for (const blockedState of ['busy', 'offline', 'syncing']) {
    for (const newerFocus of [false, true]) {
      test(`action overlay ${caseId}/${blockedState} recovers disabled focus and respects newer focus=${newerFocus}`, async () => {
        const { stableTableSnapshot } = await import('./helpers/stable-table-fixtures.js');
        const original = stableTableSnapshot(caseId, 'claim').state;
        const { scope, root } = setup({ initialState: original });
        await settle();
        const hasClass = (node, name) => String(node.props.class || '').split(/\s+/).includes(name);
        const dock = findAll(root, (node) => hasClass(node, 'hand-action-dock'))[0];
        const hand = findAll(root, (node) => hasClass(node, 'character-hand-table'))[0];
        const target = findAll(dock, (node) => node.tag === 'button' && !node.disabled)[0];
        const other = findAll(root, (node) => node.tag === 'button' && !dock.contains(node) && !hand.contains(node))[0];
        assert.ok(target && hand && other);
        target.focus();
        scope[blockedState].value = true;
        // DOM已禁用，但恢复watch的nextTick还没运行时移焦；旧watch不能抢回来。
        // Move focus after DOM disabling but before the recovery continuation, so the old watcher must yield.
        if (newerFocus) Vue.queuePostFlushCb(() => other.focus());
        await settle();
        assert.equal(target.disabled, true, 'the real component applies its existing blocked guard');
        assert.equal(target.isConnected, true, 'the disabled action still exists in this first update');
        assert.equal(document.activeElement, newerFocus ? other : hand);
        if (!newerFocus) assert.deepEqual(hand.focusOptions, { preventScroll: true });
        const next = structuredClone(original);
        next.game.legalActions = [];
        scope.state.value = next;
        await settle();
        assert.equal(target.isConnected, false);
        assert.equal(document.activeElement, newerFocus ? other : hand, 'later removal cannot strand or steal focus');
        assert.equal(findAll(root, (node) => hasClass(node, 'character-hand-table'))[0], hand);
        scope.resetRoomContext();
      });
    }
  }
}
