// 身份、离席、重连、房主转移及个人历史的端到端存储契约。
// Identity, departure, resume, host transfer and personal-history storage contracts.
// 阅读说明见 docs/TESTING-READING-GUIDE.md；固定种子与凭证仅为测试，不应移入真实用户数据。
// See docs/TESTING-READING-GUIDE.md; seeded data and test credentials must stay separate from real user data.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApi } from "../server/api.js";
import { MemoryStore, D1Store } from "../server/store.js";
import { FileStore, apiMiddleware } from "../server/node.js";
import { createGame, assertGameInvariants } from "../shared/game.js";
import {
  createGame as createLegacyGame,
  assertGameInvariants as assertLegacyInvariants,
} from "../shared/legacy-game.js";

// These independently written contract tests never connect to production. Direct
// state writes below are explicit synthetic fixtures, not public API abilities.
// 创建隔离的测试 API 环境；调用者提供存储时复用它以验证重启或并发，否则使用临时内存。
// Create an isolated API harness; an injected store enables restart/concurrency tests, otherwise use temporary memory.
function harness(store = new MemoryStore(), handler = createApi(store)) {
  return {
    store,
    async request(
      path,
      {
        body,
        token,
        profile,
        method = body === undefined ? "GET" : "POST",
      } = {},
    ) {
      const response = await handler(
        new Request(`http://recovery.test${path}`, {
          method,
          headers: {
            ...(body === undefined
              ? {}
              : {
                  "content-type": "application/json",
                }),
            ...(token
              ? {
                  authorization: `Bearer ${token}`,
                }
              : {}),
            ...(profile
              ? {
                  "x-player-token": profile,
                }
              : {}),
          },
          ...(body === undefined
            ? {}
            : {
                body: JSON.stringify(body),
              }),
        }),
      );
      return {
        status: response.status,
        body: await response.json(),
        headers: response.headers,
      };
    },
  };
}
// 验证响应成功后取出正文；错误响应在此立即失败，不继续使用错误数据。
// Validate success before extracting the body; fail immediately instead of using an error response as data.
function successful(answer, status = 200) {
  assert.equal(answer.status, status, JSON.stringify(answer.body));
  return answer.body;
}
// 验证预期拒绝状态与错误信息，证明无效请求确实被拦截。
// Verify the expected rejection status and error text, proving the invalid request was blocked.
function denied(answer, status = 401) {
  assert.equal(answer.status, status, JSON.stringify(answer.body));
  assert.equal(typeof answer.body.error, "string");
}
// 申请合成个人凭证并验证格式；昵称不能代替这个身份凭证。
// Register a synthetic profile credential and validate its format; a nickname cannot replace identity proof.
async function identity(api) {
  const body = successful(
    await api.request("/api/profile", {
      body: {},
    }),
    201,
  );
  assert.match(body.playerToken, /^[a-f0-9]{64}$/);
  return body.playerToken;
}
// 调用创建房间接口并检查成功响应；返回新房间与独立座位凭证，供后续步骤使用。
// Create a room and verify success, returning its room and independent seat credential for subsequent steps.
async function createRoom(api, name = "独立东家", profile) {
  const body = successful(
    await api.request("/api/rooms", {
      body: {
        name,
      },
      profile,
    }),
    201,
  );
  return {
    ...body,
    profile,
    seat: body.state.you,
  };
}
// 提交加入指定房间的请求；保留接口结果以便测试成功、满员或无效输入。
// Submit a join request for the selected room and retain the response for success/full-room/invalid-input checks.
async function joinRoom(api, roomId, name, profile) {
  const body = successful(
    await api.request(`/api/rooms/${roomId}/join`, {
      body: {
        name,
      },
      profile,
    }),
    201,
  );
  return {
    ...body,
    profile,
    seat: body.state.you,
  };
}
// 只组合房间资源路径；鉴权仍由单独的凭证参数承担。
// Build the room resource path; separate credentials still provide authentication.
const roomPath = (person, operation = "") =>
  `/api/rooms/${person.roomId}${operation ? `/${operation}` : ""}`;
// 提取座位凭证与个人凭证，保持两种身份用途独立。
// Extract seat and profile credentials while keeping their roles distinct.
const credentials = (person) => ({
  token: person.token,
  profile: person.profile,
});
// 以该玩家凭证读取房间，返回服务器裁剪后的个人视图。
// Read a room with that player’s credential and return the server-filtered personal view.
async function snapshot(api, person) {
  return successful(await api.request(roomPath(person), credentials(person)))
    .state;
}
// 读取指定个人身份的历史；个人凭证与牌桌座位凭证用途不同。
// Read history for the selected personal identity; profile credentials and room-seat credentials serve different purposes.
async function history(api, person) {
  return successful(
    await api.request("/api/profile/history", {
      profile: typeof person === "string" ? person : person.profile,
    }),
  );
}
// 提交离席操作及版本；离席不意味着删除进行中的牌局。
// Submit departure with its revision; leaving does not mean deleting the active game.
async function leave(api, person, revision) {
  return api.request(roomPath(person, "leave"), {
    ...credentials(person),
    body: {
      revision: revision ?? (await api.store.get(person.roomId)).revision,
    },
  });
}
// 用原座位与个人身份恢复连接；必须经过服务端校验，不能靠昵称认领。
// Resume using original seat/profile identity; server verification is required, not nickname matching.
async function resume(api, person) {
  return api.request(roomPath(person, "resume"), {
    ...credentials(person),
    body: {},
  });
}
// 通过认证接口提交动作和预期 revision，让服务端执行验证及原子保存。
// Submit an authenticated action with expected revision for server validation and atomic persistence.
async function action(api, person, revision, value) {
  return api.request(roomPath(person, "action"), {
    ...credentials(person),
    body: {
      revision,
      action: value,
    },
  });
}
// 建立三位独立玩家的测试桌；具体开局、偏好或存储条件由本文件参数决定。
// Build a three-player test table with the start, preference or storage conditions defined by this file’s parameters.
async function table(
  api,
  { start = true, names = ["独立东家", "独立南家", "独立西家"], profiles } = {},
) {
  profiles ??= await Promise.all([0, 1, 2].map(() => identity(api)));
  const host = await createRoom(api, names[0], profiles[0]);
  const people = [host];
  for (let seat = 1; seat < 3; seat++)
    people.push(await joinRoom(api, host.roomId, names[seat], profiles[seat]));
  // 要求开局时才发开局请求，未开局桌用于座位和权限测试。
  // Send start only when requested; unstarted tables support seating/permission checks.
  if (start)
    successful(
      await api.request(roomPath(host, "start"), {
        ...credentials(host),
        body: {
          revision: 2,
        },
      }),
    );
  return {
    roomId: host.roomId,
    people,
    host,
  };
}
// 检查历史等公开结构不含秘密凭证、手牌、牌墙或私有摸牌数据。
// Check public structures such as history for credentials, hands, wall and private draws.
function noPrivateData(value, secrets = []) {
  const text = JSON.stringify(value);
  // 逐项覆盖 secrets；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in secrets with the same checks, preserving the listed order.
  for (const secret of secrets)
    assert.equal(text.includes(secret), false, "secret credential leaked");
  // 递归访问嵌套对象并检查禁止公开的字段；叶节点不继续递归。
  // Recursively inspect nested objects for forbidden public fields; stop at leaf values.
  function walk(item) {
    // 空值和非对象是递归终点，不能继续枚举其字段。
    // Null and non-object values end recursion; do not enumerate their fields.
    if (!item || typeof item !== "object") return;
    // 逐项覆盖 Object.entries(item)；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in Object.entries(item) with the same checks, preserving the listed order.
    for (const [key, nested] of Object.entries(item)) {
      assert.equal(
        [
          "token",
          "tokenHash",
          "playerToken",
          "playerHash",
          "profileHash",
          "wall",
          "hand",
          "lastDraw",
          "drawnTile",
        ].includes(key),
        false,
        `private ${key} field leaked`,
      );
      walk(nested);
    }
  }
  walk(value);
}

