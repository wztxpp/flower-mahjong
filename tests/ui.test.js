import * as ChengduEventTextModule from '../src/chengdu-event-text.js';
// 注入与真实 App 相同的开局配置模块，保证测试装载器不会漏掉新增依赖。
// Inject the same start-options module as the actual App so the test loader includes its new dependency.
import * as StartOptionsModule from "../shared/start-options.js";
import * as ChengduRoomSettingsModule from "../shared/chengdu-room-settings.js";
// 编译真实 Vue 组件，验证服务端渲染、模拟浏览器交互与异步换桌边界。
// Compile real Vue components to test SSR, simulated browser interactions and asynchronous room changes.
// 阅读说明见 docs/TESTING-READING-GUIDE.md；固定种子与凭证仅为测试，不应移入真实用户数据。
// See docs/TESTING-READING-GUIDE.md; seeded data and test credentials must stay separate from real user data.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as Vue from "vue";
import * as CharacterAudioModule from "../src/character-audio.js";
import * as CharacterPortraitModule from "../src/character-portraits.js";
import * as MotionCatalog from '../src/portrait-motion/catalog.js';
import * as MotionLoader from '../src/portrait-motion/loader.js';
import * as MotionSettings from '../src/portrait-motion/settings.js';
import * as MotionController from '../src/portrait-motion/controller.js';
import * as SharedPlaybackModule from "../src/shared-playback.js";
import * as MahjongPhotoModule from "../src/mahjong-photo-faces.js";
import * as MahjongPresentationModule from "../src/mahjong-tile-presentation.js";
import * as MahjongWanModule from "../src/mahjong-wan-faces.js";
import * as Renderer from "vue/server-renderer";
import { parse, compileScript, compileTemplate } from "@vue/compiler-sfc";
import { getPlayerView } from "../shared/game.js";
import { postHuKongGame } from "./fixtures/post-hu-kong.js";
import { postHuWinClaim } from "./fixtures/post-hu-win.js";
import { createApi } from "../server/api.js";
import { MemoryStore } from "../server/store.js";
import { continuePresentedGame } from "../shared/game.js";

