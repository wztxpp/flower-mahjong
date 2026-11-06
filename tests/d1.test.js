// 用内存 SQLite 模拟 D1 接口，验证 SQL 并发和凭证存储；不连接云数据库。
// An in-memory SQLite D1 adapter checks SQL concurrency and credential storage without a cloud database.
// 阅读说明见 docs/TESTING-READING-GUIDE.md；固定种子与凭证仅为测试，不应移入真实用户数据。
// See docs/TESTING-READING-GUIDE.md; seeded data and test credentials must stay separate from real user data.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { D1Store } from "../server/store.js";
import { createApi } from "../server/api.js";
import { createServer } from "node:http";
import { apiMiddleware } from "../server/node.js";
import { createGame, assertGameInvariants } from "../shared/v2-game.js";
// 用 :memory: SQLite 实现测试所需的 D1 prepare/bind/first/run 接口；记录 SQL 以检查读写次数。
// Implement the required D1 prepare/bind/first/run surface over :memory: SQLite, recording SQL for read/write-count checks.
function sqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  const statements = [];
  sqlite.exec(
    "CREATE TABLE mahjong_rooms (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL, updated_at INTEGER NOT NULL)",
  );
  return {
    statements,
    close: () => sqlite.close(),
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              statements.push({
                kind: "read",
                sql,
              });
              return sqlite.prepare(sql).get(...values) || null;
            },
            async run() {
              statements.push({
                kind: "write",
                sql,
              });
              const result = sqlite.prepare(sql).run(...values);
              return {
                meta: {
                  changes: Number(result.changes),
                },
              };
            },
          };
        },
      };
    },
  };
}
// 场景：D1 SQL 适配器强制执行修订号比较并交换及并发座位上限
// Scenario: D1 SQL adapter enforces revision CAS and concurrent seat limit
test("D1 SQL adapter enforces revision CAS and concurrent seat limit", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const db = sqliteD1(),
    store = new D1Store(db),
    api = createApi(store);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  // 发送本场景指定的请求并读取响应；token 是测试凭证，body 决定请求负载，错误由调用处验证。
  // Send the scenario request and read its response; token is a test credential, body is its payload, and callers verify errors.
  const request = async (path, data, token) => {
    const r = await api(
      new Request(`https://test.local${path}`, {
        method: data ? "POST" : "GET",
        headers: {
          ...(data
            ? {
                "Content-Type": "application/json",
              }
            : {}),
          ...(token
            ? {
                Authorization: `Bearer ${token}`,
              }
            : {}),
        },
        ...(data
          ? {
              body: JSON.stringify(data),
            }
          : {}),
      }),
    );
    return {
      status: r.status,
      body: await r.json(),
    };
  };
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  try {
    const created = await request("/api/rooms", {
      name: "东家",
    });
    assert.equal(created.status, 201);
    const { id } = created.body.state;
    const first = await request(`/api/rooms/${id}/join`, {
      name: "南家",
    });
    assert.equal(first.status, 201);
    const contenders = await Promise.all(
      ["西家", "后来者"].map((name) =>
        request(`/api/rooms/${id}/join`, {
          name,
        }),
      ),
    );
    assert.equal(contenders.filter((r) => r.status === 201).length, 1);
    assert.equal(contenders.filter((r) => r.status === 409).length, 1);
    const room = await store.get(id);
    assert.equal(room.seats.filter(Boolean).length, 3);
    assert.equal(room.revision, 2);
    const old = structuredClone(room);
    old.revision = 3;
    assert.equal(await store.compareAndSwap(old, 1), false);
    const auth = await request(
      `/api/rooms/${id}`,
      undefined,
      created.body.token,
    );
    assert.equal(auth.status, 200);
    assert.ok(
      (await store.get(id)).seats[0].lastSeen >= room.seats[0].lastSeen,
    );
    const started = await request(
      `/api/rooms/${id}/start`,
      {
        revision: 2,
      },
      created.body.token,
    );
    assert.equal(started.status, 200);
    assert.equal(
      started.body.state.game.players.filter((p) => p.hand).length,
      1,
    );
  } finally {
    // 无论断言成功还是失败都执行清理，避免数据库、服务或全局替身泄漏到后续测试。
    // Clean up whether assertions pass or fail, preventing database/server/global substitutes leaking into later tests.
    db.close();
  }
});
// 场景：D1 保存牌局状态时不保存明文座位凭证
// Scenario: D1 stores game state without plaintext seat credentials
test("D1 stores game state without plaintext seat credentials", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const db = sqliteD1(),
    store = new D1Store(db),
    api = createApi(store);
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  try {
    const response = await api(
      new Request("https://test.local/api/rooms", {
        method: "POST",
        body: JSON.stringify({
          name: "测试",
        }),
      }),
    );
    const data = await response.json();
    const record = await store.get(data.roomId);
    assert.equal(JSON.stringify(record).includes(data.token), false);
    assert.match(record.seats[0].tokenHash, /^[a-f0-9]{64}$/);
  } finally {
    // 无论断言成功还是失败都执行清理，避免数据库、服务或全局替身泄漏到后续测试。
    // Clean up whether assertions pass or fail, preventing database/server/global substitutes leaking into later tests.
    db.close();
  }
});
// 场景：D1 未变化轮询只执行一次 SELECT，对 json_set 心跳写入限流，并保持牌局字节不变
// Scenario: D1 unchanged polls do exactly one SELECT, throttle json_set heartbeat writes, and retain game bytes
test("D1 unchanged polls do exactly one SELECT, throttle json_set heartbeat writes, and retain game bytes", async () => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const db = sqliteD1();
  const store = new D1Store(db);
  const api = createApi(store);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  // 发送本场景指定的请求并读取响应；token 是测试凭证，body 决定请求负载，错误由调用处验证。
  // Send the scenario request and read its response; token is a test credential, body is its payload, and callers verify errors.
  const request = async (path, body, token) => {
    const response = await api(
      new Request(`https://test.local${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          ...(token
            ? {
                authorization: `Bearer ${token}`,
              }
            : {}),
        },
        ...(body
          ? {
              body: JSON.stringify(body),
            }
          : {}),
      }),
    );
    return {
      status: response.status,
      body: await response.json(),
    };
  };
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  try {
    const created = await request("/api/rooms", {
      name: "SQL合成东",
    });
    const id = created.body.roomId;
    const token = created.body.token;
    const before = await store.get(id);
    const gameBytes = JSON.stringify(before.game);
    db.statements.length = 0;
    const same = await request(`/api/rooms/${id}?since=0`, undefined, token);
    assert.deepEqual(same.body, {
      unchanged: true,
      revision: 0,
      connections: [true, false, false],
    });
    assert.equal(db.statements.length, 1);
    assert.equal(db.statements[0].kind, "read");
    assert.match(db.statements[0].sql, /^SELECT state/);
    before.seats[0].lastSeen = Date.now() - 11000;
    assert.equal(await store.compareAndSwap(before, before.revision), true);
    db.statements.length = 0;
    const reconnected = await request(
      `/api/rooms/${id}?since=0`,
      undefined,
      token,
    );
    assert.equal(reconnected.status, 200);
    assert.equal(
      db.statements.filter((statement) => statement.kind === "read").length,
      1,
    );
    assert.equal(
      db.statements.filter((statement) => statement.kind === "write").length,
      1,
    );
    assert.match(
      db.statements.find((statement) => statement.kind === "write").sql,
      /json_set/,
    );
    db.statements.length = 0;
    await request(`/api/rooms/${id}?since=0`, undefined, token);
    assert.equal(db.statements.length, 1);
    assert.equal(db.statements[0].kind, "read");
    const after = await store.get(id);
    assert.equal(after.revision, before.revision);
    assert.equal(JSON.stringify(after.game), gameBytes);
    db.statements.length = 0;
    const denied = await request(
      `/api/rooms/${id}?since=0`,
      undefined,
      "0".repeat(64),
    );
    assert.equal(denied.status, 401);
    assert.equal(
      db.statements.filter((statement) => statement.kind === "write").length,
      0,
    );
  } finally {
    // 无论断言成功还是失败都执行清理，避免数据库、服务或全局替身泄漏到后续测试。
    // Clean up whether assertions pass or fail, preventing database/server/global substitutes leaking into later tests.
    db.close();
  }
});
// 场景：两个独立 D1 API 处理器与三个真实 HTTP 客户端确保胡牌、积分和萝卜仅生效一次
// Scenario: two independent API handlers over D1 and three real HTTP clients apply hu/score/radishes exactly once
test("two independent API handlers over D1 and three real HTTP clients apply hu/score/radishes exactly once", async (t) => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const db = sqliteD1();
  const store = new D1Store(db);
  // Separate handlers model two worker isolates with the shared SQL CAS as the
  // only concurrency guard. Requests use real sockets, not direct engine calls.
  const handlers = [
    apiMiddleware(new D1Store(db)),
    apiMiddleware(new D1Store(db)),
  ];
  let sequence = 0;
  const server = createServer((request, response) =>
    handlers[sequence++ % 2](request, response),
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
    db.close();
  });
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const origin = `http://127.0.0.1:${server.address().port}`;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  // 发送本场景指定的请求并读取响应；token 是测试凭证，body 决定请求负载，错误由调用处验证。
  // Send the scenario request and read its response; token is a test credential, body is its payload, and callers verify errors.
  async function request(path, body, token) {
    const response = await fetch(`${origin}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        ...(token
          ? {
              authorization: `Bearer ${token}`,
            }
          : {}),
      },
      ...(body
        ? {
            body: JSON.stringify(body),
          }
        : {}),
    });
    return {
      status: response.status,
      body: await response.json(),
    };
  }
  const created = await request("/api/rooms", {
    name: "SQL合成东",
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(created.status, 201);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const id = created.body.roomId;
  const tokens = [created.body.token];
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  // 逐项覆盖 ['SQL合成南','SQL合成西']；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in ['SQL合成南','SQL合成西'] with the same checks, preserving the listed order.
  for (const name of ["SQL合成南", "SQL合成西"]) {
    const answer = await request(`/api/rooms/${id}/join`, {
      name,
    });
    assert.equal(answer.status, 201);
    tokens.push(answer.body.token);
  }
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const started = await request(
    `/api/rooms/${id}/start`,
    {
      revision: 2,
    },
    tokens[0],
  );
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(started.status, 200);
  assert.equal(started.body.state.game.schemaVersion, 3);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const room = await store.get(id);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const game = createGame({
    seed: "SQL-hu-fixture",
  });
  const waiting = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];
  game.players.forEach((player, seat) => {
    player.hand = seat === 0 ? [...waiting, 17] : [...waiting];
  });
  game.lastDraw = {
    seat: 0,
    tile: 17,
    source: "initial",
  };
  // 十八种牌，每种八张。先登记所有已分配牌，再把余量填入牌墙；不能凭空增加牌。
  // There are eighteen kinds with eight copies each. Debit allocated tiles, then place remaining copies in the wall.
  const counts = Array(18).fill(8);
  game.players.forEach((player) =>
    player.hand.forEach((tile) => counts[tile]--),
  );
  const head = [15, 8];
  const tail = [6, 6, 7, 7, 8, 8];
  [...head, ...tail].forEach((tile) => counts[tile]--);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.ok(counts.every((count) => count >= 0));
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  game.wall = [
    ...head,
    ...counts.flatMap((count, tile) => Array(count).fill(tile)),
    ...tail,
  ];
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  room.game = game;
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(await store.compareAndSwap(room, room.revision), true);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const action = {
    revision: room.revision,
    action: {
      type: "hu",
    },
  };
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const answers = await Promise.all([
    request(`/api/rooms/${id}/action`, action, tokens[0]),
    request(`/api/rooms/${id}/action`, action, tokens[0]),
  ]);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.deepEqual(answers.map((answer) => answer.status).sort(), [200, 409]);
  assert.equal(
    answers.find((answer) => answer.status === 409).body.code,
    "STALE_STATE",
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const reconnectHandlers = tokens.map((token) =>
    request(`/api/rooms/${id}`, undefined, token),
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const views = await Promise.all(reconnectHandlers);
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  for (let seat = 0; seat < 3; seat++) {
    const state = views[seat].body.state;
    assert.equal(state.revision, room.revision + 1);
    assert.equal(state.game.players[0].huCount, 1);
    assert.equal(state.game.players[0].radishes.length, 6);
    assert.deepEqual(
      state.game.players.map((player) => player.score),
      [2, -1, -1],
    );
    assert.equal(
      state.game.players[seat].hand.length,
      state.game.players[seat].handCount,
    );
    state.game.players.forEach((player, index) => {
      // 只处理目标座位之外的其他玩家，避免在调整对手时覆盖当前玩家。
      // Handle only other seats, avoiding overwriting the selected player while adjusting opponents.
      if (index !== seat) assert.equal("hand" in player, false);
    });
    assert.equal(
      state.game.history.filter((event) => event.type === "hu").length,
      1,
    );
    // 逐项覆盖 tokens；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in tokens with the same checks, preserving the listed order.
    for (const token of tokens)
      assert.equal(JSON.stringify(state).includes(token), false);
  }
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const stored = await store.get(id);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assertGameInvariants(stored.game);
  assert.equal(stored.revision, room.revision + 1);
  assert.equal(stored.game.players[0].winPile.length, 1);
  assert.equal(
    (await request(`/api/rooms/${id}/action`, action, tokens[0])).status,
    409,
  );
});