// Exhaust the wall using a conservation-valid fixture, then finish via legal
// HTTP/API actions. This tests real settlement rather than fabricating records.
// 把剩余墙牌移入退役区保持守恒，再通过真实合法动作结束牌局，禁止伪造结算记录。
// Retire remaining wall tiles to preserve conservation, then finish through legal actions instead of fabricating settlement records.
async function finishTable(api, people, scores = [8, -3, -5]) {
  const room = await api.store.get(people[0].roomId);
  const game = createGame({
    seed: "room-recovery-finish",
  });
  game.players.forEach((player, seat) => {
    player.score = scores[seat];
  });
  game.retiredTiles.push(
    ...game.wall.map((tile) => ({
      seat: 0,
      tile,
    })),
  );
  game.wall = [];
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
  room.game = game;
  assert.equal(await api.store.compareAndSwap(room, room.revision), true);
  let state = await snapshot(api, people[0]);
  const discard = state.game.legalActions.find(
    (candidate) => candidate.type === "discard",
  );
  assert.ok(discard);
  successful(await action(api, people[0], state.revision, discard));
  for (let attempts = 0; attempts < 3; attempts++) {
    state = await snapshot(api, people[0]);
    // 牌局结束后停止继续找动作，避免把正常结束误报为没有合法动作。
    // Stop action search after the game finishes instead of treating completion as missing legal actions.
    if (state.phase === "finished") return state;
    assert.equal(state.game.phase, "claim");
    let passed = false;
    // 逐项覆盖 people；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in people with the same checks, preserving the listed order.
    for (const person of people) {
      const own = await snapshot(api, person);
      // 从该玩家自己的合法动作确认可以过牌后再提交，不能借别人的视图行动。
      // Submit pass only when the player’s own legal actions permit it.
      if (
        own.game.legalActions.some((candidate) => candidate.type === "pass")
      ) {
        successful(
          await action(api, person, own.revision, {
            type: "pass",
          }),
        );
        passed = true;
        break;
      }
    }
    assert.equal(passed, true);
  }
  assert.fail("synthetic wall exhaustion did not finish");
}
// 场景：恢复：个人历史必须使用该身份自己的凭证，同名身份保持隔离
// Scenario: recovery: identity history requires its own credential and same names stay isolated
test("recovery: identity history requires its own credential and same names stay isolated", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const api = harness();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const own = await identity(api),
    stranger = await identity(api);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.notEqual(own, stranger);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  // 逐项覆盖 [undefined,'bad','0'.repeat(64),'A'.repeat(64)]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [undefined,'bad','0'.repeat(64),'A'.repeat(64)] with the same checks, preserving the listed order.
  for (const profile of [undefined, "bad", "0".repeat(64), "A".repeat(64)])
    denied(
      await api.request("/api/profile/history", {
        profile,
      }),
    );
  const first = await table(api, {
    profiles: [own, await identity(api), await identity(api)],
    names: ["相同名字", "甲南", "甲西"],
  });
  const second = await table(api, {
    profiles: [stranger, await identity(api), await identity(api)],
    names: ["相同名字", "乙南", "乙西"],
  });
  const mine = await history(api, own),
    theirs = await history(api, stranger);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(
    mine.records.map((record) => record.roomId),
    [first.roomId],
  );
  assert.deepEqual(
    theirs.records.map((record) => record.roomId),
    [second.roomId],
  );
  assert.equal(mine.summary.settledGames, 0);
  assert.equal(mine.summary.totalScore, 0);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  noPrivateData(
    mine,
    [...first.people, ...second.people].flatMap((person) => [
      person.token,
      person.profile,
    ]),
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.match(
    (
      await api.request("/api/profile/history", {
        profile: own,
      })
    ).headers.get("cache-control"),
    /no-store/,
  );
});
// 场景：恢复：离开大厅只释放自己的座位、转移房主，并使旧座位凭证失效
// Scenario: recovery: lobby exit frees only its own seat, transfers host, and invalidates old seat credentials
test("recovery: lobby exit frees only its own seat, transfers host, and invalidates old seat credentials", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const api = harness();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const { people, host, roomId } = await table(api, {
    start: false,
  });
  const unrelated = await table(api);
  const unrelatedBefore = await api.store.get(unrelated.roomId);
  successful(await leave(api, host));
  let stored = await api.store.get(roomId);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(stored.seats[0], null);
  assert.equal(stored.hostSeat, 1);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  // 逐项覆盖 ['','resume']；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in ['','resume'] with the same checks, preserving the listed order.
  for (const operation of ["", "resume"]) {
    denied(
      await api.request(roomPath(host, operation), {
        ...credentials(host),
        ...(operation
          ? {
              body: {
                revision: stored.revision,
              },
            }
          : {}),
      }),
    );
  }
  successful(await leave(api, host)); // repeated leave is deliberately idempotent
  const replacement = await joinRoom(
    api,
    roomId,
    "替补东家",
    await identity(api),
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(replacement.seat, 0);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  denied(
    await api.request(roomPath(replacement, "resume"), {
      token: host.token,
      profile: replacement.profile,
      body: {},
    }),
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal((await snapshot(api, replacement)).you, 0);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const replacementBefore = await api.store.get(roomId);
  successful(await leave(api, host, 0));
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  assert.deepEqual(
    await api.store.get(roomId),
    replacementBefore,
    "old leave changed replacement occupant",
  );
  assert.deepEqual(await api.store.get(unrelated.roomId), unrelatedBefore);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  // 逐项覆盖 [people[1],people[2],replacement]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [people[1],people[2],replacement] with the same checks, preserving the listed order.
  for (const person of [people[1], people[2], replacement])
    successful(await leave(api, person));
  stored = await api.store.get(roomId);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(stored.seats, [null, null, null]);
  assert.equal(stored.hostSeat, null);
  // 逐项覆盖 people；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in people with the same checks, preserving the listed order.
  for (const person of people)
    assert.deepEqual((await history(api, person)).records, []);
});
// 场景：恢复：进行中离席保留全部牌局字节，阻止离席者行动，且只能恢复原座位
// Scenario: recovery: active exit preserves every game byte, blocks detached actions, and resumes only the exact seat
test("recovery: active exit preserves every game byte, blocks detached actions, and resumes only the exact seat", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const api = harness();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const { people, host, roomId } = await table(api);
  const other = await table(api);
  const before = await api.store.get(roomId),
    elsewhere = await api.store.get(other.roomId);
  const left = successful(await leave(api, host));
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(left.detached, true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let after = await api.store.get(roomId);
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  assert.equal(JSON.stringify(after.game), JSON.stringify(before.game));
  assert.equal(after.seats[0].tokenHash, before.seats[0].tokenHash);
  assert.equal(after.hostSeat, 1);
  assert.deepEqual(await api.store.get(other.roomId), elsewhere);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  denied(await api.request(roomPath(host), credentials(host)), 409);
  denied(
    await action(api, host, after.revision, {
      type: "discard",
      tile: before.game.players[0].hand[0],
    }),
    409,
  );
  denied(
    await api.request(roomPath(host, "start"), {
      ...credentials(host),
      body: {
        revision: after.revision,
      },
    }),
    409,
  );
  denied(
    await api.request(roomPath(host, "resume"), {
      token: other.host.token,
      profile: host.profile,
      body: {},
    }),
  );
  denied(
    await api.request(roomPath(host, "resume"), {
      token: host.token,
      profile: other.host.profile,
      body: {},
    }),
    403,
  );
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal((await history(api, host)).records[0].status, "detached");
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const restored = successful(await resume(api, host)).state;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(restored.you, 0);
  assert.deepEqual(restored.game.players[0].hand, before.game.players[0].hand);
  assert.equal(
    restored.game.players.filter((player) => Array.isArray(player.hand)).length,
    1,
  );
  assert.equal(
    JSON.stringify((await api.store.get(roomId)).game),
    JSON.stringify(before.game),
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  // 逐项覆盖 people；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in people with the same checks, preserving the listed order.
  for (const person of people) successful(await leave(api, person));
  after = await api.store.get(roomId);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(after.hostSeat, null);
  assert.equal(JSON.stringify(after.game), JSON.stringify(before.game));
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const oneBack = successful(await resume(api, people[2])).state;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(oneBack.hostSeat, 2);
  assert.equal(oneBack.you, 2);
});
// 场景：恢复：重复离开与并发开局使用修订号比较并交换，不造成部分牌局损坏
// Scenario: recovery: duplicate leave and concurrent start use revision CAS without partial game corruption
test("recovery: duplicate leave and concurrent start use revision CAS without partial game corruption", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const api = harness();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const { host, roomId } = await table(api, {
    start: false,
  });
  const replies = await Promise.all([
    leave(api, host, 2),
    api.request(roomPath(host, "start"), {
      ...credentials(host),
      body: {
        revision: 2,
      },
    }),
  ]);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(
    replies[0].status,
    200,
    "leave intent must win or safely retry after start",
  );
  assert.ok([200, 409].includes(replies[1].status));
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const room = await api.store.get(roomId);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(room.revision, replies[1].status === 200 ? 4 : 3);
  // 只有房间实际含牌局时才检查或处理牌局，不给大厅补造一局。
  // Process game data only when a game exists, without inventing one for a lobby.
  if (room.game) {
    assertGameInvariants(room.game);
    assert.equal(room.seats[0].detached, true);
    const before = JSON.stringify(room.game);
    const duplicate = await Promise.all([
      leave(api, host, room.revision),
      leave(api, host, room.revision),
    ]);
    assert.deepEqual(duplicate.map((reply) => reply.status).sort(), [200, 200]);
    assert.equal((await api.store.get(roomId)).revision, room.revision);
    assert.equal(JSON.stringify((await api.store.get(roomId)).game), before);
  } else {
    assert.equal(room.seats[0], null);
    assert.equal(room.hostSeat, 1);
  }
});
// 场景：恢复：延迟的已验证心跳不能复活已离席或被替换的座位
// Scenario: recovery: delayed authenticated heartbeat cannot revive a detached or replaced seat
test("recovery: delayed authenticated heartbeat cannot revive a detached or replaced seat", async () => {
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  // 逐项覆盖 [false,true]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [false,true] with the same checks, preserving the listed order.
  for (const start of [false, true]) {
    const api = harness();
    const { host, roomId } = await table(api, {
      start,
    });
    const room = await api.store.get(roomId);
    room.seats[0].lastSeen = Date.now() - 60000;
    assert.equal(await api.store.compareAndSwap(room, room.revision), true);
    let entered, release;
    const waiting = new Promise((resolve) => {
      entered = resolve;
    });
    const resumeTouch = new Promise((resolve) => {
      release = resolve;
    });
    const touch = api.store.touch.bind(api.store);
    api.store.touch = async (...args) => {
      entered();
      await resumeTouch;
      return touch(...args);
    };
    const poll = api.request(roomPath(host), credentials(host));
    await waiting;
    successful(await leave(api, host));
    // 未开局场景需要单独处理，不能假设已经有可操作的牌局。
    // Handle the unstarted case separately rather than assuming a playable game exists.
    if (!start) {
      const replacement = await joinRoom(
        api,
        roomId,
        "后来的新东家",
        await identity(api),
      );
      const stored = await api.store.get(roomId);
      stored.seats[replacement.seat].lastSeen = 12345;
      assert.equal(
        await api.store.compareAndSwap(stored, stored.revision),
        true,
      );
    }
    const expected = await api.store.get(roomId);
    release();
    await poll;
    assert.deepEqual(
      await api.store.get(roomId),
      expected,
      "late old heartbeat changed detached/replacement state",
    );
  }
});
// 场景：恢复：记录只结算一次，在新局后仍保留，且不转移给替补玩家
// Scenario: recovery: records settle exactly once, survive new games, and never move to replacement players
test("recovery: records settle exactly once, survive new games, and never move to replacement players", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const api = harness();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const { people, host, roomId } = await table(api);
  const started = (await history(api, host)).records;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(started.length, 1);
  assert.equal(started[0].status, "playing");
  assert.ok(started[0].events.some((event) => event.type === "start"));
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const state = await finishTable(api, people);
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  for (let pass = 0; pass < 3; pass++) {
    // 逐项覆盖 people；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in people with the same checks, preserving the listed order.
    for (const person of people) await snapshot(api, person);
    const mine = await history(api, host);
    assert.equal(mine.records.length, 1);
    assert.equal(mine.records[0].status, "finished");
    assert.equal(mine.records[0].gameId, started[0].gameId);
    assert.equal(mine.records[0].score, 8);
    assert.equal(mine.summary.settledGames, 1);
    assert.equal(mine.summary.totalScore, 8);
    assert.equal(
      mine.records[0].events.filter((event) => event.type === "finish").length,
      1,
    );
  }
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  successful(await leave(api, people[2], state.revision));
  const newcomer = await joinRoom(api, roomId, "独立替补", await identity(api));
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(
    (await history(api, newcomer)).records.length,
    0,
    "new seat inherited prior owner game",
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const last = (await history(api, people[2])).records[0];
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.equal(last.score, -5);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const revision = (await api.store.get(roomId)).revision;
  const starts = await Promise.all(
    [0, 1].map(() =>
      api.request(roomPath(host, "start"), {
        ...credentials(host),
        body: {
          revision,
        },
      }),
    ),
  );
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.deepEqual(starts.map((answer) => answer.status).sort(), [200, 409]);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const mine = await history(api, host);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(mine.records.length, 2);
  assert.equal(new Set(mine.records.map((record) => record.gameId)).size, 2);
  assert.equal(mine.summary.totalScore, 8);
  assert.equal(mine.summary.settledGames, 1);
  assert.equal((await history(api, newcomer)).records.length, 1);
  assert.deepEqual((await history(api, people[2])).records, [last]);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  noPrivateData(
    mine,
    people.flatMap((person) => [person.token, person.profile]),
  );
});
// 场景：恢复：旧房间仅迁移凭证可证明归属的当前牌局，绝不按昵称匹配
// Scenario: recovery: old rooms migrate only the credential-proven current game, never a name match
test("recovery: old rooms migrate only the credential-proven current game, never a name match", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const api = harness();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const legacy = await table(api, {
    profiles: [undefined, undefined, undefined],
    names: ["历史同名", "旧南", "旧西"],
  });
  const sameName = await table(api, {
    profiles: [undefined, undefined, undefined],
    names: ["历史同名", "另一南", "另一西"],
  });
  const before = await api.store.get(legacy.roomId),
    untouched = await api.store.get(sameName.roomId);
  const own = await identity(api),
    attacker = await identity(api);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual((await history(api, own)).records, []);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  denied(
    await api.request(roomPath(legacy.host), {
      token: sameName.host.token,
      profile: own,
    }),
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual((await history(api, own)).records, []);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const migrated = successful(
    await api.request(roomPath(legacy.host), {
      token: legacy.host.token,
      profile: own,
    }),
  ).state;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(migrated.you, 0);
  assert.equal(
    JSON.stringify((await api.store.get(legacy.roomId)).game),
    JSON.stringify(before.game),
  );
  assert.deepEqual(await api.store.get(sameName.roomId), untouched);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const records = (await history(api, own)).records;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(records.length, 1);
  assert.equal(records[0].roomId, legacy.roomId);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  denied(
    await api.request(roomPath(legacy.host), {
      token: legacy.host.token,
      profile: attacker,
    }),
    403,
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual((await history(api, attacker)).records, []);
});
// 场景：恢复：真实 HTTP 个人历史与离席座位在 FileStore 重载后仍保留
// Scenario: recovery: real HTTP identity history and detached seats survive a FileStore reload
test("recovery: real HTTP identity history and detached seats survive a FileStore reload", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const dir = await mkdtemp(join(tmpdir(), "mahjong-recovery-"));
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  t.after(() =>
    rm(dir, {
      recursive: true,
      force: true,
    }),
  );
  const store = new FileStore(dir);
  const server = createServer(apiMiddleware(store));
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  const api = harness(store, (request) =>
    fetch(`${origin}${new URL(request.url).pathname}`, {
      method: request.method,
      headers: request.headers,
      ...(request.method === "GET"
        ? {}
        : {
            body: request.body,
            duplex: "half",
          }),
    }),
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const first = await table(api);
  await finishTable(api, first.people, [11, -4, -7]);
  const firstHistory = await history(api, first.host);
  successful(
    await api.request(roomPath(first.host, "start"), {
      ...credentials(first.host),
      body: {
        revision: (await store.get(first.roomId)).revision,
      },
    }),
  );
  successful(await leave(api, first.host));
  const before = await store.get(first.roomId);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const reopened = harness(new FileStore(dir));
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const recovered = await history(reopened, first.host);
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.equal(recovered.summary.totalScore, 11);
  assert.equal(recovered.summary.settledGames, 1);
  assert.equal(recovered.records.length, 2);
  assert.ok(
    recovered.records.some(
      (record) => record.gameId === firstHistory.records[0].gameId,
    ),
  );
  assert.deepEqual(await reopened.store.get(first.roomId), before);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  denied(
    await reopened.request(roomPath(first.host), credentials(first.host)),
    409,
  );
  const back = successful(await resume(reopened, first.host)).state;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(back.you, 0);
  assert.deepEqual(back.game.players[0].hand, before.game.players[0].hand);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const persisted = await readFile(join(dir, "rooms.json"), "utf8");
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  // 逐项覆盖 first.people；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in first.people with the same checks, preserving the listed order.
  for (const person of first.people) {
    assert.equal(persisted.includes(person.token), false);
    assert.equal(persisted.includes(person.profile), false);
  }
});
// 用 :memory: SQLite 实现测试所需的 D1 prepare/bind/first/run 接口；记录 SQL 以检查读写次数。
// Implement the required D1 prepare/bind/first/run surface over :memory: SQLite, recording SQL for read/write-count checks.
function sqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE mahjong_rooms (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE mahjong_profiles (token_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
    CREATE TABLE mahjong_player_rooms (player_hash TEXT NOT NULL, room_id TEXT NOT NULL, PRIMARY KEY (player_hash, room_id));
  `);
  const statements = [];
  return {
    sqlite,
    statements,
    close: () => sqlite.close(),
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              statements.push({
                sql,
                values,
                kind: "read",
              });
              return sqlite.prepare(sql).get(...values) || null;
            },
            async all() {
              statements.push({
                sql,
                values,
                kind: "read",
              });
              return {
                results: sqlite.prepare(sql).all(...values),
                success: true,
              };
            },
            async run() {
              statements.push({
                sql,
                values,
                kind: "write",
              });
              return {
                meta: {
                  changes: Number(sqlite.prepare(sql).run(...values).changes),
                },
              };
            },
          };
        },
      };
    },
  };
}
// 场景：恢复 D1：独立工作进程只结算一次，处理器重启后仍保留个人历史
// Scenario: recovery D1: independent workers settle once and keep profile history after handler restart
test("recovery D1: independent workers settle once and keep profile history after handler restart", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const db = sqliteD1();
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  try {
    const primary = harness(new D1Store(db)),
      secondary = harness(new D1Store(db));
    const { host, people, roomId } = await table(primary);
    await finishTable(primary, people, [15, -6, -9]);
    const before = await history(primary, host);
    const current = await primary.store.get(roomId);
    const starts = await Promise.all(
      [primary, secondary].map((api) =>
        api.request(roomPath(host, "start"), {
          ...credentials(host),
          body: {
            revision: current.revision,
          },
        }),
      ),
    );
    assert.deepEqual(starts.map((answer) => answer.status).sort(), [200, 409]);
    const latest = await primary.store.get(roomId);
    const leaves = await Promise.all(
      [primary, secondary].map((api) => leave(api, host, latest.revision)),
    );
    assert.deepEqual(leaves.map((answer) => answer.status).sort(), [200, 200]);
    assert.equal(
      (await primary.store.get(roomId)).revision,
      latest.revision + 1,
    );
    const reloaded = harness(new D1Store(db));
    const mine = await history(reloaded, host);
    assert.equal(mine.summary.settledGames, 1);
    assert.equal(mine.summary.totalScore, 15);
    assert.equal(mine.records.length, 2);
    assert.equal(new Set(mine.records.map((record) => record.gameId)).size, 2);
    assert.ok(
      mine.records.some(
        (record) =>
          record.gameId === before.records[0].gameId &&
          record.status === "finished",
      ),
    );
    assert.ok(mine.records.some((record) => record.status === "detached"));
    assert.equal(
      JSON.stringify((await reloaded.store.get(roomId)).game),
      JSON.stringify(latest.game),
    );
    const restoredTotals = successful(await resume(reloaded, host)).state
      .tableScores;
    assert.deepEqual(
      restoredTotals.map((row) => row.totalScore),
      [15, -6, -9],
    );
    noPrivateData(
      restoredTotals,
      people.flatMap((person) => [person.token, person.profile]),
    );
    noPrivateData(
      await history(reloaded, host),
      people.flatMap((person) => [person.token, person.profile]),
    );
    const data = db.sqlite
      .prepare("SELECT state FROM mahjong_rooms")
      .all()
      .map((row) => row.state)
      .join("");
    // 逐项覆盖 people；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in people with the same checks, preserving the listed order.
    for (const person of people) {
      assert.equal(data.includes(person.token), false);
      assert.equal(data.includes(person.profile), false);
    }
  } finally {
    // 无论断言成功还是失败都执行清理，避免数据库、服务或全局替身泄漏到后续测试。
    // Clean up whether assertions pass or fail, preventing database/server/global substitutes leaking into later tests.
    db.close();
  }
});
// 场景：恢复 D1：旧工作进程的心跳不能覆盖离席状态或新入座者
// Scenario: recovery D1: stale worker heartbeat cannot overwrite a leave or a new occupant
test("recovery D1: stale worker heartbeat cannot overwrite a leave or a new occupant", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const db = sqliteD1();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  try {
    // 逐项覆盖 [false,true]；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in [false,true] with the same checks, preserving the listed order.
    for (const start of [false, true]) {
      const api = harness(new D1Store(db)),
        worker = harness(new D1Store(db));
      const { host, roomId } = await table(api, {
        start,
      });
      const room = await api.store.get(roomId);
      room.seats[0].lastSeen = Date.now() - 60000;
      assert.equal(await api.store.compareAndSwap(room, room.revision), true);
      let entered, release;
      const waiting = new Promise((resolve) => {
        entered = resolve;
      });
      const paused = new Promise((resolve) => {
        release = resolve;
      });
      const touch = worker.store.touch.bind(worker.store);
      worker.store.touch = async (...args) => {
        entered();
        await paused;
        return touch(...args);
      };
      const oldPoll = worker.request(roomPath(host), credentials(host));
      await waiting;
      successful(await leave(api, host));
      // 未开局场景需要单独处理，不能假设已经有可操作的牌局。
      // Handle the unstarted case separately rather than assuming a playable game exists.
      if (!start) await joinRoom(api, roomId, "D1新东家", await identity(api));
      const expected = await api.store.get(roomId);
      release();
      await oldPoll;
      assert.deepEqual(await api.store.get(roomId), expected);
      assert.ok(
        db.statements.some(
          (statement) =>
            /json_set/.test(statement.sql) &&
            /revision = \?/.test(statement.sql) &&
            /tokenHash/.test(JSON.stringify(statement.values)),
        ),
      );
    }
  } finally {
    // 无论断言成功还是失败都执行清理，避免数据库、服务或全局替身泄漏到后续测试。
    // Clean up whether assertions pass or fail, preventing database/server/global substitutes leaking into later tests.
    db.close();
  }
});
// 场景：恢复 D1：仅有个人资料索引绝不授予另一身份的历史访问权
// Scenario: recovery D1: profile index alone never grants another identity historical access
test("recovery D1: profile index alone never grants another identity historical access", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const db = sqliteD1();
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  try {
    const api = harness(new D1Store(db));
    const { host } = await table(api);
    const attacker = await identity(api);
    // Model an orphan/retried index operation. Ownership must still be checked
    // against the immutable game participant rather than trusting the index.
    const attackerHash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(attacker),
        ),
      ),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    await api.store.linkProfileRoom(attackerHash, host.roomId);
    assert.deepEqual((await history(api, attacker)).records, []);
    assert.equal((await history(api, host)).records.length, 1);
    denied(
      await api.request(roomPath(host), {
        token: host.token,
        profile: attacker,
      }),
      403,
    );
  } finally {
    // 无论断言成功还是失败都执行清理，避免数据库、服务或全局替身泄漏到后续测试。
    // Clean up whether assertions pass or fail, preventing database/server/global substitutes leaking into later tests.
    db.close();
  }
});
// 场景：恢复：旧版规则的私有状态在离席及显式恢复中完全保留
// Scenario: recovery: legacy rules retain private state exactly through detach and explicit resume
test("recovery: legacy rules retain private state exactly through detach and explicit resume", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const api = harness();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const { host, roomId } = await table(api);
  const room = await api.store.get(roomId);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  room.game = createLegacyGame({
    seed: "legacy-room-recovery",
  });
  delete room.game.schemaVersion;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assertLegacyInvariants(room.game);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const bytes = JSON.stringify(room.game);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(await api.store.compareAndSwap(room, room.revision), true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  successful(await leave(api, host));
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(JSON.stringify((await api.store.get(roomId)).game), bytes);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const restored = successful(await resume(api, host)).state;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(restored.game.schemaVersion, 1);
  assert.equal(JSON.stringify((await api.store.get(roomId)).game), bytes);
  assert.deepEqual(restored.game.players[0].hand, room.game.players[0].hand);
  assert.equal(
    restored.game.players.filter((player) => Array.isArray(player.hand)).length,
    1,
  );
  assert.equal((await history(api, host)).records[0].rulesVersion, 1);
});
// 场景：恢复：历史隐藏私有摸牌载荷，且在房间过期窗口后仍保留
// Scenario: recovery: history redacts private draw payloads and remains after the room expiry window
test("recovery: history redacts private draw payloads and remains after the room expiry window", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const api = harness();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const { host, roomId } = await table(api);
  const room = await api.store.get(roomId);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  room.game.history.push({
    type: "draw",
    seat: 1,
    tile: 16,
    drawnTile: 16,
    hand: [16, 16],
    tokenHash: "PRIVATE_TEST_HASH",
    message: "PRIVATE_TEST_DRAW_EIGHT_CIRCLES",
  });
  room.updatedAt = Date.now() - 8 * 86400000;
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(await api.store.compareAndSwap(room, room.revision), true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const mine = await history(api, host);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(mine.records.length, 1);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const draw = mine.records[0].events.find((event) => event.type === "draw");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.ok(draw);
  assert.equal("tile" in draw, false);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  noPrivateData(mine, [
    host.token,
    host.profile,
    "PRIVATE_TEST_HASH",
    "PRIVATE_TEST_DRAW_EIGHT_CIRCLES",
  ]);
});
// 场景：恢复：无效身份令牌不能悄悄创建或加入匿名座位
// Scenario: recovery: an invalid identity token cannot silently create or join an anonymous seat
test("recovery: an invalid identity token cannot silently create or join an anonymous seat", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const api = harness();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const room = await createRoom(api, "身份检查", await identity(api));
  const before = await api.store.get(room.roomId);
  // 逐项覆盖 ['bad','0'.repeat(64)]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in ['bad','0'.repeat(64)] with the same checks, preserving the listed order.
  for (const profile of ["bad", "0".repeat(64)]) {
    denied(
      await api.request("/api/rooms", {
        profile,
        body: {
          name: "不应建成",
        },
      }),
    );
    denied(
      await api.request(`/api/rooms/${room.roomId}/join`, {
        profile,
        body: {
          name: "不应落座",
        },
      }),
    );
  }
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  assert.deepEqual(await api.store.get(room.roomId), before);
  assert.equal(api.store.rooms.size, 1);
});
// 场景：恢复：替补座位不能继承暗杠或私有听口元数据
// Scenario: recovery: a replacement seat cannot inherit concealed kongs or private wait metadata
test("recovery: a replacement seat cannot inherit concealed kongs or private wait metadata", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const api = harness();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const { people, roomId } = await table(api);
  await finishTable(api, people);
  const room = await api.store.get(roomId);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const old = room.game.players[2];
  const tile = Array.from(
    {
      length: 18,
    },
    (_, value) => value,
  ).find(
    (value) =>
      room.game.retiredTiles.filter((item) => item.tile === value).length >= 4,
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.notEqual(tile, undefined);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  room.game.retiredTiles.push(
    ...old.hand.splice(0, 3).map((value) => ({
      seat: 2,
      tile: value,
    })),
  );
  for (let count = 0; count < 4; count++)
    room.game.retiredTiles.splice(
      room.game.retiredTiles.findIndex((item) => item.tile === tile),
      1,
    );
  // 这个回归保留旧局未公开暗杠的快照，新局公开暗杠另有隐私测试。
  // Retain the old hidden-kong snapshot here; the privacy suite covers public new-game kongs.
  delete room.game.rules.publicConcealedKongs;
  old.melds.push({
    type: "anGang",
    tile,
    tiles: [tile, tile, tile, tile],
  });
  old.lockedWaits = [8, 17];
  old.huLockActive = true;
  old.huCount = 1;
  old.firstHuPattern = {
    kind: "sevenPairs",
    pureSuit: false,
    allTriplets: false,
    waitTiles: [0, 2, 4, 6, 8, 15, 17],
    fixedFan: 3,
    sevenPairsFan: 3,
  };
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assertGameInvariants(room.game);
  assert.equal(await api.store.compareAndSwap(room, room.revision), true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  successful(await leave(api, people[2]));
  const newcomer = await joinRoom(
    api,
    roomId,
    "不可看旧暗牌",
    await identity(api),
  );
  const view = await snapshot(api, newcomer);
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  assert.equal(
    view.game.players.some((player) => Array.isArray(player.hand)),
    false,
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const kong = view.game.players[2].melds[0];
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(kong.tile, null, "new occupant learned old concealed-kong tile");
  assert.deepEqual(kong.tiles, [null, null, null, null]);
  assert.deepEqual(view.seats[2].melds, []);
  assert.equal(view.seats[2].score, 0);
  assert.equal(view.seats[2].isCurrentParticipant, false);
  assert.ok(
    !view.game.waitTiles?.length,
    "new occupant learned old waiting tiles",
  );
  assert.ok(!view.game.lockedWaits?.length, "new occupant learned old hu lock");
  assert.equal(
    view.game.specialHuPattern,
    null,
    "new occupant learned old special-hand waits",
  );
  assert.equal(Boolean(view.game.huLockActive), false);
  assert.equal((await history(api, newcomer)).records.length, 0);
});
// 场景：恢复：已部署身份传输使用个人资料 Bearer、座位 Bearer 及 POST 请求体
// Scenario: recovery: deployed identity transport uses profile bearer and seat bearer plus POST body
test("recovery: deployed identity transport uses profile bearer and seat bearer plus POST body", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const api = harness();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const own = await identity(api),
    wrong = await identity(api);
  const profileRead = successful(
    await api.request("/api/profile/history", {
      token: own,
    }),
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(profileRead.records, []);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const create = successful(
    await api.request("/api/rooms", {
      body: {
        name: "正文绑定东家",
        profileToken: own,
      },
    }),
    201,
  );
  const resume = successful(
    await api.request(`/api/rooms/${create.roomId}/resume`, {
      token: create.token,
      body: {
        profileToken: own,
      },
    }),
  ).state;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(resume.you, 0);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  denied(
    await api.request(`/api/rooms/${create.roomId}/resume`, {
      token: create.token,
      body: {
        profileToken: wrong,
      },
    }),
    403,
  );
  denied(
    await api.request("/api/profile/history", {
      token: create.token,
    }),
  );
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  assert.equal(
    (
      await api.request(`/api/rooms/${create.roomId}`, {
        token: create.token,
      })
    ).status,
    200,
    "normal room polls need no profile token",
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  successful(
    await api.request(`/api/rooms/${create.roomId}/leave`, {
      token: create.token,
      body: {
        profileToken: own,
      },
    }),
  );
  const persisted = JSON.stringify(await api.store.get(create.roomId));
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(persisted.includes(own), false);
  assert.equal(persisted.includes(create.token), false);
});
// 场景：恢复：浏览器生成的个人资料注册可跨独立 D1 工作进程安全重试
// Scenario: recovery: browser-generated profile registration is retry-safe across independent D1 workers
test("recovery: browser-generated profile registration is retry-safe across independent D1 workers", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const db = sqliteD1();
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  try {
    const clients = [harness(new D1Store(db)), harness(new D1Store(db))];
    const playerToken = Array.from(
      crypto.getRandomValues(new Uint8Array(32)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const answers = await Promise.all(
      clients.map((api) =>
        api.request("/api/profile", {
          body: {
            playerToken,
          },
        }),
      ),
    );
    assert.deepEqual(answers.map((answer) => answer.status).sort(), [200, 201]);
    assert.ok(
      answers.every((answer) => answer.body.playerToken === playerToken),
    );
    assert.equal(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM mahjong_profiles").get()
        .count,
      1,
    );
    assert.deepEqual(
      successful(
        await clients[1].request("/api/profile/history", {
          token: playerToken,
        }),
      ).records,
      [],
    );
    // 逐项覆盖 ['','short','A'.repeat(64),1]；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in ['','short','A'.repeat(64),1] with the same checks, preserving the listed order.
    for (const invalid of ["", "short", "A".repeat(64), 1]) {
      denied(
        await clients[0].request("/api/profile", {
          body: {
            playerToken: invalid,
          },
        }),
        400,
      );
    }
  } finally {
    // 无论断言成功还是失败都执行清理，避免数据库、服务或全局替身泄漏到后续测试。
    // Clean up whether assertions pass or fail, preventing database/server/global substitutes leaking into later tests.
    db.close();
  }
});
// 场景：恢复：重复离席请求只能将该旧座位绑定到其新注册身份
// Scenario: recovery: repeated detached leave can bind only that old seat to its newly registered identity
test("recovery: repeated detached leave can bind only that old seat to its newly registered identity", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const api = harness();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const { host, roomId } = await table(api, {
    profiles: [undefined, undefined, undefined],
  });
  successful(await leave(api, host));
  const before = await api.store.get(roomId);
  const profile = await identity(api);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual((await history(api, profile)).records, []);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  successful(
    await api.request(roomPath(host, "leave"), {
      token: host.token,
      body: {
        profileToken: profile,
      },
    }),
  );
  const after = await api.store.get(roomId);
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  assert.equal(JSON.stringify(after.game), JSON.stringify(before.game));
  assert.equal(after.seats[0].detached, true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const mine = await history(api, profile);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(mine.records.length, 1);
  assert.equal(mine.records[0].roomId, roomId);
  assert.equal(mine.records[0].seat, 0);
  assert.equal(mine.records[0].status, "detached");
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const stranger = await identity(api);
  denied(
    await api.request(roomPath(host, "leave"), {
      token: host.token,
      body: {
        profileToken: stranger,
      },
    }),
    403,
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual((await history(api, stranger)).records, []);
});
// 场景：恢复：此前离席的座位可在牌局结束后释放
// Scenario: recovery: a previously detached seat can be released once the game is finished
test("recovery: a previously detached seat can be released once the game is finished", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const api = harness();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const { people, roomId } = await table(api);
  // Preserve the valid current game and finish it first. Marking the participant
  // detached models a departure that preceded another player's final action.
  await finishTable(api, people);
  const room = await api.store.get(roomId);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  room.seats[2].detached = true;
  room.seats[2].lastSeen = 0;
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(await api.store.compareAndSwap(room, room.revision), true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const before = await history(api, people[2]);
  const answer = successful(await leave(api, people[2]));
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(answer.detached, false);
  assert.equal((await api.store.get(roomId)).seats[2], null);
  assert.equal(
    JSON.stringify((await api.store.get(roomId)).game),
    JSON.stringify(room.game),
  );
  assert.equal(
    (await history(api, people[2])).summary.totalScore,
    before.summary.totalScore,
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const replacement = await joinRoom(
    api,
    roomId,
    "结算后新玩家",
    await identity(api),
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(replacement.seat, 2);
});
// 场景：恢复：重试仅产生一条离席或恢复日志，绝不记录虚构的开局
// Scenario: recovery: retries create only one departure/resume log and never log a phantom game start
test("recovery: retries create only one departure/resume log and never log a phantom game start", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const api = harness();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const { host, roomId } = await table(api);
  const before = await api.store.get(roomId);
  const repeated = await Promise.all([leave(api, host), leave(api, host)]);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.ok(repeated.every((answer) => answer.status === 200));
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let stored = await api.store.get(roomId);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(
    stored.lifecycleLog.filter((event) => event.type === "leave").length,
    1,
  );
  assert.equal(
    stored.game.history.filter((event) => event.type === "start").length,
    1,
  );
  assert.equal(JSON.stringify(stored.game), JSON.stringify(before.game));
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  successful(await resume(api, host));
  const resumedRevision = (await api.store.get(roomId)).revision;
  successful(await resume(api, host));
  stored = await api.store.get(roomId);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(stored.revision, resumedRevision);
  assert.deepEqual(
    stored.lifecycleLog.map((event) => event.type),
    ["leave", "resume"],
  );
  assert.equal(JSON.stringify(stored.game), JSON.stringify(before.game));
  assert.equal((await history(api, host)).records.length, 1);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  noPrivateData(stored.lifecycleLog, [host.token, host.profile]);
});
// 场景：牌桌累计积分在 FileStore 重启、下一局、重复读取及同名替补后仍保留
// Scenario: table totals persist through FileStore restart, another game, repeated reads and same-name replacement
test("table totals persist through FileStore restart, another game, repeated reads and same-name replacement", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const dir = await mkdtemp(join(tmpdir(), "flower-total-score-"));
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  t.after(() =>
    rm(dir, {
      recursive: true,
      force: true,
    }),
  );
  const api = harness(new FileStore(dir));
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const { host, people, roomId } = await table(api);
  let state = await snapshot(api, host);
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.deepEqual(
    state.tableScores.map((row) => row.totalScore),
    [0, 0, 0],
  );
  assert.equal(state.game.rules.turnDirection, "counterclockwise");
  assert.equal(state.game.rules.allowPungUpgrade, true);
  assert.equal(state.game.rules.pungUpgradeAfterDiscard, true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  state = await finishTable(api, people, [8, -3, -5]);
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.deepEqual(
    state.tableScores.map((row) => row.totalScore),
    [8, -3, -5],
  );
  assert.deepEqual(
    state.tableScores.map((row) => row.settledScore),
    [8, -3, -5],
  );
  assert.deepEqual(
    state.tableScores.map((row) => row.provisionalScore),
    [0, 0, 0],
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  successful(
    await api.request(roomPath(host, "start"), {
      ...credentials(host),
      body: {
        revision: state.revision,
      },
    }),
  );
  let saved = await api.store.get(roomId);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  saved.game.players.forEach((player, index) => {
    player.score = [2, -1, -1][index];
  });
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  assert.equal(await api.store.compareAndSwap(saved, saved.revision), true);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const restored = harness(new FileStore(dir));
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 people；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in people with the same checks, preserving the listed order.
  for (const person of people)
    for (let i = 0; i < 2; i++) {
      const fresh = await snapshot(restored, person);
      assert.deepEqual(
        fresh.tableScores.map((row) => row.totalScore),
        [10, -4, -6],
      );
      assert.deepEqual(
        fresh.tableScores.map((row) => row.settledScore),
        [8, -3, -5],
      );
      assert.deepEqual(
        fresh.tableScores.map((row) => row.provisionalScore),
        [2, -1, -1],
      );
      noPrivateData(
        fresh.tableScores,
        people.flatMap((player) => [player.token, player.profile]),
      );
    }
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  state = await finishTable(restored, people, [2, -1, -1]);
  successful(await leave(restored, people[2], state.revision));
  const replacement = await joinRoom(
    restored,
    roomId,
    people[2].state.seats[2].name,
    await identity(restored),
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const totals = replacement.state.tableScores;
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.deepEqual(
    totals.map((row) => row.totalScore),
    [10, -4, -6, 0],
  );
  assert.equal(totals[2].seat, null);
  assert.equal(totals[2].detached, true);
  assert.equal(totals[3].seat, 2);
  assert.equal(
    totals.reduce((sum, row) => sum + row.totalScore, 0),
    0,
  );
  assert.equal((await history(restored, host)).summary.totalScore, 10);
});