// Compile the actual SFCs so these checks exercise the shipped template and setup,
// rather than maintaining a separate presentation model in the tests.
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
    ssr: true,
    ssrCssVars: [],
    compilerOptions: {
      bindingMetadata: script.bindings,
    },
  });
  assert.deepEqual(template.errors, []);
  const modules = {
    vue: {
      ...Vue,
      onMounted() {},
      onUnmounted() {},
    },
    "vue/server-renderer": Renderer,
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
  component.ssrRender = new Function(
    "modules",
    `${load(template.code).replace("export function ssrRender", "function ssrRender")}\nreturn ssrRender;`,
  )(modules);
  return component;
}
const Tile = compileComponent("MahjongTile.vue", {
  "./mahjong-tile-presentation.js": MahjongPresentationModule,
});
const Icon = compileComponent("Icon.vue");
const CharacterArtwork = compileComponent('CharacterArtwork.vue', {
  './portrait-motion/settings.js': MotionSettings,
  './portrait-motion/catalog.js': MotionCatalog,
  './portrait-motion/loader.js': MotionLoader,
  './portrait-motion/controller.js': MotionController,
});
const ChengduTable = compileComponent("ChengduTable.vue", {
  './CharacterArtwork.vue': CharacterArtwork,
  "./chengdu-event-text.js": ChengduEventTextModule,
  "./MahjongTile.vue": Tile,
  "./mahjong-tile-presentation.js": MahjongPresentationModule,
});
const PortraitMotionSettings = compileComponent('PortraitMotionSettings.vue', { './portrait-motion/settings.js': MotionSettings });
const App = compileComponent("App.vue", {
  "./PortraitMotionSettings.vue": PortraitMotionSettings,
  './CharacterArtwork.vue': CharacterArtwork,
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
// 保存原始全局对象；文件结束后恢复，避免浏览器替身污染其他场景。
// Save original globals for restoration after this file so browser substitutes do not leak.
const originals = Object.fromEntries(
  [
    "window",
    "document",
    "sessionStorage",
    "localStorage",
    "fetch",
    "setTimeout",
    "clearTimeout",
  ].map((key) => [key, globalThis[key]]),
);
let scheduled = [];
// 安装可控的浏览器存储、位置、事件和定时器替身；blocked/malformed 专门覆盖浏览器拒绝或损坏存储。
// Install controllable storage/location/events/timers; blocked/malformed cover unavailable or corrupted browser storage.
function browser({
  search = "",
  active = null,
  rooms = null,
  profile = "a".repeat(64),
  blocked = false,
  malformed = false,
} = {}) {
  scheduled = [];
  const sessionItems = new Map();
  const localItems = new Map();
  const storage = (items) => ({
    getItem(key) {
      // 故意模拟浏览器拒绝存储，让界面处理异常路径而不是依赖始终可用的存储。
      // Deliberately simulate denied browser storage to exercise the UI failure path.
      if (blocked) throw new Error("Storage blocked");
      return items.get(key) ?? null;
    },
    setItem(key, value) {
      // 故意模拟浏览器拒绝存储，让界面处理异常路径而不是依赖始终可用的存储。
      // Deliberately simulate denied browser storage to exercise the UI failure path.
      if (blocked) throw new Error("Storage blocked");
      items.set(key, value);
    },
    removeItem(key) {
      // 故意模拟浏览器拒绝存储，让界面处理异常路径而不是依赖始终可用的存储。
      // Deliberately simulate denied browser storage to exercise the UI failure path.
      if (blocked) throw new Error("Storage blocked");
      items.delete(key);
    },
  });
  // 仅在本场景明确有保存座位时写入会话存储，覆盖首次访问与回访的区别。
  // Populate saved-seat storage only when this scenario supplies an active credential.
  if (active)
    sessionItems.set("huajian-mahjong-session-v1", JSON.stringify(active));
  // 仅在提供旧房间列表时写入，保留没有历史房间缓存的情况。
  // Populate room-history storage only when supplied, retaining the no-cache case.
  if (rooms)
    sessionItems.set("huajian-mahjong-rooms-v2", JSON.stringify(rooms));
  // 故意写入无效 JSON，验证读取失败不会让大厅崩溃或永久恢复中。
  // Insert invalid JSON deliberately to verify the lobby survives corrupt stored data.
  if (malformed) sessionItems.set("huajian-mahjong-session-v1", "{bad json");
  // 有个人凭证才写入本地存储；缺少凭证的测试需要走初始化流程。
  // Store a profile credential only when present; missing-profile tests must exercise bootstrap.
  if (profile)
    localItems.set("huajian-mahjong-player-v1", JSON.stringify(profile));
  const events = new Map();
  const setLocation = (value) => {
    const url = new URL(value, "https://example.test");
    Object.assign(globalThis.window.location, {
      search: url.search,
      href: url.href,
      origin: url.origin,
      pathname: url.pathname,
    });
  };
  globalThis.window = {
    location: {},
    history: {
      replaceState(a, b, url) {
        setLocation(url);
      },
      pushState(a, b, url) {
        setLocation(url);
      },
    },
    addEventListener(name, fn) {
      events.set(name, fn);
    },
    removeEventListener(name) {
      events.delete(name);
    },
  };
  setLocation(`https://example.test/play${search}`);
  globalThis.document = {
    hidden: false,
    body: {
      style: {},
    },
    activeElement: {
      blur() {},
    },
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.sessionStorage = window.sessionStorage = storage(sessionItems);
  globalThis.localStorage = window.localStorage = storage(localItems);
  globalThis.setTimeout = (callback, delay) => {
    scheduled.push({
      callback,
      delay,
      cancelled: false,
    });
    return scheduled.length;
  };
  globalThis.clearTimeout = (id) => {
    // 定时器 ID 仍对应记录时才标记取消，模拟清理已登记任务而不创建新任务。
    // Cancel only an existing timer record, without inventing a timer for an unknown ID.
    if (scheduled[id - 1]) scheduled[id - 1].cancelled = true;
  };
  return {
    sessionItems,
    localItems,
    setLocation,
    events,
  };
}
// 生成虚构座位凭证；固定字符仅用于测试，不是生产凭证生成方式。
// Generate a synthetic seat credential; repeated characters are not production credential generation.
const credential = (roomId = "ABCDEF23", token = "b".repeat(64)) => ({
  roomId,
  token,
  name: "本人的名字",
});
// 模拟 fetch 响应的状态和异步 JSON 正文，不发起网络请求。
// Mock fetch status and async JSON body without sending a network request.
const response = (data, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => data,
});
// 为音画同步测试提供公开、合成的展示快照；不包含真实房间或对手手牌。
// Supply a public synthetic presentation snapshot, without real rooms or concealed opponent tiles.
function presentationFixture(scope, type = "hu") {
  // 此夹具只控制页面协调；真实音源在独立音频测试中验证，默认模拟已解锁且立即结束。
  // This fixture isolates page coordination; audio tests cover real sources, while the default here is unlocked and complete.
  scope.characterAudio.unlocked = true;
  scope.characterAudio.context = { state: "running" };
  scope.characterAudio.enqueueLive = () => Promise.resolve();
  scope.characterAudio.warmWins = () => Promise.resolve();
  const initial = fixture({ schemaVersion: 3 });
  initial.game.id = "playback-game";
  scope.applyState(initial);
  const next = structuredClone(initial);
  next.revision++;
  next.game.history.push({ type, seat: 0, tile: 0, source: "selfDraw" });
  next.presentation = {
    id: "playback-one", gameId: "playback-game", requiredSeats: [0, 1, 2],
    completedSeats: [], remainingMs: 40000,
  };
  return next;
}
// 生成没有已结算局的个人历史响应，供大厅与重连测试使用。
// Build empty profile history for lobby/reconnection tests.
const emptyHistory = () => ({
  summary: {
    settledGames: 0,
    totalScore: 0,
  },
  records: [],
});
// 等待有限轮微任务，使模拟请求及响应式回调完成；不进行真实网络等待。
// Drain a bounded number of microtasks so mocked requests/reactive callbacks finish, without real network waits.
async function settle() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
// 直接调用 App.setup 获取大厅响应式状态；挂载副作用由测试环境替代。
// Call App.setup for reactive lobby state; the harness substitutes mounting side effects.
function lobby() {
  return App.setup(
    {},
    {
      expose() {},
    },
  );
}
// 按本文件的参数构造场景；规则版本、手牌与牌墙由各测试显式选择。不要把 UI 快照误当成完整引擎状态。
// Build the local scenario from its parameters; each test chooses rules, hands and wall. A UI snapshot is not a complete engine state.
function fixture({
  legacy = false,
  postHu = false,
  schemaVersion = legacy ? 1 : 2,
} = {}) {
  const players = [0, 1, 2].map((seat) => ({
    seat,
    handCount: 13,
    huCount: 0,
    score: 0,
    hand: seat === 0 ? [0, 1, 2, 3] : undefined,
    melds: [],
    radishes: [],
    winPile: [],
  }));
  // 给界面夹具补上已胡标记和胡牌记录，模拟胡后手牌锁定而非普通回合。
  // Mark the UI fixture as previously won to model post-win hand locking rather than an ordinary turn.
  if (postHu) {
    players[0].huCount = 1;
    players[0].winPile = [
      {
        tile: 3,
        source: "discard",
        virtual: false,
      },
    ];
  }
  return {
    id: "ABCDEF23",
    revision: 3,
    you: 0,
    hostSeat: 0,
    phase: "playing",
    seats: players.map((player) => ({
      seat: player.seat,
      name: `牌友${player.seat + 1}`,
      connected: true,
    })),
    game: {
      schemaVersion,
      players,
      phase: "turn",
      turnStep: legacy ? "draw" : "discard",
      currentSeat: 0,
      drawnTile: legacy ? null : 3,
      wallCount: 70,
      discards: [],
      history: [],
      lockedWaits: [],
      legalActions: legacy
        ? [
            {
              type: "draw",
            },
          ]
        : postHu
          ? [
              {
                type: "hu",
              },
              {
                type: "pass",
              },
              {
                type: "discard",
                tile: 3,
              },
            ]
          : [
              {
                type: "discard",
                tile: 0,
              },
            ],
      huDiagnostic: {
        canHu: postHu,
        code: postHu ? "AVAILABLE" : "SHAPE",
        message: postHu ? "当前可以胡牌。" : "当前牌型还不满足胡牌条件。",
      },
    },
  };
}
// 准备模拟浏览器并把场景注入组件响应式状态，返回供交互和渲染检查的 scope。
// Prepare the mock browser, inject scenario state and return the scope used for interaction/render checks.
function setup(state) {
  browser();
  const scope = App.setup(
    {},
    {
      expose() {},
    },
  );
  scope.session.value = credential();
  scope.state.value = state;
  return scope;
}
// 用真实 Vue 服务端渲染把测试 scope 转为 HTML；这验证标记内容，不测浏览器布局。
// Use real Vue SSR to render the test scope as HTML; this checks markup, not browser layout.
async function render(scope) {
  return Renderer.renderToString(
    Vue.createSSRApp({
      ...App,
      setup: () => scope,
    }),
  );
}
after(() => {
  // 逐项覆盖 Object.entries(originals)；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in Object.entries(originals) with the same checks, preserving the listed order.
  for (const [key, value] of Object.entries(originals)) globalThis[key] = value;
});
// 场景：新版牌桌使用冻结手牌决策，显示胡牌区及本人私有诊断
// Scenario: new board uses frozen-hand decisions, a visible win pile and own private diagnostic
test("new board uses frozen-hand decisions, a visible win pile and own private diagnostic", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const scope = setup(
    fixture({
      postHu: true,
    }),
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.state.value.game.players[1].winPile = [
    {
      tile: 16,
      source: "discard",
      virtual: true,
    },
  ];
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  const html = await render(scope);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.match(html, /胡后固定/);
  assert.match(html, /不胡 \/ 过 · 打出新牌/);
  assert.match(html, /共胡记牌，不另算实物牌/);
  assert.match(html, /查看当前胡牌判断|当前可以胡牌/);
  assert.match(html, /仅自己可见/);
  assert.doesNotMatch(html, /选牌后打出|摸一张/);
});
// 场景：旧版牌桌保留摸牌控件，并在同一标签页切换牌桌
// Scenario: legacy board keeps draw control and switches tables in the same tab
test("legacy board keeps draw control and switches tables in the same tab", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const scope = setup(
    fixture({
      legacy: true,
    }),
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const html = await render(scope);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.match(html, /本桌已开局，继续使用旧规则/);
  assert.match(html, /离开旧桌，返回大厅换新桌/);
  // 换桌必须留在本页；官方许可链接另开页不应被这条导航合同误禁。
  // Room switching stays in this tab; official-license links may open separately without violating navigation.
  const leaveControl = html.match(/<button[^>]*class="[^"]*leave-table-button[^"]*"[^>]*>[\s\S]*?<\/button>/)?.[0];
  assert.ok(leaveControl);
  assert.doesNotMatch(leaveControl, /target="_blank"/);
  assert.match(html, /摸一张/);
  assert.doesNotMatch(html, /胡后固定|查看当前胡牌判断/);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.showRules.value = true;
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  const rules = await render(scope);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.match(rules, /本桌旧规则/);
  assert.doesNotMatch(rules, /三个牌区，每次胡都重算番/);
});
// 场景：萝卜总数区别于最近增量，第五张加杠保留五张牌
// Scenario: radish total differs from the latest increment, and fifth kong retains five tiles
test("radish total differs from the latest increment, and fifth kong retains five tiles", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const state = fixture();
  state.game.players[0].radishes = [0, 1, 2, 3, 4, 5, 6, 7];
  state.game.players[0].melds = [
    {
      type: "buGang",
      tiles: [3, 3, 3, 3, 3],
    },
  ];
  state.game.history = [
    {
      revision: 1,
      type: "anGang",
      seat: 0,
      radish: 1,
      message: "暗杠",
    },
    {
      revision: 2,
      type: "hu",
      seat: 0,
      newRadishes: [2, 3, 4, 5, 6, 7],
      message: "胡",
    },
  ];
  const scope = setup(state);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const html = await render(scope);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.match(html, /共 8 张/);
  assert.match(html, /首胡 \+6/);
  assert.match(html, /补杠 · 5 张/);
  assert.equal(scope.radishIncrement(0), 6);
  assert.match(
    scope.scoreSummary({
      fan: 5,
      fanPoints: 10,
      radishBonus: 4,
      dragonBonus: 0,
      total: 14,
    }),
    /5 番 10 分 \+ 萝卜 4/,
  );
});
// 场景：三家均胡的结束状态单独呈现，精简新规则包含已确认番值
// Scenario: all-player hu ends distinctly and compact new rules contain confirmed fan values
test("all-player hu ends distinctly and compact new rules contain confirmed fan values", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const state = fixture();
  state.phase = "finished";
  state.game.phase = "finished";
  state.game.finishReason = "allPlayersHu";
  state.game.legalActions = [];
  const scope = setup(state);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.showRules.value = true;
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  const html = await render(scope);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.match(html, /所有玩家都胡了，本局结束/);
  assert.match(html, /5 番 10 分 · 6 番 12 分 · 7 番 14 分/);
  assert.match(html, /暂不叠加番分、萝卜和神龙/);
});
// 场景：八筒与一条鸟牌使用正确的原始照片牌面
// Scenario: eight circles and the bamboo bird use the correct original photo faces
test("eight circles and the bamboo bird use the correct original photo faces", async () => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const circles = await Renderer.renderToString(
    Vue.createSSRApp(Tile, {
      tile: 16,
    }),
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.match(circles, /href="\/assets\/tiles\/mahjong-faces-20261107\.png"/);
  assert.ok(circles.includes(MahjongPhotoModule.photoFaceTransform(16)));
  assert.match(circles, /aria-label="8筒"/);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const bamboo = await Renderer.renderToString(
    Vue.createSSRApp(Tile, {
      tile: 0,
    }),
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.ok(bamboo.includes(MahjongPhotoModule.photoFaceTransform(0)));
  assert.match(bamboo, /aria-label="1条"/);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const back = await Renderer.renderToString(
    Vue.createSSRApp(Tile, {
      tile: 16,
      back: true,
    }),
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.doesNotMatch(back, /mahjong-faces-20261107|<image/);
  assert.match(back, /aria-label="背面牌"/);
});
// 实际编译的组件必须选用独立万牌原图，且保留手牌按钮与小牌河的原有语义。
// The compiled component must select the wan atlas and preserve hand-button/small-river semantics.
test("all nine wan tiles use their own atlas, crop, label and button state", async () => {
  for (let tile = 18; tile <= 26; tile++) {
    for (const small of [false, true]) {
      const html = await Renderer.renderToString(Vue.createSSRApp(Tile, {
        tile, small, interactive: true, selected: true, disabled: true,
      }));
      assert.match(html, /<button/);
      assert.match(html, /aria-pressed="true"/);
      assert.match(html, /disabled/);
      assert.ok(html.includes(`aria-label="${tile - 17}万"`));
      assert.ok(html.includes(`title="${tile - 17}万"`));
      assert.ok(html.includes(`href="${MahjongWanModule.MAHJONG_WAN_URL}"`));
      assert.ok(html.includes(`width="${MahjongWanModule.MAHJONG_WAN_WIDTH}"`));
      assert.ok(html.includes(`height="${MahjongWanModule.MAHJONG_WAN_HEIGHT}"`));
      assert.ok(html.includes(MahjongWanModule.wanFaceTransform(tile)));
      assert.equal(html.includes("tile-small"), small);
      assert.doesNotMatch(html, /mahjong-faces-20261107\.png/);
    }
  }
});

// 背面不能在图片、title或读屏标签泄漏万牌；非法输入保持空白而不是强转为牌种。
// Backs must not reveal wan through images/tooltips/accessibility; invalid input stays blank without coercion.
test("wan backs and invalid tile identities expose no face or rank", async () => {
  for (let tile = 18; tile <= 26; tile++) {
    const html = await Renderer.renderToString(Vue.createSSRApp(Tile, { tile, back: true }));
    assert.match(html, /aria-label="背面牌"/);
    assert.match(html, /title="背面牌"/);
    assert.doesNotMatch(html, /<image|mahjong-wan|[1-9]万/);
  }
  for (const tile of [null, -1, 18.5, 27, NaN, Infinity]) {
    const html = await Renderer.renderToString(Vue.createSSRApp(Tile, { tile }));
    assert.match(html, /aria-label="空白牌"/);
    assert.doesNotMatch(html, /<image|mahjong-wan|[1-9]万/);
  }
});

// 每个旧牌种逐一核对原始裁切，不用几个抽样替代18张牌的兼容边界。
// Check every old crop rather than treating a few samples as the full eighteen-face compatibility boundary.
test("all original tile faces preserve their atlas, crop and accessible label", async () => {
  for (let tile = 0; tile < 18; tile++) {
    const html = await Renderer.renderToString(Vue.createSSRApp(Tile, { tile }));
    assert.ok(html.includes(`href="${MahjongPhotoModule.MAHJONG_PHOTO_URL}"`));
    assert.ok(html.includes(MahjongPhotoModule.photoFaceTransform(tile)));
    assert.ok(html.includes(`aria-label="${tile % 9 + 1}${tile < 9 ? "条" : "筒"}"`));
    assert.doesNotMatch(html, /mahjong-wan/);
  }
});

// 场景：未变化轮询保留手牌快照，仅应用连接状态标记
// Scenario: unchanged polling preserves the hand snapshot and only applies connection flags
test("unchanged polling preserves the hand snapshot and only applies connection flags", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const scope = setup(fixture());
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const gameBefore = scope.state.value.game;
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let requested;
  globalThis.fetch = async (url) => {
    requested = url;
    return {
      ok: true,
      json: async () => ({
        unchanged: true,
        revision: 3,
        connections: [true, false, true],
      }),
    };
  };
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.refresh();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(requested, "/api/rooms/ABCDEF23?since=3");
  assert.equal(scope.state.value.game, gameBefore);
  assert.equal(scope.seats.value[1].connected, false);
  assert.ok(scheduled.at(-1).delay >= 80 && scheduled.at(-1).delay <= 350);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  globalThis.document.hidden = true;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.pollInterval(), 3000);
});
// 场景：成功动作直接采用权威响应，不再发第二次 GET
// Scenario: successful action uses its authoritative response without a second GET
test("successful action uses its authoritative response without a second GET", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const scope = setup(fixture());
  const calls = [];
  const next = fixture();
  next.revision = 4;
  next.game.currentSeat = 1;
  globalThis.fetch = async (url, options) => {
    calls.push({
      url,
      method: options.method,
    });
    return {
      ok: true,
      json: async () => ({
        state: next,
      }),
    };
  };
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.mutate({
    type: "discard",
    tile: 0,
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(
    calls.map((call) => call.method),
    ["POST"],
  );
  assert.equal(scope.state.value.revision, 4);
  assert.equal(scope.game.value.currentSeat, 1);
  assert.equal(scope.busy.value, false);
});
// 场景：修订号冲突时先同步，再允许下一动作
// Scenario: revision conflicts synchronise before allowing another action
test("revision conflicts synchronise before allowing another action", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const scope = setup(fixture());
  const calls = [];
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  globalThis.fetch = async (url, options) => {
    calls.push(options.method);
    // 把写请求与读请求分开模拟，以便检查写入次数和重复提交。
    // Mock writes separately from reads to verify mutation counts and duplicate submissions.
    if (options.method === "POST")
      return {
        ok: false,
        status: 409,
        json: async () => ({
          error: "stale",
        }),
      };
    assert.equal(scope.syncing.value, true);
    await scope.mutate({
      type: "discard",
      tile: 0,
    });
    const next = fixture();
    next.revision = 4;
    return {
      ok: true,
      json: async () => ({
        state: next,
      }),
    };
  };
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.mutate({
    type: "discard",
    tile: 0,
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(calls, ["POST", "GET"]);
  assert.equal(scope.syncing.value, false);
  assert.equal(scope.state.value.revision, 4);
});
// 场景：未变化的未满员大厅响应忽略空座位，不进入离线状态
// Scenario: unchanged partial-lobby response ignores empty seats without entering offline state
test("unchanged partial-lobby response ignores empty seats without entering offline state", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const state = fixture();
  state.phase = "lobby";
  state.game = null;
  state.seats = [state.seats[0], null, null];
  const scope = setup(state);
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      unchanged: true,
      revision: 3,
      connections: [true, false, false],
    }),
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.refresh();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.offline.value, false);
  assert.equal(scope.filledSeats.value, 1);
  assert.ok(scheduled.at(-1).delay > 900 && scheduled.at(-1).delay <= 1000);
});
// 场景：交叠的刷新尝试不会产生交叠的 GET 请求
// Scenario: overlapping refresh attempts never issue overlapping GET requests
test("overlapping refresh attempts never issue overlapping GET requests", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const scope = setup(fixture());
  let release;
  let reads = 0;
  globalThis.fetch = () => {
    reads++;
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const first = scope.refresh();
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  await scope.refresh();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(reads, 1);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  release({
    ok: true,
    json: async () => ({
      unchanged: true,
      revision: 3,
      connections: [true, true, true],
    }),
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await first;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.offline.value, false);
});
// 场景：动作结果不确定时回读状态，绝不自动重复提交
// Scenario: uncertain action outcome is read back, never automatically repeated
test("uncertain action outcome is read back, never automatically repeated", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const scope = setup(fixture());
  const calls = [];
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  globalThis.fetch = async (url, options) => {
    calls.push(options.method);
    // 把写请求与读请求分开模拟，以便检查写入次数和重复提交。
    // Mock writes separately from reads to verify mutation counts and duplicate submissions.
    if (options.method === "POST")
      throw new TypeError("network failed after submission");
    assert.equal(scope.syncing.value, true);
    const next = fixture();
    next.revision = 4;
    next.game.currentSeat = 1;
    return {
      ok: true,
      json: async () => ({
        state: next,
      }),
    };
  };
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.mutate({
    type: "discard",
    tile: 0,
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(calls, ["POST", "GET"]);
  assert.equal(scope.offline.value, false);
  assert.equal(scope.syncing.value, false);
  assert.equal(scope.game.value.currentSeat, 1);
  assert.equal(scope.error.value, "牌局已同步，请查看最新牌面后继续。");
});
// 场景：根页面存在已保存旧会话时立即渲染大厅，绝不自动恢复或轮询旧房间
// Scenario: root with a saved legacy session renders the lobby immediately, never resumes or polls it
test("root with a saved legacy session renders the lobby immediately, never resumes or polls it", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const storage = browser({
    active: credential(),
  });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({
      url,
      options,
    });
    return response(
      url === "/api/profile"
        ? {
            playerToken: "a".repeat(64),
          }
        : url.endsWith("/history")
          ? emptyHistory()
          : {
              left: true,
            },
    );
  };
  const scope = lobby();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.initialize();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.inRoom.value, false);
  assert.equal(scope.restoring.value, false);
  assert.equal(scope.busy.value, false);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await settle();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(
    calls.map((call) => call.url),
    ["/api/profile", "/api/rooms/ABCDEF23/leave", "/api/profile/history"],
  );
  assert.equal(scope.session.value, null);
  assert.equal(scope.roomCode.value, "");
  assert.equal(storage.sessionItems.has("huajian-mahjong-session-v1"), false);
  assert.equal(
    JSON.parse(storage.sessionItems.get("huajian-mahjong-rooms-v2")).ABCDEF23
      .token,
    credential().token,
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const html = await render(scope);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.match(html, /创建一张牌桌/);
  assert.doesNotMatch(html, /恢复上一桌|正在回到牌桌/);
});
// 场景：B 房间邀请优先于已保存的进行中 A 房间，不意外恢复 A
// Scenario: an invitation for B takes precedence over the saved active A, with no accidental A resume
test("an invitation for B takes precedence over the saved active A, with no accidental A resume", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  browser({
    active: credential(),
    search: "?room=GHJKLM23",
  });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({
      url,
      options,
    });
    return response(
      url === "/api/profile"
        ? {
            playerToken: "a".repeat(64),
          }
        : url.endsWith("/history")
          ? emptyHistory()
          : {
              left: true,
            },
    );
  };
  const scope = lobby();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.initialize();
  await settle();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.entryMode.value, "join");
  assert.equal(scope.roomCode.value, "GHJKLM23");
  assert.equal(scope.inRoom.value, false);
  assert.equal(calls.filter((call) => call.url.includes("/resume")).length, 0);
  assert.deepEqual(
    calls
      .filter((call) => call.url.includes("/rooms/"))
      .map((call) => call.url),
    ["/api/rooms/ABCDEF23/leave"],
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.name.value = "另一名字";
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  globalThis.fetch = async (url, options) => {
    calls.push({
      url,
      options,
    });
    const state = fixture();
    state.id = "GHJKLM23";
    return response({
      roomId: state.id,
      token: "c".repeat(64),
      state,
    });
  };
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.enterRoom();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.session.value.roomId, "GHJKLM23");
  assert.equal(window.location.search, "?room=GHJKLM23");
  assert.equal(calls.at(-1).options.headers.Authorization, undefined);
});
// 场景：显式刷新同房间时，只恢复其准确保存的座位令牌
// Scenario: explicit same-room refresh resumes only its exact stored seat token
test("explicit same-room refresh resumes only its exact stored seat token", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const correct = credential();
  const wrong = credential("GHJKLM23", "c".repeat(64));
  browser({
    active: wrong,
    rooms: {
      ABCDEF23: correct,
      GHJKLM23: wrong,
    },
    search: "?room=abcdef23",
  });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({
      url,
      options,
    });
    return response(
      url === "/api/profile"
        ? {
            playerToken: "a".repeat(64),
          }
        : url.endsWith("/resume")
          ? {
              state: fixture(),
            }
          : {
              left: true,
            },
    );
  };
  const scope = lobby();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.initialize();
  await settle();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.inRoom.value, true);
  assert.equal(scope.session.value.token, correct.token);
  assert.deepEqual(
    calls.filter((call) => call.url !== "/api/profile").map((call) => call.url),
    ["/api/rooms/GHJKLM23/leave", "/api/rooms/ABCDEF23/resume"],
  );
  assert.equal(calls[1].options.headers.Authorization, `Bearer ${wrong.token}`);
  assert.equal(
    calls[2].options.headers.Authorization,
    `Bearer ${correct.token}`,
  );
});
// 场景：返回大厅关闭浮层、释放焦点、重置控件，仅保留显式重连所需凭证
// Scenario: returning to the lobby closes overlays, releases focus, resets controls, and retains only explicit reconnect credentials
test("returning to the lobby closes overlays, releases focus, resets controls, and retains only explicit reconnect credentials", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const scope = setup(fixture());
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.playerToken.value = "a".repeat(64);
  scope.saveSession(credential());
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let blurred = false;
  document.activeElement = {
    blur() {
      blurred = true;
    },
  };
  document.body.style.overflow = "hidden";
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.showRules.value = true;
  scope.showInvite.value = true;
  scope.copyDone.value = true;
  scope.busy.value = true;
  scope.syncing.value = true;
  scope.offline.value = true;
  scope.error.value = "old error";
  scope.selectedTile.value = 0;
  scope.selectedHandIndex.value = 0;
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({
      url,
      options,
    });
    return response(
      url === "/api/profile"
        ? {
            playerToken: "a".repeat(64),
          }
        : url.endsWith("/history")
          ? emptyHistory()
          : {
              left: true,
            },
    );
  };
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.newTable();
  await settle();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 逐项覆盖 ['showRules','showInvite','copyDone','busy','syncing','offline','restoring','inRoom']；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in ['showRules','showInvite','copyDone','busy','syncing','offline','restoring','inRoom'] with the same checks, preserving the listed order.
  for (const key of [
    "showRules",
    "showInvite",
    "copyDone",
    "busy",
    "syncing",
    "offline",
    "restoring",
    "inRoom",
  ])
    assert.equal(scope[key].value, false, key);
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.equal(scope.error.value, "");
  assert.equal(scope.selectedTile.value, null);
  assert.equal(scope.selectedHandIndex.value, null);
  assert.equal(document.body.style.overflow, "");
  assert.equal(blurred, true);
  assert.equal(scope.savedRooms.get("ABCDEF23").token, credential().token);
  assert.equal(calls[0].url, "/api/rooms/ABCDEF23/leave");
  assert.equal(
    calls[0].options.headers.Authorization,
    `Bearer ${credential().token}`,
  );
});
// 场景：迟到的轮询响应不能在返回大厅后恢复牌桌
// Scenario: late polling response cannot restore a table after returning to the lobby
test("late polling response cannot restore a table after returning to the lobby", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const scope = setup(fixture());
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.playerToken.value = "a".repeat(64);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let release;
  let signal;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  globalThis.fetch = (url, options) => {
    // 只拦截房间读取，保留其他请求路径，用于观察刷新是否重叠。
    // Intercept room reads specifically while preserving other paths to observe refresh overlap.
    if (options.method === "GET" && url.includes("/rooms/")) {
      signal = options.signal;
      return new Promise((resolve) => {
        release = resolve;
      });
    }
    return Promise.resolve(
      response(
        url === "/api/profile"
          ? {
              playerToken: "a".repeat(64),
            }
          : url.endsWith("/history")
            ? emptyHistory()
            : {
                left: true,
              },
      ),
    );
  };
  const pending = scope.refresh();
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  await scope.newTable();
  await settle();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(signal.aborted, true);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  release(
    response({
      state: fixture(),
    }),
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await pending;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.state.value, null);
  assert.equal(scope.session.value, null);
  assert.equal(scope.inRoom.value, false);
  assert.equal(
    scheduled.filter(
      (task) => !task.cancelled && task.callback === scope.refresh,
    ).length,
    0,
  );
});
// 场景：迟到的修改成功或失败不能重置更新的大厅状态或重启轮询
// Scenario: late mutation success and failure cannot reset a newer lobby state or restart polling
test("late mutation success and failure cannot reset a newer lobby state or restart polling", async () => {
  // 核对事件消费或播放顺序；未提交、过期与已消费事件不应重复播报。
  // Check event consumption/playback order; uncommitted, expired or consumed events must not replay.
  // 逐项覆盖 [true,false]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [true,false] with the same checks, preserving the listed order.
  for (const succeeds of [true, false]) {
    const scope = setup(fixture());
    scope.playerToken.value = "a".repeat(64);
    let release;
    let reject;
    let signal;
    globalThis.fetch = (url, options) => {
      // 把动作请求与轮询请求分开模拟，便于延迟或拒绝特定写入的响应。
      // Mock action requests separately from polling to delay/reject a specific write response.
      if (url.endsWith("/action")) {
        signal = options.signal;
        return new Promise((resolve, fail) => {
          release = resolve;
          reject = fail;
        });
      }
      return Promise.resolve(
        response(
          url === "/api/profile"
            ? {
                playerToken: "a".repeat(64),
              }
            : url.endsWith("/history")
              ? emptyHistory()
              : {
                  left: true,
                },
        ),
      );
    };
    const pending = scope.mutate({
      type: "discard",
      tile: 0,
    });
    await scope.newTable();
    await settle();
    scope.error.value = "new lobby feedback";
    scope.busy.value = true;
    // 按参数选择复制成功或失败，验证对应反馈和降级路径。
    // Select copy success/failure according to the case to test feedback and fallback.
    if (succeeds)
      release(
        response({
          state: fixture(),
        }),
      );
    else reject(new TypeError("late network failure"));
    await pending;
    assert.equal(signal.aborted, true);
    assert.equal(scope.state.value, null);
    assert.equal(scope.busy.value, true);
    assert.equal(scope.error.value, "new lobby feedback");
    assert.equal(scope.offline.value, false);
    assert.equal(
      scheduled.filter(
        (task) => !task.cancelled && task.callback === scope.refresh,
      ).length,
      0,
    );
  }
});
// 场景：迟到的建房响应会执行离席清理，而非打开不再需要的牌桌
// Scenario: late create response is detached instead of opening an unwanted table
test("late create response is detached instead of opening an unwanted table", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  browser();
  const scope = lobby();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.name.value = "我的名字";
  scope.playerToken.value = "a".repeat(64);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let release;
  let signal;
  const calls = [];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  globalThis.fetch = (url, options) => {
    calls.push({
      url,
      options,
    });
    // 此路径代表建桌请求，与具体旧桌的读取/离席区别处理。
    // Treat room creation separately from reading/leaving a particular existing room.
    if (url === "/api/rooms") {
      signal = options.signal;
      return new Promise((resolve) => {
        release = resolve;
      });
    }
    return Promise.resolve(
      response(
        url === "/api/profile"
          ? {
              playerToken: "a".repeat(64),
            }
          : url.endsWith("/history")
            ? emptyHistory()
            : {
                left: true,
              },
      ),
    );
  };
  const entering = scope.enterRoom();
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  await settle();
  await scope.newTable();
  await settle();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(signal.aborted, true);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  release(
    response({
      roomId: "ABCDEF23",
      token: credential().token,
      state: fixture(),
    }),
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await entering;
  await settle();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.inRoom.value, false);
  assert.equal(window.location.search, "");
  assert.equal(scope.busy.value, false);
  assert.equal(calls.filter((call) => call.url.endsWith("/leave")).length, 1);
  assert.equal(
    calls.at(-1).options.headers.Authorization,
    `Bearer ${credential().token}`,
  );
});
// 场景：浏览器前进后退在根页面与指定房间间导航时，先离开再通过身份验证恢复
// Scenario: browser Back and Forward between root and explicit room use leave then authenticated resume
test("browser Back and Forward between root and explicit room use leave then authenticated resume", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const storage = browser({
    search: "?room=ABCDEF23",
    active: credential(),
  });
  const scope = lobby();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({
      url,
      options,
    });
    return response(
      url === "/api/profile"
        ? {
            playerToken: "a".repeat(64),
          }
        : url.endsWith("/resume")
          ? {
              state: fixture(),
            }
          : url.endsWith("/history")
            ? emptyHistory()
            : {
                left: true,
              },
    );
  };
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.initialize();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.inRoom.value, true);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  storage.setLocation("/play");
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.onPopState();
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  await settle();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.inRoom.value, false);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  storage.setLocation("/play?room=ABCDEF23");
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.onPopState();
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  await settle();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.inRoom.value, true);
  assert.deepEqual(
    calls
      .filter((call) => call.url.includes("/rooms/"))
      .map((call) => call.url),
    [
      "/api/rooms/ABCDEF23/resume",
      "/api/rooms/ABCDEF23/leave",
      "/api/rooms/ABCDEF23/resume",
    ],
  );
});
// 场景：导航至根页面后迟到的恢复响应被忽略，并显式执行离席
// Scenario: late resume after navigating to root is ignored and explicitly detached
test("late resume after navigating to root is ignored and explicitly detached", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const storage = browser({
    search: "?room=ABCDEF23",
    active: credential(),
  });
  const scope = lobby();
  let release;
  const calls = [];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  globalThis.fetch = (url, options) => {
    calls.push({
      url,
      options,
    });
    // 识别恢复座位请求，控制其返回时机以复现换桌竞争。
    // Recognize seat-resume requests and control their completion to reproduce navigation races.
    if (url.endsWith("/resume"))
      return new Promise((resolve) => {
        release = resolve;
      });
    return Promise.resolve(
      response(
        url === "/api/profile"
          ? {
              playerToken: "a".repeat(64),
            }
          : url.endsWith("/history")
            ? emptyHistory()
            : {
                left: true,
              },
      ),
    );
  };
  const initializing = scope.initialize();
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  await settle();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.restoring.value, true);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  storage.setLocation("/play");
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.onPopState();
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  await settle();
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  release(
    response({
      state: fixture(),
    }),
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await initializing;
  await settle();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.inRoom.value, false);
  assert.equal(scope.restoring.value, false);
  assert.equal(window.location.search, "");
  assert.equal(calls.filter((call) => call.url.endsWith("/leave")).length, 2); // Immediate detach plus compensation for the late successful resume.
});
// 场景：浏览器存储不可用或格式错误时不会崩溃，也不会使根页面卡在恢复状态
// Scenario: blocked or malformed browser storage never crashes or traps the root in restoring
test("blocked or malformed browser storage never crashes or traps the root in restoring", async () => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 逐项覆盖 [{blocked:true},{malformed:true,profile:null}]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [{blocked:true},{malformed:true,profile:null}] with the same checks, preserving the listed order.
  for (const options of [
    {
      blocked: true,
    },
    {
      malformed: true,
      profile: null,
    },
  ]) {
    browser(options);
    const scope = lobby();
    globalThis.fetch = async (url) =>
      response(
        url === "/api/profile"
          ? {
              playerToken: "d".repeat(64),
            }
          : emptyHistory(),
      );
    await scope.initialize();
    await settle();
    assert.equal(scope.inRoom.value, false);
    assert.equal(scope.restoring.value, false);
    assert.equal(scope.busy.value, false);
    assert.equal(scope.historyLoading.value, false);
    assert.match(scope.storageWarning.value, /浏览器/);
    assert.equal(scope.playerToken.value.length, 64);
  }
});
// 场景：历史将本人已结算总分与暂计牌局分开展示，且不暴露凭证
// Scenario: history shows own finalized totals separately from provisional games and never exposes credentials
test("history shows own finalized totals separately from provisional games and never exposes credentials", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  browser();
  const scope = lobby();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.playerToken.value = "a".repeat(64);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({
      url,
      options,
    });
    return response({
      summary: {
        settledGames: 1,
        totalScore: 18,
      },
      records: [
        {
          gameId: "g2",
          roomId: "GHJKLM23",
          seat: 0,
          name: "改名以后",
          status: "detached",
          score: 7,
          huCount: 1,
          startedAt: Date.now(),
          players: [
            {
              seat: 0,
              name: "改名以后",
              score: 7,
            },
          ],
          events: [
            {
              type: "hu",
              message: "自摸计分",
              delta: 7,
            },
          ],
        },
        {
          gameId: "g1",
          roomId: "ABCDEF23",
          seat: 0,
          name: "原来的名字",
          status: "finished",
          score: 18,
          huCount: 2,
          startedAt: Date.now(),
          players: [],
          events: [],
        },
      ],
    });
  };
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.loadHistory();
  const html = await render(scope);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.match(html, /个人总积分 · 累计已结算/);
  assert.match(html, /\+18/);
  assert.match(html, /已离桌 · 未结算/);
  assert.match(html, /不计入累计已结算积分/);
  assert.match(html, /改名以后/);
  assert.match(html, /原来的名字/);
  assert.match(html, /自摸计分/);
  assert.doesNotMatch(
    html,
    /恢复上一桌|href="[^\"]*room=|aaaaaaaaaaaaaaaa|bbbbbbbbbbbbbbbb/,
  );
  assert.equal(calls[0].url, "/api/profile/history");
  assert.equal(
    calls[0].options.headers.Authorization,
    `Bearer ${"a".repeat(64)}`,
  );
  assert.equal(calls[0].options.headers["X-Player-Token"], undefined);
});
// 场景：进入新牌桌前等待旧房间离开确认，失败时提供可重试反馈
// Scenario: new table entry waits for old leave confirmation, with retryable feedback on failure
test("new table entry waits for old leave confirmation, with retryable feedback on failure", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const scope = setup(fixture());
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.playerToken.value = "a".repeat(64);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let failLeave = true;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({
      url,
      options,
    });
    // 只在指定失败阶段拒绝离席，验证失败后不能贸然进入新桌。
    // Reject departure only during the configured failure phase, checking that entry into a new room waits.
    if (url.endsWith("/leave") && failLeave) throw new TypeError("offline");
    return response(
      url === "/api/profile"
        ? {
            playerToken: "a".repeat(64),
          }
        : url.endsWith("/history")
          ? emptyHistory()
          : url === "/api/rooms"
            ? {
                roomId: "GHJKLM23",
                token: "c".repeat(64),
                state: {
                  ...fixture(),
                  id: "GHJKLM23",
                },
              }
            : {
                left: true,
              },
    );
  };
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.newTable();
  await settle();
  // 准备：构造该变体的规则、牌局或对照快照，保持旧历史与当前输入分离。
  // Arrange this variant’s rules, game or comparison snapshot, keeping saved history separate from current input.
  scope.name.value = "新桌玩家";
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  await scope.enterRoom();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(
    calls.some((call) => call.url === "/api/rooms"),
    false,
  );
  assert.match(scope.error.value, /离桌通知尚未确认/);
  assert.equal(scope.busy.value, false);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  failLeave = false;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.enterRoom();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.inRoom.value, true);
  assert.equal(scope.session.value.roomId, "GHJKLM23");
});
// 场景：已释放的大厅座位凭证被移除，之后通过邀请可重新加入
// Scenario: released lobby credentials are removed and a later invitation allows a new join
test("released lobby credentials are removed and a later invitation allows a new join", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const scope = setup(fixture());
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.playerToken.value = "a".repeat(64);
  scope.saveSession(credential());
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({
      url,
      options,
    });
    return response(
      url.endsWith("/leave")
        ? {
            left: true,
            detached: false,
          }
        : url.endsWith("/history")
          ? emptyHistory()
          : {
              roomId: "ABCDEF23",
              token: "c".repeat(64),
              state: fixture(),
            },
    );
  };
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.newTable();
  await settle();
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  assert.equal(scope.savedRooms.has("ABCDEF23"), false);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.entryMode.value = "join";
  scope.roomCode.value = "ABCDEF23";
  scope.name.value = "再加入";
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  await scope.enterRoom();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(calls.at(-1).url, "/api/rooms/ABCDEF23/join");
  assert.equal(scope.session.value.token, "c".repeat(64));
});
// 场景：显式恢复失败后清除过期座位，下次点击正常加入
// Scenario: expired stored seat is cleared after explicit resume failure, then next click joins normally
test("expired stored seat is cleared after explicit resume failure, then next click joins normally", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  browser();
  const scope = lobby();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.playerToken.value = "a".repeat(64);
  scope.saveSession(credential());
  scope.session.value = null;
  scope.entryMode.value = "join";
  scope.roomCode.value = "ABCDEF23";
  scope.name.value = "再落座";
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({
      url,
      options,
    });
    return url.endsWith("/resume")
      ? response(
          {
            error: "座位凭证失效",
          },
          401,
        )
      : response({
          roomId: "ABCDEF23",
          token: "c".repeat(64),
          state: fixture(),
        });
  };
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.enterRoom();
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  assert.equal(scope.savedRooms.has("ABCDEF23"), false);
  assert.equal(scope.inRoom.value, false);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.enterRoom();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.inRoom.value, true);
  assert.deepEqual(
    calls.map((call) => call.url),
    ["/api/rooms/ABCDEF23/resume", "/api/rooms/ABCDEF23/join"],
  );
});
// 场景：待完成离席在根页面重载后仍保留，创建新房间前必须先完成
// Scenario: pending departure survives root reload and must finish before a new room is created
test("pending departure survives root reload and must finish before a new room is created", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const storage = browser({
    active: credential(),
  });
  const first = lobby();
  let failLeave = true;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({
      url,
      options,
    });
    // 只在指定失败阶段拒绝离席，验证失败后不能贸然进入新桌。
    // Reject departure only during the configured failure phase, checking that entry into a new room waits.
    if (url.endsWith("/leave") && failLeave) throw new TypeError("offline");
    return response(
      url === "/api/profile"
        ? {
            playerToken: "a".repeat(64),
          }
        : url.endsWith("/history")
          ? emptyHistory()
          : url === "/api/rooms"
            ? {
                roomId: "GHJKLM23",
                token: "c".repeat(64),
                state: {
                  ...fixture(),
                  id: "GHJKLM23",
                },
              }
            : {
                left: true,
                detached: true,
              },
    );
  };
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await first.initialize();
  await settle();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(storage.sessionItems.has("huajian-mahjong-session-v1"), false);
  assert.equal(
    JSON.parse(storage.sessionItems.get("huajian-mahjong-departures-v1"))
      .ABCDEF23.token,
    credential().token,
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const reloaded = lobby();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await reloaded.initialize();
  await settle();
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  reloaded.name.value = "新桌";
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await reloaded.enterRoom();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(
    calls.some((call) => call.url === "/api/rooms"),
    false,
  );
  assert.equal(reloaded.inRoom.value, false);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  failLeave = false;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await reloaded.enterRoom();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(reloaded.session.value.roomId, "GHJKLM23");
  assert.equal(
    storage.sessionItems.has("huajian-mahjong-departures-v1"),
    false,
  );
  assert.equal(
    calls.filter(
      (call) => call.url.includes("/rooms/") && !call.url.endsWith("/leave"),
    ).length,
    0,
  );
});
// 场景：过期恢复请求的补偿操作不能使较新导航重新选择的同一座位离席
// Scenario: stale resume compensation never detaches the same seat selected again by newer navigation
test("stale resume compensation never detaches the same seat selected again by newer navigation", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const storage = browser({
    search: "?room=ABCDEF23",
    active: credential(),
  });
  const scope = lobby();
  const calls = [];
  let releaseOld;
  let resumes = 0;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  globalThis.fetch = (url, options) => {
    calls.push({
      url,
      options,
    });
    // 识别恢复座位请求，控制其返回时机以复现换桌竞争。
    // Recognize seat-resume requests and control their completion to reproduce navigation races.
    if (url.endsWith("/resume")) {
      resumes++;
      // 只延迟第一次恢复请求；后续恢复按正常路径处理，制造可控的过时响应。
      // Delay only the first resume while later resumes proceed, creating a controlled stale response.
      if (resumes === 1)
        return new Promise((resolve) => {
          releaseOld = resolve;
        });
      return Promise.resolve(
        response({
          state: fixture(),
        }),
      );
    }
    return Promise.resolve(
      response(
        url === "/api/profile"
          ? {
              playerToken: "a".repeat(64),
            }
          : url.endsWith("/history")
            ? emptyHistory()
            : {
                left: true,
                detached: true,
              },
      ),
    );
  };
  const old = scope.initialize();
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  await settle();
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  storage.setLocation("/play");
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.onPopState();
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  await settle();
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  storage.setLocation("/play?room=ABCDEF23");
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.onPopState();
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  await settle();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.inRoom.value, true);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const leavesBefore = calls.filter((call) =>
    call.url.endsWith("/leave"),
  ).length;
  releaseOld(
    response({
      state: fixture(),
    }),
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await old;
  await settle();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.inRoom.value, true);
  assert.equal(scope.session.value.token, credential().token);
  assert.equal(
    calls.filter((call) => call.url.endsWith("/leave")).length,
    leavesBefore,
  );
});
// 场景：身份初始化先持久化再注册，并由并发标签页及失败重试复用
// Scenario: identity bootstrap is persisted before registration and reused by concurrent tabs and failed retries
test("identity bootstrap is persisted before registration and reused by concurrent tabs and failed retries", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const storage = browser({
    profile: null,
  });
  const first = lobby();
  const second = lobby();
  const submitted = [];
  let fail = true;
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/profile");
    const candidate = JSON.parse(options.body).playerToken;
    submitted.push(candidate);
    assert.match(candidate, /^[a-f0-9]{64}$/);
    assert.equal(
      JSON.parse(storage.localItems.get("huajian-mahjong-player-v1")),
      candidate,
    );
    assert.equal(options.headers["X-Player-Token"], undefined);
    // 故意启用该步骤的失败模式，验证恢复/重试而不是假定请求总成功。
    // Enable the step’s failure mode deliberately to exercise recovery/retry behavior.
    if (fail) throw new TypeError("registration interrupted");
    return response({
      playerToken: candidate,
    });
  };
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const results = await Promise.allSettled([
    first.ensureProfile(),
    second.ensureProfile(),
  ]);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(
    results.every((result) => result.status === "rejected"),
    true,
  );
  assert.equal(new Set(submitted).size, 1);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  fail = false;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await first.ensureProfile();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(first.playerToken.value, submitted[0]);
  assert.equal(new Set(submitted).size, 1);
});
// 场景：房间修改在请求体中传身份，绝不放入未脱敏的自定义请求头或 URL
// Scenario: room mutations carry the identity in the body and never in an unredacted custom header or URL
test("room mutations carry the identity in the body and never in an unredacted custom header or URL", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const scope = setup(fixture());
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.playerToken.value = "a".repeat(64);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let request;
  globalThis.fetch = async (url, options) => {
    request = {
      url,
      options,
    };
    return response({
      state: fixture(),
    });
  };
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.mutate({
    type: "discard",
    tile: 0,
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(
    JSON.parse(request.options.body).profileToken,
    scope.playerToken.value,
  );
  assert.equal(
    request.options.headers.Authorization,
    `Bearer ${credential().token}`,
  );
  assert.equal(request.options.headers["X-Player-Token"], undefined);
  assert.equal(request.url.includes(scope.playerToken.value), false);
});
// 场景：替补玩家不继承已结束玩家的手牌或积分，结果仍保留原姓名
// Scenario: replacement occupant does not inherit a finished player hand or score, while result keeps original names
test("replacement occupant does not inherit a finished player hand or score, while result keeps original names", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const state = fixture();
  state.phase = "finished";
  state.game.phase = "finished";
  state.game.legalActions = [];
  state.game.participantNames = ["原玩家", "老牌友二", "老牌友三"];
  state.seats[0] = {
    seat: 0,
    name: "新玩家",
    connected: true,
    isCurrentParticipant: false,
    score: 0,
  };
  state.game.players[0].score = 24;
  state.game.players[1].score = -12;
  state.game.players[2].score = -12;
  const scope = setup(state);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const html = await render(scope);
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.equal(scope.me.value.score, 0);
  assert.equal(scope.hand.value.length, 0);
  assert.equal(scope.scoreSeats.value[0].name, "原玩家");
  assert.equal(scope.scoreSeats.value[0].score, 24);
  assert.match(html, /已落座，等待下一局/);
  assert.match(html, /上一局结算/);
  assert.match(html, /原玩家/);
  assert.doesNotMatch(html, /aria-label="我的手牌与操作"/);
});
// 场景：保存凭证中格式错误的可选昵称不会破坏大厅表单
// Scenario: malformed optional nickname in saved credentials does not break the lobby form
test("malformed optional nickname in saved credentials does not break the lobby form", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  browser({
    active: {
      ...credential(),
      name: {
        unexpected: true,
      },
    },
  });
  const scope = lobby();
  globalThis.fetch = async (url) =>
    response(
      url === "/api/profile"
        ? {
            playerToken: "a".repeat(64),
          }
        : url.endsWith("/history")
          ? emptyHistory()
          : {
              left: true,
              detached: true,
            },
    );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.initialize();
  await settle();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.name.value, "");
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.enterRoom();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.match(scope.error.value, /落座名/);
  assert.equal(scope.busy.value, false);
});
// 场景：schema 3 只渲染中央共享萝卜池，不把翻牌来源重复显示为个人萝卜
// Scenario: schema 3 renders one central shared pool and never repeats flip provenance as personal radishes
test("schema 3 renders one central shared pool and never repeats flip provenance as personal radishes", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const state = fixture({
    schemaVersion: 3,
  });
  state.game.players[0].radishes = [0, 1, 2, 3, 4, 5];
  state.game.players[1].radishes = [7];
  state.game.players[2].radishes = [8];
  state.game.sharedRadishes = state.game.players.flatMap(
    (player) => player.radishes,
  );
  state.game.firstHuRadishesRevealed = true;
  state.game.history = [
    {
      type: "hu",
      seat: 0,
      newRadishes: [0, 1, 2, 3, 4, 5],
      message: "首胡",
    },
    {
      type: "anGang",
      seat: 2,
      radish: 8,
      message: "暗杠",
    },
  ];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const html = await render(setup(state));
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.equal(
    (html.match(/aria-label="全桌共享萝卜，共 8 张，可滚动查看"/g) || []).length,
    1,
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const pool = html.match(
    /<section class="shared-radish-pool"[\s\S]*?<\/section>/,
  )?.[0];
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.ok(pool);
  assert.match(pool, /共 8 张/);
  assert.match(pool, /牌友3杠牌 \+1/);
  assert.equal((pool.match(/aria-label="\d+[条筒]"/g) || []).length, 8);
  assert.doesNotMatch(html, /class="radish-row"|我的萝卜/);
  assert.match(html, /全桌共用这一池，后续胡牌不再加六张/);
});
// 场景：schema 3 明确呈现空池及全桌首次胡牌，不使用个人首胡标签
// Scenario: schema 3 empty pool and first table hu are explicit, with no personal first-hu labels
test("schema 3 empty pool and first table hu are explicit, with no personal first-hu labels", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const state = fixture({
    schemaVersion: 3,
  });
  state.game.sharedRadishes = [];
  const scope = setup(state);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let html = await render(scope);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.match(html, /aria-label="全桌共享萝卜，共 0 张，可滚动查看"/);
  assert.match(html, />首胡待翻</);
  assert.match(html, /aria-description="首胡翻六张基础萝卜/);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  state.game.sharedRadishes = [0, 1, 2, 3, 4, 5];
  state.game.history = [
    {
      type: "hu",
      seat: 1,
      newRadishes: [...state.game.sharedRadishes],
      message: "首胡",
    },
  ];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.state.value = {
    ...state,
    game: {
      ...state.game,
    },
  };
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  html = await render(scope);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.match(html, /全桌首胡 \+6/);
  assert.doesNotMatch(html, /我的萝卜/);
});
// 场景：schema 3 同时可胡可碰时展示两种合法选择及准确指引
// Scenario: schema 3 hu-plus-peng claim displays both legal choices and accurate guidance
test("schema 3 hu-plus-peng claim displays both legal choices and accurate guidance", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const state = fixture({
    schemaVersion: 3,
  });
  state.game.phase = "claim";
  state.game.currentSeat = 1;
  state.game.claim = {
    tile: 3,
    discardSeat: 1,
  };
  state.game.legalActions = [
    {
      type: "hu",
    },
    {
      type: "peng",
      tile: 3,
    },
    {
      type: "pass",
    },
  ];
  const scope = setup(state);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const html = await render(scope);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(
    scope.primaryActions.value.map((action) => action.type),
    ["hu", "peng", "pass"],
  );
  assert.match(html, /你可以选择胡、碰或过/);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const buttons = (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) || []).map(
    (button) => button.replace(/<[^>]*>/g, "").trim(),
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.ok(buttons.includes("胡牌"));
  assert.ok(buttons.includes("碰"));
  assert.ok(buttons.includes("过"));
  assert.doesNotMatch(html, />明杠<\/button>/);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.state.value.game.legalActions = [
    {
      type: "hu",
    },
    {
      type: "pass",
    },
  ];
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  const huOnly = await render(scope);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.doesNotMatch(
    huOnly,
    /你可以选择胡、碰或过|>碰<\/button>|>明杠<\/button>/,
  );
});
// 场景：服务端确定的胡后自摸只提供胡，不能过、打牌或杠
// Scenario: server-derived post-hu selfdraw offers hu alone, never pass, discard or kong
test("server-derived post-hu selfdraw offers hu alone, never pass, discard or kong", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const state = fixture({
    schemaVersion: 3,
    postHu: true,
  });
  state.game = getPlayerView(
    postHuKongGame({
      winningDraw: true,
    }),
    0,
  );
  const scope = setup(state);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const html = await render(scope);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.canHu.value, true);
  assert.deepEqual(scope.gangActions.value, []);
  assert.deepEqual(
    scope.primaryActions.value.map((action) => action.type),
    ["hu"],
  );
  assert.match(html, /胡牌<\/button>/);
  assert.equal(scope.mustHu.value, true);
  assert.match(html, /已经胡过，这张必须胡/);
  assert.match(html, /能胡就必须胡/);
  assert.deepEqual(scope.discardOptions.value, []);
  assert.doesNotMatch(
    html,
    /不胡|不胡就|请你决定|>过<\/button>|当前必须杠牌|暂不杠|本轮再胡需换尽原听口|选牌后打出/,
  );
});
// 真实接牌视图只显示胡；提交前不自动执行，其他玩家回应中或播放中也不显示备选动作。
// Real claim views show hu alone without autoplay; waiting for peers or presentation never creates alternatives.
for (const kind of ["discard", "kongDiscard", "robKong"]) {
  test(`post-hu ${kind} renders only hu and accurate mandatory guidance`, async () => {
    const state = fixture({ schemaVersion: 3, postHu: true });
    state.game = getPlayerView(postHuWinClaim({ kind, multiple: true }), 0);
    const scope = setup(state);
    const html = await render(scope);
    assert.deepEqual(scope.primaryActions.value, [{ type: "hu" }]);
    assert.deepEqual(scope.gangActions.value, []);
    assert.deepEqual(scope.discardOptions.value, []);
    assert.equal(scope.mustHu.value, true);
    assert.match(html, /已经胡过，这张必须胡/);
    assert.match(html, /能胡就必须胡/);
    // 滚动区域新增可及性属性不能令结构定位失效；仍逐个核对实际胡按钮与服务端白名单。
    // Accessibility attributes must not break container lookup; keep exact hu-button and server-allowlist assertions.
    const actionContainer = html.match(/<div class="action-row"([^>]*)>([\s\S]*?)<\/div>/);
    assert.match(actionContainer?.[1] || '', /tabindex="0"/);
    assert.match(actionContainer?.[1] || '', /aria-label="合法动作，可横向滚动"/);
    const actionRow = actionContainer?.[2];
    assert.ok(actionRow);
    const buttons = (actionRow.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) || []).map(
      (button) => button.replace(/<[^>]*>/g, "").trim(),
    );
    assert.deepEqual(buttons, ["胡牌"]);
    assert.doesNotMatch(html, /本次只能抢杠胡或过|不胡 \/ 过|你可以选择胡、碰或过/);
    // 模拟已回复后等待另一位，清空服务端动作不会残留必胡按钮或提示。
    // After responding, an empty server allowlist must remove the old hu button and mandatory prompt.
    scope.state.value.game.legalActions = [];
    assert.equal(scope.mustHu.value, false);
    assert.deepEqual(scope.primaryActions.value, []);
    assert.doesNotMatch(await render(scope), /胡牌<\/button>|已经胡过，这张必须胡/);
  });
}
// 场景：服务端确定的胡后三条摸牌只提供补杠，绝不提供过牌或跳杠
// Scenario: server-derived post-hu three-bamboo draw offers only supplement kong, never pass or skip kong
test("server-derived post-hu three-bamboo draw offers only supplement kong, never pass or skip kong", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const state = fixture({
    schemaVersion: 3,
    postHu: true,
  });
  state.game = getPlayerView(postHuKongGame(), 0);
  const scope = setup(state);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const html = await render(scope);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(state.game.legalActions, [
    {
      type: "buGang",
      tile: 2,
    },
  ]);
  assert.equal(state.game.drawnTile, 2);
  assert.deepEqual(state.game.waitTiles, [9, 12]);
  assert.equal(scope.canHu.value, false);
  assert.deepEqual(scope.gangActions.value, [
    {
      type: "buGang",
      tile: 2,
    },
  ]);
  assert.deepEqual(scope.primaryActions.value, []);
  assert.deepEqual(scope.discardOptions.value, []);
  assert.match(html, /1筒、4筒/);
  assert.match(html, /补杠 · 3条/);
  assert.match(html, /原手牌不能换打；当前必须杠牌/);
  assert.doesNotMatch(
    html,
    /不胡|不杠|过 · 打出新牌|>过<\/button>|胡牌<\/button>|选牌后打出/,
  );
});
// 场景：schema 3 胡牌摘要写明实际唯一付款方，包括独立结算的大单吊分
// Scenario: schema 3 hu summaries name the actual sole payer, including exclusive big-single scores
test("schema 3 hu summaries name the actual sole payer, including exclusive big-single scores", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const state = fixture({
    schemaVersion: 3,
    postHu: true,
  });
  state.game.players[1].huCount = 1;
  const score = {
    fan: 4,
    fanPoints: 8,
    copyFanBonus: 3,
    radishBonus: 4,
    dragonBonus: 0,
    total: 12,
  };
  const payments = [
    {
      seat: 0,
      delta: 12,
    },
    {
      seat: 2,
      delta: -12,
    },
  ];
  state.game.scoreBreakdown = score;
  state.game.history = [
    {
      type: "hu",
      seat: 0,
      score,
      payments,
      message: "继续自摸",
    },
  ];
  const scope = setup(state);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const html = await render(scope);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.match(html, /4 番 8 分 \+ 共享萝卜 4 = 12 分 \/ 付款方；牌友3付12分/);
  assert.doesNotMatch(html, /另外两家|\+ 神龙|牌友2付/);
  assert.match(
    scope.scoreSummary(
      {
        ...score,
        bigSingle: true,
        overlapPolicy: "exclusive",
        total: 50,
      },
      [
        {
          seat: 0,
          delta: 50,
        },
        {
          seat: 2,
          delta: -50,
        },
      ],
    ),
    /大单钓：50 分 \/ 付款方.*牌友3付50分/,
  );
  assert.doesNotMatch(
    scope.scoreSummary({
      ...score,
      bigSingle: true,
      overlapPolicy: "exclusive",
      total: 50,
    }),
    /另外两家/,
  );
});
// 场景：schema 3 最终龙结算与胡牌及即时杠费分开标注
// Scenario: schema 3 final dragon settlement is labeled separately from hu and immediate kong payments
test("schema 3 final dragon settlement is labeled separately from hu and immediate kong payments", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const state = fixture({
    schemaVersion: 3,
  });
  state.phase = "finished";
  state.game.phase = "finished";
  state.game.legalActions = [];
  const dragon = {
    type: "dragonSettlement",
    seat: 0,
    points: 20,
    dragons: [
      {
        tile: 11,
        count: 7,
        points: 20,
      },
    ],
    payments: [
      {
        seat: 0,
        delta: 40,
      },
      {
        seat: 1,
        delta: -20,
      },
      {
        seat: 2,
        delta: -20,
      },
    ],
    message: "局末神龙结算",
  };
  state.game.dragonSettlement = {
    settled: true,
    entries: [dragon],
  };
  state.game.history = [dragon];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const html = await render(setup(state));
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.match(html, /局末神龙已结算，本局只结一次/);
  assert.match(html, /局末神龙明细/);
  assert.match(html, /局末神龙 · 本局结算一次/);
  assert.match(html, /3筒 7 张 · 20 分/);
  assert.match(html, /牌友2付20分 · 牌友3付20分/);
  assert.doesNotMatch(html, /即时杠分：/);
});
// 场景：schema 2 保留个人萝卜池、再次胡牌限制、计分及规则解释
// Scenario: schema 2 preserves its personal pool, repeat-hu restriction, scoring and rule explanations
test("schema 2 preserves its personal pool, repeat-hu restriction, scoring and rule explanations", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const state = fixture({
    postHu: true,
  });
  state.game.players[0].radishes = [0, 1];
  state.game.players[1].radishes = [2];
  state.game.players[0].huLockActive = true;
  const scope = setup(state);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.showRules.value = true;
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  const html = await render(scope);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.match(html, /本桌保留 v0.3.1 旧规则/);
  assert.match(html, /本桌旧规则 · v0.3.1/);
  assert.match(html, /我的萝卜/);
  assert.match(html, /每次合法杠立即翻 1 张自己的萝卜/);
  assert.match(html, /原听口还有重合时不能再胡/);
  assert.match(html, /普通胡牌时另计/);
  assert.match(html, /本轮再胡需换尽原听口/);
  assert.doesNotMatch(
    html,
    /aria-label="全桌共享萝卜|六张加 3 番|神龙留到局末，只结一次/,
  );
  assert.match(
    scope.scoreSummary({
      fan: 1,
      fanPoints: 1,
      radishBonus: 2,
      dragonBonus: 10,
      total: 13,
    }),
    /萝卜 2 \+ 神龙 10/,
  );
});
// 场景：当前大厅规则解释六张同牌番、共享萝卜、连续胡牌及独立最终龙计数
// Scenario: current lobby rules explain six-copy fan, shared radishes, consecutive hu and separate final dragon counts
test("current lobby rules explain six-copy fan, shared radishes, consecutive hu and separate final dragon counts", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  browser();
  const scope = lobby();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.showRules.value = true;
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  const html = await render(scope);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const version = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ).version;
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.ok(html.includes(`朋友内测版 · v${version}`));
  assert.ok(html.includes(`规则原型 v${version}`));
  assert.match(html, /六张加 3 番/);
  assert.match(html, /六张同牌加到 4 番/);
  assert.match(html, /七张加 4 番，八张加 5 番/);
  assert.match(html, /逐张加杠至本局同牌上限/);
  assert.match(html, /首胡翻 6 张，加上首胡前每次成功杠累计的 1 张/);
  assert.match(html, /本人的手牌区、碰杠区、胡牌区，加上全桌共享萝卜/);
  assert.match(html, /普通加番只计算自己的三个牌区，不含萝卜/);
  assert.match(html, /只由本次胡之前还未胡的其他玩家付款/);
  assert.doesNotMatch(
    html,
    /可胡时先选择胡或过，不同时开放杠|本桌旧规则|恢复上一桌/,
  );
});
// 场景：萝卜规则与无付款方摘要同时匹配新规则及保留的旧存档规则
// Scenario: radish rules and zero-payer summaries match new and preserved old saved rules
test("radish rules and zero-payer summaries match new and preserved old saved rules", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const state = fixture({
    schemaVersion: 3,
  });
  state.game.rules = {
    radishCountsWinPile: true,
    selfDrawOnlyUnwon: true,
  };
  const scope = setup(state);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.showRules.value = true;
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  const html = await render(scope);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.match(html, /胡牌区（含共胡）、碰杠区、手牌区全部参与匹配/);
  assert.match(html, /七筒 2 张×萝卜 1 张，加四筒 1 张×萝卜 2 张，共 4 分/);
  assert.match(
    scope.scoreSummary(
      {
        fan: 1,
        fanPoints: 1,
        radishBonus: 4,
        total: 5,
      },
      [
        {
          seat: 0,
          delta: 0,
        },
      ],
    ),
    /共享萝卜 4.*本次无付款方，收入 0 分/,
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  state.game.rules = {
    radishCountsWinPile: false,
  };
  const oldScope = setup(state);
  oldScope.showRules.value = true;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const oldHtml = await render(oldScope);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.match(oldHtml, /本局保留开局时 v0.4.0 的萝卜规则/);
  assert.match(oldHtml, /本局保留开局时的自摸付款规则/);
});
// 场景：最新杠后弃牌规则明确唯一付款方为弃牌者，不使用自摸措辞
// Scenario: latest kong-discard rules explicitly name the sole discarder payer without selfdraw wording
test("latest kong-discard rules explicitly name the sole discarder payer without selfdraw wording", async () => {
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  // 逐项覆盖 [null,fixture({schemaVersion:3})]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [null,fixture({schemaVersion:3})] with the same checks, preserving the listed order.
  for (const state of [
    null,
    fixture({
      schemaVersion: 3,
    }),
  ]) {
    browser();
    const scope = state ? setup(state) : lobby();
    scope.showRules.value = true;
    const html = await render(scope);
    assert.match(html, /仅由实际出牌者付款，不按自摸结算/);
    assert.doesNotMatch(
      html,
      /按自摸付款方式结算|杠后接胡按自摸|杠后出牌，可按自摸接胡/,
    );
  }
});
// 场景：共享萝卜按花色和点数升序响应式排序，不修改服务端池顺序
// Scenario: shared radishes sort by suit and ascending rank reactively without changing server pool order
test("shared radishes sort by suit and ascending rank reactively without changing server pool order", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const state = fixture({
    schemaVersion: 3,
  });
  state.game.sharedRadishes = [17, 2, 9, 0, 12, 2];
  const scope = setup(state);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(scope.sharedRadishes.value, [0, 2, 2, 9, 12, 17]);
  assert.deepEqual(state.game.sharedRadishes, [17, 2, 9, 0, 12, 2]);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.state.value.game.sharedRadishes.push(1, 10);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(scope.sharedRadishes.value, [0, 1, 2, 2, 9, 10, 12, 17]);
  assert.deepEqual(
    scope.state.value.game.sharedRadishes,
    [17, 2, 9, 0, 12, 2, 1, 10],
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const html = await render(scope);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.match(html, /共 8 张/);
});
// 场景：入口提供可选角色偏好，并提交选择值
// Scenario: entry exposes optional character preference and submits selected value
test("entry exposes optional character preference and submits selected value", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  browser();
  const scope = lobby();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const html = await render(scope);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.match(html, /id="preferred-character"/);
  assert.match(html, /随机分配/);
  assert.match(html, /小桃 · 萝莉音/);
  assert.match(html, /清岚 · 御姐音/);
  assert.match(html, /晴禾 · 阳光少女音/);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.name.value = "测试角色";
  scope.preferredCharacter.value = "elegant";
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let submitted;
  globalThis.fetch = async (path, options) => {
    // 单独处理个人身份注册，避免把个人凭证与座位凭证的接口混淆。
    // Handle profile registration separately from room-seat credential operations.
    if (path === "/api/profile")
      return response({
        playerToken: "a".repeat(64),
      });
    submitted = JSON.parse(options.body);
    return response({
      roomId: "ABCDEF23",
      token: "b".repeat(64),
      state: {
        id: "ABCDEF23",
        revision: 0,
        phase: "lobby",
        you: 0,
        hostSeat: 0,
        seats: [
          {
            seat: 0,
            name: "测试角色",
            preferredCharacter: "elegant",
          },
        ],
        game: null,
      },
    });
  };
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.enterRoom();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(submitted.preferredCharacter, "elegant");
});
// 场景：角色头像使用服务端分配，不随观察者位置改变
// Scenario: character portraits use server assignment independent of viewer position
test("character portraits use server assignment independent of viewer position", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const value = fixture();
  value.game.characters = ["sunny", "sweet", "elegant"];
  const scope = setup(value);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.characterForPlayer(0).id, "sunny");
  assert.equal(scope.characterForPlayer(1).id, "sweet");
  assert.equal(scope.characterForPlayer(2).id, "elegant");
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  value.you = 2;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.characterForPlayer(0).id, "sunny");
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const html = await render(scope);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.match(html, /characters\/sunny-scene-base.png/);
  assert.match(html, /characters\/sweet-scene-base.png/);
  assert.match(html, /characters\/elegant-scene-base.png/);
});
// 场景：隐藏期间轮询后回到前台时，建立完整且静音的音频基线
// Scenario: foreground resume establishes a full silent baseline after hidden polling
test("foreground resume establishes a full silent baseline after hidden polling", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const scope = setup(fixture());
  const a = {
    type: "discard",
    seat: 0,
    tile: 0,
  };
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.applyState({
    ...fixture(),
    revision: 4,
    game: {
      ...fixture().game,
      id: "voice-test",
      history: [a],
    },
  });
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  document.hidden = true;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.visibilityChanged();
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  scope.applyState({
    ...fixture(),
    revision: 5,
    game: {
      ...fixture().game,
      id: "voice-test",
      history: [
        a,
        {
          type: "peng",
          seat: 1,
        },
      ],
    },
  });
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  document.hidden = false;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.visibilityChanged();
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let path;
  globalThis.fetch = async (requested) => {
    path = requested;
    return response({
      state: {
        ...fixture(),
        revision: 6,
        game: {
          ...fixture().game,
          id: "voice-test",
          history: [
            a,
            {
              type: "peng",
              seat: 1,
            },
            {
              type: "hu",
              seat: 2,
            },
          ],
        },
      },
    });
  };
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.refresh();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(path, "/api/rooms/ABCDEF23");
  // With the new full baseline established, the following action alone is new.
  assert.deepEqual(
    scope.voiceCursor.consume({
      ...fixture(),
      revision: 7,
      game: {
        ...fixture().game,
        id: "voice-test",
        history: [
          a,
          {
            type: "peng",
            seat: 1,
          },
          {
            type: "hu",
            seat: 2,
          },
          {
            type: "discard",
            seat: 0,
            tile: 2,
          },
        ],
      },
    }),
    ["/voices/sweet/tiao-3.mp3"],
  );
});
// 场景：延迟的后台请求不能消费前台音频基线
// Scenario: a delayed hidden request cannot consume the foreground audio baseline
test("a delayed hidden request cannot consume the foreground audio baseline", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const scope = setup(fixture());
  let deliver;
  const requested = [];
  document.hidden = true;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.visibilityChanged();
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  globalThis.fetch = async (path) => {
    requested.push(path);
    return new Promise((resolve) => {
      deliver = resolve;
    });
  };
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const pending = scope.refresh();
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  await settle();
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  document.hidden = false;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.visibilityChanged();
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  deliver(
    response({
      state: {
        ...fixture(),
        revision: 4,
        game: {
          ...fixture().game,
          id: "race",
          history: [
            {
              type: "discard",
              seat: 0,
              tile: 1,
            },
          ],
        },
      },
    }),
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await pending;
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  globalThis.fetch = async (path) => {
    requested.push(path);
    return response({
      state: {
        ...fixture(),
        revision: 5,
        game: {
          ...fixture().game,
          id: "race",
          history: [
            {
              type: "discard",
              seat: 0,
              tile: 1,
            },
            {
              type: "peng",
              seat: 1,
            },
          ],
        },
      },
    });
  };
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.refresh();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(requested.at(-1), "/api/rooms/ABCDEF23");
  assert.deepEqual(
    scope.voiceCursor.consume({
      ...fixture(),
      revision: 5,
      game: {
        ...fixture().game,
        id: "race",
        history: [
          {
            type: "discard",
            seat: 0,
            tile: 1,
          },
          {
            type: "peng",
            seat: 1,
          },
        ],
      },
    }),
    [],
  );
});
// 场景：新特殊规则显示计分说明，功能启用前的牌局保留旧分值提示
// Scenario: new special rules show scoring explanation while pre-feature games retain the old-rate notice
test("new special rules show scoring explanation while pre-feature games retain the old-rate notice", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  browser();
  let scope = lobby();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.

  scope.showRules.value = true;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let html = await render(scope);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.match(html, /七对首次胡后/);
  assert.match(html, /创建牌桌前填写每家支付的分数，默认 50 分/);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  scope = setup(
    fixture({
      schemaVersion: 3,
    }),
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.

  scope.showRules.value = true;
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  html = await render(scope);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.match(html, /本桌保留开局时的牌型计分/);
  assert.match(html, /本桌保留旧大单钓/);
  assert.doesNotMatch(html, /class="special-pattern-rules"/);
});
// 场景：新计分摘要标明牌型番，去掉容易误导的零分大单吊附加项
// Scenario: new score summary labels pattern fan and omits misleading zero-point big-single add-on
test("new score summary labels pattern fan and omits misleading zero-point big-single add-on", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const value = fixture({
    schemaVersion: 3,
  });
  value.game.rules = {
    specialHuPatterns: true,
  };
  const scope = setup(value);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const summary = scope.scoreSummary({
    fan: 5,
    fanPoints: 10,
    radishBonus: 2,
    total: 12,
    bigSingle: true,
    bigSinglePoints: 0,
    overlapPolicy: "fan",
    patternBonuses: [
      {
        type: "bigSingle",
        fan: 2,
      },
      {
        type: "pureSuit",
        fan: 2,
      },
    ],
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.match(summary, /大单吊 \+2番、清一色 \+2番/);
  assert.match(summary, /5 番 10 分/);
  assert.doesNotMatch(summary, /大单钓 0/);
  assert.match(
    scope.scoreSummary({
      fan: 5,
      fanPoints: 10,
      radishBonus: 0,
      total: 10,
      sevenPairsFixed: true,
      patternBonuses: [
        {
          type: "sevenPairs",
          fan: 5,
        },
      ],
    }),
    /七对固定5番/,
  );
});
// 场景：扩杠动作与副露标签显示第六至第八张，不合并重复碰牌
// Scenario: extended kong actions and meld labels show sixth through eighth tiles without merging duplicate pengs
test("extended kong actions and meld labels show sixth through eighth tiles without merging duplicate pengs", async () => {
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  // 逐项覆盖 [5,6,7]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [5,6,7] with the same checks, preserving the listed order.
  for (const count of [5, 6, 7]) {
    const state = fixture();
    state.game.players[0].melds = [
      {
        type: "peng",
        tile: 12,
        tiles: [12, 12, 12],
      },
      {
        type: "buGang",
        tile: 16,
        tiles: Array(count).fill(16),
      },
    ];
    state.game.legalActions = [
      {
        type: "addGang",
        tile: 16,
      },
    ];
    const scope = setup(state);
    assert.equal(
      scope.actionLabel({
        type: "addGang",
        tile: 16,
      }),
      `加第 ${count + 1} 张 · 8筒`,
    );
    assert.equal(
      scope.meldLabel(state.game.players[0].melds[1]),
      `补杠 · ${count} 张`,
    );
    const html = await render(scope);
    assert.match(html, new RegExp(`加第 ${count + 1} 张 · 8筒`));
  }
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const duplicate = fixture();
  duplicate.game.players[0].melds = [
    {
      type: "peng",
      tile: 16,
      tiles: [16, 16, 16],
    },
    {
      type: "mingGang",
      tile: 16,
      tiles: [16, 16, 16, 16],
    },
  ];
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(
    setup(duplicate).actionLabel({
      type: "addGang",
      tile: 16,
    }),
    "加第 5 张 · 8筒",
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const scope = setup(fixture());
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(
    scope.meldLabel({
      type: "anGang",
      hidden: true,
      tile: null,
      tiles: Array(8).fill(null),
    }),
    "暗杠 · 8 张",
  );
});
// 场景：最新规则区分明杠补牌胡、自己杠后补牌胡及弃牌胡
// Scenario: latest rules distinguish exposed-kong replacement hu from own-kong replacement hu and discarded tiles
test("latest rules distinguish exposed-kong replacement hu from own-kong replacement hu and discarded tiles", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  browser();
  const scope = lobby();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.

  scope.showRules.value = true;
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  const html = await render(scope);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.match(html, /本次补摸胡只由该明杠的出牌者付款/);
  assert.match(
    html.replace(/<[^>]*>/g, ""),
    /自己摸来的暗杠、补杠、加杠后补摸胡才由其他玩家付款/,
  );
  assert.match(html, /杠后打出的牌被胡，仍只由该张牌的出牌者付款/);
});
// 场景：抢杠响应区分待确认加杠、已完成杠及普通弃牌
// Scenario: rob-kong response distinguishes pending upgrade from completed kong or ordinary discard
test("rob-kong response distinguishes pending upgrade from completed kong or ordinary discard", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const state = fixture({
    schemaVersion: 3,
  });
  state.game.phase = "claim";
  state.game.claim = {
    kind: "robKong",
    discardSeat: 1,
    tile: 16,
    eligibleSeats: [0],
    respondedSeats: [],
  };
  state.game.legalActions = [
    {
      type: "hu",
    },
    {
      type: "pass",
    },
  ];
  const scope = setup(state);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.match(scope.statusTitle.value, /可以抢杠/);
  assert.match(scope.statusDetail.value, /只能抢杠胡或过/);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let html = await render(scope);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.match(html, /正在补杠/);
  assert.equal(
    scope.winLabel({
      tile: 16,
      source: "robKong",
    }),
    "8筒 · 抢杠胡",
  );
  assert.match(
    scope.scoreSummary({
      fan: 2,
      fanPoints: 2,
      total: 2,
      radishBonus: 0,
      patternBonuses: [
        {
          type: "robKong",
          fan: 1,
        },
      ],
    }),
    /抢杠 \+1番/,
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  state.game.legalActions = [];
  const waiting = setup(state);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.match(waiting.statusDetail.value, /暂不收杠分、不翻萝卜/);
});
// 场景：首次胡牌前的杠萝卜只显示待翻数量，不显示虚构的已翻牌
// Scenario: pre-first-win kong radishes show only pending count, not imaginary revealed tiles
test("pre-first-win kong radishes show only pending count, not imaginary revealed tiles", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const state = fixture({
    schemaVersion: 3,
  });
  state.game.sharedRadishes = [];
  state.game.firstHuRadishesRevealed = false;
  state.game.pendingKongRadishes = 5;
  const scope = setup(state);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const html = await render(scope);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.match(html, /首胡待翻 \+5 张杠萝卜/);
  assert.match(html, /aria-label="全桌共享萝卜，共 0 张，可滚动查看"/);
  const pool = html.match(/<section class="shared-radish-pool"[\s\S]*?<\/section>/)?.[0];
  assert.ok(pool);
  assert.equal((pool.match(/aria-label="\d+[条筒]"/g) || []).length, 0, 'pending radishes are not revealed tiles');
  assert.doesNotMatch(html, /每杠添 1 张；全桌第一次胡牌添 6 张/);
});
// 场景：庄家标记独立于房主，跟随服务端庄家信息
// Scenario: dealer marker follows server dealer independently of host
test("dealer marker follows server dealer independently of host", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const state = fixture({
    schemaVersion: 3,
  });
  state.game.dealerSeat = 1;
  const scope = setup(state);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const html = await render(scope);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.match(html, /dealer-tag/);
  assert.match(html, /庄/);
  assert.match(html, /房主/);
});
// 场景：最新规则允许普通再次荣胡，无需等待自然摸牌
// Scenario: latest rules permit ordinary repeat discard hu without waiting for natural draw
test("latest rules permit ordinary repeat discard hu without waiting for natural draw", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  browser();
  const scope = lobby();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.showRules.value = true;
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  const html = await render(scope);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.match(html, /自己已经胡过不限制接炮/);
  assert.match(html, /可以再次胡，不必等自己下一次正常摸牌/);
  assert.match(html, /普通弃牌也不能接胡/);
});
// 建立可开局或再开局的界面快照，用于房主权限和开局选项测试。
// Build lobby/next-game UI state for host authorization and start-option tests.
function startFixture(phase = "lobby") {
  const state = fixture({
    schemaVersion: 3,
  });
  state.phase = phase;
  // 大厅场景不应携带上一局进行中的游戏状态，开局选项属于下一局草稿。
  // A lobby should not carry an active previous game; its start option is a next-game draft.
  if (phase === "lobby") state.game = null;
  else {
    state.game.phase = "finished";
    state.game.legalActions = [];
  }
  return state;
}
// 场景：房主仅在首次开局及同房间下一局前获得默认勾选且可访问的选项
// Scenario: host gets an accessible checked option before first start and same-room next game only
test("host gets an accessible checked option before first start and same-room next game only", async () => {
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  // 逐项覆盖 ['lobby','finished']；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in ['lobby','finished'] with the same checks, preserving the listed order.
  for (const phase of ["lobby", "finished"]) {
    const scope = setup(startFixture(phase));
    const html = await render(scope);
    assert.match(html, /for="auto-discard-after-hu"/);
    assert.match(html, /id="auto-discard-after-hu"[^>]*checked/);
    assert.match(html, /aria-describedby="auto-discard-help"/);
    assert.match(html, phase === "finished" ? /下一局选项/ : /开局选项/);
    scope.state.value.you = 1;
    assert.doesNotMatch(await render(scope), /id="auto-discard-after-hu"/);
  }
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.doesNotMatch(
    await render(
      setup(
        fixture({
          schemaVersion: 3,
        }),
      ),
    ),
    /id="auto-discard-after-hu"/,
  );
});
// 场景：首次和下一局开局提交所选布尔值，不改变旧局规则
// Scenario: start submits the selected boolean for first and next games without changing the old game rule
test("start submits the selected boolean for first and next games without changing the old game rule", async () => {
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  for (const phase of ["lobby", "finished"])
    for (const choice of [true, false]) {
      const scope = setup(startFixture(phase));
      // 只有已结束旧局存在时才设置或核对其规则；大厅没有旧局，但下一局草稿仍必须独立生效。
      // Set/check prior-game rules only when a finished game exists; a lobby has no prior game, but the next-game draft remains independent.
      if (scope.game.value)
        scope.game.value.rules = {
          autoDiscardAfterHu: !choice,
        };
      scope.autoDiscardAfterHu.value = choice;
      // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
      // Arrange: prepare this step’s input or reference data within the synthetic scenario.
      const calls = [];
      // 核对接口返回及版本，区分成功、冲突与未变化响应。
      // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
      globalThis.fetch = async (url, options) => {
        calls.push({
          url,
          body: JSON.parse(options.body),
        });
        const state = fixture({
          schemaVersion: 3,
        });
        state.revision = 4;
        state.game.rules = {
          autoDiscardAfterHu: choice,
        };
        return response({
          state,
        });
      };
      // 只有已结束旧局存在时才设置或核对其规则；大厅没有旧局，但下一局草稿仍必须独立生效。
      // Set/check prior-game rules only when a finished game exists; a lobby has no prior game, but the next-game draft remains independent.
      if (scope.game.value)
        assert.equal(scope.gameAutoDiscardAfterHu.value, !choice);
      // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
      // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
      await scope.mutate(null, true);
      // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
      // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, "/api/rooms/ABCDEF23/start");
      assert.deepEqual(calls[0].body.options, {
        autoDiscardAfterHu: choice,
        bigSingleReadyPoints: 50,
      });
      assert.equal(calls[0].body.revision, 3);
      assert.equal(calls[0].body.action, undefined);
      assert.equal(scope.gameAutoDiscardAfterHu.value, choice);
      assert.doesNotMatch(await render(scope), /id="auto-discard-after-hu"/);
    }
});
// 场景：持久化的当前牌局选项对全部座位只读，旧局缺少选项时视为自动
// Scenario: persisted current game option is read-only for all seats and missing old option means automatic
test("persisted current game option is read-only for all seats and missing old option means automatic", async () => {
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  // 逐项覆盖 [0,1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [0,1,2] with the same checks, preserving the listed order.
  // Exercise each entry in [false,true,undefined] with the same checks, preserving the listed order.
  // 逐项覆盖 [false,true,undefined]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  for (const you of [0, 1, 2])
    for (const choice of [false, true, undefined]) {
      const state = fixture({
        schemaVersion: 3,
      });
      state.you = you;
      state.game.rules =
        choice === undefined
          ? {}
          : {
              autoDiscardAfterHu: choice,
            };
      const scope = setup(state);
      scope.autoDiscardAfterHu.value = choice === false;
      const html = await render(scope);
      assert.match(html, choice === false ? /已关闭，需点“过”继续/ : /已开启/);
      assert.doesNotMatch(html, /id="auto-discard-after-hu"/);
    }
});
// 场景：手动胡后无胡无杠状态只渲染过牌，且所有手牌保持锁定
// Scenario: manual post-hu no-hu no-kong state renders only pass and keeps every hand tile locked
test("manual post-hu no-hu no-kong state renders only pass and keeps every hand tile locked", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const state = fixture({
    schemaVersion: 3,
    postHu: true,
  });
  state.game.rules = {
    autoDiscardAfterHu: false,
  };
  state.game.legalActions = [
    {
      type: "pass",
    },
  ];
  const scope = setup(state);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const html = await render(scope);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(scope.primaryActions.value, [
    {
      type: "pass",
    },
  ]);
  assert.match(html, /手牌已固定，点过继续/);
  assert.match(html, /原手牌不能换打；点“过”打出新牌/);
  assert.match(html, /过 · 打出新牌<\/button>/);
  assert.doesNotMatch(html, /选牌后打出|不胡 \/ 过|当前必须杠牌/);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = html.match(/<div class="my-hand">([\s\S]*?)<\/div><\/div>/)[1];
  const buttons = hand.match(/<button\b[^>]*>/g);
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  assert.equal(buttons.length, state.game.players[0].hand.length);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  assert.ok(buttons.every((button) => /\bdisabled\b/.test(button)));
});
// 场景：忙碌、离线或同步中禁用复选框与开局，无效调用者不能开局
// Scenario: checkbox and start are disabled while busy offline or syncing, and invalid callers cannot start
test("checkbox and start are disabled while busy offline or syncing, and invalid callers cannot start", async () => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 逐项覆盖 ['busy','offline','syncing']；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in ['busy','offline','syncing'] with the same checks, preserving the listed order.
  for (const flag of ["busy", "offline", "syncing"]) {
    const scope = setup(startFixture());
    scope[flag].value = true;
    assert.match(
      await render(scope),
      /id="auto-discard-after-hu"[^>]*disabled/,
    );
    globalThis.fetch = () => {
      assert.fail("blocked start must not submit");
    };
    await scope.mutate(null, true);
  }
  // 逐项覆盖 [state=>{state.you=1;},state=>{state.seats[2]=null;},state=>{state.phase='playing';}]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [state=>{state.you=1;},state=>{state.seats[2]=null;},state=>{state.phase='playing';}] with the same checks, preserving the listed order.
  for (const change of [
    (state) => {
      state.you = 1;
    },
    (state) => {
      state.seats[2] = null;
    },
    (state) => {
      state.phase = "playing";
    },
  ]) {
    const state = startFixture();
    change(state);
    const scope = setup(state);
    globalThis.fetch = () => {
      assert.fail("invalid start must not submit");
    };
    await scope.mutate(null, true);
  }
});
// 场景：进行中的开局请求保存选项快照、拒绝重复点击并应用权威结果
// Scenario: in-flight start snapshots choice, rejects repeated clicks and applies authoritative result
test("in-flight start snapshots choice, rejects repeated clicks and applies authoritative result", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const scope = setup(startFixture());
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.autoDiscardAfterHu.value = false;
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let release;
  const requests = [];
  globalThis.fetch = (url, options) => {
    requests.push(JSON.parse(options.body));
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.

  const pending = scope.mutate(null, true);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.match(await render(scope), /id="auto-discard-after-hu"[^>]*disabled/);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.autoDiscardAfterHu.value = true;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.mutate(null, true);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].options, {
    autoDiscardAfterHu: false,
    bigSingleReadyPoints: 50,
  });
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const next = fixture({
    schemaVersion: 3,
  });
  next.revision = 4;
  next.game.rules = {
    autoDiscardAfterHu: false,
  };
  release(
    response({
      state: next,
    }),
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await pending;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.equal(scope.gameAutoDiscardAfterHu.value, false);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  assert.match(await render(scope), /已关闭，需点“过”继续/);
});
// 场景：过期开局请求读取当前规则，不重试也不覆盖服务端选择
// Scenario: stale start reads current rules without retrying or overwriting the server choice
test("stale start reads current rules without retrying or overwriting the server choice", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const scope = setup(startFixture());
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.autoDiscardAfterHu.value = false;
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const calls = [];
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  globalThis.fetch = async (url, options) => {
    calls.push(options.method);
    // 把写请求与读请求分开模拟，以便检查写入次数和重复提交。
    // Mock writes separately from reads to verify mutation counts and duplicate submissions.
    if (options.method === "POST")
      return response(
        {
          error: "stale",
        },
        409,
      );
    assert.equal(scope.syncing.value, true);
    await scope.mutate(null, true);
    const state = fixture({
      schemaVersion: 3,
    });
    state.revision = 5;
    state.game.rules = {
      autoDiscardAfterHu: true,
    };
    return response({
      state,
    });
  };
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.mutate(null, true);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(calls, ["POST", "GET"]);
  assert.equal(scope.gameAutoDiscardAfterHu.value, true);
  assert.doesNotMatch(await render(scope), /id="auto-discard-after-hu"/);
});
// 场景：新房间重置选项草稿，当前规则解释两种开局选择
// Scenario: new room resets the draft option and current rules explain both start choices
test("new room resets the draft option and current rules explain both start choices", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const scope = setup(startFixture());
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.autoDiscardAfterHu.value = false;
  scope.resetRoomContext();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.autoDiscardAfterHu.value, true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.showRules.value = true;
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  const html = await render(scope);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.match(html, /默认勾选/);
  assert.match(html, /不勾选则需点“过”才能过回合，局中不能更改/);
  assert.match(html, /有合法杠必须杠，不能跳过或打出新牌/);
});
// 场景：显式重载从服务端恢复手动规则，而非使用默认勾选的草稿
// Scenario: explicit reload restores manual rule from server rather than the default checked draft
test("explicit reload restores manual rule from server rather than the default checked draft", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  browser({
    rooms: {
      ABCDEF23: credential(),
    },
    search: "?room=ABCDEF23",
  });
  const restored = fixture({
    schemaVersion: 3,
  });
  restored.game.rules = {
    autoDiscardAfterHu: false,
  };
  globalThis.fetch = async (url) =>
    response(
      url === "/api/profile"
        ? {
            playerToken: "a".repeat(64),
          }
        : {
            state: restored,
          },
    );
  const scope = lobby();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.initialize();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.autoDiscardAfterHu.value, true);
  assert.equal(scope.gameAutoDiscardAfterHu.value, false);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const html = await render(scope);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.match(html, /已关闭，需点“过”继续/);
  assert.doesNotMatch(html, /id="auto-discard-after-hu"/);
});
// 场景：手动选项不能绕过服务端强制胡后杠或必胡决策
// Scenario: manual option cannot bypass server-mandated post-hu kong or mandatory hu
test("manual option cannot bypass server-mandated post-hu kong or mandatory hu", async () => {
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  // 逐项覆盖 [false,true]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [false,true] with the same checks, preserving the listed order.
  for (const winningDraw of [false, true]) {
    const engineGame = postHuKongGame({
      winningDraw,
    });
    engineGame.rules.autoDiscardAfterHu = false;
    const state = fixture({
      schemaVersion: 3,
      postHu: true,
    });
    state.game = getPlayerView(engineGame, 0);
    const scope = setup(state);
    const html = await render(scope);
    // 选择本次摸到的牌能直接胡的变体，验证胡优先于同刻可选杠。
    // Select a winning draw variant to verify hu takes priority over a simultaneous kong.
    if (winningDraw) {
      assert.deepEqual(
        scope.primaryActions.value.map((action) => action.type),
        ["hu"],
      );
      assert.match(html, /能胡就必须胡/);
      assert.doesNotMatch(html, /不胡 \/ 过 · 打出新牌/);
    } else {
      assert.deepEqual(scope.primaryActions.value, []);
      assert.deepEqual(scope.gangActions.value, [
        {
          type: "buGang",
          tile: 2,
        },
      ]);
      assert.match(html, /当前必须杠牌/);
      assert.doesNotMatch(html, /过 · 打出新牌|选牌后打出/);
    }
  }
});
// 场景：已结束房间的轮询保留编辑后的下一局选项，不改变上一局显示
// Scenario: finished-room polling preserves the edited next-game option without changing last-game display
test("finished-room polling preserves the edited next-game option without changing last-game display", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const state = startFixture("finished");
  state.game.rules = {
    autoDiscardAfterHu: true,
  };
  const scope = setup(state);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.autoDiscardAfterHu.value = false;
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  globalThis.fetch = async () =>
    response({
      state: {
        ...state,
        revision: 4,
      },
    });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.refresh();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.autoDiscardAfterHu.value, false);
  assert.equal(scope.gameAutoDiscardAfterHu.value, true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const html = await render(scope);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.match(html, /上一局胡后自动打出：<strong>已开启/);
  assert.doesNotMatch(html, /id="auto-discard-after-hu"[^>]*checked/);
});
// 场景：迟到的开局结果不能复活已退出房间或覆盖新房间草稿
// Scenario: late start result cannot revive an exited room or overwrite a new room draft
test("late start result cannot revive an exited room or overwrite a new room draft", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const scope = setup(startFixture());
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.autoDiscardAfterHu.value = false;
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let release;
  globalThis.fetch = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const pending = scope.mutate(null, true);
  // 准备：构造该变体的规则、牌局或对照快照，保持旧历史与当前输入分离。
  // Arrange this variant’s rules, game or comparison snapshot, keeping saved history separate from current input.
  scope.resetRoomContext();
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const next = fixture({
    schemaVersion: 3,
  });
  next.game.rules = {
    autoDiscardAfterHu: false,
  };
  release(
    response({
      state: next,
    }),
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await pending;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.state.value, null);
  assert.equal(scope.session.value, null);
  assert.equal(scope.autoDiscardAfterHu.value, true);
});
// 场景：牌桌累计积分榜与单局积分及大厅个人总分明确区分
// Scenario: table total scoreboard remains distinct from per-round scores and lobby personal total
test("table total scoreboard remains distinct from per-round scores and lobby personal total", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const state = fixture({
    schemaVersion: 3,
  });
  state.tableScores = [
    {
      id: "player-1",
      name: "本人",
      seat: 0,
      totalScore: 19,
      settledScore: 12,
      provisionalScore: 7,
    },
    {
      id: "player-2",
      name: "离桌的牌友",
      seat: null,
      detached: true,
      totalScore: -9,
      settledScore: -9,
      provisionalScore: 0,
    },
    {
      id: "player-3",
      name: "新来牌友",
      seat: 1,
      totalScore: 0,
      settledScore: 0,
      provisionalScore: 0,
    },
  ];
  state.game.players[0].score = 7;
  const scope = setup(state);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const html = await render(scope);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.match(html, /本桌总积分/);
  assert.match(html, /本局积分/);
  assert.match(html, /\+19/);
  assert.match(html, /已结算 \+12/);
  assert.match(html, /本局暂记 \+7/);
  assert.match(html, /离桌的牌友.*已离桌/);
  assert.match(html, /同桌再开、刷新、重连不清零/);
  assert.match(html, /个人跨桌总积分见大厅/);
  assert.equal(scope.tableScoreRows.value.length, 3);
});
// 场景：固定屏幕位置从每位观察者视角解释逆时针，不交换座位
// Scenario: fixed screen positions explain counterclockwise from every viewer without swapping seats
test("fixed screen positions explain counterclockwise from every viewer without swapping seats", async () => {
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  // 逐项覆盖 [0,1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [0,1,2] with the same checks, preserving the listed order.
  for (const seat of [0, 1, 2]) {
    const state = fixture({
      schemaVersion: 3,
    });
    state.you = seat;
    state.game.rules = {
      turnDirection: "counterclockwise",
      allowPungUpgrade: false,
    };
    const scope = setup(state);
    assert.deepEqual(
      scope.opponents.value.map((player) => player.seat),
      [(seat + 1) % 3, (seat + 2) % 3],
    );
    assert.equal(scope.counterclockwise.value, true);
    const html = await render(scope);
    assert.match(html, /逆时针 · 自己 → 右手边 → 左手边/);
    assert.match(html, /同级碰、杠、胡按此顺序，不按点击先后/);
    delete scope.state.value.game.rules.turnDirection;
    assert.equal(scope.counterclockwise.value, false);
    assert.match(await render(scope), /本局保留原方向，下一局改为逆时针/);
  }
});
// 场景：新规则界面解释碰后延迟补杠，而不是永久禁止补杠
// Scenario: new-rule board explains delayed rather than permanently forbidden pung upgrades
test("new-rule board explains delayed rather than permanently forbidden pung upgrades", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const raw = postHuKongGame({
    huCount: 0,
  });
  raw.rules.allowPungUpgrade = false;
  delete raw.rules.pungUpgradeAfterDiscard;
  const state = fixture({
    schemaVersion: 3,
  });
  state.game = getPlayerView(raw, 0);
  const scope = setup(state);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.

  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.showRules.value = true;
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.equal(
    scope.gangActions.value.some((action) => action.type === "buGang"),
    true,
  );
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  const html = await render(scope);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.match(html, /碰后先打出一张，之后轮到自己时可以补杠/);
  assert.match(html, /不要求刚摸到同牌/);
  assert.match(html, /已成立的杠仍可逐张加至本局每种牌的上限/);
  assert.doesNotMatch(html, /碰成的三张始终算碰|碰后不能补杠/);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  delete scope.state.value.game.rules.allowPungUpgrade;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.match(await render(scope), /本局保留原补杠时机/);
});
// 场景：已确认荣胡高亮准确来源，并等待展示结束再开放下一合法动作
// Scenario: confirmed discard win highlights the exact river tile and waits before the next legal action
test("confirmed discard win highlights the exact river tile and waits before the next legal action", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const initial = fixture({
    schemaVersion: 3,
  });
  initial.game.id = "presentation";
  const scope = setup(initial);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.applyState(initial);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const next = structuredClone(initial);
  next.revision++;
  next.game.history = [
    {
      type: "hu",
      seat: 1,
      tile: 4,
      source: "discard",
      fromSeat: 0,
    },
    {
      type: "draw",
      seat: 0,
    },
  ];
  next.game.discards = [
    {
      seat: 0,
      tile: 4,
      huSeats: [1],
    },
  ];
  next.game.players[1].winPile = [
    {
      tile: 4,
      source: "discard",
      discardIndex: 0,
    },
  ];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.applyState(next);
  await settle();
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(scope.state.value.revision, next.revision);
  assert.deepEqual(scope.legalActions.value, []);
  assert.equal(scope.winningEvents.value.length, 1);
  assert.equal(scope.winningEvents.value[0].discardIndex, 0);
  assert.equal(scope.isWinningTile(1, 0), true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const html = await render(scope);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.match(html, /winning-discard/);
  assert.match(html, /winning-tile/);
  assert.match(html, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html, /牌友2接炮5条，来自牌友1/);
  assert.match(html, /data-discard-index="0"/);
  assert.match(html, /data-win-seat="1" data-win-index="0"/);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.applyState(next);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.winningEvents.value.length, 1);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const cleanup = scheduled.find(
    (item) => item.delay === 2800 && !item.cancelled,
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.ok(cleanup);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  cleanup.callback();
  await settle();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.winningEvents.value.length, 0);
  assert.deepEqual(scope.legalActions.value, next.game.legalActions);
});
// 场景：首次载入、后台刷新与重连绝不重播旧胡牌表现
// Scenario: initial load, hidden refresh and reconnect never replay old win presentation
test("initial load, hidden refresh and reconnect never replay old win presentation", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const snapshot = fixture({
    schemaVersion: 3,
  });
  snapshot.game.id = "presentation";
  snapshot.game.history = [
    {
      type: "hu",
      seat: 1,
      tile: 4,
      source: "selfDraw",
    },
  ];
  const scope = setup(snapshot);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.applyState(snapshot);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.winningEvents.value.length, 0);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const next = structuredClone(snapshot);
  next.revision++;
  next.game.history.push({
    type: "hu",
    seat: 2,
    tile: 7,
    source: "selfDraw",
  });
  document.hidden = true;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.applyState(next);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  document.hidden = false;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.winningEvents.value.length, 0);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.visibilityChanged();
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  scope.applyState(next);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.winningEvents.value.length, 0);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.offline.value = true;
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const reconnected = structuredClone(next);
  reconnected.revision++;
  reconnected.game.history.push({
    type: "hu",
    seat: 1,
    tile: 5,
    source: "selfDraw",
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.applyState(reconnected);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.winningEvents.value.length, 0);
});
// 场景：同时胡牌者共享来源牌，减少动态效果模式保留文字反馈但不播放飞牌
// Scenario: simultaneous winners share the source tile and reduced motion keeps textual feedback without flights
test("simultaneous winners share the source tile and reduced motion keeps textual feedback without flights", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const initial = fixture({
    schemaVersion: 3,
  });
  initial.game.id = "presentation";
  const scope = setup(initial);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.applyState(initial);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let queried = false;
  window.matchMedia = () => ({
    matches: true,
  });
  document.querySelector = () => {
    queried = true;
  };
  const next = structuredClone(initial);
  next.revision++;
  next.game.history = [1, 2].map((seat) => ({
    type: "hu",
    seat,
    tile: 4,
    source: "discard",
    fromSeat: 0,
  }));
  next.game.discards = [
    {
      seat: 0,
      tile: 4,
      huSeats: [1, 2],
    },
  ];
  next.game.players[1].winPile = [
    {
      tile: 4,
      source: "discard",
      discardIndex: 0,
    },
  ];
  next.game.players[2].winPile = [
    {
      tile: 4,
      source: "discard",
      discardIndex: 0,
      virtual: true,
    },
  ];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.applyState(next);
  await settle();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.winningEvents.value.length, 2);
  assert.equal(scope.winningFlights.value.length, 0);
  assert.equal(queried, false);
  assert.equal(scope.winningDiscardIndices.value.size, 1);
  assert.match(
    scope.winningAnnouncement.value,
    /牌友2接炮5条，来自牌友1；牌友3接炮5条，来自牌友1/,
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.visibilityChanged();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.winningEvents.value.length, 0);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.applyState(next);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.winningEvents.value.length, 0);
});
// 场景：新局与离桌立即清除表现状态，不重播旧叫牌
// Scenario: new game and leaving table clear presentation immediately, without replaying old calls
test("new game and leaving table clear presentation immediately, without replaying old calls", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const initial = fixture({
    schemaVersion: 3,
  });
  initial.game.id = "presentation";
  const scope = setup(initial);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.applyState(initial);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const next = structuredClone(initial);
  next.revision++;
  next.game.history = [
    {
      type: "hu",
      seat: 1,
      tile: 4,
      source: "selfDraw",
    },
  ];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.applyState(next);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.winningEvents.value.length, 1);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const restarted = structuredClone(next);
  restarted.revision++;
  restarted.game.id = "next-game";
  restarted.game.history = [];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.applyState(restarted);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.winningEvents.value.length, 0);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  restarted.revision++;
  restarted.game.history.push({
    type: "hu",
    seat: 1,
    tile: 4,
    source: "selfDraw",
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.applyState(restarted);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.winningEvents.value.length, 1);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.resetRoomContext();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.winningEvents.value.length, 0);
  assert.equal(scope.winningFlights.value.length, 0);
});
// 场景：自摸无来源飞牌，抢杠反馈标注真实加杠来源
// Scenario: self-draw has no source flight, while rob-kong feedback labels the actual upgrade source
test("self-draw has no source flight, while rob-kong feedback labels the actual upgrade source", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const initial = fixture({
    schemaVersion: 3,
  });
  initial.game.id = "presentation";
  const scope = setup(initial);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.applyState(initial);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const next = structuredClone(initial);
  next.revision++;
  next.game.history = [
    {
      type: "hu",
      seat: 0,
      tile: 4,
      source: "selfDraw",
      fromSeat: null,
    },
  ];
  next.game.players[0].winPile = [
    {
      tile: 4,
      source: "selfDraw",
    },
  ];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.

  scope.applyState(next);
  await settle();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(scope.winningDiscardIndices.value.size, 0);
  assert.equal(scope.winningFlights.value.length, 0);
  assert.match(await render(scope), /摸牌成胡/);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.

  // 准备：构造该变体的规则、牌局或对照快照，保持旧历史与当前输入分离。
  // Arrange this variant’s rules, game or comparison snapshot, keeping saved history separate from current input.
  next.revision++;
  next.game.history.push({
    type: "hu",
    seat: 1,
    tile: 5,
    source: "robKong",
    fromSeat: 0,
  });
  next.game.players[1].winPile = [
    {
      tile: 5,
      source: "robKong",
      discardIndex: 0,
    },
  ];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.

  scope.applyState(next);
  await settle();
  const html = await render(scope);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.match(html, /牌友1杠牌/);
  assert.match(html, /抢杠胡 · 6条/);
});
// 场景：集成抢杠提示使用照片牌面，旧事件缺明细时使用准确的通用杠牌来源标签
// Scenario: integrated rob-kong cue uses photo tiles and an accurate generic source label for old events
test("integrated rob-kong cue uses photo tiles and an accurate generic source label for old events", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const initial = fixture({
    schemaVersion: 3,
  });
  initial.game.id = "integrated-presentation";
  initial.game.rules = {
    allowPungUpgrade: false,
    turnDirection: "counterclockwise",
  };
  initial.tableScores = [
    {
      id: "player-1",
      name: "牌友1",
      seat: 0,
      totalScore: 12,
      settledScore: 12,
      provisionalScore: 0,
    },
  ];
  const scope = setup(initial);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.applyState(initial);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const next = structuredClone(initial);
  next.revision++;
  next.game.history = [
    {
      type: "hu",
      seat: 2,
      tile: 5,
      source: "robKong",
      fromSeat: 0,
    },
  ];
  next.game.players[2].winPile = [
    {
      tile: 5,
      source: "robKong",
      discardIndex: 0,
    },
  ];
  next.tableScores[0].totalScore = 10;
  next.tableScores[0].provisionalScore = -2;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.applyState(next);
  await settle();
  const html = await render(scope);
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.match(html, /牌友1杠牌/);
  assert.match(html, /抢杠胡 · 6条/);
  assert.match(html, /tile-photo-face/);
  assert.match(html, /\/assets\/tiles\/mahjong-faces-20261107\.png/);
  assert.equal(scope.tableScoreRows.value[0].totalScore, 10);
  assert.equal(scope.pungUpgradeAfterDiscard.value, true);
  assert.equal(
    scope.gangActions.value.some((action) => action.type === "buGang"),
    false,
  );
  assert.equal(scope.counterclockwise.value, true);
  assert.deepEqual(scope.legalActions.value, []);
  scope.clearPresentation();
  await settle();
  assert.deepEqual(scope.legalActions.value, next.game.legalActions);
});
// Scenario: host ${phase} input has default, bounds, help and selected start value
for (const phase of ["lobby", "finished"]) // 场景：房主在 ${phase} 阶段的输入具备默认值、上下限、帮助文案和提交所选开局值
  test(`host ${phase} input has default, bounds, help and selected start value`, async () => {
    // 准备：构造该变体的规则、牌局或对照快照，保持旧历史与当前输入分离。
    // Arrange this variant’s rules, game or comparison snapshot, keeping saved history separate from current input.
    const scope = setup(startFixture(phase));
    // 只有已结束旧局存在时才设置或核对其规则；大厅没有旧局，但下一局草稿仍必须独立生效。
    // Set/check prior-game rules only when a finished game exists; a lobby has no prior game, but the next-game draft remains independent.
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    let html = await render(scope);
    // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
    // Check rendered output or source structure; regex/string matches are not real browser interactions.
    // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
    // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
    assert.match(html, /for="big-single-ready-points"/);
    assert.match(html, /id="big-single-ready-points"[^>]*value="50"/);
    assert.match(
      html,
      /id="big-single-ready-points"[^>]*min="0"[^>]*max="100000"[^>]*step="1"/,
    );
    assert.match(html, /虚拟积分 \/ 家/);
    // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
    // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
    for (const points of [0, 80, 100000]) {
      scope.bigSingleReadyPoints.value = points;
      const requests = [];
      globalThis.fetch = async (url, options) => {
        requests.push(JSON.parse(options.body));
        return response({
          state: startFixture(phase),
        });
      };
      // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
      // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
      await scope.mutate(null, true);
      // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
      // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
      assert.equal(requests.length, 1);
      assert.equal(requests[0].options.bigSingleReadyPoints, points);
    }
    // 准备：构造该变体的规则、牌局或对照快照，保持旧历史与当前输入分离。
    // Arrange this variant’s rules, game or comparison snapshot, keeping saved history separate from current input.
    scope.state.value.you = 1;
    // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
    // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
    html = await render(scope);
    // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
    // Check rendered output or source structure; regex/string matches are not real browser interactions.
    // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
    // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
    assert.doesNotMatch(html, /id="big-single-ready-points"/);
  });
