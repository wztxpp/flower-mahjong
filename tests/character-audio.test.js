// 合成音频环境中的播报游标、队列、中断、静音与过期处理。
// Voice cursors, queues, interruption, mute and expiry in a synthetic audio environment.
// 阅读说明见 docs/TESTING-READING-GUIDE.md；固定种子与凭证仅为测试，不应移入真实用户数据。
// See docs/TESTING-READING-GUIDE.md; seeded data and test credentials must stay separate from real user data.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CHARACTERS,
  ActionVoiceCursor,
  CharacterAudio,
  clipForEvent,
  clipsForEvent,
} from "../src/character-audio.js";
const state = (history, revision = history.length, id = "game-1") => ({
  id: "room-1",
  revision,
  game: {
    id,
    history,
    characters: ["sunny", "sweet", "elegant"],
  },
});
// 场景：每个角色提供 23 个正确语音片段，仅播报已确认的出牌、碰、胡、杠
// Scenario: 23 correct clips per character, only confirmed discard/peng/hu/kong
test("23 correct clips per character, only confirmed discard/peng/hu/kong", () => {
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  for (let seat = 0; seat < 3; seat++) {
    const clips = new Set(
      Array.from(
        {
          length: 18,
        },
        (_, tile) =>
          clipForEvent({
            type: "discard",
            tile,
            seat,
          }),
      ),
    );
    // 逐项覆盖 ['peng','anGang']；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in ['peng','anGang'] with the same checks, preserving the listed order.
    for (const type of ["peng", "anGang"])
      clips.add(
        clipForEvent({
          type,
          seat,
        }),
      );
    // 逐项覆盖 ['selfDraw','discard','kongDiscard','robKong']；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in ['selfDraw','discard','kongDiscard','robKong'] with the same checks, preserving the listed order.
    // Exercise each entry in clipsForEvent({type:'hu',seat,source}) with the same checks, preserving the listed order.
    for (const source of ["selfDraw", "discard", "kongDiscard", "robKong"]) // 逐项覆盖 clipsForEvent({type:'hu',seat,source})；同一组检查用于每个样本，顺序以代码列出的集合为准。
      for (const clip of clipsForEvent({
        type: "hu",
        seat,
        source,
      }))
        clips.add(clip);
    assert.equal(clips.size, 23);
    assert.ok(
      [...clips].every((url) =>
        url.startsWith(`/voices/${CHARACTERS[seat].id}/`),
      ),
    );
  }
  // 逐项覆盖 ['draw','pass','start','finish','claim','robKongAttempt','dragonSettlement']；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in ['draw','pass','start','finish','claim','robKongAttempt','dragonSettlement'] with the same checks, preserving the listed order.
  for (const type of [
    "draw",
    "pass",
    "start",
    "finish",
    "claim",
    "robKongAttempt",
    "dragonSettlement",
  ])
    assert.equal(
      clipForEvent({
        type,
        seat: 0,
      }),
      null,
    );
  assert.equal(
    clipForEvent({
      type: "discard",
      seat: 0,
      tile: 0,
    }),
    "/voices/sweet/tiao-1.mp3",
  );
  assert.equal(
    clipForEvent({
      type: "discard",
      seat: 0,
      tile: 17,
    }),
    "/voices/sweet/tong-9.mp3",
  );
  assert.equal(
    clipForEvent({
      type: "discard",
      seat: 0,
      tile: null,
    }),
    null,
  );
  // 逐项覆盖 ['mingGang','anGang','buGang','addGang']；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in ['mingGang','anGang','buGang','addGang'] with the same checks, preserving the listed order.
  for (const type of ["mingGang", "anGang", "buGang", "addGang"])
    assert.equal(
      clipForEvent({
        type,
        seat: 2,
      }),
      "/voices/sunny/gang.mp3",
    );
});
// 场景：每个座位和观察者均使用胡牌角色的声音播报已提交的实际胡牌来源
// Scenario: wins announce their committed source in the winning character, for every seat and viewer
test("wins announce their committed source in the winning character, for every seat and viewer", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const characters = ["sunny", "sweet", "elegant"];
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  for (let seat = 0; seat < 3; seat++) {
    // 逐项覆盖 [['selfDraw','zimo'],['discard','fangpao'],['kongDiscard','fangpao'],['robKong','qianggang']]；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in [['selfDraw','zimo'],['discard','fangpao'],['kongDiscard','fangpao'],['robKong','qianggang']] with the same checks, preserving the listed order.
    for (const [source, prefix] of [
      ["selfDraw", "zimo"],
      ["discard", "fangpao"],
      ["kongDiscard", "fangpao"],
      ["robKong", "qianggang"],
    ]) {
      const event = {
        type: "hu",
        seat,
        source,
        from: (seat + 1) % 3,
      };
      const expected = [`/voices/${characters[seat]}/${prefix}.mp3`];
      assert.deepEqual(clipsForEvent(event, characters), expected);
      assert.equal(clipForEvent(event, characters), expected[0]);
      assert.equal(
        expected.some((path) => path.endsWith("/hu.mp3")),
        false,
      );
      for (let viewer = 0; viewer < 3; viewer++) {
        const cursor = new ActionVoiceCursor();
        cursor.consume({
          ...state([]),
          seat: viewer,
        });
        assert.deepEqual(
          cursor.consume({
            ...state([event]),
            seat: viewer,
          }),
          expected,
        );
        assert.deepEqual(
          cursor.consume({
            ...state([event]),
            seat: viewer,
          }),
          [],
        );
      }
    }
    // 逐项覆盖 [undefined,null,'unknown','selfdraw','__proto__','constructor']；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in [undefined,null,'unknown','selfdraw','__proto__','constructor'] with the same checks, preserving the listed order.
    for (const source of [
      undefined,
      null,
      "unknown",
      "selfdraw",
      "__proto__",
      "constructor",
    ]) {
      assert.deepEqual(
        clipsForEvent(
          {
            type: "hu",
            seat,
            source,
          },
          characters,
        ),
        [],
      );
    }
    assert.deepEqual(
      clipsForEvent(
        {
          type: "hu",
          seat,
          source: "selfDraw",
        },
        ["invalid"],
      ),
      [`/voices/${CHARACTERS[seat].id}/zimo.mp3`],
    );
  }
  // 逐项覆盖 [undefined,null,-1,3,1.5,'1']；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [undefined,null,-1,3,1.5,'1'] with the same checks, preserving the listed order.
  for (const seat of [undefined, null, -1, 3, 1.5, "1"])
    assert.deepEqual(
      clipsForEvent({
        type: "hu",
        seat,
        source: "selfDraw",
      }),
      [],
    );
  // 逐项覆盖 ['draw','pass','claim','finish']；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in ['draw','pass','claim','finish'] with the same checks, preserving the listed order.
  for (const type of ["draw", "pass", "claim", "finish"])
    assert.deepEqual(
      clipsForEvent({
        type,
        seat: 0,
        source: "selfDraw",
      }),
      [],
    );
  assert.deepEqual(
    clipsForEvent({
      type: "peng",
      seat: 0,
      source: "selfDraw",
    }),
    ["/voices/sweet/peng.mp3"],
  );
});
// 场景：播放游标不重播首次载入、重连、新局的历史或重复更新
// Scenario: cursor never replays initial/reconnected/new-game history or duplicate updates
test("cursor never replays initial/reconnected/new-game history or duplicate updates", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const cursor = new ActionVoiceCursor(),
    a = {
      type: "discard",
      seat: 0,
      tile: 1,
    },
    b = {
      type: "peng",
      seat: 1,
    };
  // 核对事件消费或播放顺序；未提交、过期与已消费事件不应重复播报。
  // Check event consumption/playback order; uncommitted, expired or consumed events must not replay.
  assert.deepEqual(cursor.consume(state([a])), []);
  assert.deepEqual(cursor.consume(state([a, b])), ["/voices/sweet/peng.mp3"]);
  assert.deepEqual(cursor.consume(state([a, b])), []);
  assert.deepEqual(cursor.consume(state([a], 1)), []);
  assert.deepEqual(
    cursor.consume(
      state(
        [
          a,
          b,
          {
            type: "hu",
            seat: 2,
            source: "selfDraw",
          },
        ],
        3,
      ),
      {
        silent: true,
      },
    ),
    [],
  );
  assert.deepEqual(
    cursor.consume(
      state(
        [
          a,
          b,
          {
            type: "hu",
            seat: 2,
            source: "selfDraw",
          },
        ],
        3,
      ),
    ),
    [],
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  cursor.reset();
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.deepEqual(
    cursor.consume(
      state([
        a,
        b,
        {
          type: "hu",
          seat: 2,
          source: "discard",
        },
      ]),
    ),
    [],
  );
  assert.deepEqual(cursor.consume(state([a], 4, "game-2")), []);
});
// 场景：同一修订号内的批量事件按序各播一次，包括自动出牌
// Scenario: same-revision batch events all played once in order, including automatic discard
test("same-revision batch events all played once in order, including automatic discard", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const c = new ActionVoiceCursor();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  c.consume(state([], 1));
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const events = [
    {
      type: "hu",
      seat: 1,
      source: "discard",
    },
    {
      type: "hu",
      seat: 2,
      source: "kongDiscard",
    },
    {
      type: "draw",
      seat: 0,
    },
    {
      type: "discard",
      seat: 0,
      tile: 9,
      automatic: true,
    },
  ];
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.deepEqual(c.consume(state(events, 2)), [
    "/voices/sweet/fangpao.mp3",
    "/voices/elegant/fangpao.mp3",
    "/voices/sunny/tong-1.mp3",
  ]);
  assert.deepEqual(c.consume(state(events, 2)), []);
});
// 创建可控音频上下文和下载替身，记录播放顺序并允许测试手动触发结束；不会真正播放声音。
// Create controllable audio/download substitutes, record playback order and allow manual completion without audible playback.
function audioFixture(options = {}) {
  const played = [],
    sources = [];
  const context = {
    state: "running",
    sampleRate: 24000,
    resume: async () => {},
    close() {},
    createBuffer: () => "silent",
    decodeAudioData: async (bytes) => bytes,
    createBufferSource() {
      const source = {
        connect() {},
        start() {
          played.push(this.buffer);
          // 静音解锁缓冲自动结束；正常播报留给测试手动结束以控制播放顺序。
          // Auto-complete the silent unlock buffer; tests control normal clip completion manually.
          if (this.buffer === "silent") queueMicrotask(() => this.onended?.());
        },
        stop() {
          this.onended?.();
        },
      };
      sources.push(source);
      return source;
    },
  };
  const engine = new CharacterAudio({
    createContext: () => context,
    fetchAudio: async (url) => ({
      ok: true,
      headers: {
        get: () => "audio/mpeg",
      },
      arrayBuffer: async () => url,
    }),
    ...options,
  });
  return {
    engine,
    played,
    sources,
    context,
  };
}
// 等待下一轮事件循环，让模拟音频的异步队列推进。
// Wait for the next event-loop turn to advance the simulated audio queue.
const tick = () => new Promise((resolve) => setImmediate(resolve));
// 场景：音频必须先解锁、串行播放，静音时清空待播片段
// Scenario: audio requires unlock, plays serially, and mute clears pending clips
test("audio requires unlock, plays serially, and mute clears pending clips", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const { engine, played, sources } = audioFixture();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  engine.enqueue(["ignored"]);
  // 核对事件消费或播放顺序；未提交、过期与已消费事件不应重复播报。
  // Check event consumption/playback order; uncommitted, expired or consumed events must not replay.
  assert.deepEqual(played, []);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await engine.unlock();
  engine.enqueue(["one", "two"]);
  await tick();
  // 核对事件消费或播放顺序；未提交、过期与已消费事件不应重复播报。
  // Check event consumption/playback order; uncommitted, expired or consumed events must not replay.
  assert.deepEqual(played, ["silent", "one"]);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  sources.at(-1).onended();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await tick();
  // 核对事件消费或播放顺序；未提交、过期与已消费事件不应重复播报。
  // Check event consumption/playback order; uncommitted, expired or consumed events must not replay.
  assert.deepEqual(played, ["silent", "one", "two"]);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  engine.enqueue(["three"]);
  engine.setMuted(true);
  await tick();
  // 核对事件消费或播放顺序；未提交、过期与已消费事件不应重复播报。
  // Check event consumption/playback order; uncommitted, expired or consumed events must not replay.
  assert.equal(played.includes("three"), false);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  engine.setMuted(false);
  await tick();
  // 核对事件消费或播放顺序；未提交、过期与已消费事件不应重复播报。
  // Check event consumption/playback order; uncommitted, expired or consumed events must not replay.
  assert.equal(played.includes("three"), false);
});
// 场景：音频下载失败会报告错误，但不阻塞后续片段
// Scenario: fetch failure is reported and does not block later clips
test("fetch failure is reported and does not block later clips", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const { engine, played } = audioFixture();
  const statuses = [];
  engine.onStatus = (s) => statuses.push(s);
  engine.fetchAudio = async (url) => ({
    ok: url !== "bad",
    headers: {
      get: () => "audio/mpeg",
    },
    arrayBuffer: async () => url,
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await engine.unlock();
  engine.enqueue(["bad", "good"]);
  await tick();
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.ok(statuses.includes("unavailable"));
  assert.ok(played.includes("good"));
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  engine.dispose();
});
// 场景：清理停滞的下载后释放队列，以便播放下一房间的音频
// Scenario: clearing a stalled download releases queue for the next room
test("clearing a stalled download releases queue for the next room", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const { engine, played } = audioFixture();
  engine.fetchAudio = async (url) =>
    url === "stalled"
      ? new Promise(() => {})
      : {
          ok: true,
          headers: {
            get: () => "audio/mpeg",
          },
          arrayBuffer: async () => url,
        };
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await engine.unlock();
  engine.enqueue(["stalled"]);
  await tick();
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  engine.clear();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  engine.enqueue(["new-room"]);
  await tick();
  // 核对事件消费或播放顺序；未提交、过期与已消费事件不应重复播报。
  // Check event consumption/playback order; uncommitted, expired or consumed events must not replay.
  assert.ok(played.includes("new-room"));
  assert.equal(played.includes("stalled"), false);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  engine.dispose();
});
// 场景：暂停的音频上下文回到锁定状态，可在下次用户手势时恢复
// Scenario: suspended context becomes locked and can resume on next gesture
test("suspended context becomes locked and can resume on next gesture", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const { engine } = audioFixture();
  const statuses = [];
  engine.onStatus = (s) => statuses.push(s);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await engine.unlock();
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  engine.context.state = "suspended";
  engine.context.onstatechange();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(engine.unlocked, false);
  assert.equal(statuses.at(-1), "locked");
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  engine.context.resume = async () => {
    engine.context.state = "running";
  };
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(await engine.unlock(), true);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  engine.dispose();
});
// 场景：同时胡牌的播报保持串行且相邻，并忽略重复更新
// Scenario: simultaneous wins stay serial and adjacent, with duplicate updates ignored
test("simultaneous wins stay serial and adjacent, with duplicate updates ignored", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const { engine, played, sources } = audioFixture(),
    cursor = new ActionVoiceCursor();
  const events = [
    {
      type: "hu",
      seat: 1,
      source: "discard",
    },
    {
      type: "hu",
      seat: 2,
      source: "kongDiscard",
    },
  ];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  cursor.consume(state([]));
  await engine.unlock();
  engine.enqueue(cursor.consume(state(events)));
  await tick();
  engine.enqueue(cursor.consume(state(events)));
  engine.enqueue(["/voices/sunny/tong-1.mp3"]);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const expected = [
    "/voices/sweet/fangpao.mp3",
    "/voices/elegant/fangpao.mp3",
    "/voices/sunny/tong-1.mp3",
  ];
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  for (let index = 0; index < expected.length; index++) {
    assert.deepEqual(played, ["silent", ...expected.slice(0, index + 1)]);
    sources.at(-1).onended();
    await tick();
  }
  assert.deepEqual(played, ["silent", ...expected]);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  engine.dispose();
});
// 场景：队列达到上限时丢弃最旧的待播单次胡牌播报
// Scenario: queue limit drops the oldest pending single win
test("queue limit drops the oldest pending single win", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const { engine, played, sources } = audioFixture();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await engine.unlock();
  engine.enqueue(["blocker"]);
  await tick();
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const later = Array.from(
    {
      length: 12,
    },
    (_, index) => `later-${index}`,
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  engine.enqueue([
    ...clipsForEvent({
      type: "hu",
      seat: 0,
      source: "selfDraw",
    }),
    ...later,
  ]);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(
    engine.queue.flatMap((item) => item.urls),
    later,
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  for (let index = 0; index <= later.length; index++) {
    sources.at(-1).onended();
    await tick();
  }
  // 核对事件消费或播放顺序；未提交、过期与已消费事件不应重复播报。
  // Check event consumption/playback order; uncommitted, expired or consumed events must not replay.
  assert.deepEqual(played, ["silent", "blocker", ...later]);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  engine.dispose();
});
// 场景：已经开始的胡牌播报即使过期或被队列淘汰仍完整播放，且不被其他播报插入
// Scenario: a started win completes after expiry and queue eviction without interleaving
test("a started win completes after expiry and queue eviction without interleaving", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let now = 0;
  const { engine, played, sources } = audioFixture({
    now: () => now,
  });
  const win = clipsForEvent({
    type: "hu",
    seat: 1,
    source: "discard",
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await engine.unlock();
  engine.enqueue(win);
  await tick();
  // 核对事件消费或播放顺序；未提交、过期与已消费事件不应重复播报。
  // Check event consumption/playback order; uncommitted, expired or consumed events must not replay.
  assert.deepEqual(played, ["silent", win[0]]);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  now = 7000;
  const later = Array.from(
    {
      length: 13,
    },
    (_, index) => `later-${index}`,
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  engine.enqueue(later);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(
    engine.queue.flatMap((item) => item.urls),
    later.slice(1),
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  sources.at(-1).onended();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await tick();
  // 核对事件消费或播放顺序；未提交、过期与已消费事件不应重复播报。
  // Check event consumption/playback order; uncommitted, expired or consumed events must not replay.
  assert.deepEqual(played, ["silent", ...win, "later-1"]);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  engine.dispose();
});
// 场景：尚未开始且已过期的胡牌播报整组跳过
// Scenario: an unstarted expired win is skipped as a whole
test("an unstarted expired win is skipped as a whole", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let now = 0;
  const { engine, played, sources } = audioFixture({
    now: () => now,
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await engine.unlock();
  engine.enqueue(["blocker"]);
  await tick();
  engine.enqueue(
    clipsForEvent({
      type: "hu",
      seat: 2,
      source: "kongDiscard",
    }),
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  now = 6001;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  engine.enqueue(["fresh"]);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  sources.at(-1).onended();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await tick();
  // 核对事件消费或播放顺序；未提交、过期与已消费事件不应重复播报。
  // Check event consumption/playback order; uncommitted, expired or consumed events must not replay.
  assert.deepEqual(played, ["silent", "blocker", "fresh"]);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  engine.dispose();
});
// 场景：单次胡牌片段先加载再播报，开始前检查是否过期
// Scenario: a single win clip loads before speaking and expiry is checked before it starts
test("a single win clip loads before speaking and expiry is checked before it starts", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let now = 0,
    resolveHu;
  const { engine, played } = audioFixture({
    now: () => now,
  });
  const win = clipsForEvent({
    type: "hu",
    seat: 0,
    source: "selfDraw",
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  engine.fetchAudio = async (url) => ({
    ok: true,
    headers: {
      get: () => "audio/mpeg",
    },
    arrayBuffer: () =>
      url === win[0]
        ? new Promise((resolve) => {
            resolveHu = resolve;
          })
        : Promise.resolve(url),
  });
  await engine.unlock();
  engine.enqueue(win);
  await tick();
  // 核对事件消费或播放顺序；未提交、过期与已消费事件不应重复播报。
  // Check event consumption/playback order; uncommitted, expired or consumed events must not replay.
  assert.deepEqual(played, ["silent"]);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  now = 6001;
  resolveHu(win[0]);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await tick();
  // 核对事件消费或播放顺序；未提交、过期与已消费事件不应重复播报。
  // Check event consumption/playback order; uncommitted, expired or consumed events must not replay.
  assert.deepEqual(played, ["silent"]);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  engine.enqueue(["fresh"]);
  await tick();
  // 核对事件消费或播放顺序；未提交、过期与已消费事件不应重复播报。
  // Check event consumption/playback order; uncommitted, expired or consumed events must not replay.
  assert.deepEqual(played, ["silent", "fresh"]);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  engine.dispose();
});
// 场景：胡牌片段不可用时整组跳过，不拆分播报也不阻塞后续事件
// Scenario: a win with an unavailable clip is skipped without splitting it or blocking later events
test("a win with an unavailable clip is skipped without splitting it or blocking later events", async () => {
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  // 逐项覆盖 ['zimo']；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in ['zimo'] with the same checks, preserving the listed order.
  for (const unavailable of ["zimo"]) {
    const { engine, played } = audioFixture();
    engine.fetchAudio = async (url) => ({
      ok: !url.endsWith(`/${unavailable}.mp3`),
      headers: {
        get: () => "audio/mpeg",
      },
      arrayBuffer: async () => url,
    });
    await engine.unlock();
    engine.enqueue([
      ...clipsForEvent({
        type: "hu",
        seat: 0,
        source: "selfDraw",
      }),
      "good",
    ]);
    await tick();
    assert.deepEqual(played, ["silent", "good"]);
    engine.dispose();
  }
});
// 逐项覆盖 ['mute','clear','context loss']；同一组检查用于每个样本，顺序以代码列出的集合为准。
// Exercise each entry in ['mute','clear','context loss'] with the same checks, preserving the listed order.
for (const interruption of ["mute", "clear", "context loss"]) {
  // 场景：${interruption} 中断已开始胡牌播报的剩余部分，恢复后不重播
  // Scenario: ${interruption} stops the remainder of a started win, without replaying on resume
  test(`${interruption} stops the remainder of a started win, without replaying on resume`, async () => {
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.
    const { engine, played, context } = audioFixture();
    const win = clipsForEvent({
      type: "hu",
      seat: 0,
      source: "selfDraw",
    });
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    await engine.unlock();
    engine.enqueue([...win, "old-pending"]);
    await tick();
    // 核对事件消费或播放顺序；未提交、过期与已消费事件不应重复播报。
    // Check event consumption/playback order; uncommitted, expired or consumed events must not replay.
    assert.deepEqual(played, ["silent", win[0]]);
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    // 该参数组合模拟静音中断，检查余下播报不会在解除静音后补播。
    // This case interrupts by muting and checks the remainder does not replay after unmute.
    if (interruption === "mute") engine.setMuted(true);
    else if (interruption === "clear")
      // 该组合显式清空队列，模拟换桌或上下文重置时终止剩余播报。
      // This case explicitly clears the queue, modeling room/context reset cancellation.
      engine.clear();
    else {
      context.state = "suspended";
      context.onstatechange();
    }
    await tick();
    // 该参数组合模拟静音中断，检查余下播报不会在解除静音后补播。
    // This case interrupts by muting and checks the remainder does not replay after unmute.
    if (interruption === "mute") engine.setMuted(false);
    else if (interruption === "context loss") {
      // 模拟音频上下文被关闭，验证中断后不会恢复旧播报。
      // Simulate a closed audio context and verify obsolete speech does not resume.
      context.resume = async () => {
        context.state = "running";
      };
      await engine.unlock();
    }
    engine.enqueue(["fresh"]);
    await tick();
    // 核对事件消费或播放顺序；未提交、过期与已消费事件不应重复播报。
    // Check event consumption/playback order; uncommitted, expired or consumed events must not replay.
    assert.equal(played.filter((clip) => clip === win[0]).length, 1);
    assert.equal(played.includes("old-pending"), false);
    assert.equal(played.at(-1), "fresh");
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.
    engine.dispose();
  });
}
// 场景：静音时已确认的胡牌事件仍被消费，重新开声后不补播
// Scenario: muted confirmed wins are consumed without replaying when sound is enabled again
test("muted confirmed wins are consumed without replaying when sound is enabled again", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const { engine, played } = audioFixture(),
    cursor = new ActionVoiceCursor();
  const events = [
    {
      type: "hu",
      seat: 0,
      source: "selfDraw",
    },
  ];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  cursor.consume(state([]));
  await engine.unlock();
  engine.setMuted(true);
  engine.enqueue(cursor.consume(state(events)));
  await tick();
  engine.setMuted(false);
  engine.enqueue(cursor.consume(state(events)));
  await tick();
  // 核对事件消费或播放顺序；未提交、过期与已消费事件不应重复播报。
  // Check event consumption/playback order; uncommitted, expired or consumed events must not replay.
  assert.deepEqual(played, ["silent"]);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  engine.dispose();
});
// 场景：抢杠尝试保持静音，确认抢杠胡后只播放一次对应叫牌且不重播
// Scenario: rob-kong attempts stay silent; confirmed rob wins play one matching call and never replay
test("rob-kong attempts stay silent; confirmed rob wins play one matching call and never replay", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const cursor = new ActionVoiceCursor();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  cursor.consume(state([]));
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const attempt = {
    type: "robKongAttempt",
    seat: 0,
    tile: 12,
  };
  // 核对事件消费或播放顺序；未提交、过期与已消费事件不应重复播报。
  // Check event consumption/playback order; uncommitted, expired or consumed events must not replay.
  assert.deepEqual(cursor.consume(state([attempt])), []);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const win = {
    type: "hu",
    seat: 2,
    source: "robKong",
  };
  // 核对事件消费或播放顺序；未提交、过期与已消费事件不应重复播报。
  // Check event consumption/playback order; uncommitted, expired or consumed events must not replay.
  assert.deepEqual(cursor.consume(state([attempt, win])), [
    "/voices/elegant/qianggang.mp3",
  ]);
  assert.deepEqual(cursor.consume(state([attempt, win])), []);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  cursor.reset();
  // 核对事件消费或播放顺序；未提交、过期与已消费事件不应重复播报。
  // Check event consumption/playback order; uncommitted, expired or consumed events must not replay.
  assert.deepEqual(cursor.consume(state([attempt, win])), []);
});
const live = (events) =>
  events.map((event) => ({
    ...event,
    urls: clipsForEvent(event),
  }));
// 场景：实时自动出牌突发更新只播报最新公开动作，不补播六秒历史
// Scenario: live auto-discard burst announces only the latest public action, not six seconds of history
test("live auto-discard burst announces only the latest public action, not six seconds of history", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const { engine, played } = audioFixture();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await engine.unlock();
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const events = Array.from(
    {
      length: 12,
    },
    (_, tile) => ({
      type: "discard",
      seat: tile % 3,
      tile,
      automatic: true,
    }),
  );
  engine.enqueueLive(live(events));
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await tick();
  // 核对事件消费或播放顺序；未提交、过期与已消费事件不应重复播报。
  // Check event consumption/playback order; uncommitted, expired or consumed events must not replay.
  assert.deepEqual(played, ["silent", clipForEvent(events.at(-1))]);
  assert.equal(engine.queue.length, 0);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  engine.dispose();
});
// 场景：实时胡牌会中断旧出牌播报，并丢弃同次更新中的自动出牌播报
// Scenario: a live win interrupts an old discard and drops automatic discards in the same update
test("a live win interrupts an old discard and drops automatic discards in the same update", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const { engine, played, sources } = audioFixture();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await engine.unlock();
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  engine.enqueueLive(
    live([
      {
        type: "discard",
        seat: 0,
        tile: 1,
      },
    ]),
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await tick();
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let stopped = false;
  const old = sources.at(-1);
  old.stop = () => {
    stopped = true;
    old.onended?.();
  };
  engine.enqueueLive(
    live([
      {
        type: "discard",
        seat: 1,
        tile: 4,
      },
      {
        type: "hu",
        seat: 2,
        source: "discard",
      },
      {
        type: "discard",
        seat: 2,
        tile: 7,
        automatic: true,
      },
    ]),
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await tick();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(stopped, true);
  assert.deepEqual(played, [
    "silent",
    "/voices/sweet/tiao-2.mp3",
    "/voices/sunny/fangpao.mp3",
  ]);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  engine.enqueueLive(
    live([
      {
        type: "discard",
        seat: 0,
        tile: 8,
      },
    ]),
  );
  sources.at(-1).onended();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await tick();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(engine.queue.length, 0);
  assert.equal(played.length, 3);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  engine.dispose();
});
// 场景：实时同时胡牌保持相邻串行，新胡牌替换过时的待播叫牌
// Scenario: live simultaneous wins remain adjacent and serial; a newer win replaces obsolete pending calls
test("live simultaneous wins remain adjacent and serial; a newer win replaces obsolete pending calls", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const { engine, played, sources } = audioFixture();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await engine.unlock();
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  engine.enqueueLive(
    live([
      {
        type: "hu",
        seat: 0,
        source: "discard",
      },
      {
        type: "hu",
        seat: 1,
        source: "discard",
      },
    ]),
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await tick();
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.equal(played.at(-1), "/voices/sweet/fangpao.mp3");
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  engine.enqueueLive(
    live([
      {
        type: "discard",
        seat: 2,
        tile: 4,
      },
    ]),
  );
  sources.at(-1).onended();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await tick();
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.equal(played.at(-1), "/voices/elegant/fangpao.mp3");
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  engine.enqueueLive(
    live([
      {
        type: "hu",
        seat: 2,
        source: "selfDraw",
      },
    ]),
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await tick();
  // 核对事件消费或播放顺序；未提交、过期与已消费事件不应重复播报。
  // Check event consumption/playback order; uncommitted, expired or consumed events must not replay.
  assert.equal(played.at(-1), "/voices/sunny/zimo.mp3");
  assert.equal(engine.queue.length, 0);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  engine.dispose();
});
// 场景：实时语音加载过慢时直接丢弃，避免延迟失步播放
// Scenario: slow live voice loads are dropped rather than played out of sync
test("slow live voice loads are dropped rather than played out of sync", async () => {
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  // 逐项覆盖 [{type:'discard',seat:0,tile:2},{type:'hu',seat:0,source:'selfDraw'}]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [{type:'discard',seat:0,tile:2},{type:'hu',seat:0,source:'selfDraw'}] with the same checks, preserving the listed order.
  for (const event of [
    {
      type: "discard",
      seat: 0,
      tile: 2,
    },
    {
      type: "hu",
      seat: 0,
      source: "selfDraw",
    },
  ]) {
    let now = 0,
      finish;
    const { engine, played } = audioFixture({
      now: () => now,
    });
    engine.fetchAudio = async (url) => ({
      ok: true,
      headers: {
        get: () => "audio/mpeg",
      },
      arrayBuffer: () =>
        new Promise((resolve) => {
          finish = () => resolve(url);
        }),
    });
    await engine.unlock();
    engine.enqueueLive(live([event]));
    await tick();
    now = 651;
    finish();
    await tick();
    assert.deepEqual(played, ["silent"]);
    engine.dispose();
  }
});
// 场景：中断加载后可立即重试同一资源，旧请求的拒绝不会干扰新请求
// Scenario: interrupting an in-flight load can retry the same asset immediately without a stale rejection
test("interrupting an in-flight load can retry the same asset immediately without a stale rejection", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let calls = 0;
  const { engine, played } = audioFixture();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await engine.unlock();
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  engine.fetchAudio = async (url) =>
    ++calls === 1
      ? new Promise(() => {})
      : {
          ok: true,
          headers: {
            get: () => "audio/mpeg",
          },
          arrayBuffer: async () => url,
        };
  const event = {
    type: "discard",
    seat: 0,
    tile: 2,
  };
  engine.enqueueLive(live([event]));
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await tick();
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  engine.enqueueLive(live([event]));
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await tick();
  // 核对事件消费或播放顺序；未提交、过期与已消费事件不应重复播报。
  // Check event consumption/playback order; uncommitted, expired or consumed events must not replay.
  assert.deepEqual(played, ["silent", "/voices/sweet/tiao-3.mp3"]);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  engine.dispose();
});
// 场景：播放游标暴露已提交事件标识，但静音、重连或换局不触发重播
// Scenario: cursor exposes committed event identity without replay on mute, reconnect, or game change
test("cursor exposes committed event identity without replay on mute, reconnect, or game change", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const cursor = new ActionVoiceCursor();
  const event = {
    type: "hu",
    seat: 1,
    source: "discard",
    tile: 4,
    fromSeat: 0,
  };
  // 核对事件消费或播放顺序；未提交、过期与已消费事件不应重复播报。
  // Check event consumption/playback order; uncommitted, expired or consumed events must not replay.
  assert.deepEqual(cursor.consumeEvents(state([])), []);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const events = cursor.consumeEvents(state([event]));
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(events[0].eventKey, "room-1:game-1:0");
  assert.equal(events[0].tile, 4);
  assert.equal(events[0].fromSeat, 0);
  assert.deepEqual(cursor.consumeEvents(state([event])), []);
  assert.deepEqual(cursor.consumeEvents(state([event], 2, "game-2")), []);
});
// 场景：胡牌预热有数量上限、去重且静音；关闭音频时不发预加载请求
// Scenario: win warming is bounded, deduplicated and silent; disabled audio sends no preload requests
test("win warming is bounded, deduplicated and silent; disabled audio sends no preload requests", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const { engine, played } = audioFixture();
  let active = 0,
    max = 0,
    fetches = 0;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  engine.fetchAudio = async (url) => {
    fetches++;
    active++;
    max = Math.max(max, active);
    await tick();
    active--;
    return {
      ok: true,
      headers: {
        get: () => "audio/mpeg",
      },
      arrayBuffer: async () => url,
    };
  };
  await engine.warmWins();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(fetches, 0);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await engine.unlock();
  await engine.warmWins(["sunny", "sweet", "elegant"]);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(fetches, 9);
  assert.ok(max <= 3);
  assert.deepEqual(played, ["silent"]);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await engine.warmWins();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(fetches, 9);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  engine.setMuted(true);
  await engine.warmWins();
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(fetches, 9);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  engine.dispose();
});
