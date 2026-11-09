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
  LEGACY_CHARACTER_IDS,
  SEAT_COUNT,
  assignCharacters,
  assignSeatCharacter,
  seatCharacters,
  gameCharacters,
  preferredCharacter,
} from "../shared/character-assignment.js";
import { createApi } from "../server/api.js";
import { engineFor } from "../server/game-engines.js";
import { MemoryStore } from "../server/store.js";
import { FileStore } from "../server/node.js";
import { createGame as createLegacyGame } from "../shared/legacy-game.js";
import { createGame as createV2Game } from "../shared/v2-game.js";
import { createGame as createCurrentGame } from "../shared/game.js";
// 验证三个座位的角色分配没有重复；偏好冲突不能让两位玩家共享同一角色。
// Verify distinct assignments across three seats; conflicting preferences must not duplicate a character.
function assertDistinct(characters, seatCount = SEAT_COUNT) {
  assert.equal(characters.length, seatCount);
  assert.equal(new Set(characters).size, seatCount);
  assert.ok(characters.every((id) => CHARACTER_IDS.includes(id)));
}

// 场景：角色池七人不改变三人座位，保存映射只接受三个唯一合法 ID。
// Scenario: a seven-character roster does not expand seats; saved maps require three unique valid IDs.
test("seven-character roster stays separate from three-seat legacy mapping", () => {
  assert.equal(SEAT_COUNT, 3);
  assert.equal(CHARACTER_IDS.length, 7);
  assert.deepEqual(LEGACY_CHARACTER_IDS, ["sweet", "elegant", "sunny"]);
  assert.throws(() => assignCharacters(Array(7).fill(null)), TypeError);
  assert.throws(() => assignCharacters(Array(4).fill(null)), TypeError);
  assertDistinct(assignCharacters(Array(3), () => 0));
  assert.deepEqual(gameCharacters(["landlord", "honest", "wealthy"]), ["landlord", "honest", "wealthy"]);
  assert.deepEqual(gameCharacters(["star", "sunny", "sweet"]), ["star", "sunny", "sweet"]);
  for (const malformed of [CHARACTER_IDS, ["landlord", "landlord", "star"], ["star", "sweet"], ["star", , "sweet"]]) {
    assert.deepEqual(gameCharacters(malformed), LEGACY_CHARACTER_IDS);
  }
});

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
async function table(api, preferences = ["sweet", "sweet", "elegant"], options = {}) {
  const host = await api.request("/api/rooms", {
    method: "POST",
    body: {
      name: "东家",
      ...options,
      preferredCharacter: preferences[0],
    },
  });
  assert.equal(host.status, 201);
  const clients = [host];
  // 逐项覆盖 [1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [1,2] with the same checks, preserving the listed order.
  for (let seat = 1; seat < host.state.seats.length; seat++) {
    const result = await api.request(`/api/rooms/${host.roomId}/join`, {
      method: "POST",
      body: {
        name: `${seat}号玩家`,
        preferredCharacter: preferences[seat],
      },
    });
    assert.equal(result.status, 201);
    // 后加入的人不得改动已落座者的角色。
    // A later join must not change any existing occupant’s role.
    for (let previousSeat = 0; previousSeat < seat; previousSeat++) {
      assert.equal(result.state.seats[previousSeat].characterId, clients[previousSeat].state.seats[previousSeat].characterId);
    }
    clients.push(result);
  }
  const path = `/api/rooms/${host.roomId}`;
  return {
    path,
    clients,
    host,
    state: clients.at(-1).state,
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
    () => assignCharacters([null, null, null], () => 7),
    RangeError,
  );
});
// 场景：全部 512 种角色偏好组合均分配不重复角色，并满足无竞争的指定偏好
// Scenario: all 512 preference combinations stay unique and honor uncontested requests
test("all 512 preference combinations stay unique and honor uncontested requests", () => {
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
// 场景：随机三人从七位角色等概率抽取；三人同好先公平选出一名赢家。
// Scenario: random seats draw uniformly from seven; three-way preference ties choose one fair winner.
test("random players and three-way conflicts yield equally likely assignments", () => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 逐项覆盖 [[null,null,null],...CHARACTER_IDS.map(id=>[id,id,id])]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [[null,null,null],...CHARACTER_IDS.map(id=>[id,id,id])] with the same checks, preserving the listed order.
  for (const preferences of [
    [null, null, null],
    ...CHARACTER_IDS.map((id) => [id, id, id]),
  ]) {
    const possibilities = outcomes(preferences);
    const expectedCount = preferences[0] === null ? 7 * 6 * 5 : 3 * 6 * 5;
    assert.equal(possibilities.size, expectedCount);
    // 逐项覆盖 possibilities.values()；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in possibilities.values() with the same checks, preserving the listed order.
    for (const probability of possibilities.values())
      assert.ok(Math.abs(probability - 1 / expectedCount) < 1e-12);
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
    assert.equal(possibilities.size, 10);
    // 逐项覆盖 possibilities；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in possibilities with the same checks, preserving the listed order.
    for (const [key, probability] of possibilities) {
      assert.equal(probability, 0.1);
      assert.equal(key.split(",")[preferences.indexOf("elegant")], "elegant");
    }
  }
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const possibilities = outcomes(["sunny", "sunny", null]);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(possibilities.size, 60);
  // 逐项覆盖 possibilities.values()；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in possibilities.values() with the same checks, preserving the listed order.
  for (const probability of possibilities.values())
    assert.ok(Math.abs(probability - 1 / 60) < 1e-12);
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
    assert.deepEqual(gameCharacters(invalid), LEGACY_CHARACTER_IDS);
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
  assert.ok(CHARACTER_IDS.includes(host.state.seats[0].characterId));
  assert.equal((await api.store.get(host.roomId)).seats[0].characterId, host.state.seats[0].characterId);
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
  assert.ok(CHARACTER_IDS.includes(joined.state.seats[1].characterId));
  assert.notEqual(joined.state.seats[1].characterId, host.state.seats[0].characterId);
});
// 场景：落座即确定角色，开局复制结果，并在动作与重连中保持角色和隐私。
// Scenario: seating fixes authoritative roles; start copies them, with stable identities/privacy through actions and reconnect.
test("assignment begins on seating and stays authoritative, private, and stable through start/actions/reconnect", async () => {
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
  const lobbyCharacters = lobby.seats.map((person) => person.characterId);
  assertDistinct(lobbyCharacters);
  assert.equal(lobbyCharacters[0], "sweet");
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
  assert.deepEqual(characters, lobbyCharacters);
  assert.equal(characters[0], "sweet");
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
// 场景：终局换人获得自己的落座角色，旧局快照不变，下一局延续当前占座映射。
// Scenario: replacements get their own seated role; the finished snapshot stays intact and the next game copies current occupancy.
test("finished-game replacements get stable seated characters without changing the previous game", async () => {
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
  assert.ok(CHARACTER_IDS.includes(replacement.state.seats[1].characterId));
  assert.notEqual(replacement.state.seats[1].characterId, "sweet");
  assert.deepEqual(replacement.state.seats.filter((person) => person.seat !== 1).map((person) => person.characterId), ["sweet", "sunny"]);
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
  assert.deepEqual(restarted.state.game.characters, replacement.state.seats.map((person) => person.characterId));
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
  for (const person of room.seats) {
    delete person.preferredCharacter;
    delete person.characterId;
  }
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
    assert.deepEqual(view.state.game.characters, LEGACY_CHARACTER_IDS);
    assert.deepEqual(
      view.state.seats.map((person) => person.characterId),
      LEGACY_CHARACTER_IDS,
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

// 场景：新增角色经过真实创建、加入、开局和读取接口，三人满桌仍拒绝第四人。
// Scenario: new IDs survive real create/join/start/read routes while a full table rejects a fourth player.
test("all four new preferences persist and never create a fourth seat", async () => {
  for (const preferences of [["landlord", "honest", "wealthy"], ["star", "elegant", "sweet"]]) {
    const api = apiHarness();
    const { path, host, clients, state } = await table(api, preferences);
    assert.equal(state.seats.length, 3);
    const fourth = await api.request(`${path}/join`, {
      method: "POST",
      body: { name: "第四位", preferredCharacter: "star" },
    });
    assert.equal(fourth.status, 409);
    const started = await api.request(`${path}/start`, {
      method: "POST", token: host.token, body: { revision: state.revision },
    });
    assert.equal(started.status, 200);
    assert.deepEqual(started.state.game.characters, preferences);
    for (let seat = 0; seat < SEAT_COUNT; seat++) {
      const result = await api.request(path, { token: clients[seat].token });
      assert.deepEqual(result.state.game.characters, preferences);
      assert.equal(result.state.game.players.length, 3);
      assertPrivate(result.state, await api.store.get(host.roomId), seat, clients);
    }
  }
});

// 场景：三个规则版本的旧数据在缺失/已有角色映射时只投影，不补写规则或历史。
// Scenario: all three saved engine versions project absent/existing maps without backfilling rules or history.
test("all engine versions preserve old character maps and saved bytes", async () => {
  for (const createGame of [createLegacyGame, createV2Game, createCurrentGame]) {
    for (const characters of [undefined, ["sunny", "sweet", "elegant"]]) {
      const api = apiHarness();
      const { path, host, state } = await table(api, ["landlord", "honest", "star"]);
      await api.request(`${path}/start`, {
        method: "POST", token: host.token, body: { revision: state.revision },
      });
      const room = await api.store.get(host.roomId);
      room.game = createGame({ seed: 42 });
      if (characters) room.gameMeta.characters = characters;
      else delete room.gameMeta.characters;
      await api.store.compareAndSwap(room, room.revision);
      const before = await api.store.get(host.roomId);
      const result = await api.request(path, { token: host.token });
      assert.equal(result.status, 200);
      assert.deepEqual(result.state.game.characters, characters || LEGACY_CHARACTER_IDS);
      assert.deepEqual(result.state.seats.map((person) => person.characterId), characters || LEGACY_CHARACTER_IDS,
        'a matching participant keeps the game’s visible identity even if occupant fields differ');
      assert.deepEqual(await api.store.get(host.roomId), before);
    }
  }
});

// 场景：显式四人参数只改变新调用，旧签名仍为三人；角色偏好与无重复继续成立。
// Scenario: an explicit fourth seat affects new calls only; the old signature stays three with unique preferences.
test("explicit four-seat assignment preserves three-seat defaults", () => {
  const mapping = ["landlord", "honest", "wealthy", "star"];
  assert.deepEqual(assignCharacters(mapping, () => 0, 4), mapping);
  assert.deepEqual(gameCharacters(mapping, 4), mapping);
  assert.deepEqual(gameCharacters(undefined, 4), ["sweet", "elegant", "sunny", "landlord"]);
  assert.deepEqual(gameCharacters(mapping), LEGACY_CHARACTER_IDS);
  assert.throws(() => assignCharacters(mapping), TypeError);
  for (const invalidCount of [0, 2, 5, 7, "4", null]) {
    assert.throws(() => assignCharacters(mapping, () => 0, invalidCount), TypeError);
    assert.throws(() => gameCharacters(mapping, invalidCount), TypeError);
  }
  // 穷举四座位的4096种偏好；固定选首候选，验证所有无竞争偏好与不重复约束。
  // Enumerate 4096 four-seat preferences with deterministic first-choice draws to check requests and uniqueness.
  const choices = [null, ...CHARACTER_IDS];
  for (const a of choices) for (const b of choices) for (const c of choices) for (const d of choices) {
    const preferences = [a, b, c, d];
    const assigned = assignCharacters(preferences, () => 0, 4);
    assert.equal(assigned.length, 4);
    assert.equal(new Set(assigned).size, 4);
    assert.ok(assigned.every((id) => CHARACTER_IDS.includes(id)));
    for (const id of CHARACTER_IDS) {
      const seat = preferences.indexOf(id);
      if (seat !== -1) assert.equal(assigned[seat], id);
    }
  }
});

// 场景：顺序落座先保留旧人，再处理新偏好；遍历三/四席全部偏好组合，随机选择只针对未占用角色。
// Scenario: sequential seating reserves existing roles before new preferences, covering every three/four-seat preference combination.
test('sequential assignments never displace existing roles or accept invalid random choices', () => {
  const options = [null, ...CHARACTER_IDS];
  for (const seatCount of [3, 4]) {
    for (let combination = 0; combination < options.length ** seatCount; combination++) {
      let remaining = combination;
      const assigned = [];
      for (let seat = 0; seat < seatCount; seat++) {
        const preference = options[remaining % options.length];
        remaining = Math.floor(remaining / options.length);
        const before = [...assigned];
        const character = assignSeatCharacter(preference, assigned, (size) => size - 1);
        assert.deepEqual(assigned, before, 'the helper does not mutate occupied IDs');
        if (preference && !assigned.includes(preference)) assert.equal(character, preference);
        assert.ok(!assigned.includes(character));
        assigned.push(character);
      }
      assertDistinct(assigned, seatCount);
    }
  }
  assert.throws(() => assignSeatCharacter('invalid', []), TypeError);
  assert.throws(() => assignSeatCharacter(null, CHARACTER_IDS), RangeError);
  for (const invalid of [-1, 7, 0.5, NaN]) {
    assert.throws(() => assignSeatCharacter(null, [], () => invalid), RangeError);
  }
  assert.equal(assignSeatCharacter('star', [], () => { throw Error('No draw needed'); }), 'star');
});

// 场景：旧大厅缺字段或有重复/非法角色时，只读兜底保持确定性、合法性与空座，不改原对象。
// Scenario: missing/duplicate/invalid legacy lobby roles get deterministic valid read-only fallbacks without filling vacancies.
test('legacy occupancy mapping reserves saved roles before preferences and repairs invalid entries read-only', () => {
  const seats = [{ characterId: 'sunny' }, { preferredCharacter: 'sunny' }, { characterId: 'invalid', preferredCharacter: 'star' }, null];
  const original = structuredClone(seats);
  assert.deepEqual(seatCharacters(seats), ['sunny', 'elegant', 'star', null]);
  assert.deepEqual(seatCharacters(seats), seatCharacters(seats));
  assert.deepEqual(seats, original);
  assert.deepEqual(seatCharacters([{ preferredCharacter: 'star' }, { characterId: 'star' }, { characterId: 'star' }]),
    ['sweet', 'star', 'sunny']);
  assert.deepEqual(seatCharacters([null, {}, {}, {}]), [null, 'elegant', 'sunny', 'landlord']);
  assert.throws(() => seatCharacters([{}, {}]), TypeError);
});

const CHARACTER_TABLE_MODES = [
  { name: 'Flower three-seat', options: { gameMode: 'flower', settings: { playerCount: 3, deckCount: 1 } } },
  { name: 'Flower four-seat', options: { gameMode: 'flower', settings: { playerCount: 4, deckCount: 1 } } },
  { name: 'Chengdu four-seat', options: { gameMode: 'chengdu', settings: { endCondition: 'bloodBattle', exchangeThree: true, selfDraw: 'addBase', fanCap: 4 } } },
];

// 只在合成存储推进合法动作到真实终局；不手工伪造 finished、牌墙、规则或分数。
// Advance legal engine actions only in synthetic storage to a genuine finish, without fabricating phase/wall/rules/scores.
async function finishCharacterTable(api, roomId) {
  const room = await api.store.get(roomId);
  for (let step = 0; step < 800 && room.game.phase !== 'finished'; step++) {
    const engine = engineFor(room.game);
    let choice;
    for (let seat = 0; seat < room.seats.length && !choice; seat++) {
      const actions = engine.view(room.game, seat).legalActions;
      const action = actions.find((entry) => entry.type === 'pass') || actions.find((entry) => entry.type === 'discard') || actions[0];
      if (action) choice = { seat, action };
    }
    assert.ok(choice, 'An active synthetic game exposes a legal action');
    room.game = engine.apply(room.game, choice.seat, choice.action);
  }
  assert.equal(room.game.phase, 'finished');
  assert.equal(await api.store.compareAndSwap(room, room.revision), true);
  return room;
}

// 场景：随机/冲突偏好经过落座、重启、开局、观战、离席重连、真实终局和续局都保持同一身份。
// Scenario: random/conflicting preferences keep identity through seating/restart/start/spectating/reconnect/legal finish/next game.
for (const { name, options } of CHARACTER_TABLE_MODES) {
  for (const preference of [null, 'sweet']) {
    test(`${name}: ${preference ?? 'random'} seated characters survive FileStore reload and every round boundary`, async (t) => {
      const directory = await mkdtemp(join(tmpdir(), 'mahjong-seat-identity-'));
      t.after(() => rm(directory, { recursive: true, force: true }));
      let api = apiHarness(new FileStore(directory));
      const { path, host, clients, state } = await table(api, Array(4).fill(preference), options);
      const characters = state.seats.map((person) => person.characterId);
      assertDistinct(characters, clients.length);
      if (preference) assert.equal(characters[0], preference);
      api = apiHarness(new FileStore(directory));
      const lobby = await api.request(path, { token: host.token });
      assert.equal(lobby.state.game, null);
      assert.deepEqual(lobby.state.seats.map((person) => person.characterId), characters);
      const resumedLobby = await api.request(`${path}/resume`, { method: 'POST', token: host.token, body: {} });
      assert.deepEqual(resumedLobby.state.seats.map((person) => person.characterId), characters);
      const started = await api.request(`${path}/start`, { method: 'POST', token: host.token, body: { revision: resumedLobby.state.revision } });
      assert.equal(started.status, 200);
      assert.deepEqual(started.state.game.characters, characters);
      const beforeReconnect = await api.store.get(host.roomId);
      const spectator = await api.request(`${path}/spectate`, { method: 'POST', body: {} });
      assert.deepEqual(spectator.state.game.characters, characters);
      assert.ok(spectator.state.game.players.every((person) => !('hand' in person)));
      const left = await api.request(`${path}/leave`, { method: 'POST', token: clients[1].token, body: {} });
      assert.equal(left.detached, true);
      api = apiHarness(new FileStore(directory));
      const resumed = await api.request(`${path}/resume`, { method: 'POST', token: clients[1].token, body: {} });
      assert.equal(resumed.status, 200);
      assert.deepEqual(resumed.state.game.characters, characters);
      assert.deepEqual((await api.store.get(host.roomId)).game, beforeReconnect.game, 'reconnect preserves rules, hidden tiles and scores');
      for (let seat = 0; seat < clients.length; seat++) {
        const view = await api.request(path, { token: clients[seat].token });
        assert.deepEqual(view.state.seats.map((person) => person.characterId), characters);
        assertPrivate(view.state, beforeReconnect, seat, clients);
      }
      const finished = await finishCharacterTable(api, host.roomId);
      api = apiHarness(new FileStore(directory));
      const next = await api.request(`${path}/start`, { method: 'POST', token: host.token, body: { revision: finished.revision } });
      assert.equal(next.status, 200, JSON.stringify(next));
      assert.notEqual(next.state.game.id, started.state.game.id);
      assert.deepEqual(next.state.game.characters, characters);
      const saved = await api.store.get(host.roomId);
      assert.deepEqual(saved.seats.map((person) => person.characterId), characters);
      assert.deepEqual(saved.archivedGames[0].meta.characters, characters);
      assert.deepEqual(saved.game.rules, finished.game.rules);
      assert.equal(saved.archivedGames.length, 1);
    });
  }
}

// 场景：旧大厅读时不迁移，任一落座变更都先固定原显示结果，离席者的角色才可以被复用。
// Scenario: legacy lobby reads do not migrate; occupancy changes freeze existing visible roles before a released role is reused.
test('legacy lobby reads, joins and leaves keep existing identities and freeze them before start', async () => {
  const api = apiHarness();
  const { path, host, clients } = await table(api, ['star', 'sweet', 'sunny']);
  const room = await api.store.get(host.roomId);
  for (const person of room.seats) delete person.characterId;
  room.seats[1].preferredCharacter = 'star';
  room.seats[2].preferredCharacter = 'unknown';
  await api.store.compareAndSwap(room, room.revision);
  const original = await api.store.get(host.roomId);
  const view = await api.request(path, { token: host.token });
  assert.deepEqual(view.state.seats.map((person) => person.characterId), ['star', 'elegant', 'sunny']);
  assert.deepEqual(await api.store.get(host.roomId), original);
  await api.request(`${path}/leave`, { method: 'POST', token: host.token, body: {} });
  const replacement = await api.request(`${path}/join`, { method: 'POST', body: { name: '替补', preferredCharacter: 'star', characterId: 'sunny' } });
  assert.equal(replacement.status, 201);
  const characters = replacement.state.seats.map((person) => person.characterId);
  assert.deepEqual(characters, ['star', 'elegant', 'sunny']);
  assert.equal((await api.store.get(host.roomId)).seats[1].characterId, 'elegant', 'departure does not upgrade the remaining duplicate preference');
  const started = await api.request(`${path}/start`, { method: 'POST', token: clients[1].token, body: { revision: replacement.state.revision } });
  assert.equal(started.status, 200);
  assert.deepEqual(started.state.game.characters, characters);
});

// 场景：旧局已保存/缺失/损坏映射都沿原公开结果续局，不用旧偏好再抽，不改旧规则或原元信息。
// Scenario: saved/missing/malformed old game maps continue from their original public identity, without rerolling preferences or rewriting old data.
for (const { name, options } of CHARACTER_TABLE_MODES) {
  test(`${name}: legacy game maps remain read-only and carry into the next round`, async () => {
    for (const mapping of [undefined, ['wealthy', 'landlord', 'honest', 'star'], ['bad', 'bad', 'sweet', 'sweet']]) {
      const api = apiHarness();
      const { path, host, state } = await table(api, ['star', 'sunny', 'sweet', 'elegant'], options);
      const started = await api.request(`${path}/start`, { method: 'POST', token: host.token, body: { revision: state.revision } });
      assert.equal(started.status, 200);
      const room = await api.store.get(host.roomId);
      for (const person of room.seats) delete person.characterId;
      if (mapping) room.gameMeta.characters = mapping.slice(0, room.seats.length);
      else delete room.gameMeta.characters;
      await api.store.compareAndSwap(room, room.revision);
      const original = await api.store.get(host.roomId);
      const view = await api.request(path, { token: host.token });
      const expected = gameCharacters(room.gameMeta.characters, room.seats.length);
      assert.deepEqual(view.state.game.characters, expected);
      assert.deepEqual(view.state.seats.map((person) => person.characterId), expected);
      assert.deepEqual(await api.store.get(host.roomId), original);
      const finished = await finishCharacterTable(api, host.roomId);
      const next = await api.request(`${path}/start`, { method: 'POST', token: host.token, body: { revision: finished.revision } });
      assert.equal(next.status, 200);
      assert.deepEqual(next.state.game.characters, expected);
      const saved = await api.store.get(host.roomId);
      assert.deepEqual(saved.archivedGames[0].meta, finished.gameMeta, 'character compatibility does not rewrite archived metadata');
      assert.deepEqual(saved.game.rules, finished.game.rules);
    }
  });
}

// 场景：同时抢座只提交一个新角色，输掉的候选不能改变已有占座者；失败开局也不能重抽。
// Scenario: racing joins commit only one new role; losing candidates and rejected starts cannot displace existing occupants.
test('concurrent seating and rejected starts preserve committed character assignments', async () => {
  const api = apiHarness();
  const host = await api.request('/api/rooms', { method: 'POST', body: { name: '房主', preferredCharacter: 'star' } });
  const path = `/api/rooms/${host.roomId}`;
  const joins = await Promise.all(['甲', '乙'].map((name) => api.request(`${path}/join`, {
    method: 'POST', body: { name, seat: 1, preferredCharacter: 'star', characterId: 'star' },
  })));
  assert.deepEqual(joins.map((response) => response.status).sort(), [201, 409]);
  const winner = joins.find((response) => response.status === 201);
  assert.equal(winner.state.seats[0].characterId, 'star');
  assert.notEqual(winner.state.seats[1].characterId, 'star');
  const before = await api.store.get(host.roomId);
  const denied = await api.request(`${path}/start`, { method: 'POST', token: host.token, body: { revision: before.revision } });
  assert.equal(denied.code, 'NOT_FULL');
  assert.deepEqual(await api.store.get(host.roomId), before);
});

// 场景：终局后换人只重新分配该占座身份，旧公开局仍按旧人显示，下一局和归档各自保留正确映射。
// Scenario: replacement changes only the occupant identity; the old public game, next game and archive retain their separate mappings.
for (const { name, options } of CHARACTER_TABLE_MODES) {
  test(`${name}: finished-game seat replacement cannot reroll other players or inherit private hands`, async () => {
    const api = apiHarness();
    const { path, host, clients, state } = await table(api, ['sweet', 'elegant', 'sunny', 'landlord'], options);
    const started = await api.request(`${path}/start`, { method: 'POST', token: host.token, body: { revision: state.revision } });
    assert.equal(started.status, 200);
    const characters = started.state.game.characters;
    const finished = await finishCharacterTable(api, host.roomId);
    const left = await api.request(`${path}/leave`, { method: 'POST', token: clients[1].token, body: {} });
    assert.equal(left.detached, false);
    const joined = await api.request(`${path}/join`, { method: 'POST', body: { name: '新占座者', preferredCharacter: 'star' } });
    assert.equal(joined.status, 201);
    const expected = characters.map((character, seat) => seat === 1 ? 'star' : character);
    assert.deepEqual(joined.state.seats.map((person) => person.characterId), expected);
    assert.deepEqual(joined.state.game.characters, characters);
    assert.equal(joined.state.seats[1].isCurrentParticipant, false);
    assert.ok(joined.state.game.players.every((person) => !('hand' in person)));
    assert.deepEqual((await api.store.get(host.roomId)).game, finished.game);
    const oldCredential = await api.request(`${path}/resume`, { method: 'POST', token: clients[1].token, body: {} });
    assert.equal(oldCredential.status, 401);
    const next = await api.request(`${path}/start`, { method: 'POST', token: host.token, body: { revision: joined.state.revision } });
    assert.equal(next.status, 200);
    assert.deepEqual(next.state.game.characters, expected);
    assert.deepEqual((await api.store.get(host.roomId)).archivedGames[0].meta.characters, characters);
  });
}

// 场景：向缺字段旧大厅直接加入前，须先固定已显示的兜底角色，不能让新偏好抢占已有显示。
// Scenario: joining a legacy lobby first freezes visible compatibility roles, so a new preference cannot steal an existing identity.
test('joining a legacy lobby freezes previously visible roles before resolving the new preference', async () => {
  const api = apiHarness();
  const { path, host } = await table(api, [null, null, null]);
  const room = await api.store.get(host.roomId);
  room.seats[2] = null;
  for (const person of room.seats.filter(Boolean)) delete person.characterId;
  await api.store.compareAndSwap(room, room.revision);
  const before = await api.request(path, { token: host.token });
  assert.deepEqual(before.state.seats.map((person) => person?.characterId ?? null), ['sweet', 'elegant', null]);
  const joined = await api.request(`${path}/join`, { method: 'POST', body: { name: '新玩家', preferredCharacter: 'sweet' } });
  assert.equal(joined.status, 201);
  assert.deepEqual(joined.state.seats.slice(0, 2).map((person) => person.characterId), ['sweet', 'elegant']);
  assertDistinct(joined.state.seats.map((person) => person.characterId));
});

// 新随机落座只用当前六角色；旧明确偏好与保存映射保持原身份，避免临时停用变成存档迁移。
// New random occupants use six active roles while explicit legacy requests and saved maps retain identity without migration.
test('new random seating omits paused sunny but preserves explicit legacy identity', () => {
  const choices = new Set();
  for (let index = 0; index < 6; index++) choices.add(assignSeatCharacter(null, [], () => index));
  assert.deepEqual([...choices].sort(), ['elegant', 'honest', 'landlord', 'star', 'sweet', 'wealthy']);
  assert.equal(assignSeatCharacter('sunny', []), 'sunny');
  assert.deepEqual(gameCharacters(['sunny', 'sweet', 'elegant']), ['sunny', 'sweet', 'elegant']);
});