// 场景：无效喜钱禁用开局并解释错误，直接调用 mutate 也不能提交
// Scenario: invalid ready amount disables start, describes the error and cannot submit through mutate
test("invalid ready amount disables start, describes the error and cannot submit through mutate", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const scope = setup(startFixture());
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  globalThis.fetch = () => assert.fail("invalid choice must not submit");
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  for (const points of ["", -1, 0.5, 100001, "50", Infinity, NaN]) {
    scope.bigSingleReadyPoints.value = points;
    const html = await render(scope);
    // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
    // Check rendered output or source structure; regex/string matches are not real browser interactions.
    assert.match(html, /id="big-single-ready-points"[^>]*aria-invalid="true"/);
    assert.match(html, /id="ready-points-error"[^>]*role="alert"/);
    assert.match(html, /class="button gold start-button"[^>]*disabled/);
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    await scope.mutate(null, true);
    // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
    // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
    assert.match(scope.error.value, /喜钱须为/);
  }
  // 准备：构造该变体的规则、牌局或对照快照，保持旧历史与当前输入分离。
  // Arrange this variant’s rules, game or comparison snapshot, keeping saved history separate from current input.
  scope.bigSingleReadyPoints.value = 0;
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.doesNotMatch(await render(scope), /id="ready-points-error"/);
});
// 场景：忙碌、离线或同步中禁用喜钱输入；请求快照防止重复点击改变已提交值
// Scenario: ready choice is disabled while busy offline or syncing and snapshots repeated clicks
test("ready choice is disabled while busy offline or syncing and snapshots repeated clicks", async () => {
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  for (const flag of ["busy", "offline", "syncing"]) {
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.
    const scope = setup(startFixture());
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    scope[flag].value = true;
    assert.match(
      await render(scope),
      /id="big-single-ready-points"[^>]*disabled/,
    );
  }
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const scope = setup(startFixture());
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.bigSingleReadyPoints.value = 80;
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let release;
  const requests = [];
  globalThis.fetch = (url, options) => {
    requests.push(JSON.parse(options.body));
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.

  const pending = scope.mutate(null, true);
  // 准备：构造该变体的规则、牌局或对照快照，保持旧历史与当前输入分离。
  // Arrange this variant’s rules, game or comparison snapshot, keeping saved history separate from current input.
  scope.bigSingleReadyPoints.value = 90;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await scope.mutate(null, true);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.bigSingleReadyPoints, 80);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const next = fixture({
    schemaVersion: 3,
  });
  next.game.rules = {
    specialHuPatterns: true,
    bigSingleReadyPayment: true,
    bigSingleReadyPoints: 80,
  };
  release(
    response({
      state: next,
    }),
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await pending;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.equal(scope.gameBigSingleReadyPoints.value, 80);
});
// 场景：所有玩家只读查看保存的喜钱金额、零金额及旧功能状态
// Scenario: all players see saved ready amount, zero and pre-feature status without editable inputs
test("all players see saved ready amount, zero and pre-feature status without editable inputs", async () => {
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  for (const you of [0, 1, 2])
    for (const points of [0, 80, undefined]) {
      const state = fixture({
        schemaVersion: 3,
      });
      state.you = you;
      state.game.rules = {
        specialHuPatterns: true,
        bigSingleReadyPayment: true,
        ...(points === undefined
          ? {}
          : {
              bigSingleReadyPoints: points,
            }),
      };
      const scope = setup(state);
      // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
      // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.

      // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
      // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
      scope.showRules.value = true;
      const html = await render(scope);
      // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
      // Check rendered output or source structure; regex/string matches are not real browser interactions.
      assert.doesNotMatch(html, /id="big-single-ready-points"/);
      assert.match(
        html,
        points === 0
          ? /0 分，不收取/
          : new RegExp(`另外2家各付 ${points ?? 50} 分`),
      );
      delete scope.state.value.game.rules.bigSingleReadyPayment;
      assert.match(await render(scope), /未启用，不补收/);
    }
});
// 场景：刷新恢复下局金额，普通轮询保留草稿编辑，离桌恢复默认值
// Scenario: refresh restores next-round amount, ordinary polling preserves edits, and leaving resets default
test("refresh restores next-round amount, ordinary polling preserves edits, and leaving resets default", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const scope = setup(startFixture());
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const next = startFixture("finished");
  next.game.id = "saved-game";
  next.game.rules = {
    bigSingleReadyPoints: 80,
  };
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.applyState(next);
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.equal(scope.bigSingleReadyPoints.value, 80);
  // 准备：构造该变体的规则、牌局或对照快照，保持旧历史与当前输入分离。
  // Arrange this variant’s rules, game or comparison snapshot, keeping saved history separate from current input.
  scope.bigSingleReadyPoints.value = 120;
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  scope.applyState({
    ...next,
    revision: 4,
  });
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.equal(scope.bigSingleReadyPoints.value, 120);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  scope.resetRoomContext();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.equal(scope.bigSingleReadyPoints.value, 50);
});
// 场景：听牌付款历史标记为喜钱，不混称即时杠分
// Scenario: ready payment history is labelled as 喜钱 instead of kong points
test("ready payment history is labelled as 喜钱 instead of kong points", async () => {
  // 准备：构造该变体的规则、牌局或对照快照，保持旧历史与当前输入分离。
  // Arrange this variant’s rules, game or comparison snapshot, keeping saved history separate from current input.
  const state = fixture({
    schemaVersion: 3,
  });
  state.game.history = [
    {
      type: "bigSingleReady",
      seat: 0,
      points: 80,
      message: "大单吊听牌喜钱",
      payments: [
        {
          seat: 1,
          delta: -80,
        },
        {
          seat: 2,
          delta: -80,
        },
        {
          seat: 0,
          delta: 160,
        },
      ],
    },
  ];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const html = await render(setup(state));
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.match(html, /听牌喜钱/);
  assert.doesNotMatch(html, /即时杠分/);
});

