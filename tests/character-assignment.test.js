// 角色偏好校验、随机分配公平性、唯一性与保存后的稳定性。
// Character preference validation, fair unique assignment and persistence stability.
// 阅读说明见 docs/TESTING-READING-GUIDE.md；固定种子与凭证仅为测试，不应移入真实用户数据。
// See docs/TESTING-READING-GUIDE.md; seeded data and test credentials must stay separate from real user data.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CHARACTER_IDS,
  assignCharacters,
  gameCharacters,
  preferredCharacter,
} from "../shared/character-assignment.js";
import { createApi } from "../server/api.js";
import { MemoryStore } from "../server/store.js";
import { FileStore } from "../server/node.js";
import { createGame as createLegacyGame } from "../shared/legacy-game.js";
// 验证三个座位的角色分配没有重复；偏好冲突不能让两位玩家共享同一角色。
// Verify distinct assignments across three seats; conflicting preferences must not duplicate a character.
function assertDistinct(characters) {
  assert.deepEqual([...characters].sort(), [...CHARACTER_IDS].sort());
}

// Enumerate every RNG branch rather than using a flaky statistical test.
// 递归枚举随机选择的每条分支，按分支数分配概率权重；比重复抽样更准确且不会偶发失败。
// Enumerate every RNG branch recursively and divide probability weight by branch count, avoiding flaky statistical sampling.
function outcomes(preferences, choices = [], weight = 1, results = new Map()) {
  let cursor = 0;
  try {
    const assignment = assignCharacters(preferences, (size) => {
      // 已知随机选择路径走完后抛出分支规模，让外层递归枚举下一次随机选择。
      // Signal the next RNG branch size when the supplied choice path is exhausted.
      if (cursor === choices.length)
        throw {
          branchSize: size,
        };
      return choices[cursor++];
    });
    const key = assignment.join(",");
    results.set(key, (results.get(key) || 0) + weight);
  } catch (branch) {
    // 不是用于枚举的分支信号就重新抛出错误，不能把真实异常吞成随机分支。
    // Rethrow non-branch errors instead of swallowing genuine failures as RNG enumeration.
    if (!branch.branchSize) throw branch;
    for (let choice = 0; choice < branch.branchSize; choice++) {
      outcomes(
        preferences,
        [...choices, choice],
        weight / branch.branchSize,
        results,
      );
    }
  }
  return results;
}
// 为角色分配测试建立隔离 API 与存储，返回请求入口而不是线上连接。
// Build isolated API/storage access for character-assignment tests rather than connecting to a live service.
function apiHarness(store = new MemoryStore()) {
  const api = createApi(store);
  return {
    store,
    async request(path, { token, method = "GET", body } = {}) {
      const response = await api(
        new Request(`http://localhost${path}`, {
          method,
          headers: {
            ...(token
              ? {
                  authorization: `Bearer ${token}`,
                }
              : {}),
            ...(body === undefined
              ? {}
              : {
                  "content-type": "application/json",
                }),
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
        ...(await response.json()),
      };
    },
  };
}
// 建立三位独立玩家的测试桌；具体开局、偏好或存储条件由本文件参数决定。
// Build a three-player test table with the start, preference or storage conditions defined by this file’s parameters.
async function table(api, preferences = ["sweet", "sweet", "elegant"]) {
  const host = await api.request("/api/rooms", {
    method: "POST",
    body: {
      name: "东家",
      preferredCharacter: preferences[0],
    },
  });
  assert.equal(host.status, 201);
  const clients = [host];
  // 逐项覆盖 [1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [1,2] with the same checks, preserving the listed order.
  for (const seat of [1, 2]) {
    const result = await api.request(`/api/rooms/${host.roomId}/join`, {
      method: "POST",
      body: {
        name: `${seat}号玩家`,
        preferredCharacter: preferences[seat],
      },
    });
    assert.equal(result.status, 201);
    clients.push(result);
  }
  const path = `/api/rooms/${host.roomId}`;
  return {
    path,
    clients,
    host,
    state: clients[2].state,
  };
}
// 检查角色快照不泄漏凭证、哈希或底牌，并且只有当前座位含手牌字段。
// Check character snapshots for credential/hash/wall leaks and allow a hand field only for the current seat.
function assertPrivate(state, room, seat, clients) {
  const json = JSON.stringify(state);
  // 逐项覆盖 clients；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in clients with the same checks, preserving the listed order.
  for (const client of clients)
    assert.equal(json.includes(client.token), false);
  // 逐项覆盖 room.seats.filter(Boolean)；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in room.seats.filter(Boolean) with the same checks, preserving the listed order.
  for (const person of room.seats.filter(Boolean))
    assert.equal(json.includes(person.tokenHash), false);
  const visit = (value) => {
    // 空值和非对象是递归终点，不能继续枚举其字段。
    // Null and non-object values end recursion; do not enumerate their fields.
    if (!value || typeof value !== "object") return;
    // 逐项覆盖 Object.entries(value)；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in Object.entries(value) with the same checks, preserving the listed order.
    for (const [key, entry] of Object.entries(value)) {
      assert.equal(
        [
          "token",
          "tokenHash",
          "playerHash",
          "wall",
          "lastDraw",
          "participants",
        ].includes(key),
        false,
        key,
      );
      visit(entry);
    }
  };
  visit(state);
  // 逐项覆盖 state.seats.filter(Boolean)；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in state.seats.filter(Boolean) with the same checks, preserving the listed order.
  for (const person of state.seats.filter(Boolean))
    assert.equal("hand" in person, false);
  // 逐项覆盖 state.game.players；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in state.game.players with the same checks, preserving the listed order.
  for (const player of state.game.players)
    assert.equal("hand" in player, player.seat === seat);
}
// 场景：角色偏好校验仅接受稳定角色标识或不选择
// Scenario: character preference validation accepts only stable IDs or no selection
test("character preference validation accepts only stable IDs or no selection", () => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(preferredCharacter(), null);
  assert.equal(preferredCharacter(null), null);
  // 逐项覆盖 CHARACTER_IDS；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in CHARACTER_IDS with the same checks, preserving the listed order.
  for (const id of CHARACTER_IDS) assert.equal(preferredCharacter(id), id);
  // 逐项覆盖 ['','random','Sweet',' sweet ',0,false,[],{},'__proto__']；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in ['','random','Sweet',' sweet ',0,false,[],{},'__proto__'] with the same checks, preserving the listed order.
  for (const invalid of [
    "",
    "random",
    "Sweet",
    " sweet ",
    0,
    false,
    [],
    {},
    "__proto__",
  ]) {
    assert.throws(() => preferredCharacter(invalid), TypeError);
  }
  assert.throws(() => assignCharacters([]), TypeError);
  assert.throws(() => assignCharacters(["sweet", null, "unknown"]), TypeError);
  assert.throws(
    () => assignCharacters([null, null, null], () => 3),
    RangeError,
  );
});
// 场景：全部 64 种角色偏好组合均分配不重复角色，并满足无竞争的指定偏好
// Scenario: all 64 preference combinations stay unique and honor uncontested requests
test("all 64 preference combinations stay unique and honor uncontested requests", () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const options = [null, ...CHARACTER_IDS];
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 逐项覆盖 options；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in options with the same checks, preserving the listed order.
  // Exercise each entry in options with the same checks, preserving the listed order.
  // Exercise each entry in options with the same checks, preserving the listed order.
  for (const first of options) // 逐项覆盖 options；同一组检查用于每个样本，顺序以代码列出的集合为准。
    for (const second of options) // 逐项覆盖 options；同一组检查用于每个样本，顺序以代码列出的集合为准。
      for (const third of options) {
        const preferences = [first, second, third];
        const possibilities = outcomes(preferences);
        assert.ok(
          Math.abs(
            [...possibilities.values()].reduce(
              (sum, weight) => sum + weight,
              0,
            ) - 1,
          ) < 1e-12,
        );
        // 逐项覆盖 possibilities.keys()；同一组检查用于每个样本，顺序以代码列出的集合为准。
        // Exercise each entry in possibilities.keys() with the same checks, preserving the listed order.
        for (const key of possibilities.keys()) {
          const assigned = key.split(",");
          assertDistinct(assigned);
          // 逐项覆盖 CHARACTER_IDS；同一组检查用于每个样本，顺序以代码列出的集合为准。
          // Exercise each entry in CHARACTER_IDS with the same checks, preserving the listed order.
          for (const character of CHARACTER_IDS) {
            const candidates = preferences.flatMap((value, seat) =>
              value === character ? [seat] : [],
            );
            // 候选集合非空时才从中选择，避免对空数组随机取值。
            // Select only from a nonempty candidate set, avoiding an undefined random choice.
            if (candidates.length)
              assert.ok(
                candidates.includes(assigned.indexOf(character)),
                `${preferences}: ${key}`,
              );
          }
        }
      }
});
// 场景：随机选择与三人冲突均产生等概率的六种角色分配
// Scenario: random players and three-way conflicts yield all six equally likely assignments
test("random players and three-way conflicts yield all six equally likely assignments", () => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 逐项覆盖 [[null,null,null],...CHARACTER_IDS.map(id=>[id,id,id])]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [[null,null,null],...CHARACTER_IDS.map(id=>[id,id,id])] with the same checks, preserving the listed order.
  for (const preferences of [
    [null, null, null],
    ...CHARACTER_IDS.map((id) => [id, id, id]),
  ]) {
    const possibilities = outcomes(preferences);
    assert.equal(possibilities.size, 6);
    // 逐项覆盖 possibilities.values()；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in possibilities.values() with the same checks, preserving the listed order.
    for (const probability of possibilities.values())
      assert.ok(Math.abs(probability - 1 / 6) < 1e-12);
  }
});
// 场景：两人角色冲突时每位请求者概率相同，且不占用第三人指定的角色
// Scenario: two-way conflicts give each requester equal odds without taking another requested role
test("two-way conflicts give each requester equal odds without taking another requested role", () => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 逐项覆盖 [['sweet','sweet','elegant'],['sweet','elegant','sweet'],['elegant','sweet','sweet']]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [['sweet','sweet','elegant'],['sweet','elegant','sweet'],['elegant','sweet','sweet']] with the same checks, preserving the listed order.
  for (const preferences of [
    ["sweet", "sweet", "elegant"],
    ["sweet", "elegant", "sweet"],
    ["elegant", "sweet", "sweet"],
  ]) {
    const possibilities = outcomes(preferences);
    assert.equal(possibilities.size, 2);
    // 逐项覆盖 possibilities；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in possibilities with the same checks, preserving the listed order.
    for (const [key, probability] of possibilities) {
      assert.equal(probability, 0.5);
      assert.equal(key.split(",")[preferences.indexOf("elegant")], "elegant");
    }
  }
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const possibilities = outcomes(["sunny", "sunny", null]);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(possibilities.size, 4);
  // 逐项覆盖 possibilities.values()；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in possibilities.values() with the same checks, preserving the listed order.
  for (const probability of possibilities.values())
    assert.equal(probability, 0.25);
});
// 场景：安全的牌局映射拒绝格式错误数据，且不暴露可修改的源数组
// Scenario: safe game mapping rejects malformed data and never exposes a mutable source array
test("safe game mapping rejects malformed data and never exposes a mutable source array", () => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 逐项覆盖 [undefined,null,{},[],['sweet','sweet','sunny'],['sweet','elegant',{secret:true}]]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [undefined,null,{},[],['sweet','sweet','sunny'],['sweet','elegant',{secret:true}]] with the same checks, preserving the listed order.
  for (const invalid of [
    undefined,
    null,
    {},
    [],
    ["sweet", "sweet", "sunny"],
    [
      "sweet",
      "elegant",
      {
        secret: true,
      },
    ],
  ]) {
    assert.deepEqual(gameCharacters(invalid), CHARACTER_IDS);
  }
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const mapping = ["sunny", "sweet", "elegant"];
  const result = gameCharacters(mapping);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(result, mapping);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  result[0] = "changed";
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(mapping[0], "sunny");
});
// 场景：创建或加入房间时拒绝无效偏好，不预留座位也不暴露客户端字段
// Scenario: create/join reject invalid preferences without reserving seats or exposing client fields
test("create/join reject invalid preferences without reserving seats or exposing client fields", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const api = apiHarness();
  const invalidValues = [
    "",
    "random",
    "Sweet",
    1,
    true,
    [],
    {},
    {
      tokenHash: "secret",
    },
  ];
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  // 逐项覆盖 invalidValues；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in invalidValues with the same checks, preserving the listed order.
  for (const preferredCharacter of invalidValues) {
    const result = await api.request("/api/rooms", {
      method: "POST",
      body: {
        name: "无效",
        preferredCharacter,
      },
    });
    assert.equal(result.status, 400);
    assert.equal(result.code, "BAD_CHARACTER");
  }
  assert.equal(api.store.rooms.size, 0);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const host = await api.request("/api/rooms", {
    method: "POST",
    body: {
      name: "东家",
      characterId: "sunny",
      characters: ["sunny", "sunny", "sunny"],
    },
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(host.status, 201);
  assert.equal(host.state.seats[0].preferredCharacter, null);
  assert.equal(host.state.seats[0].characterId, null);
  // 逐项覆盖 invalidValues；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in invalidValues with the same checks, preserving the listed order.
  for (const preferredCharacter of invalidValues) {
    const result = await api.request(`/api/rooms/${host.roomId}/join`, {
      method: "POST",
      body: {
        name: "无效",
        preferredCharacter,
      },
    });
    assert.equal(result.status, 400);
    assert.equal(result.code, "BAD_CHARACTER");
  }
  assert.equal(
    (await api.store.get(host.roomId)).seats.filter(Boolean).length,
    1,
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const joined = await api.request(`/api/rooms/${host.roomId}/join`, {
    method: "POST",
    body: {
      name: "随机",
      preferredCharacter: null,
    },
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(joined.status, 201);
  assert.equal(joined.state.seats[1].preferredCharacter, null);
  assert.equal(joined.state.seats[1].characterId, null);
});
// 场景：角色分配仅在开局进行，由服务端权威确定、保持私密，并在动作与重连中稳定
// Scenario: assignment waits for start and is authoritative, private, and stable through actions/reconnect
test("assignment waits for start and is authoritative, private, and stable through actions/reconnect", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const api = apiHarness();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const { path, clients, host, state: lobby } = await table(api);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(lobby.game, null);
  assert.deepEqual(
    lobby.seats.map((person) => person.preferredCharacter),
    ["sweet", "sweet", "elegant"],
  );
  assert.deepEqual(
    lobby.seats.map((person) => person.characterId),
    [null, null, null],
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const storedLobby = await api.store.get(host.roomId);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(storedLobby.gameMeta, undefined);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const started = await api.request(`${path}/start`, {
    method: "POST",
    token: host.token,
    body: {
      revision: lobby.revision,
      characters: ["sunny", "sunny", "sunny"],
    },
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(started.status, 200);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const characters = started.state.game.characters;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assertDistinct(characters);
  assert.equal(characters[2], "elegant");
  assert.ok([0, 1].includes(characters.indexOf("sweet")));
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const stored = await api.store.get(host.roomId);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(stored.gameMeta.characters, characters);
  for (let seat = 0; seat < clients.length; seat++) {
    const view = await api.request(path, {
      token: clients[seat].token,
    });
    assert.deepEqual(view.state.game.characters, characters);
    assert.deepEqual(
      view.state.seats.map((person) => person.characterId),
      characters,
    );
    assertPrivate(view.state, stored, seat, clients);
  }
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const actingSeat = started.state.game.currentSeat;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const acting = await api.request(path, {
    token: clients[actingSeat].token,
  });
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const action = acting.state.game.legalActions.find(
    (action) => action.type === "discard",
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.ok(action, "the new game should allow a discard");
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const moved = await api.request(`${path}/action`, {
    method: "POST",
    token: clients[actingSeat].token,
    body: {
      revision: acting.state.revision,
      action: {
        type: "discard",
        tile: acting.state.game.players[actingSeat].hand[0],
      },
      preferredCharacter: "sunny",
      characters: ["sunny", "sunny", "sunny"],
    },
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(moved.status, 200, JSON.stringify(moved));
  assert.deepEqual(moved.state.game.characters, characters);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const left = await api.request(`${path}/leave`, {
    method: "POST",
    token: clients[1].token,
    body: {},
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(left.detached, true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const resumed = await api.request(`${path}/resume`, {
    method: "POST",
    token: clients[1].token,
    body: {},
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(resumed.status, 200);
  assert.deepEqual(resumed.state.game.characters, characters);
  assert.equal(resumed.state.seats[1].preferredCharacter, "sweet");
  assert.equal(resumed.state.seats[1].characterId, characters[1]);
  assert.equal(resumed.state.game.id, started.state.game.id);
});
// 场景：大厅释放的座位不再占用其偏好角色
// Scenario: a released lobby seat does not reserve its preferred character
test("a released lobby seat does not reserve its preferred character", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const api = apiHarness();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const { path, clients, host } = await table(api, [
    "sweet",
    "elegant",
    "sunny",
  ]);
  await api.request(`${path}/leave`, {
    method: "POST",
    token: clients[1].token,
    body: {},
  });
  const replacement = await api.request(`${path}/join`, {
    method: "POST",
    body: {
      name: "新玩家",
      preferredCharacter: "sweet",
    },
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(replacement.status, 201);
  assert.equal(replacement.state.you, 1);
  assert.equal(replacement.state.seats[1].preferredCharacter, "sweet");
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const started = await api.request(`${path}/start`, {
    method: "POST",
    token: host.token,
    body: {
      revision: replacement.state.revision,
    },
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(started.status, 200);
  assertDistinct(started.state.game.characters);
  assert.equal(started.state.game.characters[2], "sunny");
  assert.ok([0, 1].includes(started.state.game.characters.indexOf("sweet")));
});
// 场景：已结束牌局的替补玩家不继承旧角色，下一局按当前偏好分配
// Scenario: finished-game replacements do not inherit old characters and the next game uses current preferences
test("finished-game replacements do not inherit old characters and the next game uses current preferences", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const api = apiHarness();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const { path, clients, host, state } = await table(api, [
    "sweet",
    "elegant",
    "sunny",
  ]);
  const started = await api.request(`${path}/start`, {
    method: "POST",
    token: host.token,
    body: {
      revision: state.revision,
    },
  });
  const room = await api.store.get(host.roomId);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  room.game.phase = "finished";
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await api.store.compareAndSwap(room, room.revision);
  await api.request(`${path}/leave`, {
    method: "POST",
    token: clients[1].token,
    body: {},
  });
  const replacement = await api.request(`${path}/join`, {
    method: "POST",
    body: {
      name: "新玩家",
      preferredCharacter: "sweet",
    },
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(replacement.status, 201);
  assert.equal(replacement.state.seats[1].characterId, null);
  assert.equal(replacement.state.seats[1].isCurrentParticipant, false);
  assert.deepEqual(
    replacement.state.game.characters,
    started.state.game.characters,
  );
  assert.ok(
    replacement.state.game.players.every((player) => !("hand" in player)),
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const restarted = await api.request(`${path}/start`, {
    method: "POST",
    token: host.token,
    body: {
      revision: replacement.state.revision,
    },
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(restarted.status, 200);
  assert.notEqual(restarted.state.game.id, started.state.game.id);
  assertDistinct(restarted.state.game.characters);
  assert.equal(restarted.state.game.characters[2], "sunny");
  assert.equal(restarted.state.seats[1].isCurrentParticipant, true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const persisted = await api.store.get(host.roomId);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(
    persisted.archivedGames[0].meta.characters,
    started.state.game.characters,
  );
});
// 场景：旧版进行中牌局仅获得视图层回退，不改变已保存规则或状态
// Scenario: legacy live games receive only a view fallback without changing stored rules or state
test("legacy live games receive only a view fallback without changing stored rules or state", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const api = apiHarness();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const { path, clients, host } = await table(api, [null, null, null]);
  const room = await api.store.get(host.roomId);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  room.game = createLegacyGame({
    seed: 42,
  });
  // 逐项覆盖 room.seats；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in room.seats with the same checks, preserving the listed order.
  for (const person of room.seats) delete person.preferredCharacter;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await api.store.compareAndSwap(room, room.revision);
  const original = await api.store.get(host.roomId);
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  for (let seat = 0; seat < 3; seat++) {
    const view = await api.request(path, {
      token: clients[seat].token,
    });
    assert.equal(view.status, 200);
    assert.deepEqual(view.state.game.characters, CHARACTER_IDS);
    assert.deepEqual(
      view.state.seats.map((person) => person.characterId),
      CHARACTER_IDS,
    );
    assert.deepEqual(
      view.state.seats.map((person) => person.preferredCharacter),
      [null, null, null],
    );
    assert.equal(view.state.game.schemaVersion, 1);
    assertPrivate(view.state, room, seat, clients);
  }
  assert.deepEqual(await api.store.get(host.roomId), original);
});
// 场景：并发开局只提交一次角色分配，过期请求重试不能重新随机
// Scenario: concurrent starts commit only one assignment and stale retries cannot reroll it
test("concurrent starts commit only one assignment and stale retries cannot reroll it", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const api = apiHarness();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const { path, host, state } = await table(api, [null, null, null]);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  // 发送本场景指定的请求并读取响应；token 是测试凭证，body 决定请求负载，错误由调用处验证。
  // Send the scenario request and read its response; token is a test credential, body is its payload, and callers verify errors.
  const request = () =>
    api.request(`${path}/start`, {
      method: "POST",
      token: host.token,
      body: {
        revision: state.revision,
      },
    });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const responses = await Promise.all([request(), request()]);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [200, 409],
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const winner = responses.find((response) => response.status === 200);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const retry = await request();
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(retry.status, 409);
  assert.equal(retry.code, "STALE_STATE");
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const view = await api.request(path, {
    token: host.token,
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(view.state.game.characters, winner.state.game.characters);
  assert.equal(view.state.game.id, winner.state.game.id);
});
// 场景：角色偏好和角色映射在真实文件存储重启后保留
// Scenario: preferences and character mapping survive a real file-store restart
test("preferences and character mapping survive a real file-store restart", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const directory = await mkdtemp(join(tmpdir(), "mahjong-characters-"));
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  t.after(() =>
    rm(directory, {
      recursive: true,
      force: true,
    }),
  );
  const api = apiHarness(new FileStore(directory));
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const { path, host, clients, state } = await table(api, [
    "sunny",
    "sweet",
    "elegant",
  ]);
  const started = await api.request(`${path}/start`, {
    method: "POST",
    token: host.token,
    body: {
      revision: state.revision,
    },
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(started.status, 200);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const restarted = apiHarness(new FileStore(directory));
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  for (let seat = 0; seat < 3; seat++) {
    const view = await restarted.request(path, {
      token: clients[seat].token,
    });
    assert.equal(view.status, 200);
    assert.deepEqual(view.state.game.characters, ["sunny", "sweet", "elegant"]);
    assert.deepEqual(
      view.state.seats.map((person) => person.preferredCharacter),
      ["sunny", "sweet", "elegant"],
    );
    assert.deepEqual(
      view.state.seats.map((person) => person.characterId),
      ["sunny", "sweet", "elegant"],
    );
    assert.equal(view.state.game.id, started.state.game.id);
  }
});