// 场景：声音先结束或画面先结束，都必须收齐两个完成信号才确认；重复轮询不能提前放行。
// Scenario: either completion order requires both signals; repeated polls cannot release the table early.
for (const order of ['audio-first', 'animation-first']) {
  test(`table presentation waits for audio and actual animations: ${order}`, async () => {
    const scope = setup(fixture({ schemaVersion: 3 }));
    const next = presentationFixture(scope);
    let finishAudio, finishAnimation;
    const audio = new Promise((resolve) => { finishAudio = resolve; });
    const animation = new Promise((resolve) => { finishAnimation = resolve; });
    scope.characterAudio.enqueueLive = () => audio;
    document.querySelectorAll = () => [{
      getAnimations: () => [{ finished: animation, cancel() { finishAnimation(); } }],
    }];
    const requests = [];
    globalThis.fetch = async (path, options) => {
      requests.push({ path, body: JSON.parse(options.body) });
      return response({ state: { ...next, revision: next.revision + 1,
        presentation: { ...next.presentation, owners: { 0: scope.presentationClientId },
          completedSeats: JSON.parse(options.body).phase === "begin" ? [] : [0] } } });
    };
    scope.applyState(next);
    await settle();
    scope.applyState({ ...next, revision: next.revision + 1 });
    await scope.mutate({ type: 'discard', tile: 0 });
    assert.equal(requests.filter((request) => request.body.phase !== "begin").length, 0);
    assert.equal(scope.isMyTurn.value, false);
    assert.deepEqual(scope.legalActions.value, []);
    scheduled.find((item) => item.delay === 2800 && !item.cancelled).callback();
    if (order === 'audio-first') finishAudio();
    else finishAnimation();
    await settle();
    assert.equal(requests.filter((request) => request.body.phase !== "begin").length, 0);
    if (order === 'audio-first') finishAnimation();
    else finishAudio();
    await settle();
    assert.equal(requests.length, 2);
    assert.equal(requests[1].path, '/api/rooms/ABCDEF23/presentation');
    assert.equal(requests[1].body.presentationId, 'playback-one');
    assert.equal(requests[1].body.gameId, 'playback-game');
    assert.equal(scope.localPresentationBusy.value, false);
    assert.equal(scope.presentationWaiting.value, true, 'other seats still need to finish');
    scope.resetRoomContext();
  });
}

// 场景：静音/未解锁、后台和重连都明确跳过本机媒体，但仍等待服务端全桌确认。
// Scenario: unavailable audio, hidden tabs and reconnect baselines skip local media but retain table gating.
for (const mode of ['locked', 'muted', 'hidden', 'reconnect']) {
  test(`presentation can complete without replay or deadlock: ${mode}`, async () => {
    const scope = setup(fixture({ schemaVersion: 3 }));
    const next = presentationFixture(scope, 'discard');
    if (mode === 'locked') scope.characterAudio.unlocked = false;
    if (mode === 'muted') scope.characterAudio.setMuted(true);
    if (mode === 'hidden') document.hidden = true;
    if (mode === 'reconnect') { scope.voiceCursor.reset(); scope.offline.value = true; }
    const requests = [];
    globalThis.fetch = async (path, options) => {
      requests.push(path);
      return response({ state: { ...next, revision: next.revision + 1,
        presentation: { ...next.presentation, owners: { 0: scope.presentationClientId },
          completedSeats: JSON.parse(options.body).phase === "begin" ? [] : [0] } } });
    };
    scope.applyState(next);
    await settle();
    assert.deepEqual(requests, ['locked', 'muted'].includes(mode)
      ? ['/api/rooms/ABCDEF23/presentation', '/api/rooms/ABCDEF23/presentation']
      : []);
    assert.equal(scope.winningEvents.value.length, 0);
    assert.equal(scope.presentationWaiting.value, true);
    scope.resetRoomContext();
  });
}

// 场景：确认丢包后仅在同步验证同一个 ID 仍待确认时重试，不重新播放或重发动作。
// Scenario: a lost ack retries only after a verified poll finds the same gate, without replaying media or a move.
test('presentation acknowledgement retries idempotently after a verified unchanged poll', async () => {
  const scope = setup(fixture({ schemaVersion: 3 }));
  const next = presentationFixture(scope, 'discard');
  const paths = [];
  let receipts = 0;
  globalThis.fetch = async (path, options) => {
    paths.push(path);
    if (path.endsWith('/presentation')) {
      if (JSON.parse(options.body).phase !== 'begin') receipts++;
      if (receipts === 1 && JSON.parse(options.body).phase !== 'begin') throw new Error('Lost response');
      return response({ state: { ...next, revision: next.revision + 1,
        presentation: { ...next.presentation, owners: { 0: scope.presentationClientId },
          completedSeats: JSON.parse(options.body).phase === "begin" ? [] : [0] } } });
    }
    return response({ unchanged: true, revision: next.revision });
  };
  scope.applyState(next);
  await settle();
  assert.equal(receipts, 1);
  await scope.refresh();
  await settle();
  assert.equal(receipts, 2);
  assert.equal(paths.some((path) => path.endsWith('/action')), false);
  scope.resetRoomContext();
});

// 场景：旧桌媒体迟到完成或确认迟到返回，不能污染新会话或发送旧桌新动作。
// Scenario: late old-room media/ack completion cannot update a new session or submit old-room moves.
test('leaving during presentation invalidates completion and late acknowledgements', async () => {
  const scope = setup(fixture({ schemaVersion: 3 }));
  const next = presentationFixture(scope, 'discard');
  let finishAudio;
  scope.characterAudio.enqueueLive = () => new Promise((resolve) => { finishAudio = resolve; });
  const paths = [];
  globalThis.fetch = async (path) => {
    paths.push(path);
    return response({ state: { ...next, revision: next.revision + 1,
      presentation: { ...next.presentation, owners: { 0: scope.presentationClientId } } } });
  };
  scope.applyState(next);
  await settle();
  scope.resetRoomContext();
  finishAudio();
  await settle();
  assert.deepEqual(paths, ['/api/rooms/ABCDEF23/presentation']);
  assert.equal(scope.presentationWaiting.value, false);
});

// 场景：同座位另一个页面取得播放权时，本页不播放、不确认，也不放开动作。
// Scenario: another page owning the same seat keeps this page silent, unable to acknowledge or act.
test('a duplicate seat tab cannot play or acknowledge another page presentation', async () => {
  const scope = setup(fixture({ schemaVersion: 3 }));
  const next = presentationFixture(scope);
  let playCount = 0;
  scope.characterAudio.enqueueLive = () => { playCount++; return Promise.resolve(); };
  const bodies = [];
  globalThis.fetch = async (_path, options) => {
    bodies.push(JSON.parse(options.body));
    return response({ state: { ...next, revision: next.revision + 1,
      presentation: { ...next.presentation, owners: { 0: 'another-page' } } } });
  };
  scope.applyState(next);
  await settle();
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].phase, 'begin');
  assert.equal(playCount, 0);
  assert.equal(scope.winningEvents.value.length, 0);
  assert.equal(scope.presentationWaiting.value, true);
  scope.applyState(scope.state.value);
  await settle();
  assert.equal(bodies.length, 1);
  scope.resetRoomContext();
});

// 场景：展示截止时先取消动画与声音，完成回执不能在残留媒体仍播放时发出。
// Scenario: the gate deadline cancels visuals/audio before issuing a completion receipt.
test('presentation deadline stops media before acknowledging completion', async () => {
  const scope = setup(fixture({ schemaVersion: 3 }));
  const next = presentationFixture(scope);
  next.presentation.remainingMs = 100;
  let finishAudio;
  let stopped = false;
  scope.characterAudio.enqueueLive = () => new Promise((resolve) => { finishAudio = resolve; });
  scope.characterAudio.clear = () => {
    if (finishAudio) { stopped = true; finishAudio(); }
  };
  const bodies = [];
  globalThis.fetch = async (_path, options) => {
    const body = JSON.parse(options.body);
    bodies.push(body);
    if (body.phase !== 'begin') {
      assert.equal(stopped, true);
      assert.equal(scope.winningEvents.value.length, 0);
    }
    return response({ state: { ...next, revision: next.revision + bodies.length,
      presentation: { ...next.presentation, owners: { 0: scope.presentationClientId },
        completedSeats: body.phase === 'begin' ? [] : [0] } } });
  };
  scope.applyState(next);
  await settle();
  assert.equal(bodies.length, 1);
  scheduled.find((item) => item.delay === 100 && !item.cancelled).callback();
  await settle();
  assert.equal(bodies.length, 2);
  scope.resetRoomContext();
});

// 场景：播放权认领的迟到响应不能让已离桌页面重新出现或播出旧动作。
// Scenario: a late ownership response cannot revive a departed table or play its old action.
test('late playback ownership response is ignored after leaving', async () => {
  const scope = setup(fixture({ schemaVersion: 3 }));
  const next = presentationFixture(scope);
  let deliver;
  let playCount = 0;
  scope.characterAudio.enqueueLive = () => { playCount++; return Promise.resolve(); };
  globalThis.fetch = () => new Promise((resolve) => { deliver = resolve; });
  scope.applyState(next);
  scope.resetRoomContext();
  deliver(response({ state: { ...next,
    presentation: { ...next.presentation, owners: { 0: scope.presentationClientId } } } }));
  await settle();
  assert.equal(playCount, 0);
  assert.equal(scope.state.value, null);
  assert.equal(scope.presentationWaiting.value, false);
});

// 场景：认领失败后切后台再回来，重试可以确认但不可补播已经作废的旧动作。
// Scenario: an ownership retry after hiding/returning may acknowledge, but must not replay invalidated media.
test('ownership retries after visibility reset never replay the pending old event', async () => {
  const scope = setup(fixture({ schemaVersion: 3 }));
  const next = presentationFixture(scope);
  const batches = [];
  scope.characterAudio.enqueueLive = (events) => { batches.push(events); return Promise.resolve(); };
  let claims = 0;
  globalThis.fetch = async (_path, options) => {
    const body = JSON.parse(options.body);
    if (body.phase === 'begin' && ++claims === 1) throw new Error('Claim response lost');
    return response({ state: { ...next, revision: next.revision + claims,
      presentation: { ...next.presentation, owners: { 0: scope.presentationClientId },
        completedSeats: body.phase === 'begin' ? [] : [0] } } });
  };
  scope.applyState(next);
  await settle();
  assert.equal(batches.length, 0);
  document.hidden = true;
  scope.visibilityChanged();
  document.hidden = false;
  scope.visibilityChanged();
  scope.applyState({ ...next, revision: next.revision + 1 });
  await settle();
  assert.equal(claims, 1);
  assert.deepEqual(batches, []);
  assert.equal(scope.winningEvents.value.length, 0);
  assert.equal(scope.localPresentationBusy.value, false);
  scope.resetRoomContext();
});

// 场景：先收到快照的后台、空基线或未解锁副页都不能吞掉同座位前台的胡牌音画。
// Scenario: an earlier hidden, baseline-only or locked sibling cannot consume the foreground seat's win media.
for (const siblingMode of ['hidden', 'baseline', 'locked']) {
  test(`foreground win media survives a faster same-seat ${siblingMode} sibling`, async () => {
    const sibling = setup(fixture({ schemaVersion: 3 }));
    const siblingNext = presentationFixture(sibling);
    const foreground = setup(fixture({ schemaVersion: 3 }));
    const next = presentationFixture(foreground);
    assert.notEqual(sibling.presentationClientId, foreground.presentationClientId);
    if (siblingMode === 'baseline') sibling.voiceCursor.reset();
    if (siblingMode === 'locked') sibling.characterAudio.unlocked = false;
    // 服务端根据之前分别注册的前台租约选择可发声页面，客户端不再靠固定延时抢先。
    // The server chooses the audible page from independently registered leases, not a client-side timing race.
    siblingNext.presentation.preferredClients = { 0: foreground.presentationClientId };
    next.presentation.preferredClients = { 0: foreground.presentationClientId };
    let finishAudio;
    const played = [];
    foreground.characterAudio.enqueueLive = (events) => {
      played.push(events);
      return new Promise((resolve) => { finishAudio = resolve; });
    };
    const receipts = [];
    let authoritative = structuredClone(next);
    authoritative.presentation.owners = {};
    globalThis.fetch = async (_path, options) => {
      const body = JSON.parse(options.body);
      receipts.push(body);
      const gate = authoritative.presentation;
      if (body.phase === 'begin' && !gate.owners[0]) gate.owners[0] = body.clientId;
      else if (body.phase !== 'begin' && gate.owners[0] === body.clientId) gate.completedSeats = [0];
      authoritative.revision++;
      return response({ state: structuredClone(authoritative) });
    };
    document.hidden = siblingMode === 'hidden';
    sibling.applyState(siblingNext);
    await settle();
    assert.equal(receipts.length, 0, 'the passive sibling must not win before foreground polling');
    document.hidden = false;
    foreground.applyState(next);
    await settle();
    assert.equal(authoritative.presentation.owners[0], foreground.presentationClientId);
    assert.equal(played.length, 1);
    assert.equal(played[0][0].type, 'hu');
    assert.equal(foreground.winningEvents.value.length, 1);
    assert.deepEqual(authoritative.presentation.completedSeats, []);
    // 副页继续轮询也不能使前台还在播放的本座位提前完成。
    // Further sibling polling cannot complete the seat while foreground media still runs.
    document.hidden = siblingMode === 'hidden';
    sibling.applyState(structuredClone(authoritative));
    await settle();
    document.hidden = false;
    assert.deepEqual(authoritative.presentation.completedSeats, []);
    assert.equal(foreground.winningEvents.value.length, 1);
    scheduled.find((item) => item.delay === 2800 && !item.cancelled).callback();
    await settle();
    assert.deepEqual(authoritative.presentation.completedSeats, [], 'voice still running after visuals finish');
    finishAudio();
    await settle();
    assert.deepEqual(authoritative.presentation.completedSeats, [0]);
    assert.equal(receipts.filter((body) => body.phase !== 'begin').length, 1);
    foreground.resetRoomContext();
    sibling.resetRoomContext();
  });
}

// 场景：认领飞行期间转后台要归还所有权，不能用空媒体完成来抢掉另一个页面的播放。
// Scenario: hiding while a claim is in flight releases ownership, rather than completing with empty media.
test('a page hidden during ownership claim releases the gate without completing it', async () => {
  const scope = setup(fixture({ schemaVersion: 3 }));
  const next = presentationFixture(scope);
  let deliverBegin;
  let plays = 0;
  const requests = [];
  scope.characterAudio.enqueueLive = () => { plays++; return Promise.resolve(); };
  globalThis.fetch = async (_path, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    if (body.phase === 'begin') return new Promise((resolve) => { deliverBegin = resolve; });
    assert.equal(body.phase, 'release');
    return response({ state: { ...next, revision: next.revision + 2,
      presentation: { ...next.presentation, owners: {}, completedSeats: [] } } });
  };
  scope.applyState(next);
  document.hidden = true;
  scope.visibilityChanged();
  deliverBegin(response({ state: { ...next, revision: next.revision + 1,
    presentation: { ...next.presentation, owners: { 0: scope.presentationClientId } } } }));
  await settle();
  assert.deepEqual(requests.map((body) => body.phase), ['begin', 'release']);
  assert.equal(plays, 0);
  assert.deepEqual(scope.state.value.presentation.completedSeats, []);
  assert.deepEqual(scope.state.value.presentation.owners, {});
  scope.resetRoomContext();
});

// 场景：前台页先看到他页暂时拥有，待他页在播放前释放后仍能接手，不被误记为已开始。
// Scenario: foreground ownership loss is not playback; after an unstarted sibling releases, fresh media can take over.
test('a foreground sibling takes over after observing an unstarted owner release', async () => {
  const scope = setup(fixture({ schemaVersion: 3 }));
  const next = presentationFixture(scope);
  let finishAudio;
  const batches = [];
  scope.characterAudio.enqueueLive = (events) => {
    batches.push(events);
    return new Promise((resolve) => { finishAudio = resolve; });
  };
  const bodies = [];
  globalThis.fetch = async (_path, options) => {
    const body = JSON.parse(options.body);
    bodies.push(body);
    return response({ state: { ...next, revision: next.revision + bodies.length + 1,
      presentation: { ...next.presentation, owners: { 0: scope.presentationClientId },
        completedSeats: body.phase === 'begin' ? [] : [0] } } });
  };
  scope.applyState({ ...next, presentation: { ...next.presentation, owners: { 0: 'claim-in-flight' } } });
  await settle();
  assert.equal(bodies.length, 0);
  assert.equal(batches.length, 0);
  scope.applyState({ ...next, revision: next.revision + 1,
    presentation: { ...next.presentation, owners: {} } });
  await settle();
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].phase, 'begin');
  assert.equal(batches[0][0].type, 'hu');
  assert.equal(scope.winningEvents.value.length, 1);
  scheduled.find((item) => item.delay === 2800 && !item.cancelled).callback();
  await settle();
  assert.equal(bodies.length, 1);
  finishAudio();
  await settle();
  assert.equal(bodies.length, 2);
  scope.resetRoomContext();
});

// 场景：真实 API + 四个真实 App 协调：隐藏座位不拖慢牌局，同座位后台副页不能结束前台慢语音。
// Scenario: real API plus four App instances exclude a hidden seat while preserving a foreground sibling's slow voice.
test('real API foreground leases skip a hidden seat but await active sibling media', async () => {
  browser();
  // WebCrypto 鉴权使用实际异步任务队列；有限轮事件循环等待真实请求，而非只排空 Promise 微任务。
  // Real WebCrypto authentication uses event-loop tasks; bounded turns await actual requests, not only promise microtasks.
  const settleRequests = async (complete) => {
    for (let turn = 0; turn < 1000; turn++) {
      if (await complete()) return;
      await new Promise((resolve) => originals.setTimeout(resolve, 5));
    }
    assert.fail('The real authenticated request did not finish within five seconds');
  };
  const store = new MemoryStore();
  const handle = createApi(store);
  const tokens = [];
  const call = async (path, seat, body) => {
    const result = await handle(new Request(`https://example.test/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: seat === undefined ? {} : { authorization: `Bearer ${tokens[seat]}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    assert.ok(result.status >= 200 && result.status < 300);
    return result.json();
  };
  const created = await call('rooms', undefined, { name: '前台甲' });
  tokens.push(created.token);
  for (const name of ['前台乙', '后台丙'])
    tokens.push((await call(`rooms/${created.roomId}/join`, undefined, { name })).token);
  let roomState = (await call(`rooms/${created.roomId}`, 0)).state;
  await call(`rooms/${created.roomId}/start`, 0, { revision: roomState.revision, presentation: true });
  const room = await store.get(created.roomId);
  room.game = postHuKongGame({ type: 'anGang', winningDraw: true, huCount: 0 });
  await store.compareAndSwap(room, room.revision);
  const scopes = [];
  for (const seat of [0, 1, 2, 1]) {
    const scope = lobby();
    scope.session.value = { roomId: created.roomId, token: tokens[seat] };
    scope.characterAudio.unlocked = true;
    scope.characterAudio.context = { state: 'running' };
    scope.characterAudio.warmWins = () => Promise.resolve();
    scope.characterAudio.enqueueLive = () => Promise.resolve();
    scope.applyState((await call(`rooms/${created.roomId}`, seat)).state);
    scopes.push(scope);
  }
  // 本用例专门保留旧屏障兼容契约；模拟未发送 local 能力的已发布浏览器。
  // This case retains the legacy barrier contract by simulating a published browser without local capability.
  globalThis.fetch = (path, options) => {
    if (options.body && path.endsWith('/action')) {
      const body = JSON.parse(options.body);
      delete body.presentationMode;
      options = { ...options, body: JSON.stringify(body) };
    }
    return handle(new Request(`https://example.test${path}`, options));
  };
  // 各实例先独立登记状态。后登记的后台副页不得覆盖同座位已登记的前台实例。
  // Register independently; the later hidden duplicate cannot overwrite its seat's foreground instance.
  for (const [index, scope] of scopes.entries()) {
    document.hidden = index >= 2;
    const data = await scope.api(`/api/rooms/${created.roomId}`);
    scope.applyState(data.state);
  }
  document.hidden = false;
  let finishSlowVoice;
  const spoken = [];
  scopes[1].characterAudio.enqueueLive = (events) => {
    spoken.push(events);
    return new Promise((resolve) => { finishSlowVoice = resolve; });
  };
  await scopes[0].mutate({ type: 'hu' });
  await settleRequests(() => scopes[0].winningEvents.value.length === 1);
  await scopes[1].refresh();
  await settleRequests(() => spoken.length === 1);
  const paused = await store.get(created.roomId);
  assert.deepEqual(paused.presentation.requiredSeats, [0, 1]);
  assert.equal(paused.presentation.preferredClients[1], scopes[1].presentationClientId);
  assert.equal(paused.presentation.owners[1], scopes[1].presentationClientId);
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0][0].type, 'hu');
  assert.equal(scopes[1].winningEvents.value.length, 1);
  const frozen = structuredClone(paused.game);
  document.hidden = true;
  await scopes[3].refresh();
  await settle();
  document.hidden = false;
  for (const timer of scheduled.filter((item) => item.delay === 2800 && !item.cancelled)) timer.callback();
  await settleRequests(async () => (await store.get(created.roomId)).presentation.completedSeats.includes(0));
  assert.deepEqual((await store.get(created.roomId)).game, frozen, 'foreground voice still holds the actual engine');
  finishSlowVoice();
  await settleRequests(async () => !(await store.get(created.roomId)).presentation);
  assert.deepEqual((await store.get(created.roomId)).game, continuePresentedGame(frozen));
  assert.equal((await store.get(created.roomId)).presentation, undefined);
  for (const scope of scopes) scope.resetRoomContext();
});

// 模拟真实音频完成结构；共享协调器不能把空Promise当成播放成功。
// Mirror real audio outcomes; the coordinator must never treat a void promise as successful playback.
const successfulAudio = (events) => ({ events: events.map(({ eventKey }) => ({ eventKey, status: 'success' })) });
// 共享锁、基线登记和媒体完成各有Promise层；只推进微任务，不伪造媒体或墙钟时间。
// Locks, baseline registration and media completion add promise layers; drain microtasks without faking media or wall time.
async function settlePlayback() {
  for (let i = 0; i < 120; i++) await Promise.resolve();
}
// 为新模式创建合成快照；慢媒体由Promise控制，不替代真实浏览器验收。
// Build local-mode snapshots with controllable media promises, never a substitute for real-browser acceptance.
function localPlaybackFixture(scope, type = 'discard') {
  const next = presentationFixture(scope, type);
  next.presentationMode = 'local';
  next.presentation.mode = 'local';
  scope.characterAudio.enqueueOrdered = (events) => Promise.resolve(successfulAudio(events));
  return next;
}

// 接收游标独立于展示状态：重复轮询、下一段、合法动作更新均不能截断本机当前声音。
// Received cursors are independent of displayed frames: polls, later segments and legal-action updates cannot interrupt speech.
test('local playback queues every event and reveals latest controls only after its own FIFO drains', async () => {
  browser();
  const scope = setup(fixture({ schemaVersion: 3 }));
  const first = localPlaybackFixture(scope);
  const calls = [];
  const finishes = [];
  scope.characterAudio.enqueueOrdered = (events) => {
    calls.push(events.map((event) => event.eventKey));
    return new Promise((resolve) => finishes.push(() => resolve(successfulAudio(events))));
  };
  scope.applyState(first);
  const second = structuredClone(first);
  second.revision++;
  second.presentation.id = 'playback-two';
  second.game.history.push({ type: 'discard', seat: 1, tile: 1 });
  scope.applyState(second);
  scope.applyState(second);
  const latest = { ...second, revision: second.revision + 1, presentation: null };
  scope.applyState(latest);
  await settlePlayback();
  assert.equal(calls.length, 1);
  assert.equal(scope.state.value.revision, first.revision);
  assert.equal(scope.legalActions.value.length, 0);
  assert.equal(scope.localPresentationBusy.value, true);
  finishes.shift()();
  for (const timer of scheduled.filter((item) => item.delay === 350 && !item.cancelled)) timer.callback();
  await settlePlayback();
  assert.equal(calls.length, 2);
  assert.equal(scope.state.value.revision, second.revision);
  finishes.shift()();
  for (const timer of scheduled.filter((item) => item.delay === 350 && !item.cancelled)) timer.callback();
  await settlePlayback();
  assert.equal(scope.state.value.revision, latest.revision);
  assert.equal(scope.localPresentationBusy.value, false);
  assert.notEqual(calls[0][0], calls[1][0]);
  scope.resetRoomContext();
});

// 一次轮询跨过多段仍完整入队；相同来源双胡成组，后续自摸另组且定位各自胡牌区。
// A poll spanning several segments queues all events, grouping shared-discard winners but keeping later self-draws separate.
test('local playback keeps skipped-poll events, simultaneous winners and subsequent hu in chronological groups', async () => {
  browser();
  const scope = setup(fixture({ schemaVersion: 3 }));
  const next = localPlaybackFixture(scope);
  next.game.players[0].winPile = [{ tile: 3, discardIndex: 0 }, { tile: 4 }];
  next.game.players[1].winPile = [{ tile: 3, discardIndex: 0 }];
  next.game.history.push(
    { type: 'hu', seat: 0, tile: 3, source: 'discard', fromSeat: 2 },
    { type: 'hu', seat: 1, tile: 3, source: 'discard', fromSeat: 2 },
    { type: 'draw', seat: 0 },
    { type: 'hu', seat: 0, tile: 4, source: 'selfDraw' },
    { type: 'discard', seat: 2, tile: 2 },
  );
  const calls = [];
  scope.characterAudio.enqueueOrdered = (events) => {
    calls.push(events.map((event) => ({ type: event.type, seat: event.seat, winIndex: event.winIndex })));
    return Promise.resolve(successfulAudio(events));
  };
  scope.applyState(next);
  for (const timer of scheduled.filter((item) => item.delay === 350 && !item.cancelled)) timer.callback();
  await settlePlayback();
  assert.deepEqual(calls.map((group) => group.map((event) => event.type)), [['discard'], ['hu'], ['hu']]);
  assert.deepEqual(scope.winningEvents.value.map((event) => event.winIndex), [0, 0]);
  scheduled.findLast((timer) => timer.delay === 4500 && !timer.cancelled).callback();
  await settlePlayback();
  assert.equal(calls.length, 4);
  assert.equal(scope.winningEvents.value[0].winIndex, 1);
  scheduled.findLast((timer) => timer.delay === 2800 && !timer.cancelled).callback();
  await settlePlayback();
  assert.deepEqual(calls.map((group) => group.map((event) => event.type)), [['discard'], ['hu'], ['hu'], ['hu'], ['discard']]);
  scope.resetRoomContext();
});

// 409 是服务器已响应的同步竞争；不能冒充断网、弹重连提示或静默吞掉下一条事件。
// A 409 is a server response indicating contention, not a disconnect, reconnect toast or silent cursor advance.
test('poll 409 preserves online playback and the next live announcement', async () => {
  browser();
  const scope = setup(fixture({ schemaVersion: 3 }));
  const next = localPlaybackFixture(scope);
  const spoken = [];
  scope.characterAudio.enqueueOrdered = (events) => { spoken.push(...events); return Promise.resolve(successfulAudio(events)); };
  globalThis.fetch = async () => response({ code: 'STALE_STATE', error: '牌桌已更新' }, 409);
  await scope.refresh();
  assert.equal(scope.offline.value, false);
  assert.equal(scope.syncing.value, true);
  globalThis.fetch = async () => response({ state: next });
  await scope.refresh();
  await settlePlayback();
  assert.equal(spoken.length, 1);
  assert.equal(scope.offline.value, false);
  assert.doesNotMatch(scope.notice.value, /重新连接/);
  scope.resetRoomContext();
});

// 短网络中断可从权威历史补齐本次现场事件；隐藏/离桌仍取消，旧 Promise 不可恢复已退出队列。
// Brief outages recover live events from authority; hiding/leaving still cancels and stale promises cannot revive old queues.
test('local playback survives a short transport gap but cancels on visibility and room changes', async () => {
  browser();
  const scope = setup(fixture({ schemaVersion: 3 }));
  const next = localPlaybackFixture(scope);
  const spoken = [];
  let finish;
  scope.characterAudio.enqueueOrdered = (events) => {
    spoken.push(...events);
    return new Promise((resolve) => { finish = () => resolve(successfulAudio(events)); });
  };
  globalThis.fetch = async () => { throw new Error('temporary transport failure'); };
  await scope.refresh();
  assert.equal(scope.offline.value, true);
  globalThis.fetch = async () => response({ state: next });
  await scope.refresh();
  await settlePlayback();
  assert.equal(spoken.length, 1);
  document.hidden = true;
  scope.visibilityChanged();
  assert.equal(scope.localPresentationBusy.value, false);
  scope.resetRoomContext();
  finish();
  await settlePlayback();
  assert.equal(scope.state.value, null);
  assert.equal(scope.localPresentationBusy.value, false);
  document.hidden = false;
});

// Web Locks 和共享精确事件记录保证同浏览器同座副页不重复发声；锁等待期间离桌也安全取消。
// Web Locks plus shared exact-event records suppress duplicate sibling speech and safely invalidate queued lock waits.
test('local same-seat tabs share one audible event through a lock and exact-event record', async () => {
  browser();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let tail = Promise.resolve();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request(_key, callback) { const result = tail.then(callback); tail = result.catch(() => {}); return result; },
  } } });
  const scopes = [setup(fixture({ schemaVersion: 3 }))];
  // 同座副页必须共享同一个Storage对象；再次setup会创建隔离浏览器。
  // Sibling tabs must share one Storage object; another setup call creates an isolated browser.
  const sibling = App.setup({}, { expose() {} });
  sibling.session.value = credential();
  sibling.state.value = fixture({ schemaVersion: 3 });
  scopes.push(sibling);
  try {
    const next = scopes.map((scope) => localPlaybackFixture(scope));
    const spoken = [];
    let finish;
    scopes[0].characterAudio.enqueueOrdered = (events) => { spoken.push(0); return new Promise((resolve) => { finish = () => resolve(successfulAudio(events)); }); };
    scopes[1].characterAudio.enqueueOrdered = (events) => { spoken.push(1); return Promise.resolve(successfulAudio(events)); };
    scopes[0].applyState(next[0]);
    scopes[1].applyState(next[1]);
    await settlePlayback();
    assert.deepEqual(spoken, [0]);
    finish();
    for (const timer of scheduled.filter((item) => item.delay === 350 && !item.cancelled)) timer.callback();
    await settlePlayback();
    assert.deepEqual(spoken, [0]);
    assert.equal(scopes[1].localPresentationBusy.value, false);
  } finally {
    scopes.forEach((scope) => scope.resetRoomContext());
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  }
});

// 同座去重只能静音，不能删掉副页的飞牌和字幕。
// Same-seat deduplication suppresses sound only, never a sibling page's flights and captions.
test('same-seat audio deduplication retains each page win animation', async () => {
  browser();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let tail = Promise.resolve();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request(_key, callback) { const result = tail.then(callback); tail = result.catch(() => {}); return result; },
  } } });
  const scopes = [setup(fixture({ schemaVersion: 3 }))];
  // 同座副页必须共享同一个Storage对象；再次setup会创建隔离浏览器。
  // Sibling tabs must share one Storage object; another setup call creates an isolated browser.
  const sibling = App.setup({}, { expose() {} });
  sibling.session.value = credential();
  sibling.state.value = fixture({ schemaVersion: 3 });
  scopes.push(sibling);
  try {
    const snapshots = scopes.map((scope) => localPlaybackFixture(scope, 'hu'));
    let spoken = 0;
    for (const scope of scopes) scope.characterAudio.enqueueOrdered = (events) => { spoken++; return Promise.resolve(successfulAudio(events)); };
    scopes.forEach((scope, index) => scope.applyState(snapshots[index]));
    await settlePlayback();
    assert.equal(spoken, 1);
    assert.deepEqual(scopes.map((scope) => scope.winningEvents.value.length), [1, 1]);
    assert.deepEqual(scopes.map((scope) => scope.localPresentationBusy.value), [true, true]);
    for (const timer of scheduled.filter((item) => item.delay === 2800 && !item.cancelled)) timer.callback();
    await settlePlayback();
    assert.deepEqual(scopes.map((scope) => scope.localPresentationBusy.value), [false, false]);
  } finally {
    scopes.forEach((scope) => scope.resetRoomContext());
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  }
});

// 锁排队期间静音不应写入已播记录；普通静音动作依旧有可见停留。
// Muting while a lock is queued must not consume the event, and ordinary silent calls retain visible dwell.
test('mute while awaiting a playback lock leaves the exact event available to audible siblings', async () => {
  const { localItems } = browser();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let release;
  const permission = new Promise((resolve) => { release = resolve; });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request: async (_key, callback) => { await permission; return callback(); },
  } } });
  const scope = setup(fixture({ schemaVersion: 3 }));
  try {
    const next = localPlaybackFixture(scope);
    let spoken = 0;
    scope.characterAudio.enqueueOrdered = (events) => { spoken++; return Promise.resolve(successfulAudio(events)); };
    scope.applyState(next);
    scope.characterAudio.muted = true;
    release();
    await settlePlayback();
    assert.equal(spoken, 0);
    assert.equal([...localItems.keys()].some((key) => key.startsWith('huajian-presentation-v1:')), false);
    assert.equal(scope.localPresentationBusy.value, true, 'silent caption remains visible');
    for (const timer of scheduled.filter((item) => item.delay === 350 && !item.cancelled)) timer.callback();
    await settlePlayback();
    assert.equal(scope.localPresentationBusy.value, false);
  } finally {
    scope.resetRoomContext();
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  }
});

for (const completionOrder of ['audio-first', 'animation-first']) {
  // 服务端已经推进、新事件已收到时，当前胡动画和声音仍分别完整结束，不能被新段替换。
  // Even after authority advances and another event arrives, current win audio and visuals must both finish.
  test(`local queued next event waits for both win media paths: ${completionOrder}`, async () => {
    browser();
    const scope = setup(fixture({ schemaVersion: 3 }));
    const first = localPlaybackFixture(scope, 'hu');
    const spoken = [];
    let finishVoice;
    scope.characterAudio.enqueueOrdered = (events) => {
      spoken.push(events[0].type);
      return events[0].type === 'hu'
        ? new Promise((resolve) => { finishVoice = () => resolve(successfulAudio(events)); }) : Promise.resolve(successfulAudio(events));
    };
    scope.applyState(first);
    const later = structuredClone(first);
    later.revision++;
    later.presentation = null;
    later.game.history.push({ type: 'discard', seat: 1, tile: 2 });
    scope.applyState(later);
    const finishVisual = () => scheduled.findLast((timer) => timer.delay === 2800 && !timer.cancelled).callback();
    await settlePlayback();
    if (completionOrder === 'audio-first') finishVoice();
    else finishVisual();
    await settlePlayback();
    assert.deepEqual(spoken, ['hu']);
    assert.equal(scope.localPresentationBusy.value, true);
    if (completionOrder === 'audio-first') finishVisual();
    else finishVoice();
    await settlePlayback();
    assert.deepEqual(spoken, ['hu', 'discard']);
    for (const timer of scheduled.filter((item) => item.delay === 350 && !item.cancelled)) timer.callback();
    await settlePlayback();
    assert.equal(scope.state.value.revision, later.revision);
    assert.equal(scope.localPresentationBusy.value, false);
    scope.resetRoomContext();
  });
}

// 网络断开不代表玩家选择略过；已收到的积压与恢复后新增事件都应保序。
// A transport gap is not consent to skip: preserve both received backlog and the recovered suffix.
test('local foreground gap longer than five seconds preserves received FIFO and recovered events', async () => {
  const scope = setup(fixture({ schemaVersion: 3 }));
  const first = localPlaybackFixture(scope);
  const second = structuredClone(first);
  second.revision++;
  second.game.history.push({ type: 'discard', seat: 1, tile: 1 });
  const calls = [];
  const finishes = [];
  scope.characterAudio.enqueueOrdered = (events) => {
    calls.push(events.map((event) => event.eventKey));
    return new Promise((resolve) => finishes.push(() => resolve(successfulAudio(events))));
  };
  const originalNow = Date.now;
  try {
    scope.applyState(first);
    scope.applyState(second);
    await settlePlayback();
    assert.equal(calls.length, 1);
    Date.now = () => originalNow() + 6100;
    scope.offline.value = true;
    const recovered = structuredClone(second);
    recovered.revision++;
    recovered.presentation = null;
    recovered.game.history.push({ type: 'discard', seat: 2, tile: 2 });
    scope.applyState(recovered);
    assert.equal(scope.pendingPresentationCount.value, 3);
    for (let index = 0; index < 3; index++) {
      finishes.shift()();
      for (const timer of scheduled.filter((item) => item.delay === 350 && !item.cancelled)) timer.callback();
      await settlePlayback();
    }
    assert.deepEqual(calls.flat().map((key) => key.split(':').at(-1)), ['0', '1', '2']);
    assert.equal(scope.localPresentationBusy.value, false);
    assert.equal(scope.state.value.revision, recovered.revision);
  } finally { Date.now = originalNow; scope.resetRoomContext(); }
});

// 静音时接收的队列只保留画面；在其排空前取消静音也不能改变旧票据的资格。
// Events received while muted retain visuals only; unmuting before they drain cannot promote old tickets.
test('unmuting never voices events received while muted', async () => {
  const scope = setup(fixture({ schemaVersion: 3 }));
  const snapshot = localPlaybackFixture(scope);
  snapshot.game.history.push({ type: 'discard', seat: 1, tile: 1 });
  const spoken = [];
  scope.characterAudio.enqueueOrdered = (events) => {
    spoken.push(...events); return Promise.resolve(successfulAudio(events));
  };
  scope.characterAudio.muted = true;
  scope.applyState(snapshot);
  scope.characterAudio.muted = false;
  for (let index = 0; index < 2; index++) {
    for (const timer of scheduled.filter((item) => item.delay === 350 && !item.cancelled)) timer.callback();
    await settlePlayback();
  }
  assert.deepEqual(spoken, []);
  assert.equal(scope.localPresentationBusy.value, false);
  assert.equal(scope.state.value.revision, snapshot.revision);
  scope.resetRoomContext();
});

// 很长的积压只由明确按钮略过，不悄悄丢播；略过不改权威历史或积分。
// Only the explicit control skips a long backlog, without changing authoritative history or scores.
test('long local backlog offers explicit skip while preserving authority', async () => {
  const scope = setup(fixture({ schemaVersion: 3 }));
  const snapshot = localPlaybackFixture(scope);
  for (let index = 1; index < 9; index++) snapshot.game.history.push({ type: 'discard', seat: index % 3, tile: index });
  scope.characterAudio.enqueueOrdered = () => new Promise(() => {});
  scope.applyState(snapshot);
  assert.equal(scope.pendingPresentationCount.value, 9);
  assert.match(await render(scope), /待播 9 段 · 略过并看最新牌面/);
  const historyBefore = structuredClone(snapshot.game.history);
  scope.skipLocalPlayback();
  assert.equal(scope.pendingPresentationCount.value, 0);
  assert.equal(scope.localPresentationBusy.value, false);
  assert.deepEqual(scope.state.value.game.history, historyBefore);
  assert.equal(scope.state.value.revision, snapshot.revision);
  scope.resetRoomContext();
});

// 晚打开的副页先收到后缀时，必须从活跃共享起点补齐声音，不能先2后1。
// A late-baseline sibling receiving the suffix first must fill the active shared prefix, never voice 2 then 1.
test('same-seat later baseline plays the complete shared prefix before a delayed page arrives', async () => {
  browser();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let tail = Promise.resolve();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request(_key, callback) { const result = tail.then(callback); tail = result.catch(() => {}); return result; },
  } } });
  const firstPage = setup(fixture({ schemaVersion: 3 }));
  const laterPage = App.setup({}, { expose() {} });
  laterPage.session.value = credential();
  laterPage.state.value = fixture({ schemaVersion: 3 });
  const scopes = [firstPage, laterPage];
  try {
    const first = localPlaybackFixture(firstPage);
    localPlaybackFixture(laterPage);
    await settlePlayback();
    laterPage.voiceCursor.consumeEvents(first, { silent: true });
    laterPage.applyState(first);
    const second = structuredClone(first);
    second.revision++;
    second.game.history.push({ type: 'discard', seat: 1, tile: 1 });
    const spoken = [];
    scopes.forEach((scope) => {
      scope.characterAudio.enqueueOrdered = (events) => {
        spoken.push(...events.map((event) => event.eventKey.split(':').at(-1)));
        return Promise.resolve(successfulAudio(events));
      };
    });
    laterPage.applyState(second);
    await settlePlayback();
    assert.deepEqual(spoken, ['0', '1']);
    firstPage.applyState(second);
    for (let index = 0; index < 2; index++) {
      for (const timer of scheduled.filter((item) => item.delay === 350 && !item.cancelled)) timer.callback();
      await settlePlayback();
    }
    assert.deepEqual(spoken, ['0', '1']);
  } finally {
    scopes.forEach((scope) => scope.resetRoomContext());
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  }
});

// 新副页只有一个本地批次时，共享补播的长前缀也应显示积压与略过入口。
// A new sibling with one local batch must expose backlog/skip for a long recovered shared prefix.
test('shared hidden prefix counts toward the explicit backlog skip control', async () => {
  browser();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let tail = Promise.resolve();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request(_key, callback) { const result = tail.then(callback); tail = result.catch(() => {}); return result; },
  } } });
  const firstPage = setup(fixture({ schemaVersion: 3 }));
  const laterPage = App.setup({}, { expose() {} });
  laterPage.session.value = credential();
  laterPage.state.value = fixture({ schemaVersion: 3 });
  try {
    const snapshot = localPlaybackFixture(firstPage);
    localPlaybackFixture(laterPage);
    await settlePlayback();
    for (let index = 1; index < 8; index++) snapshot.game.history.push({ type: 'discard', seat: index % 3, tile: index });
    laterPage.voiceCursor.consumeEvents(snapshot, { silent: true });
    laterPage.applyState(snapshot);
    const latest = structuredClone(snapshot);
    latest.revision++;
    latest.game.history.push({ type: 'discard', seat: 2, tile: 8 });
    let finish;
    laterPage.characterAudio.enqueueOrdered = (events) => new Promise((resolve) => {
      finish = () => resolve({ events: events.map(({ eventKey }) => ({ eventKey, status: 'cancelled' })) });
    });
    laterPage.characterAudio.clear = () => finish?.();
    laterPage.applyState(latest);
    await settlePlayback();
    assert.equal(laterPage.localPendingPresentationCount.value, 1);
    assert.equal(laterPage.pendingPresentationCount.value, 9);
    assert.match(await render(laterPage), /待播 9 段 · 略过并看最新牌面/);
    laterPage.skipLocalPlayback();
    await settlePlayback();
    assert.equal(laterPage.pendingPresentationCount.value, 0);
    assert.equal(laterPage.state.value.revision, latest.revision);
  } finally {
    firstPage.resetRoomContext(); laterPage.resetRoomContext();
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  }
});

// 真实新标签页初次音频被浏览器锁定，不等于玩家选择丢弃其他活跃页尚未收到的前缀。
// A genuinely new tab's initial autoplay lock is not consent to discard a live sibling's unseen prefix.
test('initially locked new sibling preserves shared prefix after a normal user unlock', async () => {
  browser();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let tail = Promise.resolve();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request(_key, callback) { const result = tail.then(callback); tail = result.catch(() => {}); return result; },
  } } });
  const firstPage = setup(fixture({ schemaVersion: 3 }));
  const laterPage = App.setup({}, { expose() {} });
  laterPage.session.value = credential();
  const scopes = [firstPage, laterPage];
  try {
    const first = localPlaybackFixture(firstPage);
    await settlePlayback();
    laterPage.characterAudio.warmWins = () => Promise.resolve();
    assert.equal(laterPage.characterAudio.unlocked, false);
    laterPage.applyState(first);
    await settlePlayback();
    assert.equal(laterPage.localPresentationBusy.value, false, 'initial snapshot itself is silent');
    laterPage.characterAudio.unlocked = true;
    laterPage.characterAudio.context = { state: 'running' };
    const second = structuredClone(first);
    second.revision++;
    second.game.history.push({ type: 'discard', seat: 1, tile: 1 });
    const spoken = [];
    scopes.forEach((scope) => {
      scope.characterAudio.enqueueOrdered = (events) => {
        spoken.push(...events.map((event) => event.eventKey.split(':').at(-1)));
        return Promise.resolve(successfulAudio(events));
      };
    });
    laterPage.applyState(second);
    await settlePlayback();
    assert.deepEqual(spoken, ['0', '1']);
    firstPage.applyState(second);
    for (let index = 0; index < 2; index++) {
      for (const timer of scheduled.filter((item) => item.delay === 350 && !item.cancelled)) timer.callback();
      await settlePlayback();
    }
    assert.deepEqual(spoken, ['0', '1']);
  } finally {
    scopes.forEach((scope) => scope.resetRoomContext());
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  }
});

// 三个观察座位都使用左对手、本人、右对手的顺序；终局和旧局不应回到绝对座位顺序。
// Every viewer sees left opponent, self, right opponent, including finished and older-version games.
for (const viewerSeat of [0, 1, 2]) {
  test(`river columns follow opponent panels with viewer ${viewerSeat} in the center`, async () => {
    for (const schemaVersion of [1, 2, 3]) {
      const state = fixture({ schemaVersion });
      state.you = viewerSeat;
      state.game.players.forEach((player) => {
        player.hand = player.seat === viewerSeat ? [0, 1, 2, 3] : undefined;
      });
      // 为每家放一个独特弃牌下标，以证明仅换列，不会把别家的记录贴到错误姓名下。
      // Give each player a distinct discard index to prove column reordering preserves record ownership.
      state.game.discards = [0, 1, 2].map((seat) => ({ seat, tile: seat }));
      const before = structuredClone(state);
      const scope = setup(state);
      const expectedSeats = [(viewerSeat + 1) % 3, viewerSeat, (viewerSeat + 2) % 3];
      for (const phase of ["playing", "finished"]) {
        scope.state.value.phase = phase;
        assert.deepEqual(scope.riverPlayers.value.map((player) => player.seat), expectedSeats);
        assert.equal(scope.riverPlayers.value[0], scope.opponents.value[0]);
        assert.equal(scope.riverPlayers.value[2], scope.opponents.value[1]);
        const html = await render(scope);
        const columns = [...html.matchAll(/data-river-seat="(\d)"([\s\S]*?)(?=data-river-seat="|class="hand-panel)/g)];
        assert.deepEqual(columns.map((column) => Number(column[1])), expectedSeats);
        columns.forEach((column, index) => {
          const seat = expectedSeats[index];
          assert.match(column[2], new RegExp(`data-discard-index="${seat}"`));
          assert.ok(column[2].includes(`aria-label="${scope.seatLabel(seat)}的牌河，可滚动查看全部记录"`));
          assert.doesNotMatch(column[2], /class="discard-label"|\d+ 条记录/);
        });
      }
      assert.deepEqual(state.game, before.game);
      assert.deepEqual(state.seats, before.seats);
    }
  });
}
// 三种来源显示中文事件番；关闭特殊牌型的旧快照也可读取独立来源字段，不伪造加番。
// All three event sources get Chinese labels; non-pattern snapshots read independent source fields without inventing bonuses.
test('kong event score labels cover pattern and legacy breakdowns without double counting', () => {
  const scope = setup(fixture({ schemaVersion: 3 }));
  for (const [type, label] of [['robKong', '抢杠'], ['kongDiscard', '杠后接炮'], ['kongReplacement', '杠上花']]) {
    for (const patterns of [true, false]) {
      const score = {
        fan: 2, fanPoints: 2, radishBonus: 0, total: 2,
        [`${type}Bonus`]: 1,
        ...(patterns ? { patternBonuses: [{ type, fan: 1 }] } : {}),
      };
      const before = structuredClone(score);
      const summary = scope.scoreSummary(score);
      assert.equal(summary.split(`${label} +1番`).length - 1, 1);
      assert.match(summary, /2 番 2 分/);
      assert.deepEqual(score, before);
    }
  }
  const old = scope.scoreSummary({ fan: 1, fanPoints: 1, radishBonus: 0, total: 1 });
  assert.doesNotMatch(old, /抢杠|杠后接炮|杠上花/);
});

// 新局对手自摸的牌背、字幕及高亮都使用真实组件；终局同一个位置恢复牌面。
// Real components show backs, captions and highlights for an opponent self-draw; finish reveals the same slot.
test('hidden self-draw renders a back and win cue, then reveals on finish without exposing hand tiles', async () => {
  const state = fixture({ schemaVersion: 3 });
  const win = { tile: null, source: 'selfDraw', hidden: true, virtual: false };
  state.game.players[1].winPile = [win];
  state.game.players[1].huCount = 1;
  const scope = setup(state);
  const event = { ...win, type: 'hu', seat: 1, fromSeat: null };
  const pending = scope.presentWins([event], state);
  await settle();
  assert.equal(scope.winningEvents.value.length, 1);
  assert.equal(scope.isWinningTile(1, 0), true);
  assert.match(scope.winningAnnouncement.value, /牌面隐藏/);
  const html = await render(scope);
  assert.match(html, /自摸 · 牌面隐藏，终局公开/);
  assert.match(html, /tile-back/);
  assert.match(html, /winning-tile/);
  assert.equal(scope.winLabel(win), '自摸 · 牌面隐藏，终局公开');
  scope.clearPresentation();
  await pending;
  const finished = structuredClone(state);
  finished.phase = 'finished';
  finished.game.phase = 'finished';
  finished.game.players[1].winPile = [{ ...win, tile: 17, hidden: false }];
  scope.state.value = finished;
  const finalHtml = await render(scope);
  assert.match(finalHtml, /9筒 · 自摸/);
  assert.doesNotMatch(finalHtml, /自摸 · 牌面隐藏，终局公开/);
  assert.equal(scope.state.value.game.players[1].hand, undefined);
});

// 场景：大厅显示七个可选角色；每个新角色的预览、请求与绝对座位展示一致。
// Scenario: the lobby lists seven options, and each new preview/request agrees with absolute-seat portraits.
test("seven-character lobby and assigned portraits cover every viewer", async () => {
  browser();
  const entry = lobby();
  const html = await render(entry);
  assert.match(html, /七位角色，支持三人或四人同桌/);
  for (const character of CharacterAudioModule.CHARACTERS) {
    assert.ok(html.includes(`value="${character.id}"`));
    entry.preferredCharacter.value = character.id;
    const preview = await render(entry);
    assert.ok(preview.includes(character.portrait));
    for (let viewer = 0; viewer < 3; viewer++) {
      const value = fixture();
      value.you = viewer;
      value.game.mySeat = viewer;
      value.game.characters = [character.id, "honest", "star"];
      const scope = setup(value);
      assert.equal(scope.characterForPlayer(0).id, character.id);
      assert.equal(scope.characterForPlayer(1).id, "honest");
      assert.equal(scope.characterForPlayer(2).id, "star");
      const tableHtml = await render(scope);
      assert.ok(tableHtml.includes(character.portrait));
      assert.equal((tableHtml.match(/class="[^"]*\bopponent-seat\b/g) || []).length, 2);
    }
  }
});

// 建房配置与四人投影用真实组件执行，不让前端草稿覆盖既有桌或错误暴露第四座暗手牌。
// Execute the actual component for configuration/four-seat projections, without overwriting existing rooms or exposing opponents.
test('new table fields default to three/two/six, validate half decks and keep join requests unconfigured', async () => {
  browser();
  const scope = lobby();
  assert.equal(scope.playerCountDraft.value, 3);
  assert.equal(scope.deckCountDraft.value, 2);
  assert.equal(scope.dragonStartCountDraft.value, 6);
  assert.equal(scope.validTableSettings.value, true);
  scope.playerCountDraft.value = 4;
  scope.deckCountDraft.value = 1.5;
  scope.dragonStartCountDraft.value = 7;
  let html = await render(scope);
  assert.match(html, /起算张数超过每种牌数量，本局不会触发神龙/);
  assert.match(html, /id="table-player-count"/);
  assert.match(html, /1.5 副 · 108 张/);
  scope.deckCountDraft.value = 1.25;
  assert.equal(scope.validTableSettings.value, false);
  scope.name.value = '配置测试';
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Must not request with invalid settings'); };
  await scope.enterRoom();
  assert.equal(calls, 0);
  scope.entryMode.value = 'join';
  html = await render(scope);
  assert.doesNotMatch(html, /id="table-player-count"/);
});

test('four-seat real view renders three opponents including opposite, four rivers and immutable settings', async () => {
  const { createGame } = await import('../shared/game.js');
  const raw = createGame({ seed: 'four-ui', rules: { playerCount: 4, deckCount: 2.5, dragonStartCount: 8 } });
  const state = fixture({ schemaVersion: 3 });
  state.settings = { playerCount: 4, deckCount: 2.5, dragonStartCount: 8 };
  state.seats = raw.players.map(player => ({ seat: player.seat, name: `四人测试${player.seat}`, connected: true }));
  state.you = 3;
  state.game = getPlayerView(raw, 3);
  const scope = setup(state);
  scope.showRules.value = true;
  const html = await render(scope);
  assert.equal(scope.opponents.value.length, 3);
  assert.equal(scope.riverPlayers.value.length, 4);
  assert.deepEqual(scope.opponents.value.map(player => player.seat), [0, 1, 2]);
  assert.match(html, /four-player-table/);
  assert.match(html, /opposite-seat/);
  assert.match(html, /对家/);
  assert.match(html, /4人 · 2.5副 · 180张/);
  assert.match(html.replace(/<[^>]*>/g, ''), /8张起10分，每多一张翻倍/);
  assert.match(html, /九张加六番/);
  assert.match(html, /自己 → 右手边 → 对家 → 左手边/);
  assert.doesNotMatch(html, /id="table-player-count"|id="table-deck-count"|id="dragon-start-count"/);
  assert.equal((html.match(/class="discard-group/g) ?? []).length, 4);
  assert.equal((html.match(/class="[^"]*\bopponent-seat\b/g) ?? []).length, 3);
  assert.equal(scope.characterForPlayer(3).id, 'landlord');
});

// 大牌组的按钮标签也使用已保存副数，不因旧8张显示边界退回泛称。
// Extension labels use the saved deck budget rather than the former eight-copy presentation boundary.
test('four-player extension label includes ninth and twentieth copies', () => {
  const state = fixture({ schemaVersion: 3 });
  state.game.rules = { playerCount: 3, deckCount: 5 };
  state.game.players[0].melds = [{ type: 'anGang', tile: 0, tiles: Array(8).fill(0) }];
  const scope = setup(state);
  assert.match(scope.actionLabel({ type: 'addGang', tile: 0 }), /9/);
  state.game.players[0].melds[0].tiles = Array(19).fill(0);
  assert.match(scope.actionLabel({ type: 'addGang', tile: 0 }), /20/);
});

// 观战的身份、界面和请求边界使用真实 Vue 组件；DOM 断言不是浏览器布局验收。
// Spectator identity, UI and request boundaries use the real Vue component; DOM checks are not browser layout acceptance.
test('spectator UI shows every public seat without self panels, host controls or player actions', async () => {
  const state = fixture({ schemaVersion: 3 });
  state.you = null;
  state.viewerRole = 'spectator';
  state.game.mySeat = null;
  state.game.participantNames = ['东家', '南家', '西家'];
  // 即使误传了合法动作，前端也必须拒绝；真正权限由独立 API 测试覆盖。
  // Even an erroneous actions payload must be ignored in the UI; separate API tests enforce actual authorization.
  const scope = setup(state);
  assert.equal(scope.mySeat.value, null);
  assert.equal(scope.isHost.value, false);
  assert.equal(scope.isMyTurn.value, false);
  assert.equal(scope.opponents.value.length, 3);
  assert.equal(scope.riverPlayers.value.length, 3);
  assert.deepEqual(scope.legalActions.value, []);
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('Spectators must not mutate'); };
  await scope.mutate({ type: 'discard', tile: 0 });
  await scope.mutate(null, true);
  assert.equal(requests, 0);
  const html = await render(scope);
  assert.match(html, /观战中/);
  assert.doesNotMatch(html, /aria-label="我的手牌与操作"|class="own-seat-summary"|同桌再来一局/);
  assert.equal((html.match(/class="[^"']*opponent-seat/g) || []).length, 3);
});

test('spectator entry needs only room code and preserves the same-room player credential', async () => {
  const seated = credential();
  browser({ rooms: { [seated.roomId]: seated } });
  const scope = lobby();
  scope.loadSavedSessions();
  scope.entryMode.value = 'spectate';
  scope.roomCode.value = seated.roomId;
  scope.name.value = '';
  const watched = { roomId: seated.roomId, token: `watch.${'c'.repeat(64)}.${'d'.repeat(64)}`, viewerRole: 'spectator' };
  const state = { ...fixture({ schemaVersion: 3 }), id: seated.roomId, you: null, viewerRole: 'spectator' };
  const requests = [];
  globalThis.fetch = async (path, options) => {
    requests.push({ path, options });
    return new Response(JSON.stringify({ ...watched, state }));
  };
  await scope.enterRoom();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, `/api/rooms/${seated.roomId}/spectate`);
  assert.equal(scope.session.value.viewerRole, 'spectator');
  assert.equal(scope.savedRooms.get(seated.roomId).token, seated.token);
  assert.equal(scope.savedRooms.get(`watch:${seated.roomId}`).token, watched.token);
  assert.match(window.location.search, /view=spectator/);
  assert.ok(!window.location.href.includes(watched.token));
  const html = await render(scope);
  assert.match(html, /观战中/);
  const before = requests.length;
  await scope.queueLeave(scope.session.value);
  assert.equal(requests.length, before);
});

test('spectator browser reload and Back use the watch credential rather than the cached player seat', async () => {
  const seated = credential();
  const watched = { roomId: seated.roomId, token: `watch.${'c'.repeat(64)}.${'d'.repeat(64)}`, viewerRole: 'spectator' };
  const env = browser({ search: `?room=${seated.roomId}&view=spectator`, active: watched,
    rooms: { [seated.roomId]: seated, [`watch:${seated.roomId}`]: watched } });
  const scope = lobby();
  const initial = scope.loadSavedSessions();
  const requests = [];
  globalThis.fetch = async (path, options) => {
    requests.push({ path, options });
    return new Response(JSON.stringify({ state: { ...fixture({ schemaVersion: 3 }), id: seated.roomId, you: null, viewerRole: 'spectator' } }));
  };
  await scope.routeFromLocation(initial);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.headers.Authorization, `Bearer ${watched.token}`);
  assert.equal(scope.mySeat.value, null);
  env.setLocation('https://example.test/');
  await scope.routeFromLocation();
  assert.equal(scope.session.value, null);
  assert.equal(scope.savedRooms.get(seated.roomId).token, seated.token);
});

test('spectator entry remains single-flight and ignores late results after navigation', async () => {
  browser();
  const scope = lobby();
  scope.entryMode.value = 'spectate';
  scope.roomCode.value = 'ABCDEFGH';
  let resolveRequest;
  let count = 0;
  globalThis.fetch = async () => {
    count++;
    return new Promise((resolve) => { resolveRequest = resolve; });
  };
  const pending = scope.enterRoom();
  await settle();
  await scope.enterRoom();
  assert.equal(count, 1);
  scope.resetRoomContext();
  resolveRequest(new Response(JSON.stringify({ roomId: 'ABCDEFGH', token: `watch.${'c'.repeat(64)}.${'d'.repeat(64)}`,
    state: { ...fixture(), id: 'ABCDEFGH', you: null, viewerRole: 'spectator' } })));
  await pending;
  assert.equal(scope.state.value, null);
  assert.equal(scope.session.value, null);
  assert.equal(count, 1);
});

// 展示层使用四席合成快照验证动态集合；四人规则由对应引擎分支负责。
// A four-seat display-only snapshot verifies dynamic collections; the separate engine branch owns four-player rules.
test('spectator panels and rivers include all four seats without treating a viewer as a player', async () => {
  const state = fixture({ schemaVersion: 3 });
  state.viewerRole = 'spectator';
  state.you = null;
  state.seats.push({ ...state.seats[2], seat: 3, name: '北家' });
  state.game.players.push({ ...state.game.players[2], seat: 3 });
  state.game.participantNames = ['东家', '南家', '西家', '北家'];
  const scope = setup(state);
  assert.equal(scope.opponents.value.length, 4);
  assert.equal(scope.riverPlayers.value.length, 4);
  assert.equal(scope.discardsBySeat.value.length, 4);
  const html = await render(scope);
  assert.match(html, /北家的手牌，共/);
  assert.match(html, /北家的牌河/);
  assert.doesNotMatch(html, /aria-label="我的手牌与操作"/);
});

// 终局原参赛者仍应保留名字和公开牌区，但离开的历史玩家不能占用下一局的空位计数。
// Finished participants retain names/public zones, while departed historical players do not count as occupied next-round seats.
test('finished spectator panels preserve participants while occupancy tracks actual seats', async () => {
  const state = fixture({ schemaVersion: 3 });
  state.viewerRole = 'spectator';
  state.you = null;
  state.phase = 'finished';
  state.game.phase = 'finished';
  state.game.participantNames = ['原东家', '原南家', '原西家'];
  state.seats[0] = null;
  state.seats[1].name = '后来的人';
  state.seats[1].isCurrentParticipant = false;
  const scope = setup(state);
  assert.equal(scope.filledSeats.value, 2);
  assert.equal(scope.opponents.value[0].name, '原东家');
  assert.equal(scope.opponents.value[1].name, '原南家');
  assert.equal(scope.opponents.value[1].detached, true);
  const html = await render(scope);
  assert.match(html, /2\/3 位落座/);
  assert.doesNotMatch(html, /class="own-seat-summary"/);
});

// 无效观战轮询只能删除观战缓存，不能顺手删除同桌仍有效的玩家凭证。
// Invalid spectator polls may remove only the viewer cache, never a valid same-room player credential.
test('expired spectator polling preserves the same-room player cache', async () => {
  const seated = credential();
  const watched = { roomId: seated.roomId, token: `watch.${'c'.repeat(64)}.${'d'.repeat(64)}`, viewerRole: 'spectator' };
  browser({ rooms: { [seated.roomId]: seated } });
  const scope = lobby();
  scope.loadSavedSessions();
  scope.saveSession(watched);
  scope.state.value = { ...fixture(), id: seated.roomId, you: null, viewerRole: 'spectator' };
  globalThis.fetch = async (path) => new Response(JSON.stringify(
    path.startsWith('/api/profile') ? emptyHistory() : { error: '观战凭证失效', code: 'UNAUTHORIZED' },
  ), { status: path.startsWith('/api/profile') ? 200 : 401 });
  await scope.refresh();
  await settle();
  assert.equal(scope.session.value, null);
  assert.equal(scope.savedRooms.get(seated.roomId).token, seated.token);
  assert.equal(scope.savedRooms.has(`watch:${seated.roomId}`), false);
  assert.match(scope.error.value, /观战会话已失效/);
});

// 联合界面回归穷举三/四人每个玩家视角与观众，角色来自真实引擎投影而非角色池下标。
// Combined UI coverage visits every three/four-player viewpoint plus observers using genuine engine projections.
for (const playerCount of [3, 4]) {
  test(`${playerCount}-seat integrated layout isolates relative player positions from all-seat spectating`, async () => {
    const { createGame } = await import('../shared/game.js');
    const { spectatorGameView } = await import('../server/spectators.js');
    const raw = createGame({ seed: `integrated-ui-${playerCount}`, rules: { playerCount, deckCount: 2.5, dragonStartCount: 9 } });
    const characters = ['wealthy', 'landlord', 'honest', 'star'].slice(0, playerCount);
    for (const viewer of [...Array(playerCount).keys(), null]) {
      const value = fixture({ schemaVersion: 3 });
      value.viewerRole = viewer === null ? 'spectator' : 'player';
      value.you = viewer;
      value.settings = { playerCount, deckCount: 2.5, dragonStartCount: 9 };
      value.seats = raw.players.map((player) => ({ seat: player.seat, name: `整合玩家${player.seat}`, connected: true }));
      value.game = viewer === null ? spectatorGameView(raw) : getPlayerView(raw, viewer);
      value.game.characters = characters;
      value.game.participantNames = value.seats.map((seat) => seat.name);
      const scope = setup(value);
      const html = await render(scope);
      const spectator = viewer === null;
      assert.equal(scope.opponents.value.length, spectator ? playerCount : playerCount - 1);
      assert.equal(scope.riverPlayers.value.length, playerCount);
      assert.equal((html.match(/class="discard-group/g) || []).length, playerCount);
      for (let seat = 0; seat < playerCount; seat++) {
        assert.equal(scope.characterForPlayer(seat).id, characters[seat]);
        assert.ok(html.includes(scope.characterForPlayer(seat).portrait));
      }
      if (spectator) {
        assert.doesNotMatch(html, /four-player-table|opposite-seat|relative-seat-label|aria-label="我的手牌与操作"/);
        assert.deepEqual(scope.legalActions.value, []);
        assert.equal(scope.isHost.value, false);
        assert.deepEqual(scope.opponents.value.map((player) => player.seat), [...Array(playerCount).keys()]);
      } else {
        assert.equal(html.includes('four-player-table'), playerCount === 4);
        assert.equal(scope.opponentPosition((viewer + 1) % playerCount), '左手边');
        assert.equal(scope.opponentPosition((viewer + playerCount - 1) % playerCount), '右手边');
        if (playerCount === 4) {
          assert.equal(scope.opponentPosition((viewer + 2) % playerCount), '对家');
          assert.equal((html.match(/class="[^"']*\bopposite-seat\b/g) || []).length, 1);
        }
      }
    }
  });
}

// 规则弹窗必须与新/旧局快照一致，两个开关独立判定；仅显示文字不会迁移已存规则。
// Rule dialogs follow saved snapshots and evaluate the two flags independently without migrating stored rules.
test('rules dialog preserves old choices and describes explicit pre-hu and post-peng snapshots', async () => {
  for (const choice of [true, false, undefined]) {
    for (const discardFirst of [true, false, undefined]) {
      const value = fixture({ schemaVersion: 3 });
      value.game.rules = {};
      if (choice !== undefined) value.game.rules.preHuActionChoice = choice;
      if (discardFirst !== undefined) value.game.rules.concealedKongAfterPungDiscard = discardFirst;
      const before = structuredClone(value.game.rules);
      const scope = setup(value);
      scope.showRules.value = true;
      const html = (await render(scope)).replace(/<[^>]*>/g, '');
      assert.equal(html.includes('可自行选择胡或合法杠，也可出牌'), choice === true);
      assert.equal(html.includes('胡、碰、明杠及过均按实际合法动作保留'), choice === true);
      assert.equal(html.includes('自己摸牌同时可胡又可杠时，不提供杠'), choice !== true);
      assert.equal(html.includes('可胡又可明杠时，只提供胡或过'), choice !== true);
      assert.equal(html.includes('碰后当前回合不能立即暗杠'), discardFirst === true);
      assert.match(html, /你已胡过且本张可胡时，只提供胡/);
      assert.match(html, /胡优先于明杠，明杠优先于碰/);
      assert.deepEqual(scope.state.value.game.rules, before);
    }
  }
  // 大厅讲下一局的新默认；schema1/2 即使出现同名字段也不套用新版解释。
  // The lobby describes new defaults; schemas one/two never adopt current wording even with matching field names.
  const entry = lobby();
  entry.showRules.value = true;
  const lobbyHtml = await render(entry);
  assert.match(lobbyHtml, /可自行选择胡或合法杠，也可出牌/);
  assert.match(lobbyHtml, /碰后当前回合不能立即暗杠/);
  for (const version of [1, 2]) {
    const value = fixture({ schemaVersion: version });
    value.game.rules = { preHuActionChoice: true, concealedKongAfterPungDiscard: true };
    const scope = setup(value);
    scope.showRules.value = true;
    const html = await render(scope);
    assert.doesNotMatch(html, /可自行选择胡或合法杠，也可出牌|碰后当前回合不能立即暗杠/);
    assert.match(html, /本桌旧规则/);
  }
});

// 新建桌把五项参数作为同一份创建快照；原生标签、帮助、错误和状态让键盘/读屏可用。
// New rooms submit five choices together; native labels, help, errors and states support keyboard/screen readers.
test('creation panel unifies five choices and exposes defaults, errors and disabled states', async () => {
  browser();
  const scope = lobby();
  let html = await render(scope);
  for (const id of ['table-player-count', 'table-deck-count', 'dragon-start-count', 'create-ready-points', 'create-auto-discard']) {
    assert.match(html, new RegExp(`for="${id}"`));
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /id="create-auto-discard"[^>]*checked[^>]*role="switch"/);
  assert.match(html, /id="create-ready-points"[^>]*value="50"/);
  assert.match(html, /创建后固定，同桌每一局沿用/);
  assert.match(html, /role="group" aria-label="进入牌桌方式"/);
  scope.name.value = '创建验证';
  globalThis.fetch = () => assert.fail('invalid creation must not request');
  for (const amount of ['', -1, 1.5, 100001]) {
    scope.bigSingleReadyPoints.value = amount;
    html = await render(scope);
    assert.match(html, /id="create-ready-points"[^>]*aria-invalid="true"/);
    assert.match(html, /id="create-ready-error"[^>]*role="alert"/);
    assert.match(html, /class="button primary entry-submit"[^>]*disabled/);
    await scope.enterRoom();
    assert.match(scope.error.value, /喜钱须为/);
  }
  scope.bigSingleReadyPoints.value = 0;
  scope.dragonStartCountDraft.value = '';
  html = await render(scope);
  assert.match(html, /id="dragon-start-count"[^>]*aria-invalid="true"/);
  assert.match(html, /id="dragon-count-error"[^>]*role="alert"/);
  for (const flag of ['busy', 'restoring']) {
    scope[flag].value = true;
    assert.match(await render(scope), /class="table-settings-fields"[^>]*disabled/);
    scope[flag].value = false;
  }
  scope.entryMode.value = 'join';
  assert.doesNotMatch(await render(scope), /id="create-ready-points"|id="create-auto-discard"/);
  scope.entryMode.value = 'create';
  assert.equal(scope.bigSingleReadyPoints.value, 0);
});

// 异步创建开始前复制全部选项；重复点击和稍后的草稿变化都不能改已发送参数。
// Snapshot every option before asynchronous creation; repeat clicks and later draft edits cannot alter submitted settings.
test('creation snapshots automatic discard and zero bonus exactly once before reset', async () => {
  browser();
  const scope = lobby();
  scope.playerToken.value = 'a'.repeat(64);
  scope.name.value = '创建快照';
  scope.playerCountDraft.value = 4;
  scope.deckCountDraft.value = 2.5;
  scope.dragonStartCountDraft.value = 9;
  scope.autoDiscardAfterHu.value = false;
  scope.bigSingleReadyPoints.value = 0;
  const requests = [];
  let release;
  globalThis.fetch = (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return new Promise(resolve => { release = resolve; });
  };
  const pending = scope.enterRoom();
  await settle();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/rooms');
  assert.deepEqual(requests[0].body.settings, {
    playerCount: 4, deckCount: 2.5, dragonStartCount: 9,
    autoDiscardAfterHu: false, bigSingleReadyPoints: 0,
  });
  scope.autoDiscardAfterHu.value = true;
  scope.bigSingleReadyPoints.value = 75;
  await scope.enterRoom();
  assert.equal(requests.length, 1);
  const created = startFixture();
  created.settings = requests[0].body.settings;
  release(response({ roomId: created.id, token: 'test-creation-token', state: created }));
  await pending;
  assert.equal(scope.hasFixedAutoDiscard.value, true);
  assert.equal(scope.hasFixedReadyPoints.value, true);
  const html = await render(scope);
  assert.match(html, /胡后自动打出：关闭，需点“过”继续/);
  assert.match(html, /大单吊喜钱：0 分，不收取/);
  assert.doesNotMatch(html, /id="auto-discard-after-hu"|id="big-single-ready-points"/);
});

// 固定新桌的开局不依赖本地草稿；旧桌或部分旧快照仅保留缺失字段的编辑入口。
// Fixed-room starts ignore local drafts; legacy/partial snapshots retain editors only for missing fields.
test('fixed room starts and next rounds use server settings, while partial legacy choices remain editable', async () => {
  for (const phase of ['lobby', 'finished']) {
    const state = startFixture(phase);
    state.settings = { playerCount: 3, deckCount: 2, dragonStartCount: 6, autoDiscardAfterHu: false, bigSingleReadyPoints: 0 };
    const scope = setup(state);
    scope.bigSingleReadyPoints.value = '';
    assert.equal(scope.canConfigureStart.value, false);
    assert.equal(scope.validStartOptions.value, true);
    assert.doesNotMatch(await render(scope), /id="auto-discard-after-hu"|id="big-single-ready-points"/);
    const requests = [];
    globalThis.fetch = async (url, options) => {
      requests.push(JSON.parse(options.body));
      return response({ state: { ...state, revision: state.revision + 1 } });
    };
    await scope.mutate(null, true);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].options, {});
    scope.state.value.you = 1;
    await scope.mutate(null, true);
    assert.equal(requests.length, 1);
    assert.match(await render(scope), /创建时已确定/);
  }
  for (const fixedKey of ['autoDiscardAfterHu', 'bigSingleReadyPoints']) {
    const state = startFixture();
    state.settings = { [fixedKey]: fixedKey === 'autoDiscardAfterHu' ? false : 0 };
    const scope = setup(state);
    assert.equal(scope.canConfigureStart.value, true);
    const html = await render(scope);
    assert.equal(html.includes('id="auto-discard-after-hu"'), fixedKey !== 'autoDiscardAfterHu');
    assert.equal(html.includes('id="big-single-ready-points"'), fixedKey !== 'bigSingleReadyPoints');
  }
});

// 已明确失败的创建保留原输入，不会自动重发；下一次用户点击仍用原选择。
// An explicitly failed creation retains its form and never retries automatically; the next click still uses the original choices.
test('failed creation retains chosen automatic-discard and ready-bonus drafts', async () => {
  browser();
  const scope = lobby();
  scope.name.value = '失败保留';
  scope.playerToken.value = 'a'.repeat(64);
  scope.autoDiscardAfterHu.value = false;
  scope.bigSingleReadyPoints.value = 75;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return response({ error: '合成明确拒绝', code: 'TEST_REJECTED' }, 400);
  };
  await scope.enterRoom();
  assert.equal(calls, 1);
  assert.equal(scope.autoDiscardAfterHu.value, false);
  assert.equal(scope.bigSingleReadyPoints.value, 75);
  assert.equal(scope.busy.value, false);
  assert.match(scope.error.value, /合成明确拒绝/);
  const html = await render(scope);
  assert.match(html, /id="create-ready-points"[^>]*value="75"/);
  assert.doesNotMatch(html, /id="create-auto-discard"[^>]*checked/);
});

// 规则说明必须与新房固定值一致；旧桌继续描述每局可选，不能用新文案覆盖旧契约。
// Rule help must match fixed new-room choices while retaining per-round wording for legacy rooms.
test('rules help distinguishes creation snapshots from legacy per-round choices', async () => {
  const old = setup(startFixture());
  old.showRules.value = true;
  assert.match(await render(old), /房主可在每局开局前选择/);
  const current = startFixture();
  current.settings = { autoDiscardAfterHu: false, bigSingleReadyPoints: 0 };
  const scope = setup(current);
  scope.showRules.value = true;
  const html = await render(scope);
  assert.match(html, /在创建牌桌前选择/);
  assert.match(html, /本桌创建时确定为每家 0 分，不收取，同桌每局沿用/);
  assert.doesNotMatch(html, /房主可在每局开局前选择|房主在每局开局前填写/);
});

// 成都四项必选且与花麻将草稿隔离；切换/加入/观战不能偷带另一模式参数。
// Four Chengdu choices are required and independent of Flower drafts; switching/joining/spectating must not leak settings.
test('Chengdu creation form has explicit accessible choices and independent Flower drafts', async () => {
  browser();
  const scope = lobby();
  scope.gameModeDraft.value = 'chengdu';
  let html = await render(scope);
  assert.match(html, /for="game-mode"/);
  for (const id of ['chengdu-end-condition', 'chengdu-exchange-three', 'chengdu-self-draw', 'chengdu-fan-cap']) {
    assert.match(html, new RegExp(`for="${id}"`));
    assert.match(html, new RegExp(`id="${id}"[^>]*required`));
  }
  assert.match(html, /固定四人/);
  assert.match(html, /换牌和定缺由各人亲自选择/);
  assert.doesNotMatch(html, /id="table-player-count"|id="create-ready-points"/);
  assert.equal(scope.validCreationSettings.value, false);
  scope.name.value = '成都准备';
  globalThis.fetch = () => assert.fail('unfinished choices must not create');
  await scope.enterRoom();
  assert.match(scope.error.value, /请选择结束方式/);
  scope.chengduEndConditionDraft.value = 'firstWin';
  scope.chengduExchangeThreeDraft.value = false;
  scope.chengduSelfDrawDraft.value = 'addFan';
  scope.chengduFanCapDraft.value = 6;
  scope.bigSingleReadyPoints.value = '';
  scope.dragonStartCountDraft.value = '';
  assert.equal(scope.validCreationSettings.value, true);
  scope.gameModeDraft.value = 'flower';
  assert.equal(scope.validCreationSettings.value, false);
  scope.gameModeDraft.value = 'chengdu';
  assert.equal(scope.chengduExchangeThreeDraft.value, false);
  for (const entryMode of ['join', 'spectate']) {
    scope.entryMode.value = entryMode;
    html = await render(scope);
    assert.doesNotMatch(html, /id="game-mode"|id="chengdu-end-condition"/);
  }
});

// 异步建房前固定模式和四项选择，重复点击/草稿变化不可将成都请求转成花麻将。
// Capture mode/choices before async creation; repeated clicks or draft edits cannot convert the request into Flower.
test('Chengdu creation sends one immutable configuration and no Flower fields', async () => {
  browser();
  const scope = lobby();
  scope.playerToken.value = 'a'.repeat(64);
  scope.name.value = '成都准备';
  scope.gameModeDraft.value = 'chengdu';
  scope.chengduEndConditionDraft.value = 'bloodBattle';
  scope.chengduExchangeThreeDraft.value = false;
  scope.chengduSelfDrawDraft.value = 'addBase';
  scope.chengduFanCapDraft.value = 5;
  const requests = [];
  let release;
  globalThis.fetch = (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return new Promise(resolve => { release = resolve; });
  };
  const pending = scope.enterRoom();
  await settle();
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].body.settings, {
    playerCount: 4, dingque: true, endCondition: 'bloodBattle', exchangeThree: false, selfDraw: 'addBase', fanCap: 5,
  });
  assert.equal(requests[0].body.gameMode, 'chengdu');
  scope.gameModeDraft.value = 'flower';
  scope.chengduFanCapDraft.value = 6;
  await scope.enterRoom();
  assert.equal(requests.length, 1);
  const state = startFixture();
  state.gameMode = 'chengdu';
  state.rulesVersion = null;
  state.settings = requests[0].body.settings;
  release(response({ roomId: state.id, token: 'test-chengdu-room', state }));
  await pending;
  assert.equal(scope.isChengduRoom.value, true);
  assert.match(await render(scope), /5番封顶/);
});

// 成都准备房间绝不出现花麻将专属说明，满员房主/普通玩家/观众都不能触发开局请求。
// Preparation rooms never display Flower-only rules; full hosts, ordinary players and spectators cannot issue start requests.
test('Chengdu room shows saved choices with four seats, safe start gate and separate rules help', async () => {
  for (const viewerRole of ['host', 'player', 'spectator']) {
    const state = startFixture();
    state.gameMode = 'chengdu';
    state.rulesVersion = null;
    state.settings = { playerCount: 4, dingque: true, endCondition: 'firstWin', exchangeThree: true, selfDraw: 'addFan', fanCap: 6 };
    state.seats = Array.from({ length: 4 }, (_, seat) => ({ seat, name: `成都${seat + 1}`, connected: true }));
    state.you = viewerRole === 'spectator' ? null : viewerRole === 'host' ? 0 : 2;
    state.viewerRole = viewerRole === 'spectator' ? 'spectator' : 'player';
    const scope = setup(state);
    assert.equal(scope.tablePlayerCount.value, 4);
    assert.equal(scope.canStart.value, false);
    assert.equal(scope.canConfigureStart.value, false);
    let html = await render(scope);
    assert.match(html, /首胡结束/);
    assert.match(html, /换三张：开启/);
    assert.match(html, /先加1番再封顶/);
    assert.match(html, /6番封顶/);
    assert.match(html, /此服务端尚未开放成都开局/);
    assert.doesNotMatch(html.replace(/<!--[\s\S]*?-->/g, ''), /神龙|萝卜|大单吊|同级碰、杠、胡|id="start-options-title"/);
    if (viewerRole === 'host') assert.match(html, /class="button gold start-button"[^>]*disabled/);
    else assert.doesNotMatch(html, /class="button gold start-button"/);
    globalThis.fetch = () => assert.fail('Chengdu UI start must not request');
    await scope.mutate(null, true);
    scope.showRules.value = true;
    html = await render(scope);
    assert.match(html, /无人胡流局也查花猪、查叫、退杠/);
    assert.doesNotMatch(html, /自贡花麻将 · 玩法说明|神龙留到局末/);
    scope.showRules.value = false;
    assert.doesNotMatch(await render(scope), /role="dialog"/);
  }
});

// 失败保留明确选择不自动重试，导航后迟到响应不能重新打开刚离开的成都桌。
// Failures retain explicit choices without retries; late results after navigation cannot reopen the abandoned Chengdu table.
test('Chengdu failed creation preserves choices and late navigation results cannot restore its room', async () => {
  browser();
  const scope = lobby();
  scope.playerToken.value = 'a'.repeat(64);
  scope.name.value = '成都中断';
  scope.gameModeDraft.value = 'chengdu';
  scope.chengduEndConditionDraft.value = 'firstWin';
  scope.chengduExchangeThreeDraft.value = true;
  scope.chengduSelfDrawDraft.value = 'addBase';
  scope.chengduFanCapDraft.value = 4;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response({ error: '合成失败' }, 503); };
  await scope.enterRoom();
  assert.equal(calls, 1);
  assert.equal(scope.chengduEndConditionDraft.value, 'firstWin');
  assert.equal(scope.chengduExchangeThreeDraft.value, true);
  assert.equal(scope.chengduSelfDrawDraft.value, 'addBase');
  assert.equal(scope.chengduFanCapDraft.value, 4);
  assert.equal(scope.validChengduSettings.value, true);
  assert.match(scope.error.value, /合成失败/);
  let release;
  globalThis.fetch = (url) => {
    if (url.endsWith('/leave')) return Promise.resolve(response({ ok: true }));
    return new Promise(resolve => { release = resolve; });
  };
  const pending = scope.enterRoom();
  await settle();
  scope.resetRoomContext();
  const state = startFixture();
  state.gameMode = 'chengdu';
  state.settings = { ...scope.chengduSettingsDraft.value };
  release(response({ roomId: state.id, token: 'test-late-chengdu', state }));
  await pending;
  assert.equal(scope.inRoom.value, false);
  assert.equal(scope.state.value, null);
});

// 正式成都版本才开放满员房主开局；隐藏花麻将草稿及声音屏障字段不能混入请求。
// Only production Chengdu enables the filled-table host; hidden Flower drafts/media barrier fields never enter the request.
test('production Chengdu host starts with empty fixed options and no Flower media protocol', async () => {
  const state = startFixture();
  state.gameMode = 'chengdu'; state.rulesVersion = 2;
  state.settings = { playerCount: 4, dingque: true, endCondition: 'bloodBattle', exchangeThree: false, selfDraw: 'addBase', fanCap: 4 };
  state.seats = Array.from({ length: 4 }, (_, seat) => ({ seat, name: `成都${seat + 1}`, connected: true }));
  const scope = setup(state);
  scope.bigSingleReadyPoints.value = '';
  assert.equal(scope.canStart.value, true);
  assert.equal(scope.validStartOptions.value, true);
  assert.equal(scope.canConfigureStart.value, false);
  const html = await render(scope);
  assert.match(html, /人齐了，开始牌局/);
  assert.doesNotMatch(html, /成都开局暂未开放|创建成都准备桌/);
  let sent;
  globalThis.fetch = async (url, options) => {
    sent = { url, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ state }) };
  };
  await scope.mutate(null, true);
  assert.match(sent.url, /\/start$/);
  assert.deepEqual(sent.body.options, {});
  assert.equal(Object.hasOwn(sent.body, 'presentation'), false);
  assert.equal(Object.hasOwn(sent.body, 'presentationMode'), false);
  scope.state.value.you = 1;
  assert.equal(scope.canStart.value, false);
});

// 成都 schema2不是花麻将v2；真实App渲染专用桌，不出现旧版升级提示和花麻将自动出牌说明。
// Chengdu schema2 is not Flower v2; actual App renders its separate board without legacy-upgrade or Flower auto-discard text.
test('App routes Chengdu schema two to its own table without Flower compatibility banners', async () => {
  const state = startFixture(); state.gameMode = 'chengdu'; state.rulesVersion = 2; state.phase = 'playing';
  state.settings = { playerCount: 4, dingque: true, endCondition: 'bloodBattle', exchangeThree: false, selfDraw: 'addBase', fanCap: 4 };
  state.seats = Array.from({ length: 4 }, (_, seat) => ({ seat, name: `成都${seat + 1}`, connected: true }));
  state.game = { id: 'chengdu-ui-game', gameMode: 'chengdu', schemaVersion: 2, revision: 0, mySeat: 0, phase: 'dingque', dealerSeat: 0, currentSeat: null, wallCount: 55,
    rules: state.settings, players: state.seats.map((player) => ({ seat: player.seat, handCount: 13, score: 0, melds: [], won: null, ...(player.seat === 0 ? { hand: [18, 19, 20] } : {}) })),
    legalActions: [{ type: 'dingque', suit: 'characters' }], history: [], discards: [] };
  const scope = setup(state);
  assert.equal(scope.isOlderGame.value, false); assert.equal(scope.isLegacy.value, false); assert.equal(scope.isLatest.value, false);
  const html = (await render(scope)).replace(/<!--[\s\S]*?-->/g, '');
  assert.match(html, /class="portrait-motion-settings"/);
  assert.doesNotMatch(html, /<canvas|character-artwork-background/);
  assert.match(html, /aria-label="成都麻将牌桌"/); assert.match(html, /定缺万/); assert.match(html, /aria-label="我的手牌与操作"/);
  assert.doesNotMatch(html, /本桌保留 v0|胡后自动打出|萝卜|神龙|大单吊/);
});

// 真实App请求直接连真实API/MemoryStore，覆盖已注册成都从满员大厅到准备和第一手出牌。
// Connect actual App requests to the actual API/MemoryStore, covering registered Chengdu from a full lobby through preparation and the first discard.
test('real App and Chengdu API complete room start, exchange, dingque and first discard', async () => {
  const handle = createApi(new MemoryStore());
  const tokens = [];
  const request = async (path, seat, body) => {
    const response = await handle(new Request(`https://example.test/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: seat === undefined ? {} : { authorization: `Bearer ${tokens[seat]}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    const payload = await response.json();
    assert.ok(response.ok, JSON.stringify(payload));
    return payload;
  };
  const created = await request('rooms', undefined, { name: '成都界面甲', gameMode: 'chengdu', settings: {
    endCondition: 'bloodBattle', exchangeThree: true, selfDraw: 'addBase', fanCap: 4,
  } });
  tokens.push(created.token);
  for (const name of ['成都界面乙', '成都界面丙', '成都界面丁'])
    tokens.push((await request(`rooms/${created.roomId}/join`, undefined, { name })).token);
  const scope = setup((await request(`rooms/${created.roomId}`, 0)).state);
  scope.session.value = { roomId: created.roomId, token: tokens[0] };
  scope.playerToken.value = '';
  globalThis.fetch = (path, options) => handle(new Request(`https://example.test${path}`, options));
  await scope.mutate(null, true);
  assert.equal(scope.error.value, ''); assert.equal(scope.game.value.phase, 'exchange');
  assert.equal(scope.game.value.schemaVersion, 2);
  assert.match(await render(scope), /确认换三张/);
  // 前端不代选；测试明确选择每份服务器白名单的第一项，模拟四名真实玩家分别决定。
  // No production autoplay: this test explicitly chooses each player's first offered action to simulate independent decisions.
  await scope.mutate(scope.game.value.legalActions[0]);
  assert.equal(scope.error.value, '');
  assert.ok(scope.game.value.preparation.myExchange);
  assert.match(await render(scope), /换牌已提交，等待其他牌友/);
  for (const seat of [1, 2, 3]) {
    const state = (await request(`rooms/${created.roomId}`, seat)).state;
    await request(`rooms/${created.roomId}/action`, seat, { revision: state.revision, action: state.game.legalActions[0] });
  }
  scope.applyState((await request(`rooms/${created.roomId}`, 0)).state);
  assert.equal(scope.game.value.phase, 'dingque');
  assert.match(await render(scope), /定缺条/);
  await scope.mutate(scope.game.value.legalActions[0]);
  for (const seat of [1, 2, 3]) {
    const state = (await request(`rooms/${created.roomId}`, seat)).state;
    await request(`rooms/${created.roomId}/action`, seat, { revision: state.revision, action: state.game.legalActions[0] });
  }
  scope.applyState((await request(`rooms/${created.roomId}`, 0)).state);
  assert.equal(scope.game.value.phase, 'turn'); assert.equal(scope.game.value.currentSeat, 0);
  assert.match(await render(scope), /确认出牌/);
  const discard = scope.game.value.legalActions.find((action) => action.type === 'discard');
  await scope.mutate(discard);
  assert.equal(scope.error.value, ''); assert.ok(scope.game.value.history.some((event) => event.type === 'discard' && event.tile === discard.tile));
  assert.equal(scope.state.value.presentation, null);
  for (const player of scope.game.value.players) if (player.seat !== 0) assert.equal(player.hand, undefined);
  scope.cancelTurnPresentation();
});

// 大厅历史按记录模式选文案；成都旧局不借当前桌昵称或展示原始英文事件type。
// Lobby history chooses prose by record mode, never current-room names or raw English Chengdu event types.
test('personal Chengdu records render same-round names and private-safe Chinese events', async () => {
  browser(); const scope = lobby();
  scope.personalHistory.value = { summary: { totalScore: 0, settledGames: 1 }, records: [{
    roomId: 'OLDCD', gameId: 'old-chengdu', gameMode: 'chengdu', startedAt: 1, name: '旧甲', status: 'finished', score: 0,
    players: [{ seat: 0, name: '旧甲', score: 0 }, { seat: 1, name: '旧乙', score: 0 }],
    events: [{ type: 'discard', seat: 1, tile: 26 }, { type: 'hu', seat: 0, source: 'selfDraw', points: 9, tile: null, hidden: true }],
  }] };
  const html = await render(scope);
  assert.match(html, /旧乙打出 9万/); assert.match(html, /旧甲自摸 · 9分/);
  assert.doesNotMatch(html, />discard<|>hu<|隐藏牌/);
});

// 立绘只跟随已显示事件：排队未来胡牌、重复轮询和旧响应不能提前换脸或延长计时。
// Portraits follow displayed events only; future queued wins, duplicate polls and stale responses cannot switch early or extend timers.
test('portrait reactions follow local FIFO instead of future received wins', async () => {
  const scope = setup(fixture({ schemaVersion: 3 }));
  const next = localPlaybackFixture(scope);
  next.game.characters = ['sweet', 'sunny', 'elegant'];
  next.game.history.push({ type: 'hu', seat: 1, tile: 0, source: 'discard', fromSeat: 0 });
  scope.applyState(next);
  assert.deepEqual(scope.portraitReactionsBySeat.value, {});
  for (const timer of scheduled.filter((entry) => entry.delay === 350 && !entry.cancelled)) timer.callback();
  await settlePlayback();
  assert.deepEqual(scope.portraitReactionsBySeat.value, { 0: 'discardLoss', 1: 'win' });
  assert.equal(scope.characterForPlayer(0).portrait, '/characters/sweet-scene-discard-loss.png');
  assert.equal(scope.characterForPlayer(1).portrait, '/characters/sunny-scene-win.png');
  const reactionTimers = scheduled.filter((entry) => entry.delay === CharacterPortraitModule.PORTRAIT_REACTION_MS);
  scope.applyState(next);
  scope.applyState({ ...next, revision: next.revision - 1 });
  assert.equal(scheduled.filter((entry) => entry.delay === CharacterPortraitModule.PORTRAIT_REACTION_MS).length, reactionTimers.length);
  scope.clearPresentation();
  assert.equal(scope.characterForPlayer(1).portrait, '/characters/sunny-scene-win.png', 'tile-flight cleanup is independent');
  for (const timer of reactionTimers) timer.callback();
  assert.equal(scope.characterForPlayer(1).portrait, '/characters/sunny-scene-base.png');
  scope.resetRoomContext();
});

// 初次恢复只建立基线；新胡后切后台、换局及离桌立即撤下表情，晚到旧定时器无作用。
// Initial restore baselines history; visibility/game/room changes clear reactions and invalidate late old timers.
test('portrait reactions do not replay restored history and clear on visibility, round and room changes', async () => {
  const initial = fixture({ schemaVersion: 3 });
  initial.game.id = 'portrait-round';
  initial.game.characters = ['sweet', 'sunny', 'elegant'];
  initial.game.history = [{ type: 'hu', seat: 1, tile: null, hidden: true, source: 'selfDraw' }];
  const scope = setup(initial);
  scope.applyState(initial);
  assert.deepEqual(scope.portraitReactionsBySeat.value, {});
  const next = structuredClone(initial);
  next.revision++;
  next.game.history.push({ type: 'hu', seat: 0, tile: null, hidden: true, source: 'selfDraw' });
  scope.applyState(next);
  assert.equal(scope.characterForPlayer(0).portrait, '/characters/sweet-scene-win.png');
  document.hidden = true;
  scope.visibilityChanged();
  assert.deepEqual(scope.portraitReactionsBySeat.value, {});
  document.hidden = false;
  scope.visibilityChanged();
  scope.applyState(next);
  assert.deepEqual(scope.portraitReactionsBySeat.value, {});
  scope.presentWins([{ type: 'hu', seat: 0, hidden: true, source: 'selfDraw' }], next);
  const newRound = structuredClone(next);
  newRound.revision++;
  newRound.game.id = 'portrait-next-round';
  newRound.game.history = [];
  scope.applyState(newRound);
  assert.deepEqual(scope.portraitReactionsBySeat.value, {});
  scope.presentWins([{ type: 'hu', seat: 0, hidden: true, source: 'selfDraw' }], newRound);
  scope.resetRoomContext();
  for (const timer of scheduled.filter((entry) => entry.delay === CharacterPortraitModule.PORTRAIT_REACTION_MS)) timer.callback();
  assert.deepEqual(scope.portraitReactionsBySeat.value, {});
  await settlePlayback();
});

// 成都不使用花麻将飞牌或等待，但自己的真实头像仍会换；自摸隐藏牌不需要推断身份。
// Chengdu uses no Flower flights/wait, but its rendered portraits still react without inferring concealed self-draw identities.
test('Chengdu portraits react for players and spectators without leaking hidden self-draw tiles', async () => {
  for (const viewer of [0, null]) {
    const initial = fixture({ schemaVersion: 2 });
    initial.gameMode = 'chengdu';
    initial.you = viewer;
    initial.isSpectator = viewer === null;
    initial.game.id = 'portrait-chengdu';
    initial.game.gameMode = 'chengdu';
    initial.game.playerCount = 4;
    initial.game.players.push({ seat: 3, handCount: 13, melds: [], score: 0 });
    initial.game.characters = ['sweet', 'elegant', 'sunny', 'star'];
    initial.settings = { playerCount: 4, endCondition: 'bloodBattle', exchangeThree: false, selfDraw: 'addBase', fanCap: 4 };
    initial.game.rules = initial.settings;
    const scope = setup(initial);
    scope.applyState(initial);
    const next = structuredClone(initial);
    next.revision++;
    next.game.history.push({ type: 'hu', seat: 3, tile: null, hidden: true, source: 'selfDraw' });
    next.game.players[3].won = { tile: null, source: 'selfDraw', points: 2 };
    scope.applyState(next);
    await settlePlayback();
    assert.deepEqual(scope.portraitReactionsBySeat.value, { 3: 'win' });
    assert.equal(scope.winningEvents.value.length, 0);
    assert.equal(scope.localPresentationBusy.value, false, 'a portrait adds no action barrier');
    const html = await render(scope);
    assert.match(html, /characters\/star-scene-win.png/);
    assert.match(html, /牌面未公开/);
    const later = structuredClone(next);
    later.revision++;
    later.game.history.push({ type: 'discard', seat: 1, tile: 20 });
    scope.applyState(later);
    assert.equal(scope.characterForPlayer(3).portrait, '/characters/star-scene-win.png', 'other actions cannot clear a seat reaction');
    scope.resetRoomContext();
  }
});

// 四人一炮三响是同一批，立绘不能沿用原飞牌最多两人的截断。
// A four-seat triple win is one batch; portraits must not inherit the old two-flight display cap.
test('local four-seat triple wins change all three winners and the discarder together', async () => {
  const scope = setup(fixture({ schemaVersion: 3 }));
  const next = localPlaybackFixture(scope);
  next.game.playerCount = 4;
  next.game.players.push({ seat: 3, handCount: 13, huCount: 0, score: 0, melds: [], winPile: [], radishes: [] });
  next.game.characters = ['sweet', 'elegant', 'sunny', 'star'];
  for (const seat of [1, 2, 3]) next.game.history.push({ type: 'hu', seat, source: 'discard', tile: 4, fromSeat: 0 });
  scope.applyState(next);
  for (const timer of scheduled.filter((entry) => entry.delay === 350 && !entry.cancelled)) timer.callback();
  await settlePlayback();
  assert.deepEqual(scope.portraitReactionsBySeat.value, { 0: 'discardLoss', 1: 'win', 2: 'win', 3: 'win' });
  scope.skipLocalPlayback();
  assert.deepEqual(scope.portraitReactionsBySeat.value, {});
  scope.applyState(next);
  assert.deepEqual(scope.portraitReactionsBySeat.value, {});
  scope.resetRoomContext();
});

// 本人立绘独立位于手牌下方，不再充当背景；观众仍没有本人牌区或本人立绘。
// Own art is separate below the hand rather than a background; spectators retain neither an own hand nor own portrait.
test('portrait scenes use independent own art below the existing private hand controls', async () => {
  for (const schemaVersion of [1, 2, 3]) {
    const state = fixture({ legacy: schemaVersion === 1, schemaVersion });
    state.game.characters = ['sweet', 'sunny', 'elegant'];
    const scope = setup(state);
    const html = await render(scope);
    assert.equal((html.match(/class="[^"]*\bcharacter-portrait\b/g) || []).length, 2);
    assert.equal((html.match(/class="[^"]*\bown-character-scene\b/g) || []).length, 1);
    const ownArea = html.slice(html.indexOf('own-player-area'));
    assert.match(ownArea, /own-character-scene[\s\S]+character-artwork-original[^>]+src="\/characters\/sweet-scene-base\.png"[^>]+alt="小桃"/);
    // 可见角色名片消失，但原图的alt与玩家身份仍保留，旧schema也使用同一展示约定。
    // Visible role nameplates disappear while image alternatives/player identity remain, including legacy schemas.
    assert.doesNotMatch(html, /<figcaption\b|>\s*(?:小桃|晴禾|清岚)\s*</);
    for (const name of ['牌友1', '牌友2', '牌友3']) {
      assert.match(html, new RegExp(`class="player-name"[^>]*>\\s*${name}`));
    }
    assert.ok(ownArea.indexOf('class="hand-panel"') < ownArea.indexOf('class="own-character-display"'));
    assert.ok(ownArea.indexOf('class="own-character-display"') < ownArea.indexOf('table-info-footer'));
    assert.match(ownArea, /table-info-footer[\s\S]+own-seat-summary/);
    assert.match(ownArea, /class="my-hand"/);
    scope.resetRoomContext();
  }
  const spectator = fixture({ schemaVersion: 3 });
  spectator.viewerRole = 'spectator';
  spectator.you = null;
  const scope = setup(spectator);
  const html = await render(scope);
  assert.doesNotMatch(html, /own-player-area|own-character-scene|我的手牌与操作/);
  assert.equal((html.match(/class="[^"]*\bcharacter-portrait\b/g) || []).length, 3);
  scope.resetRoomContext();
});

// 大厅没有私有牌区；终局保留下方独立角色图并沿用既有诊断/下一局流程。
// Lobbies have no private hand; finished rounds retain the separate portrait below and existing diagnostics/next-round flow.
test('own scene lifecycle keeps the lobby undecorated and clears on room exit', async () => {
  const state = fixture({ schemaVersion: 3 });
  state.phase = 'finished';
  state.game.phase = 'finished';
  state.game.legalActions = [];
  const scope = setup(state);
  assert.match(await render(scope), /own-character-scene/);
  scope.state.value = { ...state, phase: 'lobby', game: null };
  const lobbyHtml = await render(scope);
  assert.match(lobbyHtml, /own-seat-summary/);
  assert.doesNotMatch(lobbyHtml, /own-character-scene|我的手牌与操作/);
  scope.resetRoomContext();
  assert.doesNotMatch(await render(scope), /own-character-scene/);
});

// 局部Canvas2D替代整图 CSS 摆动；系统偏好由真实组件监听，原图/牌/标签保持静止。
// Local Canvas2D replaces whole-image CSS motion; the real component observes preferences while art/tiles/labels remain still.
test('scene motion is local-only and observes live reduced-motion changes', () => {
  const css = readFileSync(new URL('../src/tabletop.css', import.meta.url), 'utf8');
  const artwork = readFileSync(new URL('../src/CharacterArtwork.vue', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /@keyframes character-scene-breathe|animation: character-scene-breathe/);
  assert.match(css, /\.own-character-art\s*\{[^}]*overflow: clip;/);
  assert.match(css, /\.own-character-scene\s*\{[^}]*position: static;/);
  assert.doesNotMatch(css, /\.own-player-area\.has-character-scene::after/);
  assert.match(artwork, /prefers-reduced-motion: reduce/);
  assert.match(artwork, /addEventListener\?\.\('change', motionChanged\)/);
  assert.match(artwork, /removeEventListener\?\.\('change', motionChanged\)/);
  assert.match(artwork, /pointer-events: none/);
});

// 落座后的已分配角色优先于偏好；进入游戏、刷新快照与观战不能重新猜测角色。
// Assigned seated identities outrank preferences; game entry, refreshed snapshots and spectators must not guess new identities.
test('seated character identity survives lobby to start and preserves replacement versus game ownership', async () => {
  const state = fixture({ schemaVersion: 3 });
  state.seats[0].preferredCharacter = 'sweet';
  state.seats[0].characterId = 'landlord';
  const game = structuredClone(state.game);
  game.characters = ['landlord', 'honest', 'star'];
  state.game = null;
  state.phase = 'lobby';
  const scope = setup(state);
  assert.equal(scope.characterForPlayer(0).id, 'landlord');
  // 身份以已分配角色头像和名称验证，不依赖已删除的冗余角色说明。
  // Verify identity through the assigned portrait/name rather than the removed redundant description.
  const seatedHtml = await render(scope);
  assert.match(seatedHtml, /src="\/characters\/landlord-scene-base\.png" alt="地主"/);
  assert.doesNotMatch(seatedHtml, /own-character-label|own-role-note/);
  assert.doesNotMatch(await render(scope), /开局时最终分配|偏好预览/);
  scope.state.value = { ...state, game, phase: 'playing' };
  assert.equal(scope.characterForPlayer(0).id, 'landlord');
  scope.state.value = structuredClone({ ...state, game, phase: 'playing' });
  assert.equal(scope.characterForPlayer(0).id, 'landlord');
  scope.state.value.seats[0].isCurrentParticipant = false;
  scope.state.value.seats[0].characterId = 'elegant';
  scope.state.value.phase = 'finished';
  assert.equal(scope.characterForPlayer(0, true).id, 'elegant', 'replacement identity uses its new seated role');
  assert.equal(scope.characterForPlayer(0).id, 'landlord', 'the old game participant retains its original role');
  scope.resetRoomContext();
});


// 设置入口独立于模式和牌局；普通本地开关默认静态，不再加载旧SDK或要求旧许可。
// Settings are independent of mode/game, default static and no longer load the retired SDK or ask for its terms.
test('both actual App modes expose ordinary local settings without preloading dynamic assets', async () => {
  for (const gameMode of ['flower', 'chengdu']) {
    const state = startFixture();
    state.gameMode = gameMode;
    if (gameMode === 'chengdu') {
      state.rulesVersion = 2;
      state.settings = { playerCount: 4, dingque: true, endCondition: 'bloodBattle', exchangeThree: false, selfDraw: 'addBase', fanCap: 4 };
    }
    const html = await render(setup(state));
    assert.match(html, /<details class="portrait-motion-settings">/);
    assert.match(html, /动态角色：未启用/);
    assert.match(html, /启用局部动态/);
    assert.match(html, /不启用，使用静态角色/);
    assert.match(html, /只在眼睑处眨眼/);
    assert.doesNotMatch(html, /Live2D|官方许可|live2d\.com/);
    assert.doesNotMatch(html, /(?:src|href)="(?:\/vendor\/live2d|\/live2d\/|[^" ]*renderer[^" ]*\.js)/);
    assert.doesNotMatch(html, /<canvas|Live2D 组件使用条款|赔偿承诺|收入申报/);
  }
});

// 真实SSR覆盖旧版本、玩家/观众和终局；移动不能复制接牌提示、遗失按钮或把私有区带入观战。
// Real SSR covers legacy versions, players/spectators and finish; moving must not duplicate claims, lose controls or expose private zones.
test('Flower footer preserves one public status/claim and original finish controls across views', async () => {
  for (const schemaVersion of [1, 2, 3]) {
    for (const spectator of [false, true]) {
      const state = fixture({ legacy: schemaVersion === 1, schemaVersion });
      state.game.phase = 'claim';
      state.game.claim = { tile: 4, discardSeat: 1, kind: 'discard' };
      if (spectator) { state.viewerRole = 'spectator'; state.you = null; }
      const scope = setup(state);
      const html = await render(scope);
      const footer = html.indexOf('class="table-info-footer');
      assert.ok(footer >= 0);
      assert.equal((html.match(/class="claim-slot stable-scroll"/g) || []).length, 1);
      assert.equal((html.match(/class="game-status"/g) || []).length, 1);
      assert.ok(html.indexOf('class="game-status"') > footer);
      const claim = html.indexOf('class="claim-slot stable-scroll"');
      if (spectator) {
        assert.ok(claim > footer);
        assert.doesNotMatch(html, /own-seat-summary|我的手牌与操作/);
      } else {
        assert.ok(claim < footer && claim > html.indexOf('class="my-hand"'));
        assert.ok(claim < html.indexOf('class="action-row"'));
        assert.equal((html.match(/class="[^"]*\bown-seat-summary\b/g) || []).length, 1, 'one own identity summary remains');
      }
      scope.state.value = { ...state, phase: 'finished', game: { ...state.game, phase: 'finished', claim: null, legalActions: [] } };
      const finished = await render(scope);
      assert.ok(finished.indexOf('class="finished-banner"') > finished.indexOf('class="table-info-footer'));
      assert.match(finished, /返回大厅换桌/);
      assert.equal(finished.includes('同桌再来一局'), !spectator);
      scope.resetRoomContext();
    }
  }
});

// 整合回归把真实schema3投影送入已居中/置底的App，不能用旧UI合成动作掩盖规则修复。
// Integration sends real schema-three projections into the centered/footer App instead of inventing stale UI actions.
test('integrated Flower UI removes held-tile post-hu upgrades while preserving pass and footer order', async () => {
  const { variableFixture, meld } = await import('./fixtures/variable-table.js');
  for (const count of [3, 4, 7]) {
    const raw = variableFixture({ playerCount: 3, deckCount: 3, drawTile: 14,
      hands: [[3, 4, 5, 5, 11, 12, 13, 14]], melds: [[meld(11, count, count === 3 ? 'peng' : 'buGang'), meld(1)]],
      huCounts: [2], rules: { specialHuPatterns: false, autoDiscardAfterHu: false } });
    const state = fixture({ schemaVersion: 3 }); state.game = getPlayerView(raw, 0);
    const scope = setup(state);
    assert.deepEqual(scope.gangActions.value, []);
    assert.deepEqual(scope.primaryActions.value, [{ type: 'pass' }]);
    const html = (await render(scope)).replace(/<!--[\s\S]*?-->/g, '');
    const actions = html.match(/<div class="action-row"[^>]*>([\s\S]*?)<\/div>/)?.[1];
    assert.ok(actions); assert.match(actions, /过/); assert.doesNotMatch(actions, /加杠|补杠|暗杠|胡牌/);
    assert.ok(html.indexOf('class="table-info-footer') > html.indexOf('class="action-row"'));
    assert.doesNotMatch(html, /own-character-label|own-role-note/);
    scope.resetRoomContext();
  }
});

// 不能为“锁手牌”把暗杠一刀切掉：合法暗杠须继续出现在同一权威操作栏。
// Held-hand correction must not remove legal concealed kongs from the same authoritative action bar.
test('integrated Flower UI keeps a legal post-hu concealed kong in its accessible action bar', async () => {
  const raw = postHuKongGame({ type: 'anGang' });
  const state = fixture({ schemaVersion: 3 }); state.game = getPlayerView(raw, 0);
  const scope = setup(state);
  assert.deepEqual(scope.gangActions.value, [{ type: 'anGang', tile: raw.lastDraw.tile }]);
  const html = await render(scope);
  const actions = html.match(/<div class="action-row"[^>]*>([\s\S]*?)<\/div>/)?.[1];
  assert.match(actions, /暗杠/); assert.doesNotMatch(actions, /加杠|补杠/);
  assert.match(html, /class="action-row"[^>]*tabindex="0"[^>]*aria-label="合法动作，可横向滚动"/);
  scope.resetRoomContext();
});

// 已保存待回应窗仍可能列出旧hu。规则先过滤再投影，UI不能把已胡身份变回“必胡”。
// Saved claim options may contain old hu; engine filtering must reach UI before prior-win mandatory-hu presentation.
test('integrated Flower UI restores a self-discard-locked old claim as pass, with private explanation', async () => {
  const { assertGameInvariants } = await import('../shared/game.js');
  for (const kind of ['discard', 'robKong']) {
    const raw = postHuWinClaim({ kind });
    const tile = raw.claim.tile;
    const wallIndex = raw.wall.indexOf(tile); assert.notEqual(wallIndex, -1);
    raw.wall.splice(wallIndex, 1);
    raw.discards.unshift({ seat: 0, tile, claimable: false, afterKong: false });
    raw.claim.discardIndex++;
    raw.history.unshift({ type: 'discard', seat: 0, tile, revision: 0 });
    assertGameInvariants(raw);
    const before = JSON.stringify(raw);
    const state = fixture({ schemaVersion: 3 }); state.game = getPlayerView(JSON.parse(before), 0);
    const scope = setup(state);
    assert.deepEqual(scope.primaryActions.value, [{ type: 'pass' }]);
    assert.equal(scope.mustHu.value, false); assert.equal(scope.canHu.value, false);
    assert.equal(scope.huDiagnostic.value.code, 'SELF_DISCARD_LOCK');
    const html = await render(scope);
    const actions = html.match(/<div class="action-row"[^>]*>([\s\S]*?)<\/div>/)?.[1];
    assert.match(actions, /过/); assert.doesNotMatch(actions, /胡牌/);
    assert.match(html, /下次自己摸牌前不能胡这张牌/);
    assert.equal(JSON.stringify(raw), before, 'reading/rendering must not rewrite stored old options or history');
    // 模拟刷新重新投影，不能靠重载页面解除本人的自弃限制。
    // Reprojection on refresh cannot clear the self-discard restriction.
    scope.state.value = { ...state, game: getPlayerView(JSON.parse(before), 0) };
    assert.deepEqual(scope.primaryActions.value, [{ type: 'pass' }]);
    scope.resetRoomContext();
  }
});

// 自弃锁诊断只给本人；观众仍只看下方公开状态和待接牌，不能得到手牌或动作。
// Only the owner sees the lock diagnosis; spectators retain public footer/claim content without hands or controls.
test('integrated Flower spectator footer retains public claims without private lock explanations', async () => {
  const { engineFor } = await import('../server/game-engines.js');
  const raw = postHuWinClaim();
  raw.history.unshift({ type: 'discard', seat: 0, tile: raw.claim.tile, revision: 0 });
  const state = fixture({ schemaVersion: 3 });
  state.viewerRole = 'spectator'; state.you = null;
  state.game = engineFor(raw).spectatorView(raw);
  const scope = setup(state);
  const html = (await render(scope)).replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(html.indexOf('class="claim-slot stable-scroll"') > html.indexOf('class="table-info-footer'));
  assert.doesNotMatch(html, /SELF_DISCARD_LOCK|下次自己摸牌前不能胡这张牌|我的手牌与操作|class="action-row"/);
  scope.resetRoomContext();
});

// 下一局弹层测试只使用合成裁剪视图与模拟请求；不改规则、不连接真实牌桌。
// Next-round dialog tests use synthetic filtered snapshots and mocked requests, never live tables or rule edits.
function nextRoundFixture(mode = 'flower', phase = 'finished') {
  const state = startFixture('finished');
  state.phase = phase;
  state.game.id = 'next-round-dialog-game';
  state.game.phase = phase === 'finished' ? 'finished' : 'turn';
  state.settings = { playerCount: 3, deckCount: 2, dragonStartCount: 6, autoDiscardAfterHu: false, bigSingleReadyPoints: 0 };
  if (mode === 'chengdu') {
    state.gameMode = 'chengdu';
    state.rulesVersion = 2;
    state.settings = { playerCount: 4, dingque: true, endCondition: 'bloodBattle', exchangeThree: false, selfDraw: 'addBase', fanCap: 4 };
    state.seats = Array.from({ length: 4 }, (_, seat) => ({ seat, name: `合成${seat + 1}`, connected: true }));
    state.game = { id: 'next-round-dialog-game', gameMode: 'chengdu', schemaVersion: 2, revision: 0,
      mySeat: 0, phase: phase === 'finished' ? 'finished' : 'turn', dealerSeat: 0, currentSeat: 0, wallCount: 0,
      rules: state.settings, players: state.seats.map((player) => ({ seat: player.seat, handCount: 13, score: 0, melds: [], won: null,
        ...(player.seat === 0 ? { hand: [18, 19, 20] } : {}) })), legalActions: [], history: [], discards: [] };
  }
  return state;
}

for (const mode of ['flower', 'chengdu']) {
  test(`next-round dialog ${mode}: live finish opens once, reload stays closed, and manual reopening is harmless`, async () => {
    const scope = setup(nextRoundFixture(mode, 'playing'));
    globalThis.fetch = () => assert.fail('opening a dialog must not make a request');
    await settle();
    scope.state.value.phase = 'finished';
    scope.state.value.game.phase = 'finished';
    await settle();
    assert.equal(scope.showNextRound.value, true);
    const html = (await render(scope)).replace(/<!--[\s\S]*?-->/g, '');
    const dialog = html.match(/<section[^>]*aria-labelledby="next-round-title"[\s\S]*?<\/section>/)?.[0] || '';
    assert.match(dialog, /role="dialog"/);
    assert.match(dialog, /aria-labelledby="next-round-title"/);
    assert.match(dialog, /aria-describedby="next-round-description"/);
    assert.match(dialog, /同桌再来一局/);
    assert.match(dialog, /返回大厅/);
    assert.doesNotMatch(dialog, /<input|<select|查看结算<\/button>/);
    scope.closeModal();
    await settle();
    scope.state.value = { ...scope.state.value, revision: scope.state.value.revision + 1 };
    await settle();
    assert.equal(scope.showNextRound.value, false);
    scope.openNextRound();
    await settle();
    assert.equal(scope.showNextRound.value, true);
    scope.resetRoomContext();
    scope.session.value = credential();
    scope.state.value = nextRoundFixture(mode);
    await settle();
    assert.equal(scope.showNextRound.value, false, 're-entry into a finished room is not a new finish');
    scope.resetRoomContext();
    const fresh = setup(nextRoundFixture(mode));
    await settle();
    assert.equal(fresh.showNextRound.value, false, 'a refreshed page does not auto-prompt an existing finish');
    fresh.resetRoomContext();
  });

  test(`next-round dialog ${mode}: host starts once with saved choices and closes only after the new game arrives`, async () => {
    const state = nextRoundFixture(mode);
    const scope = setup(state);
    await settle();
    scope.openNextRound();
    const requests = [];
    let release;
    globalThis.fetch = (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return new Promise(resolve => { release = resolve; });
    };
    const pending = scope.startNextRound();
    await settle();
    await scope.startNextRound();
    scope.closeModal();
    await scope.leaveFinishedTable();
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /\/start$/);
    assert.deepEqual(requests[0].body.options, {});
    assert.equal(scope.showNextRound.value, true, 'in-flight outcome stays visible');
    assert.equal(scope.busy.value, true);
    const next = nextRoundFixture(mode, 'playing');
    next.game.id = 'next-round-dialog-new-game';
    next.revision++;
    release(response({ state: next }));
    await pending;
    await settle();
    assert.equal(scope.showNextRound.value, false);
    assert.equal(scope.phase.value, 'playing');
    assert.deepEqual(scope.state.value.settings, state.settings);
    scope.resetRoomContext();
  });
}

// 非房主/观众没有开局入口；满员、断线、同步、音画与旧金额守卫同样约束弹层处理器。
// Non-hosts/viewers gain no start control; occupancy, offline, sync, media and legacy-amount guards also protect handlers.
test('next-round dialog respects player, spectator and existing start restrictions', async () => {
  const scope = setup(nextRoundFixture());
  await settle();
  scope.openNextRound();
  globalThis.fetch = () => assert.fail('blocked starts must not request');
  for (const role of ['player', 'spectator']) {
    scope.state.value.you = role === 'player' ? 1 : null;
    scope.state.value.viewerRole = role;
    await settle();
    scope.openNextRound();
    await scope.startNextRound();
    const html = await render(scope);
    const dialog = html.match(/<section[^>]*aria-labelledby="next-round-title"[\s\S]*?<\/section>/)?.[0] || '';
    assert.doesNotMatch(dialog, /同桌再来一局<\/button>/);
    assert.match(dialog, /等待房主/);
    scope.closeModal();
  }
  scope.state.value.you = 0;
  scope.state.value.viewerRole = 'player';
  scope.openNextRound();
  for (const key of ['busy', 'offline', 'syncing', 'localPresentationBusy']) {
    scope[key].value = true;
    assert.ok(scope.nextRoundUnavailable.value);
    await scope.startNextRound();
    scope[key].value = false;
  }
  scope.state.value.seats[2].detached = true;
  assert.match(scope.nextRoundUnavailable.value, /所有玩家落座/);
  await scope.startNextRound();
  scope.state.value.seats[2] = null;
  await scope.startNextRound();
  scope.state.value.seats[2] = { seat: 2, name: '合成3', connected: true };
  scope.state.value.settings = { autoDiscardAfterHu: false };
  scope.bigSingleReadyPoints.value = -1;
  assert.match(scope.nextRoundUnavailable.value, /喜钱金额/);
  await scope.startNextRound();
  scope.resetRoomContext();
});

test('next-round dialog defers behind existing modals and media, never prompts spectators, and cancels stale pending finishes', async () => {
  const scope = setup(nextRoundFixture('flower', 'playing'));
  await settle();
  scope.showRules.value = true;
  scope.localPresentationBusy.value = true;
  scope.state.value.phase = 'finished';
  scope.state.value.game.phase = 'finished';
  await settle();
  assert.equal(scope.showNextRound.value, false);
  scope.showRules.value = false;
  scope.showInvite.value = true;
  scope.localPresentationBusy.value = false;
  await settle();
  assert.equal(scope.showNextRound.value, false);
  scope.showInvite.value = false;
  await settle();
  assert.equal(scope.showNextRound.value, true);
  assert.equal((await render(scope)).match(/role="dialog"/g).length, 1);
  scope.closeModal();
  scope.state.value = nextRoundFixture('flower', 'playing');
  scope.state.value.game.id = 'next-pending-game';
  await settle();
  scope.showRules.value = true;
  scope.state.value.phase = 'finished';
  await settle();
  scope.resetRoomContext();
  await settle();
  assert.equal(scope.showNextRound.value, false);
  scope.session.value = credential();
  scope.state.value = nextRoundFixture('flower', 'playing');
  scope.state.value.viewerRole = 'spectator';
  await settle();
  scope.state.value.phase = 'finished';
  await settle();
  assert.equal(scope.showNextRound.value, false);
  scope.resetRoomContext();
});

// 用可控DOM替身验证真实键盘处理器，包括禁用按钮过滤、全禁用、ESC和关闭后的焦点恢复。
// Exercise the real keyboard handler with controlled DOM doubles: disabled filtering, all-disabled focus, Escape and restoration.
test('next-round dialog traps keyboard focus, handles Escape and restores the triggering control', async () => {
  const scope = setup(nextRoundFixture());
  await settle();
  const control = () => ({ isConnected: true, focus() { document.activeElement = this; } });
  const trigger = control(), first = control(), last = control(), container = control();
  let controls = [first, last];
  scope.modalRef.value = { ...container,
    querySelector: () => first,
    querySelectorAll(selector) { assert.match(selector, /:not\(:disabled\)/); return controls; },
    contains: (element) => element === scope.modalRef.value || controls.includes(element),
  };
  document.activeElement = trigger;
  scope.openNextRound();
  await settle();
  assert.equal(document.activeElement, first);
  let prevented = 0;
  const key = (key, shiftKey = false) => scope.onKey({ key, shiftKey, preventDefault() { prevented++; } });
  document.activeElement = last;
  key('Tab');
  assert.equal(document.activeElement, first);
  key('Tab', true);
  assert.equal(document.activeElement, last);
  document.activeElement = trigger;
  key('Tab');
  assert.equal(document.activeElement, first);
  scope.busy.value = true;
  controls = [];
  key('Tab');
  assert.equal(document.activeElement, scope.modalRef.value);
  key('Escape');
  assert.equal(scope.showNextRound.value, true);
  scope.busy.value = false;
  // 开局失败后按钮恢复，但焦点仍可能在容器本身；真实DOM的contains(self)为true，仍须拦住双向Tab。
  // A failed start restores controls while focus may stay on the container; real contains(self) is true, so both Tab directions must remain trapped.
  controls = [first, last];
  key('Tab', true);
  assert.equal(document.activeElement, last);
  document.activeElement = scope.modalRef.value;
  key('Tab');
  assert.equal(document.activeElement, first);
  key('Escape');
  await settle();
  assert.equal(scope.showNextRound.value, false);
  assert.equal(document.activeElement, trigger);
  assert.equal(document.body.style.overflow, '');
  assert.equal(prevented, 8);
  // 已失效的触发按钮不接收焦点；终局动作被禁用时回到常驻的下一局入口。
  // Do not focus an obsolete trigger; disabled end-of-game actions fall back to the persistent next-round entry.
  const fallback = control();
  document.querySelector = () => fallback;
  scope.openNextRound();
  await settle();
  trigger.disabled = true;
  scope.closeModal();
  await settle();
  assert.equal(document.activeElement, fallback);
  scope.resetRoomContext();
});

test('next-round dialog keeps failure feedback visible and returns to the lobby through normal departure', async () => {
  const scope = setup(nextRoundFixture());
  await settle();
  scope.openNextRound();
  let starts = 0;
  globalThis.fetch = async (url) => {
    assert.match(url, /\/start$/);
    starts++;
    return response({ error: '合成开局失败，请稍后再试。' }, 503);
  };
  await scope.startNextRound();
  await settle();
  assert.equal(starts, 1);
  assert.equal(scope.showNextRound.value, true);
  assert.equal(scope.busy.value, false);
  assert.match(await render(scope), /class="next-round-error" role="alert">合成开局失败/);
  const calls = [];
  scope.playerToken.value = 'a'.repeat(64);
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (url.endsWith('/leave')) return response({ left: true, detached: false });
    return response({ records: [], totals: [] });
  };
  await scope.leaveFinishedTable();
  await settle();
  assert.equal(calls.filter(url => url.endsWith('/leave')).length, 1);
  assert.equal(calls.some(url => url.endsWith('/start')), false);
  assert.equal(scope.inRoom.value, false);
  assert.equal(scope.showNextRound.value, false);
  assert.equal(window.location.search, '');
});

// 请求结果不明时沿用原同步流程；读到已开新局才撤下弹层，不能自动重复 start。
// Uncertain starts use existing resynchronization; only an observed new game closes the dialog, never an automatic retry.
test('next-round dialog reconciles an uncertain start without retry and retains unresolved connection feedback', async () => {
  for (const recovered of [true, false]) {
    const scope = setup(nextRoundFixture());
    await settle();
    scope.openNextRound();
    let starts = 0, reads = 0;
    globalThis.fetch = async (url) => {
      if (url.endsWith('/start')) {
        starts++;
        throw new Error('synthetic lost response');
      }
      reads++;
      if (!recovered) throw new Error('synthetic offline read');
      const state = nextRoundFixture('flower', 'playing');
      state.game.id = 'confirmed-new-game';
      state.revision++;
      return response({ state });
    };
    await scope.startNextRound();
    await settle();
    assert.equal(starts, 1);
    assert.equal(reads, 1);
    assert.equal(scope.showNextRound.value, !recovered);
    if (!recovered) {
      assert.equal(scope.offline.value, true);
      assert.match(scope.nextRoundUnavailable.value, /连接中断/);
      assert.match(await render(scope), /连接中断，操作结果需要同步确认/);
      await scope.startNextRound();
      assert.equal(starts, 1);
    }
    scope.resetRoomContext();
  }
});

// 新局 ID 结束后可再次提示；换桌或离开会清掉旧待提示，不因迟到请求重新进入。
// A distinct next game may prompt on finish; departure cancels old prompts and stale responses cannot re-enter the table.
test('next-round dialog follows distinct game identities and ignores a late start after navigation', async () => {
  const scope = setup(nextRoundFixture('flower', 'playing'));
  await settle();
  scope.state.value.phase = 'finished';
  await settle();
  assert.equal(scope.showNextRound.value, true);
  const next = nextRoundFixture('flower', 'playing');
  next.game.id = 'different-next-round';
  scope.state.value = next;
  await settle();
  assert.equal(scope.showNextRound.value, false);
  scope.state.value.phase = 'finished';
  scope.state.value.game.phase = 'finished';
  await settle();
  assert.equal(scope.showNextRound.value, true);
  let release;
  globalThis.fetch = () => new Promise(resolve => { release = resolve; });
  const pending = scope.startNextRound();
  await settle();
  scope.resetRoomContext();
  release(response({ state: nextRoundFixture('flower', 'playing') }));
  await pending;
  await settle();
  assert.equal(scope.inRoom.value, false);
  assert.equal(scope.showNextRound.value, false);
});

// 完整快照会重新触发watch，即使只更新revision；观众手动打开的弹层不能被这种轮询撤掉。
// Full snapshots retrigger the watcher even for revision-only updates; such polls must preserve a spectator's manual dialog.
test('next-round dialog preserves spectator manual choices across full same-game polls without enabling starts or automatic prompts', async () => {
  for (const mode of ['flower', 'chengdu']) {
    const state = nextRoundFixture(mode, 'playing');
    state.viewerRole = 'spectator';
    state.you = null;
    const scope = setup(state);
    globalThis.fetch = () => assert.fail('spectator choices must never start a game');
    await settle();
    scope.state.value = { ...scope.state.value, phase: 'finished', game: { ...scope.state.value.game, phase: 'finished' } };
    await settle();
    assert.equal(scope.showNextRound.value, false, 'live spectator finishes do not auto-prompt');
    scope.openNextRound();
    await settle();
    assert.equal(scope.showNextRound.value, true);
    scope.state.value = { ...scope.state.value, revision: scope.state.value.revision + 1, game: { ...scope.state.value.game } };
    await settle();
    assert.equal(scope.showNextRound.value, true, 'full same-game polls preserve manual choices');
    assert.equal(scope.canStart.value, false);
    assert.match(scope.nextRoundUnavailable.value, /正在观战/);
    await scope.startNextRound();
    const html = await render(scope);
    const dialog = html.match(/<section[^>]*aria-labelledby="next-round-title"[\s\S]*?<\/section>/)?.[0] || '';
    assert.match(dialog, /返回大厅/);
    assert.doesNotMatch(dialog, /同桌再来一局<\/button>/);
    scope.closeModal();
    scope.state.value = { ...scope.state.value, revision: scope.state.value.revision + 1 };
    await settle();
    assert.equal(scope.showNextRound.value, false, 'polls cannot reopen a dismissed spectator dialog');
    scope.state.value = { ...scope.state.value, viewerRole: 'player', you: 0 };
    await settle();
    scope.openNextRound();
    await settle();
    assert.equal(scope.showNextRound.value, true);
    scope.state.value = { ...scope.state.value, viewerRole: 'spectator', you: null };
    await settle();
    assert.equal(scope.showNextRound.value, false, 'an actual role change closes the previous role dialog');
    scope.resetRoomContext();
  }
});

// 用真实Vue渲染器调度原App watcher；宿主只模拟节点连接/禁用/焦点，不替代watch或nextTick。
// Run the original App watcher with Vue's real renderer scheduler; the host models connection/disabled/focus only, never watch or nextTick.
function mountNextRoundFocusHost(scope) {
  const disabled = Vue.ref(false);
  const nodes = {};
  function connect(node, connected) {
    node.isConnected = connected;
    if (!connected && document.activeElement === node) document.activeElement = document.body;
    for (const child of node.children) connect(child, connected);
  }
  function element(type) {
    return Vue.markRaw({ type, parent: null, children: [], isConnected: false, disabled: false, focusCount: 0,
      focus() {
        this.focusCount++;
        if (this.isConnected && !this.disabled) document.activeElement = this;
      },
      querySelector() { return this.children.find(child => child.type === 'button' && !child.disabled); },
    });
  }
  const renderer = Vue.createRenderer({
    createElement: element,
    createText: () => element('text'),
    createComment: () => element('comment'),
    setText(node, text) { node.text = text; },
    setElementText(node, text) { node.text = text; },
    patchProp(node, key, previous, value) { node[key] = value; },
    parentNode: node => node.parent,
    nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
    insert(node, parent, anchor = null) {
      const oldIndex = node.parent?.children.indexOf(node) ?? -1;
      if (oldIndex >= 0) node.parent.children.splice(oldIndex, 1);
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      parent.children.splice(index < 0 ? parent.children.length : index, 0, node);
      node.parent = parent;
      connect(node, parent.isConnected);
    },
    remove(node) {
      const index = node.parent?.children.indexOf(node) ?? -1;
      if (index >= 0) node.parent.children.splice(index, 1);
      node.parent = null;
      connect(node, false);
    },
  });
  const root = element('root');
  root.isConnected = true;
  const app = renderer.createApp({
    setup: () => () => Vue.h('main', [
      scope.phase.value === 'finished' ? Vue.h('button', {
        key: 'trigger', disabled: disabled.value, ref: node => { nodes.trigger = node; },
      }, '下一局选择') : null,
      Vue.h('button', { key: 'tool', ref: node => { nodes.tool = node; } }, '复制邀请'),
      scope.activeModal.value ? Vue.h('section', {
        key: scope.activeModal.value, ref: node => { scope.modalRef.value = node; },
      }, [Vue.h('button', { ref: node => { nodes.modalButton = node; } }, '关闭')]) : null,
    ]),
  });
  app.mount(root);
  document.querySelector = () => [nodes.trigger, nodes.tool].find(node => node?.isConnected && !node.disabled);
  return { disabled, nodes, unmount: () => app.unmount() };
}

for (const change of ['new game removes trigger', 'same tick disables trigger']) {
  test(`next-round dialog restores focus after DOM commit when ${change}`, async () => {
    const scope = setup(nextRoundFixture());
    await settle();
    const host = mountNextRoundFocusHost(scope);
    const trigger = host.nodes.trigger;
    trigger.focus();
    scope.openNextRound();
    await settle();
    assert.equal(document.activeElement, host.nodes.modalButton);
    if (change === 'new game removes trigger') {
      const state = nextRoundFixture('flower', 'playing');
      state.game.id = 'focus-after-new-game';
      scope.state.value = state;
    } else {
      host.disabled.value = true;
      scope.closeModal();
    }
    await settle();
    assert.equal(scope.activeModal.value, null);
    assert.equal(trigger.isConnected && !trigger.disabled, false);
    assert.equal(trigger.focusCount, 1, 'the obsolete trigger must not receive even a transient restore');
    assert.equal(document.activeElement, host.nodes.tool, 'persistent table tool receives focus after the DOM patch');
    host.unmount();
    scope.resetRoomContext();
  });
}

// post watcher在关闭后的同一轮DOM提交中打开规则，旧关闭回调不能再抢回触发器或桌面工具。
// A post-flush watcher opens rules during the close flush; the old closing callback must not steal focus from the new modal.
test('next-round dialog closing restore yields to another modal taking over during the DOM flush', async () => {
  const scope = setup(nextRoundFixture());
  await settle();
  const host = mountNextRoundFocusHost(scope);
  const trigger = host.nodes.trigger;
  trigger.focus();
  scope.openNextRound();
  await settle();
  const stop = Vue.watch(scope.activeModal, (open) => {
    if (open) return;
    stop();
    scope.showRules.value = true;
  }, { flush: 'post' });
  scope.closeModal();
  await settle();
  assert.equal(scope.activeModal.value, 'rules');
  assert.equal(trigger.focusCount, 1, 'the closing dialog never steals focus back');
  assert.equal(host.nodes.tool.focusCount, 0);
  assert.equal(document.activeElement, host.nodes.modalButton);
  assert.equal(document.body.style.overflow, 'hidden');
  host.unmount();
  scope.resetRoomContext();
});
