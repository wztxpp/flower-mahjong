// 真实本机 HTTP 请求的认证、并发版本、隐私与规则结算回归。
// Real loopback HTTP regression coverage for authentication, revision races, privacy and scoring.
// 阅读说明见 docs/TESTING-READING-GUIDE.md；固定种子与凭证仅为测试，不应移入真实用户数据。
// See docs/TESTING-READING-GUIDE.md; seeded data and test credentials must stay separate from real user data.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../server/store.js";
import { FileStore, apiMiddleware } from "../server/node.js";
import { createGame, assertGameInvariants } from "../shared/v2-game.js";
import {
  createGame as createLegacyGame,
  assertGameInvariants as assertLegacyInvariants,
} from "../shared/legacy-game.js";
import { postHuKongGame } from "./fixtures/post-hu-kong.js";

// Every player below owns an independently issued bearer credential and makes
// real HTTP requests. The only direct store writes are explicit game fixtures;
// no client is granted an endpoint that can set the wall, hand, or acting seat.
// 创建隔离的测试 API 环境；调用者提供存储时复用它以验证重启或并发，否则使用临时内存。
// Create an isolated API harness; an injected store enables restart/concurrency tests, otherwise use temporary memory.
async function harness(t, store = new MemoryStore()) {
  const server = createServer(apiMiddleware(store));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  // 发送本场景指定的请求并读取响应；token 是测试凭证，body 决定请求负载，错误由调用处验证。
  // Send the scenario request and read its response; token is a test credential, body is its payload, and callers verify errors.
  async function request(
    path,
    { method = "GET", body, token, headers = {}, rawBody } = {},
  ) {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        ...(body !== undefined || rawBody !== undefined
          ? {
              "content-type": "application/json",
            }
          : {}),
        ...(token === undefined
          ? {}
          : {
              authorization: `Bearer ${token}`,
            }),
        ...headers,
      },
      ...(rawBody !== undefined
        ? {
            body: rawBody,
          }
        : body !== undefined
          ? {
              body: JSON.stringify(body),
            }
          : {}),
    });
    return {
      status: response.status,
      body: await response.json(),
      headers: response.headers,
    };
  }
  return {
    origin,
    request,
    store,
  };
}
// 把一个房间凭证绑定为独立客户端；seat 是期望身份，服务器仍必须只信任 token。
// Bind a room credential to an independent client; seat describes the expected identity, but the server must trust only the token.
function client(api, roomId, token, seat) {
  return {
    roomId,
    token,
    seat,
    get: (since) =>
      api.request(
        `/api/rooms/${roomId}${since === undefined ? "" : `?since=${encodeURIComponent(since)}`}`,
        {
          token,
        },
      ),
    start: (revision) =>
      api.request(`/api/rooms/${roomId}/start`, {
        method: "POST",
        token,
        body: {
          revision,
        },
      }),
    action: (revision, action, extra = {}) =>
      api.request(`/api/rooms/${roomId}/action`, {
        method: "POST",
        token,
        body: {
          revision,
          action,
          ...extra,
        },
      }),
  };
}
// 调用创建房间接口并检查成功响应；返回新房间与独立座位凭证，供后续步骤使用。
// Create a room and verify success, returning its room and independent seat credential for subsequent steps.
async function createRoom(api, name = "东家") {
  const result = await api.request("/api/rooms", {
    method: "POST",
    body: {
      name,
    },
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  const { roomId, token, state } = result.body;
  return {
    roomId,
    state,
    host: client(api, roomId, token, state.you),
  };
}
// 提交加入指定房间的请求；保留接口结果以便测试成功、满员或无效输入。
// Submit a join request for the selected room and retain the response for success/full-room/invalid-input checks.
async function joinRoom(api, roomId, name, seat) {
  return api.request(`/api/rooms/${roomId}/join`, {
    method: "POST",
    body: {
      name,
      ...(seat === undefined
        ? {}
        : {
            seat,
          }),
    },
  });
}
// 建立三位独立玩家的测试桌；具体开局、偏好或存储条件由本文件参数决定。
// Build a three-player test table with the start, preference or storage conditions defined by this file’s parameters.
async function table(t, { store, start = true, seed } = {}) {
  const api = await harness(t, store);
  const { roomId, host } = await createRoom(api);
  const clients = [host];
  // 逐项覆盖 ['南家','西家']；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in ['南家','西家'] with the same checks, preserving the listed order.
  for (const name of ["南家", "西家"]) {
    const result = await joinRoom(api, roomId, name);
    assert.equal(result.status, 201, JSON.stringify(result.body));
    clients.push(client(api, roomId, result.body.token, result.body.state.you));
  }
  let state = (await host.get()).body.state;
  // 要求开局时才发开局请求，未开局桌用于座位和权限测试。
  // Send start only when requested; unstarted tables support seating/permission checks.
  if (start) {
    const result = await host.start(state.revision);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    state = result.body.state;
  }
  // 显式种子才覆盖牌局，避免默认场景无意变成固定牌墙。
  // Override the game only for an explicit seed, keeping the ordinary setup distinct.
  if (seed !== undefined) {
    assert.equal(start, true);
    const room = await api.store.get(roomId);
    room.game = createGame({
      seed,
    });
    assert.equal(await api.store.compareAndSwap(room, room.revision), true);
    state = (await host.get()).body.state;
  }
  return {
    ...api,
    roomId,
    host,
    clients,
    state,
  };
}
// 同时检查 HTTP 状态、业务错误码和可读错误信息，避免仅凭一个状态码误判通过。
// Check HTTP status, domain code and readable error text together rather than accepting a status alone.
function assertError(result, status, code) {
  assert.equal(result.status, status, JSON.stringify(result.body));
  assert.equal(result.body.code, code);
  assert.equal(typeof result.body.error, "string");
}
// 递归排查凭证和私有字段泄漏；只允许当前座位看到自己的手牌，公共事件不得含摸牌牌面。
// Recursively detect credentials/private fields; only the current seat may see its hand, and public draws must not reveal tile faces.
function assertPrivateView(state, seat, tokens = []) {
  assert.equal(state.you, seat);
  const serialized = JSON.stringify(state);
  // 逐项覆盖 tokens；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in tokens with the same checks, preserving the listed order.
  for (const secret of tokens)
    assert.equal(
      serialized.includes(secret),
      false,
      "a bearer token leaked into a snapshot",
    );
  // 递归检查对象的字段名；空值和基本类型直接结束，避免访问不存在的子对象。
  // Recursively inspect object keys, stopping at null or primitive values rather than descending into nonexistent children.
  function checkKeys(value) {
    // 空值和非对象是递归终点，不能继续枚举其字段。
    // Null and non-object values end recursion; do not enumerate their fields.
    if (!value || typeof value !== "object") return;
    // 逐项覆盖 Object.entries(value)；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in Object.entries(value) with the same checks, preserving the listed order.
    for (const [key, nested] of Object.entries(value)) {
      assert.equal(
        ["token", "tokenHash", "wall", "lastDraw"].includes(key),
        false,
        `private field ${key} leaked`,
      );
      checkKeys(nested);
    }
  }
  checkKeys(state);
  // 逐项覆盖 state.seats.filter(Boolean)；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in state.seats.filter(Boolean) with the same checks, preserving the listed order.
  for (const player of state.seats.filter(Boolean))
    assert.equal("hand" in player, false);
  // 大厅没有牌局时结束牌局隐私检查，避免访问不存在的手牌或历史。
  // Stop game-specific privacy checks in a lobby with no game.
  if (!state.game) return;
  assert.equal(state.game.mySeat, seat);
  // 逐项覆盖 state.game.players；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in state.game.players with the same checks, preserving the listed order.
  for (const player of state.game.players) {
    // 按座位区分本人的数据与其他玩家的数据；不能把测试视角当成公共权限。
    // Separate the selected seat’s data from other players’ data; the test viewpoint is not public permission.
    if (player.seat === seat) {
      assert.ok(Array.isArray(player.hand));
      assert.equal(player.hand.length, player.handCount);
    } else {
      assert.equal("hand" in player, false, "opponent hand leaked");
    }
    assert.equal(typeof player.score, "number");
    assert.ok(Array.isArray(player.melds));
  }
  // 不处于本人待打牌阶段就不能看到 drawnTile，避免泄漏他人的摸牌信息。
  // Hide drawnTile unless this viewer is the current discarding seat, preventing private-draw leakage.
  if (state.game.currentSeat !== seat || state.game.turnStep !== "discard")
    assert.equal(state.game.drawnTile, null);
  // 逐项覆盖 state.game.history.filter(event=>event.type==='draw')；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in state.game.history.filter(event=>event.type==='draw') with the same checks, preserving the listed order.
  for (const event of state.game.history.filter(
    (event) => event.type === "draw",
  )) {
    assert.equal(
      "tile" in event,
      false,
      "draw history revealed a private tile",
    );
    assert.equal("drawnTile" in event, false);
    assert.doesNotMatch(
      event.message,
      /[一二三四五六七八九1-9][条筒]/u,
      "draw message revealed a private tile",
    );
  }
}
// 并行读取三个独立视图，检查版本一致和各自隐私边界。
// Read three independent views concurrently, checking consistent revisions and per-seat privacy.
async function snapshots(clients) {
  const results = await Promise.all(clients.map((player) => player.get()));
  // 逐项覆盖 results；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in results with the same checks, preserving the listed order.
  for (const result of results)
    assert.equal(result.status, 200, JSON.stringify(result.body));
  const states = results.map((result) => result.body.state);
  assert.equal(
    new Set(states.map((state) => state.revision)).size,
    1,
    "clients disagree on room revision",
  );
  const tokens = clients.map((player) => player.token);
  states.forEach((state, seat) => assertPrivateView(state, seat, tokens));
  return states;
}
// 通过每位玩家自己的快照与最新 revision 过牌，验证反应窗不会重复要求同一玩家回应。
// Pass using each player’s own view and current revision, checking that a reaction window does not request duplicate responses.
async function passClaims(clients) {
  let states = await snapshots(clients);
  let passes = 0;
  // 持续推进场景直到 states[0].game.phase==='claim' 不再成立；循环内的动作/断言负责保证进展。
  // Advance while states[0].game.phase==='claim' holds; actions/assertions inside are responsible for progress.
  while (states[0].game.phase === "claim") {
    const seat = states.findIndex((state) =>
      state.game.legalActions.some((action) => action.type === "pass"),
    );
    assert.notEqual(seat, -1, "claim window has no remaining responder");
    const result = await clients[seat].action(states[seat].revision, {
      type: "pass",
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    passes++;
    assert.ok(passes <= 2, "a claim window requested a repeated response");
    states = await snapshots(clients);
  }
  return {
    states,
    passes,
  };
}
// 不用 Content-Length，逐块发送请求体，以验证服务端按实际字节限制负载。
// Send chunks without Content-Length to verify server limits against actual received bytes.
function chunkedRequest(api, chunks) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      `${api.origin}/api/rooms`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "transfer-encoding": "chunked",
        },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          try {
            resolve({
              status: response.statusCode,
              body: JSON.parse(body),
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on("error", reject);
    request.setTimeout(5000, () =>
      request.destroy(new Error("chunked request timed out")),
    );
    chunks.forEach((chunk) => request.write(chunk));
    request.end();
  });
}
// 场景：健康检查与 API 均返回不可缓存的 JSON，并受同源限制保护
// Scenario: health and API responses are JSON, non-cacheable, and same-origin protected
test("health and API responses are JSON, non-cacheable, and same-origin protected", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await harness(t);
  const healthy = await api.request("/api/health", {
    headers: {
      origin: api.origin,
    },
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(healthy.status, 200);
  assert.equal(healthy.body.ok, true);
  assert.equal(healthy.body.version, "0.7.0");
  assert.equal(healthy.body.rulesVersion, 3);
  assert.match(healthy.headers.get("content-type"), /application\/json/);
  assert.match(healthy.headers.get("cache-control"), /no-store/);
  assert.equal(healthy.headers.get("x-content-type-options"), "nosniff");
  assertError(
    await api.request("/api/health", {
      headers: {
        origin: "https://attacker.example",
      },
    }),
    403,
    "ORIGIN",
  );
  assertError(
    await api.request("/api/rooms", {
      method: "POST",
      body: {
        name: "跨站",
      },
      headers: {
        origin: "https://attacker.example",
      },
    }),
    403,
    "ORIGIN",
  );
  assert.equal(api.store.rooms.size, 0);
});
// 场景：只有显式启用代理信任时才采纳代理提供的 HTTPS 协议信息
// Scenario: HTTPS proxy scheme is honored only when explicit proxy trust is enabled
test("HTTPS proxy scheme is honored only when explicit proxy trust is enabled", async (t) => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const previous = process.env.TRUST_PROXY;
  t.after(() => {
    // 原来没有环境变量就删除测试设置；否则还原旧值，不留下字符串 undefined。
    // Delete a previously absent environment variable; otherwise restore its original value.
    if (previous === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previous;
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await harness(t);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const secureOrigin = api.origin.replace(/^http:/, "https:");
  delete process.env.TRUST_PROXY;
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  assertError(
    await api.request("/api/health", {
      headers: {
        origin: secureOrigin,
        "x-forwarded-proto": "https",
      },
    }),
    403,
    "ORIGIN",
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  process.env.TRUST_PROXY = "1";
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(
    (
      await api.request("/api/health", {
        headers: {
          origin: secureOrigin,
          "x-forwarded-proto": "https",
        },
      })
    ).status,
    200,
  );
  assertError(
    await api.request("/api/health", {
      headers: {
        origin: "https://attacker.example",
        "x-forwarded-proto": "https",
      },
    }),
    403,
    "ORIGIN",
  );
  assertError(
    await api.request("/api/health", {
      headers: {
        origin: api.origin,
        "x-forwarded-proto": "https",
      },
    }),
    403,
    "ORIGIN",
  );
});
// 场景：昵称先规范化、限制长度，再检查规范化后的重名冲突
// Scenario: names are normalized, bounded, and checked for collisions after normalization
test("names are normalized, bounded, and checked for collisions after normalization", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await harness(t);
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  // 逐项覆盖 [undefined,null,42,{},'','   ','a'.repeat(17),'甲\u0000乙','甲\u200b乙']；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [undefined,null,42,{},'','   ','a'.repeat(17),'甲\u0000乙','甲\u200b乙'] with the same checks, preserving the listed order.
  for (const name of [
    undefined,
    null,
    42,
    {},
    "",
    "   ",
    "a".repeat(17),
    "甲\u0000乙",
    "甲\u200b乙",
  ]) {
    assertError(
      await api.request("/api/rooms", {
        method: "POST",
        body: {
          name,
        },
      }),
      400,
      "BAD_NAME",
    );
  }
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const { roomId, state } = await createRoom(api, "  e\u0301  ");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(state.seats[0].name, "é");
  assertError(await joinRoom(api, roomId, "é"), 409, "NAME_TAKEN");
  assertError(await joinRoom(api, roomId, "\n"), 400, "BAD_NAME");
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const joined = await joinRoom(api, roomId, "😀".repeat(16));
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(
    joined.status,
    201,
    "name bounds should count Unicode characters, not UTF-16 code units",
  );
  assert.equal(joined.body.state.seats[1].name, "😀".repeat(16));
});
// 场景：房间凭证彼此独立且不可推测，持久化时只保存哈希
// Scenario: room credentials are independent, opaque, and stored only as hashes
test("room credentials are independent, opaque, and stored only as hashes", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await harness(t);
  const first = await createRoom(api, "一");
  const second = await createRoom(api, "二");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.match(first.roomId, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.notEqual(first.roomId, second.roomId);
  assert.match(first.host.token, /^[a-f0-9]{64}$/);
  assert.notEqual(first.host.token, second.host.token);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const stored = await api.store.get(first.roomId);
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  assert.notEqual(stored.seats[0].tokenHash, first.host.token);
  assert.equal(JSON.stringify(stored).includes(first.host.token), false);
  assertPrivateView(first.state, 0, [first.host.token]);
  assertError(
    await api.request(`/api/rooms/${first.roomId}`, {
      token: second.host.token,
    }),
    401,
    "UNAUTHORIZED",
  );
});
// 场景：Node 客户端不能伪造 Cloudflare IP 请求头绕过建房限流
// Scenario: Node clients cannot bypass room creation throttling with a forged Cloudflare IP header
test("Node clients cannot bypass room creation throttling with a forged Cloudflare IP header", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await harness(t);
  for (let i = 0; i < 10; i++) await createRoom(api, `建房${i}`);
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  assertError(
    await api.request("/api/rooms", {
      method: "POST",
      body: {
        name: "超限",
      },
    }),
    429,
    "RATE_LIMIT",
  );
  assertError(
    await api.request("/api/rooms", {
      method: "POST",
      body: {
        name: "伪造来源",
      },
      headers: {
        "cf-connecting-ip": "198.51.100.42",
      },
    }),
    429,
    "RATE_LIMIT",
  );
  assert.equal(api.store.rooms.size, 10);
});
// 场景：格式错误或过大的请求体会被拒绝，且不会创建房间
// Scenario: malformed and oversized bodies are rejected without creating a room
test("malformed and oversized bodies are rejected without creating a room", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await harness(t);
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  // 逐项覆盖 ['{','[]','null','3','"name"']；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in ['{','[]','null','3','"name"'] with the same checks, preserving the listed order.
  for (const rawBody of ["{", "[]", "null", "3", '"name"']) {
    assertError(
      await api.request("/api/rooms", {
        method: "POST",
        rawBody,
      }),
      400,
      "BAD_JSON",
    );
  }
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assertError(
    await api.request("/api/rooms", {
      method: "POST",
      body: {
        name: "x",
        padding: "x".repeat(2050),
      },
    }),
    413,
    "TOO_LARGE",
  );
  assert.equal(api.store.rooms.size, 0);
});
// 场景：即使没有 Content-Length 请求头，分块请求体也受字节数上限约束
// Scenario: chunked bodies are limited by bytes even without a Content-Length header
test("chunked bodies are limited by bytes even without a Content-Length header", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await harness(t);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const unicode = JSON.stringify({
    name: "中文",
    padding: "字".repeat(800),
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.ok(unicode.length < 2048);
  assert.ok(Buffer.byteLength(unicode) > 2048);
  assertError(
    await chunkedRequest(api, [unicode.slice(0, 20), unicode.slice(20)]),
    413,
    "TOO_LARGE",
  );
  assert.equal(api.store.rooms.size, 0);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const valid = await chunkedRequest(api, ['{"name":', '"分块"}']);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(valid.status, 201);
  assert.equal(valid.body.state.seats[0].name, "分块");
});
// 场景：显式选座不能覆盖已有玩家或分配第四个座位
// Scenario: explicit seat choice cannot overwrite a player or allocate a fourth seat
test("explicit seat choice cannot overwrite a player or allocate a fourth seat", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await harness(t);
  const { roomId, host } = await createRoom(api);
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  assertError(await joinRoom(api, roomId, "占东", 0), 409, "SEAT_TAKEN");
  // 逐项覆盖 [-1,3,1.5,'1',null]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [-1,3,1.5,'1',null] with the same checks, preserving the listed order.
  for (const seat of [-1, 3, 1.5, "1", null])
    assertError(await joinRoom(api, roomId, "错误", seat), 409, "ROOM_FULL");
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const last = await joinRoom(api, roomId, "坐西", 2);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(last.status, 201);
  assert.equal(last.body.state.you, 2);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const middle = await joinRoom(api, roomId, "坐南", 1);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(middle.status, 201);
  assertError(await joinRoom(api, roomId, "第四位"), 409, "ROOM_FULL");
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const state = (await host.get()).body.state;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(
    state.seats.map((seat) => seat.name),
    ["东家", "坐南", "坐西"],
  );
});
// 场景：并发加入通过原子操作最多预留三个座位，失败客户端可安全重试
// Scenario: concurrent joins atomically reserve at most three seats and losing clients can retry safely
test("concurrent joins atomically reserve at most three seats and losing clients can retry safely", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await harness(t);
  const { roomId, host } = await createRoom(api);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const names = Array.from(
    {
      length: 8,
    },
    (_, i) => `客人${i}`,
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const attempts = await Promise.all(
    names.map((name) => joinRoom(api, roomId, name)),
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const accepted = attempts.filter((result) => result.status === 201);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.ok(accepted.length >= 1 && accepted.length <= 2);
  // 逐项覆盖 attempts.filter(result=>result.status!==201)；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in attempts.filter(result=>result.status!==201) with the same checks, preserving the listed order.
  for (const result of attempts.filter((result) => result.status !== 201))
    assert.equal(result.status, 409);
  // A CAS conflict may reject an otherwise available seat. Retry only clients
  // that received a definite failure, as the browser join flow would do.
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  for (let i = 0; accepted.length < 2 && i < attempts.length; i++) {
    // 只保存并发竞争中的成功加入者凭证，失败者仍需重新申请座位。
    // Retain credentials only for successful join contenders; losers still need another join attempt.
    if (attempts[i].status === 201) continue;
    const result = await joinRoom(api, roomId, names[i]);
    // 仅成功创建/加入的响应携带可用身份；失败竞争者不能当成已入座玩家。
    // Only successful create/join responses supply usable identity; failed contenders are not seated players.
    if (result.status === 201) accepted.push(result);
  }
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(accepted.length, 2);
  assert.equal(
    new Set(accepted.map((result) => result.body.state.you)).size,
    2,
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const state = (await host.get()).body.state;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(state.seats.filter(Boolean).length, 3);
  assert.equal(state.revision, 2, "losing joins must not advance revision");
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const extra = await Promise.all(
    ["额外甲", "额外乙"].map((name) => joinRoom(api, roomId, name)),
  );
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  extra.forEach((result) => assertError(result, 409, "ROOM_FULL"));
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const peers = accepted.map((result) =>
    client(api, roomId, result.body.token, result.body.state.you),
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await snapshots([host, ...peers].sort((a, b) => a.seat - b.seat));
});
// 场景：只有通过身份验证的房主能启动满员牌桌
// Scenario: only the authenticated host can start a full table
test("only the authenticated host can start a full table", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await harness(t);
  const { roomId, host } = await createRoom(api);
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  assertError(await host.start(0), 409, "NOT_FULL");
  assertError(
    await host.action(0, {
      type: "draw",
    }),
    409,
    "NOT_STARTED",
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const joined = await joinRoom(api, roomId, "南家");
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const guest = client(api, roomId, joined.body.token, 1);
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  assertError(await guest.start(1), 403, "HOST_ONLY");
  assertError(await host.start(1), 409, "NOT_FULL");
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await joinRoom(api, roomId, "西家");
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  assertError(await guest.start(2), 403, "HOST_ONLY");
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const started = await host.start(2);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(started.status, 200);
  assert.equal(started.body.state.phase, "playing");
  assert.equal(started.body.state.revision, 3);
  assertError(await host.start(3), 409, "PLAYING");
  assert.equal((await host.get()).body.state.revision, 3);
});
// 场景：缺失、格式错误、伪造或其他房间的令牌均不能读取或修改房间
// Scenario: missing, malformed, forged, and other-room tokens cannot read or mutate a room
test("missing, malformed, forged, and other-room tokens cannot read or mutate a room", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t);
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  // 逐项覆盖 [undefined,'bad','0'.repeat(64),'A'.repeat(64),`${api.host.token.slice(0,-1)}z`]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [undefined,'bad','0'.repeat(64),'A'.repeat(64),`${api.host.token.slice(0,-1)}z`] with the same checks, preserving the listed order.
  for (const token of [
    undefined,
    "bad",
    "0".repeat(64),
    "A".repeat(64),
    `${api.host.token.slice(0, -1)}z`,
  ]) {
    assertError(
      await api.request(`/api/rooms/${api.roomId}`, {
        token,
      }),
      401,
      "UNAUTHORIZED",
    );
    assertError(
      await api.request(`/api/rooms/${api.roomId}/action`, {
        method: "POST",
        token,
        body: {
          revision: api.state.revision,
          action: {
            type: "draw",
          },
        },
      }),
      401,
      "UNAUTHORIZED",
    );
  }
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const elsewhere = await createRoom(api, "别的房间");
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  assertError(
    await api.request(`/api/rooms/${api.roomId}`, {
      token: elsewhere.host.token,
    }),
    401,
    "UNAUTHORIZED",
  );
  assert.equal((await api.host.get()).body.state.revision, api.state.revision);
});
// 场景：三名已验证客户端只能收到自己的手牌，并且均可重连
// Scenario: all three authenticated clients receive only their own hand and can reconnect
test("all three authenticated clients receive only their own hand and can reconnect", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t);
  const states = await snapshots(api.clients);
  const authoritative = await api.store.get(api.roomId);
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  states.forEach((state, seat) => {
    assert.deepEqual(
      state.game.players[seat].hand,
      authoritative.game.players[seat].hand,
    );
    assert.equal(state.game.wallCount, 104);
    assert.equal(
      state.game.drawnTile,
      seat === 0 ? authoritative.game.lastDraw.tile : null,
    );
  });
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const reconnected = client(api, api.roomId, api.clients[1].token, 1);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const response = await reconnected.get();
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.state, states[1]);
});
// 场景：客户端不能借请求体中的座位字段冒充另一名已验证玩家
// Scenario: clients cannot use payload seat fields to impersonate another authenticated player
test("clients cannot use payload seat fields to impersonate another authenticated player", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const tile = api.state.game.players[0].hand[0];
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const before = await api.store.get(api.roomId);
  const forged = await api.clients[1].action(
    api.state.revision,
    {
      type: "discard",
      tile,
      seat: 0,
    },
    {
      seat: 0,
      playerSeat: 0,
      token: api.host.token,
    },
  );
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  assertError(forged, 422, "ILLEGAL_ACTION");
  assertError(
    await api.clients[2].action(
      api.state.revision,
      {
        type: "draw",
      },
      {
        seat: 0,
      },
    ),
    422,
    "ILLEGAL_ACTION",
  );
  assertError(
    await api.host.action(api.state.revision, {
      type: "draw",
    }),
    422,
    "ILLEGAL_ACTION",
  );
  assertError(
    await api.host.action(api.state.revision, {
      type: "cheat",
    }),
    422,
    "ILLEGAL_ACTION",
  );
  assert.deepEqual((await api.store.get(api.roomId)).game, before.game);
  assert.equal((await api.host.get()).body.state.revision, before.revision);
});
// 场景：格式错误的牌标识和动作结构会失败，且不改变牌局状态
// Scenario: malformed tile IDs and action shapes fail without altering game state
test("malformed tile IDs and action shapes fail without altering game state", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t);
  const before = await api.store.get(api.roomId);
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  // 逐项覆盖 [-1,18,1.5,'1',null,{},[]]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [-1,18,1.5,'1',null,{},[]] with the same checks, preserving the listed order.
  for (const tile of [-1, 18, 1.5, "1", null, {}, []]) {
    assertError(
      await api.host.action(api.state.revision, {
        type: "discard",
        tile,
      }),
      400,
      "BAD_TILE",
    );
  }
  // 逐项覆盖 [null,[],{},{type:1}]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [null,[],{},{type:1}] with the same checks, preserving the listed order.
  for (const action of [
    null,
    [],
    {},
    {
      type: 1,
    },
  ]) {
    assertError(
      await api.host.action(api.state.revision, action),
      400,
      "BAD_ACTION",
    );
  }
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assertError(
    await api.host.action(api.state.revision, {
      type: "discard",
    }),
    422,
    "ILLEGAL_ACTION",
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const after = await api.store.get(api.roomId);
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  assert.deepEqual(after.game, before.game);
  assert.equal(after.revision, before.revision);
});
// 场景：每次修改都必须携带完全匹配的整数修订号，重试不能重复执行
// Scenario: every mutation requires the exact integer revision, and retries cannot apply twice
test("every mutation requires the exact integer revision, and retries cannot apply twice", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const action = {
    type: "discard",
    tile: api.state.game.players[0].hand[0],
  };
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  // 逐项覆盖 [undefined,null,'3',-1,1.5,api.state.revision-1,api.state.revision+1]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [undefined,null,'3',-1,1.5,api.state.revision-1,api.state.revision+1] with the same checks, preserving the listed order.
  for (const revision of [
    undefined,
    null,
    "3",
    -1,
    1.5,
    api.state.revision - 1,
    api.state.revision + 1,
  ]) {
    assertError(await api.host.action(revision, action), 409, "STALE_STATE");
  }
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const requests = await Promise.all([
    api.host.action(api.state.revision, action),
    api.host.action(api.state.revision, action),
  ]);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.deepEqual(requests.map((result) => result.status).sort(), [200, 409]);
  assertError(
    requests.find((result) => result.status === 409),
    409,
    "STALE_STATE",
  );
  assertError(
    await api.host.action(api.state.revision, action),
    409,
    "STALE_STATE",
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const states = await snapshots(api.clients);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(states[0].revision, api.state.revision + 1);
  assert.equal(states[0].game.discards.length, 1);
});
// 场景：所有响应结束后服务端自动摸牌，三名客户端依次轮转，无需手动摸牌动作
// Scenario: server draws after all responses and rotates three clients without a manual draw action
test("server draws after all responses and rotates three clients without a manual draw action", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t, {
    seed: 0,
  });
  const before = (await api.store.get(api.roomId)).game;
  const first = await api.host.action(api.state.revision, {
    type: "discard",
    tile: 8,
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(first.status, 200);
  assert.equal(first.body.state.game.phase, "claim");
  assert.equal(
    first.body.state.game.wallCount,
    before.wall.length,
    "no draw while claims are outstanding",
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const claim = await passClaims(api.clients);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.ok(claim.passes > 0);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  let states = claim.states;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(states[0].game.currentSeat, 1);
  assert.equal(states[0].game.wallCount, before.wall.length - 1);
  // 逐项覆盖 [1,2,0]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [1,2,0] with the same checks, preserving the listed order.
  for (const seat of [1, 2, 0]) {
    assert.equal(states[seat].game.currentSeat, seat);
    assert.equal(states[seat].game.turnStep, "discard");
    assert.equal(
      states[seat].game.legalActions.some((action) => action.type === "draw"),
      false,
    );
    assert.equal(typeof states[seat].game.drawnTile, "number");
    const previousRevision = states[seat].revision;
    assertError(
      await api.clients[seat].action(previousRevision, {
        type: "draw",
      }),
      422,
      "ILLEGAL_ACTION",
    );
    states.forEach((state, index) => {
      // 只处理目标座位之外的其他玩家，避免在调整对手时覆盖当前玩家。
      // Handle only other seats, avoiding overwriting the selected player while adjusting opponents.
      if (index !== seat) assert.equal(state.game.drawnTile, null);
      const latest = state.game.history.at(-1);
      assert.equal(latest.type, "draw");
      assert.equal("tile" in latest, false);
    });
    const wallBefore = states[seat].game.wallCount;
    const discard = states[seat].game.legalActions.find(
      (action) => action.type === "discard",
    );
    const discarded = await api.clients[seat].action(previousRevision, discard);
    assert.equal(discarded.status, 200);
    assert.equal(discarded.body.state.revision, previousRevision + 1);
    states = (await passClaims(api.clients)).states;
    assert.equal(states[0].game.currentSeat, (seat + 1) % 3);
    assert.equal(states[0].game.wallCount, wallBefore - 1);
  }
});
// 场景：明面副露公开，但私有手牌和尚未裁决的响应选择保持隐藏
// Scenario: open melds are public while private hands and pending claim choices remain hidden
test("open melds are public while private hands and pending claim choices remain hidden", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t, {
    seed: 0,
  });
  const discarded = await api.host.action(api.state.revision, {
    type: "discard",
    tile: 8,
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(discarded.status, 200);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let states = await snapshots(api.clients);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(
    states[1].game.legalActions.some((action) => action.type === "peng"),
    true,
  );
  assert.equal("options" in states[0].game.claim, false);
  assert.equal("responses" in states[0].game.claim, false);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const peng = await api.clients[1].action(states[1].revision, {
    type: "peng",
    tile: 8,
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(peng.status, 200, JSON.stringify(peng.body));
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  states = (await passClaims(api.clients)).states;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 逐项覆盖 states；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in states with the same checks, preserving the listed order.
  for (const state of states) {
    const meld = state.game.players[1].melds[0];
    assert.equal(meld.type, "peng");
    assert.deepEqual(meld.tiles, [8, 8, 8]);
    assert.deepEqual(state.seats[1].melds, state.game.players[1].melds);
    assert.equal(state.game.currentSeat, 1);
    assert.equal(state.game.turnStep, "discard");
  }
});
// 场景：同时响应的玩家必须刷新过期修订号，且看不到彼此尚未裁决的选择
// Scenario: simultaneous claimants must refresh stale revisions and cannot see each other’s pending choice
test("simultaneous claimants must refresh stale revisions and cannot see each other’s pending choice", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t, {
    seed: 13,
  });
  const discarded = await api.host.action(api.state.revision, {
    type: "discard",
    tile: 7,
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(discarded.status, 200);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let states = await snapshots(api.clients);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(states[0].game.claim.eligibleSeats, [1, 2]);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const revision = states[0].revision;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const chosen = await api.clients[1].action(revision, {
    type: "peng",
    tile: 7,
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(chosen.status, 200);
  assert.equal(chosen.body.state.game.phase, "claim");
  assertError(
    await api.clients[2].action(revision, {
      type: "pass",
    }),
    409,
    "STALE_STATE",
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  states = await snapshots(api.clients);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 逐项覆盖 states；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in states with the same checks, preserving the listed order.
  for (const state of states) {
    assert.equal("responses" in state.game.claim, false);
    assert.equal("options" in state.game.claim, false);
    assert.deepEqual(state.game.claim.respondedSeats, [1]);
    assert.equal(
      state.game.history.some((event) => event.type === "peng"),
      false,
    );
    assert.equal(state.game.players[1].melds.length, 0);
  }
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.deepEqual(states[1].game.legalActions, []);
  assertError(
    await api.clients[1].action(states[1].revision, {
      type: "pass",
    }),
    422,
    "ILLEGAL_ACTION",
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const resolved = await api.clients[2].action(states[2].revision, {
    type: "pass",
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(resolved.status, 200);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  states = await snapshots(api.clients);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(states[0].game.phase, "turn");
  assert.equal(states[0].game.currentSeat, 1);
  assert.equal(states[0].game.players[1].melds[0].type, "peng");
});
// 场景：暗杠保持隐蔽，补牌历史也绝不暴露具体牌值
// Scenario: concealed kongs stay concealed and replacement draw history never reveals the tile
test("concealed kongs stay concealed and replacement draw history never reveals the tile", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t, {
    seed: 0,
  });
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.ok(
    api.state.game.legalActions.some(
      (action) => action.type === "anGang" && action.tile === 7,
    ),
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const result = await api.host.action(api.state.revision, {
    type: "anGang",
    tile: 7,
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(result.status, 200, JSON.stringify(result.body));
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const states = await snapshots(api.clients);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(states[0].game.players[0].melds[0].tiles, [7, 7, 7, 7]);
  // 逐项覆盖 states.slice(1)；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in states.slice(1) with the same checks, preserving the listed order.
  for (const state of states.slice(1)) {
    const meld = state.game.players[0].melds[0];
    assert.equal(meld.tile, null);
    assert.equal(meld.hidden, true);
    assert.deepEqual(meld.tiles, [null, null, null, null]);
    assert.deepEqual(state.seats[0].melds, [meld]);
  }
  // 逐项覆盖 states；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in states with the same checks, preserving the listed order.
  for (const state of states) {
    assert.equal(state.game.history.at(-1).type, "draw");
    assert.equal(state.game.history.at(-1).source, "replacement");
    assert.equal("tile" in state.game.history.at(-1), false);
    assert.equal(
      "tile" in state.game.history.find((event) => event.type === "anGang"),
      false,
    );
  }
});
// 场景：积分、萝卜与计分事件公开，但不泄露胡牌手牌
// Scenario: scores, radishes, and scoring events are public without exposing the winning hand
test("scores, radishes, and scoring events are public without exposing the winning hand", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t, {
    seed: 0,
  });
  const room = await api.store.get(api.roomId);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const game = createGame({
    seed: "scoring",
  });
  // 从每种牌八张的预算开始；后面的逐张扣除保证手牌与牌墙来自同一副牌。
  // Start with eight copies per kind; subsequent debits keep hands and wall within one physical deck.
  const remaining = Array(18).fill(8);
  const winning = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6];
  game.players[0].hand = winning;
  // 逐项覆盖 winning；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in winning with the same checks, preserving the listed order.
  for (const tile of winning) remaining[tile]--;
  // 逐项覆盖 [1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [1,2] with the same checks, preserving the listed order.
  for (const seat of [1, 2]) {
    const hand = [];
    for (let tile = 9; hand.length < 13; tile = (tile + 1) % 18) {
      // 只有该牌还有物理余量才放入手牌，防止发出第九张同种牌。
      // Deal this tile only while physical copies remain, preventing a ninth copy.
      if (remaining[tile]) {
        hand.push(tile);
        remaining[tile]--;
      }
    }
    game.players[seat].hand = hand.sort((a, b) => a - b);
  }
  game.wall = remaining.flatMap((count, tile) => Array(count).fill(tile));
  game.lastDraw = {
    seat: 0,
    tile: 6,
    source: "initial",
  };
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
  assert.equal(await api.store.compareAndSwap(room, room.revision), true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const result = await api.host.action(room.revision, {
    type: "hu",
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(result.status, 200, JSON.stringify(result.body));
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const states = await snapshots(api.clients);
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 states；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in states with the same checks, preserving the listed order.
  for (const state of states) {
    assert.equal(
      state.game.players.reduce((sum, player) => sum + player.score, 0),
      0,
    );
    assert.ok(state.game.players[0].score > 0);
    assert.ok(state.game.players[1].score < 0);
    assert.equal(state.game.players[0].huCount, 1);
    assert.equal(state.game.players[0].radishes.length, 6);
    assert.deepEqual(
      state.seats.map((player) => player.score),
      state.game.players.map((player) => player.score),
    );
    const event = state.game.history.find((item) => item.type === "hu");
    assert.ok(event.points > 0);
    assert.equal(
      event.payments.reduce((sum, payment) => sum + payment.delta, 0),
      0,
    );
    assert.equal("hand" in event, false);
  }
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.deepEqual(
    states[0].game.players.map((player) => player.score),
    states[2].game.players.map((player) => player.score),
  );
});
// 场景：进行中的房间拒绝新玩家加入，也不能被访客替换
// Scenario: an active room refuses new joins and cannot be replaced by a guest
test("an active room refuses new joins and cannot be replaced by a guest", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t);
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  assertError(await joinRoom(api, api.roomId, "后来者"), 409, "STARTED");
  assertError(await api.clients[1].start(api.state.revision), 403, "HOST_ONLY");
  assert.equal((await api.host.get()).body.state.revision, api.state.revision);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await snapshots(api.clients);
});
// 场景：FileStore 重载保留牌局、修订号和凭证重连能力，且不持久化原始 Bearer 令牌
// Scenario: FileStore reload preserves game, revision, and authenticated reconnect without persisting raw bearer tokens
test("FileStore reload preserves game, revision, and authenticated reconnect without persisting raw bearer tokens", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const directory = await mkdtemp(join(tmpdir(), "flower-mahjong-api-"));
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  t.after(() =>
    rm(directory, {
      recursive: true,
      force: true,
    }),
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const first = await table(t, {
    store: new FileStore(directory),
    seed: 0,
  });
  const discarded = await first.host.action(first.state.revision, {
    type: "discard",
    tile: 8,
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(discarded.status, 200);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await passClaims(first.clients);
  let before = await snapshots(first.clients);
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  assert.equal(before[1].game.turnStep, "discard");
  assert.equal(before[1].game.schemaVersion, 2);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const disk = await readFile(join(directory, "rooms.json"), "utf8");
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  first.clients.forEach((player) =>
    assert.equal(disk.includes(player.token), false),
  );
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.ok(disk.includes("tokenHash"));
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const second = await harness(t, new FileStore(directory));
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const reconnected = first.clients.map((player) =>
    client(second, player.roomId, player.token, player.seat),
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const after = await snapshots(reconnected);
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  for (let seat = 0; seat < 3; seat++)
    assert.deepEqual(after[seat], before[seat]);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const discard = after[1].game.legalActions.find(
    (action) => action.type === "discard",
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const resumed = await reconnected[1].action(after[1].revision, discard);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  assert.equal(resumed.body.state.revision, before[1].revision + 1);
  assertError(
    await reconnected[1].action(after[1].revision, discard),
    409,
    "STALE_STATE",
  );
});
// 只给内存存储加读写计数；实际持久化行为仍委托父类，用于验证轮询没有多余 IO。
// Add read/write counters while delegating actual memory-store behavior, measuring unnecessary polling IO.
class CountingStore extends MemoryStore {
  gets = 0;
  touches = 0;
  async get(id) {
    this.gets++;
    return super.get(id);
  }
  async touch(...args) {
    this.touches++;
    return super.touch(...args);
  }
  resetCounts() {
    this.gets = 0;
    this.touches = 0;
  }
}
// 场景：修订号轮询验证身份、返回精简的未变化响应，并仅执行一次读取且节流更新心跳
// Scenario: revision polling authenticates, returns a tiny unchanged envelope, and uses one read with throttled heartbeat
test("revision polling authenticates, returns a tiny unchanged envelope, and uses one read with throttled heartbeat", async (t) => {
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const store = new CountingStore();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t, {
    store,
  });
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  store.resetCounts();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const same = await api.host.get(api.state.revision);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(same.status, 200);
  assert.deepEqual(same.body, {
    unchanged: true,
    revision: api.state.revision,
    connections: [true, true, true],
  });
  assert.equal(store.gets, 1);
  assert.equal(store.touches, 0);
  assert.ok(Buffer.byteLength(JSON.stringify(same.body)) < 100);
  assertError(
    await api.request(`/api/rooms/${api.roomId}?since=${api.state.revision}`),
    401,
    "UNAUTHORIZED",
  );
  assertError(
    await api.request(`/api/rooms/${api.roomId}?since=${api.state.revision}`, {
      token: "0".repeat(64),
    }),
    401,
    "UNAUTHORIZED",
  );
  // 逐项覆盖 [api.state.revision-1,api.state.revision+1,-1,'3.5','NaN','','Infinity']；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [api.state.revision-1,api.state.revision+1,-1,'3.5','NaN','','Infinity'] with the same checks, preserving the listed order.
  for (const since of [
    api.state.revision - 1,
    api.state.revision + 1,
    -1,
    "3.5",
    "NaN",
    "",
    "Infinity",
  ]) {
    store.resetCounts();
    const full = await api.host.get(since);
    assert.equal(full.status, 200);
    assert.equal(full.body.unchanged, undefined);
    assert.equal(full.body.state.revision, api.state.revision);
    assertPrivateView(
      full.body.state,
      0,
      api.clients.map((player) => player.token),
    );
    assert.equal(store.gets, 1);
    assert.equal(store.touches, 0);
  }
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const room = store.rooms.get(api.roomId);
  room.seats[0].lastSeen = Date.now() - 11000;
  room.seats[1].lastSeen = Date.now() - 31000;
  store.resetCounts();
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const reconnected = await api.host.get(api.state.revision);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.deepEqual(reconnected.body.connections, [true, false, true]);
  assert.equal(store.gets, 1);
  assert.equal(store.touches, 1);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await api.host.get(api.state.revision);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(store.gets, 2);
  assert.equal(
    store.touches,
    1,
    "a second rapid poll must not write another heartbeat",
  );
  assert.equal(
    store.rooms.get(api.roomId).revision,
    api.state.revision,
    "heartbeat must not advance game revision",
  );
});
// 场景：修改响应具有权威性，后续条件轮询无需再次读取动作状态即可发现其他玩家的变化
// Scenario: mutation response is authoritative and the next conditional poll detects peers without another action GET
test("mutation response is authoritative and the next conditional poll detects peers without another action GET", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t, {
    seed: 0,
  });
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const oldRevision = api.state.revision;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const acted = await api.host.action(oldRevision, {
    type: "discard",
    tile: 8,
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(acted.status, 200);
  assert.equal(acted.body.state.revision, oldRevision + 1);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const ownPoll = await api.host.get(acted.body.state.revision);
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  assert.equal(ownPoll.body.unchanged, true);
  // 逐项覆盖 api.clients.slice(1)；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in api.clients.slice(1) with the same checks, preserving the listed order.
  for (const peer of api.clients.slice(1)) {
    const poll = await peer.get(oldRevision);
    assert.equal(poll.body.state.revision, acted.body.state.revision);
    assertPrivateView(
      poll.body.state,
      peer.seat,
      api.clients.map((player) => player.token),
    );
  }
});
// 逐项覆盖 [undefined,1]；同一组检查用于每个样本，顺序以代码列出的集合为准。
// Exercise each entry in [undefined,1] with the same checks, preserving the listed order.
for (const version of [undefined, 1]) {
  // 场景：保存的旧版 schema ${version ?? 'absent'} 重连后逐字节不变，保留手动摸牌，且仅在结束后开启 v3
  // Scenario: saved legacy schema ${version ?? "absent"} reconnects byte-for-byte, retains manual draw, and starts v3 only after completion
  test(`saved legacy schema ${version ?? "absent"} reconnects byte-for-byte, retains manual draw, and starts v3 only after completion`, async (t) => {
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    const directory = await mkdtemp(join(tmpdir(), "flower-mahjong-legacy-"));
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.
    t.after(() =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    );
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    const api = await table(t, {
      store: new FileStore(directory),
    });
    const room = await api.store.get(api.roomId);
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.
    const game = createLegacyGame({
      seed: 13,
    });
    // 只有提供版本号才写入该字段，保留无版本旧存档的分支。
    // Write the version only when supplied, retaining the unversioned legacy branch.
    if (version !== undefined) game.schemaVersion = version;
    game.retiredTiles.push({
      seat: 0,
      tile: game.lastDraw.tile,
    });
    game.players[0].hand.splice(
      game.players[0].hand.indexOf(game.lastDraw.tile),
      1,
    );
    game.retiredTiles.push(
      ...game.wall.splice(1).map((tile) => ({
        seat: 0,
        tile,
      })),
    );
    game.turnStep = "draw";
    game.lastDraw = null;
    // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
    // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
    assertLegacyInvariants(game);
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.
    room.game = game;
    // 核对接口返回及版本，区分成功、冲突与未变化响应。
    // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
    assert.equal(await api.store.compareAndSwap(room, room.revision), true);
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.
    const gameBytes = JSON.stringify(game);
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    const reloaded = await harness(t, new FileStore(directory));
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.
    const peers = api.clients.map((player) =>
      client(reloaded, api.roomId, player.token, player.seat),
    );
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    const views = await snapshots(peers);
    // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
    // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
    // 逐项覆盖 views；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in views with the same checks, preserving the listed order.
    for (const view of views) {
      assert.equal(view.game.schemaVersion, 1);
      assert.equal(view.rulesVersion, 1);
    }
    // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
    // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
    assert.equal(
      JSON.stringify((await reloaded.store.get(api.roomId)).game),
      gameBytes,
      "read/reconnect migrated or mutated legacy game",
    );
    assert.deepEqual(views[0].game.legalActions, [
      {
        type: "draw",
      },
    ]);
    assertError(await peers[0].start(views[0].revision), 409, "PLAYING");
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    const drawn = await peers[0].action(views[0].revision, {
      type: "draw",
    });
    // 核对接口返回及版本，区分成功、冲突与未变化响应。
    // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
    assert.equal(drawn.status, 200);
    assert.equal(drawn.body.state.game.schemaVersion, 1);
    assert.equal(drawn.body.state.game.wallCount, 0);
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    const discarded = await peers[0].action(
      drawn.body.state.revision,
      drawn.body.state.game.legalActions.find(
        (action) => action.type === "discard",
      ),
    );
    // 核对接口返回及版本，区分成功、冲突与未变化响应。
    // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
    assert.equal(discarded.status, 200);
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    const ended = (await passClaims(peers)).states[0];
    // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
    // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
    assert.equal(ended.game.phase, "finished");
    assert.equal(ended.game.schemaVersion, 1);
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    const restarted = await peers[0].start(ended.revision);
    // 核对接口返回及版本，区分成功、冲突与未变化响应。
    // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
    assert.equal(restarted.status, 200);
    assert.equal(restarted.body.state.game.schemaVersion, 3);
    assert.equal(restarted.body.state.rulesVersion, 3);
    assert.equal(restarted.body.state.game.wallCount, 104);
  });
}
// 场景：未知的已保存牌局版本按拒绝处理，且不修改存储中的牌局
// Scenario: unknown saved game version fails closed without altering the stored game
test("unknown saved game version fails closed without altering the stored game", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t);
  const room = await api.store.get(api.roomId);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  room.game.schemaVersion = 999;
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(await api.store.compareAndSwap(room, room.revision), true);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const before = JSON.stringify(room.game);
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  assertError(await api.host.get(), 409, "UNSUPPORTED_GAME_VERSION");
  assertError(
    await api.host.action(room.revision, {
      type: "discard",
      tile: room.game.players[0].hand[0],
    }),
    409,
    "UNSUPPORTED_GAME_VERSION",
  );
  assert.equal(JSON.stringify((await api.store.get(api.roomId)).game), before);
});
const WAITING_HAND = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17];
const WINNING_HAND = [...WAITING_HAND, 17];
const PAIR_CLAIM_HAND = [17, 17, 0, 1, 3, 4, 6, 7, 9, 10, 12, 13, 15];
const KONG_CLAIM_HAND = [17, 17, 17, 0, 1, 3, 4, 6, 7, 9, 10, 12, 13];

// Independent physical accounting deliberately does NOT count logical winPile
// references. A multi-winner tile remains exactly one physical river tile.
// 统计手牌、副露、牌墙及已移出的实物牌，检查每种八张与总计 144 张。
// Count physical tiles across hands, melds, wall and retired zones, checking eight copies per kind and 144 total.
function checkPhysicalConservation(game) {
  const physical = [
    ...game.wall,
    ...game.retiredTiles.map((record) => record.tile),
    ...game.discards
      .filter((record) => record.claimedBy === undefined)
      .map((record) => record.tile),
    ...game.players.flatMap((player) => [
      ...player.hand,
      ...player.melds.flatMap((meld) => meld.tiles),
      ...player.radishes,
    ]),
  ];
  assert.equal(physical.length, 144);
  for (let tile = 0; tile < 18; tile++)
    assert.equal(
      physical.filter((value) => value === tile).length,
      8,
      `physical copies of ${tile}`,
    );
  assert.equal(
    game.players.reduce((sum, player) => sum + player.score, 0),
    0,
  );
  // 验证当前状态的引擎不变量；场景不能靠非法牌数来满足期望。
  // Check current engine invariants; an expected outcome must not rely on illegal tile counts.
  assertGameInvariants(game);
}
// 构造 HTTP 计分测试使用的完整守恒状态；显式设置手牌、旧胡牌、萝卜、锁定与墙头墙尾。
// Build conserved HTTP scoring state with explicit hands, prior wins, radishes, locks and wall ends.
function apiFixture({
  hands = [WINNING_HAND, WAITING_HAND, WAITING_HAND],
  melds = [[], [], []],
  wins = [[], [], []],
  radishes = [[], [], []],
  currentSeat = 0,
  drawTile = hands[currentSeat].at(-1),
  head = [],
  tail = [],
  kongSeats = [],
  locks = [[], [], []],
  wallCount,
  rules = {},
} = {}) {
  const game = createGame({
    seed: "independent-http-fixture",
    rules,
  });
  game.history = [];
  game.discards = [];
  // 已胡的实物牌仍占一张物理配额；winPile 是展示/计分引用，不能当成新增的牌。
  // Physical winning tiles still occupy one copy; winPile is a display/scoring reference, not newly created tiles.
  game.retiredTiles = [];
  game.players.forEach((player, seat) => {
    player.hand = [...hands[seat]].sort((a, b) => a - b);
    player.melds = structuredClone(melds[seat]);
    player.winPile = wins[seat].map((tile) => ({
      tile,
      source: "selfDraw",
      virtual: false,
    }));
    game.retiredTiles.push(
      ...wins[seat].map((tile) => ({
        seat,
        tile,
      })),
    );
    player.huCount = wins[seat].length;
    player.radishes = [...radishes[seat]];
    player.pendingKongDiscard = kongSeats.includes(seat);
    player.lockedWaits = [...locks[seat]];
    player.huLockActive = locks[seat].length > 0;
  });
  game.currentSeat = currentSeat;
  game.lastDraw =
    drawTile === null
      ? null
      : {
          seat: currentSeat,
          tile: drawTile,
          source: "normal",
        };
  // 十八种牌，每种八张。先登记所有已分配牌，再把余量填入牌墙；不能凭空增加牌。
  // There are eighteen kinds with eight copies each. Debit allocated tiles, then place remaining copies in the wall.
  const counts = Array(18).fill(8);
  // 从每种牌八张的余量扣除一张；负数表示夹具凭空制造了第九张，立即失败。
  // Debit one of the eight copies of a tile; a negative remainder means the fixture invented a ninth copy and must fail.
  function use(tile) {
    assert.ok(Number.isInteger(tile) && tile >= 0 && tile < 18);
    assert.ok(--counts[tile] >= 0, `fixture overused ${tile}`);
  }
  game.retiredTiles.forEach((record) => use(record.tile));
  game.players.forEach((player) =>
    [
      ...player.hand,
      ...player.melds.flatMap((meld) => meld.tiles),
      ...player.radishes,
    ].forEach(use),
  );
  [...head, ...tail].forEach(use);
  const rest = counts.flatMap((count, tile) => Array(count).fill(tile));
  // 仅在明确指定墙牌数时裁剪；多出的实物牌必须移入退役区，不能消失。
  // Trim the wall only when explicitly requested; surplus physical tiles must be retired, not disappear.
  if (wallCount !== undefined) {
    assert.ok(wallCount >= head.length + tail.length);
    game.retiredTiles.push(
      ...rest.splice(wallCount - head.length - tail.length).map((tile) => ({
        seat: 0,
        tile,
      })),
    );
  }
  game.wall = [...head, ...rest, ...tail];
  checkPhysicalConservation(game);
  return game;
}
// 只在测试内部把合成牌局通过 CAS 写入隔离存储；客户端没有这个写入能力。
// Install a synthetic game through CAS inside the isolated harness; clients have no such write capability.
async function installFixture(api, game) {
  const room = await api.store.get(api.roomId);
  room.game = game;
  assert.equal(await api.store.compareAndSwap(room, room.revision), true);
  return snapshots(api.clients);
}
// 从存储重新读取权威状态并检查牌数与分数守恒，而不只检查动作响应。
// Reload authoritative storage and check tile/score conservation, not only the action response.
async function checkStored(api) {
  const room = await api.store.get(api.roomId);
  checkPhysicalConservation(room.game);
  return room.game;
}
// 场景：并发重复自摸只扣分一次、翻六张萝卜一次，并保留公开胡牌区
// Scenario: duplicate concurrent self-hu is charged once, flips six radishes once, and keeps the public winning pile
test("duplicate concurrent self-hu is charged once, flips six radishes once, and keeps the public winning pile", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const game = apiFixture({
    head: [6, 8],
    tail: [7, 7, 8, 8, 15, 15],
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let views = await installFixture(api, game);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const revision = views[0].revision;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const answers = await Promise.all([
    api.host.action(revision, {
      type: "hu",
    }),
    api.host.action(revision, {
      type: "hu",
    }),
  ]);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.deepEqual(answers.map((answer) => answer.status).sort(), [200, 409]);
  assertError(
    answers.find((answer) => answer.status === 409),
    409,
    "STALE_STATE",
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  views = await snapshots(api.clients);
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 views；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in views with the same checks, preserving the listed order.
  for (const view of views) {
    const player = view.game.players[0];
    assert.equal(player.huCount, 1);
    assert.equal(player.radishes.length, 6);
    assert.deepEqual(player.winPile, [
      {
        tile: 17,
        source: "selfDraw",
        virtual: false,
      },
    ]);
    assert.deepEqual(view.seats[0].winPile, player.winPile);
    assert.equal(
      view.game.history.filter((event) => event.type === "hu").length,
      1,
    );
    assert.deepEqual(
      view.game.players.map((player) => player.score),
      [2, -1, -1],
    );
    assert.equal(player.lastScoreBreakdown.fan, 1);
    assert.equal(player.lastScoreBreakdown.total, 1);
    assert.equal(
      view.game.history.filter(
        (event) => event.type === "discard" && event.automatic,
      ).length,
      1,
    );
    assert.equal(
      view.game.history.find((event) => event.automatic).tile,
      6,
      "automatic discard must use continuation draw, not another hand tile",
    );
  }
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.deepEqual((await checkStored(api)).players[0].hand, WAITING_HAND);
  assertError(
    await api.host.action(revision, {
      type: "hu",
    }),
    409,
    "STALE_STATE",
  );
});
// 逐项覆盖 下列集合；同一组检查用于每个样本，顺序以代码列出的集合为准。
// Exercise each entry in the following collection with the same checks, preserving the listed order.
for (const {
  name,
  near,
  far,
  responses,
  winner,
  claimType,
  expectedScores,
} of [
  {
    name: "farther kong outranks nearer peng",
    near: PAIR_CLAIM_HAND,
    far: KONG_CLAIM_HAND,
    responses: ["peng", "mingGang"],
    winner: 2,
    claimType: "mingGang",
    expectedScores: [-2, 0, 2],
  },
  {
    name: "equal peng chooses nearer seat",
    near: PAIR_CLAIM_HAND,
    far: PAIR_CLAIM_HAND,
    responses: ["peng", "peng"],
    winner: 1,
    claimType: "peng",
    expectedScores: [0, 0, 0],
  },
  {
    name: "equal kong chooses nearer seat",
    near: KONG_CLAIM_HAND,
    far: KONG_CLAIM_HAND,
    responses: ["mingGang", "mingGang"],
    winner: 1,
    claimType: "mingGang",
    expectedScores: [-2, 2, 0],
  },
]) {
  // 场景：响应裁决：${name}，即使较远座位先响应也不改变结果
  // Scenario: claim arbitration: ${name}, even when farther response arrives first
  test(`claim arbitration: ${name}, even when farther response arrives first`, async (t) => {
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    const api = await table(t);
    let views = await installFixture(
      api,
      apiFixture({
        hands: [WINNING_HAND, near, far],
        head: [8],
        tail: [16],
      }),
    );
    // 核对接口返回及版本，区分成功、冲突与未变化响应。
    // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
    assert.equal(
      (
        await api.host.action(views[0].revision, {
          type: "discard",
          tile: 17,
        })
      ).status,
      200,
    );
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    views = await snapshots(api.clients);
    // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
    // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
    assert.deepEqual(views[0].game.claim.eligibleSeats, [1, 2]);
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.
    const wallBefore = views[0].game.wallCount;
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    const first = await api.clients[2].action(views[2].revision, {
      type: responses[1],
      tile: 17,
    });
    // 核对接口返回及版本，区分成功、冲突与未变化响应。
    // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
    assert.equal(first.status, 200);
    assert.equal(first.body.state.game.phase, "claim");
    assert.equal(first.body.state.game.wallCount, wallBefore);
    assert.deepEqual(
      first.body.state.game.players.map((player) => player.score),
      [0, 0, 0],
    );
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    views = await snapshots(api.clients);
    const duplicateFinal = await Promise.all(
      [1, 2].map(() =>
        api.clients[1].action(views[1].revision, {
          type: responses[0],
          tile: 17,
        }),
      ),
    );
    // 核对接口返回及版本，区分成功、冲突与未变化响应。
    // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
    assert.deepEqual(
      duplicateFinal.map((answer) => answer.status).sort(),
      [200, 409],
    );
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    views = await snapshots(api.clients);
    // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
    // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
    // 逐项覆盖 views；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in views with the same checks, preserving the listed order.
    for (const view of views) {
      assert.equal(view.game.currentSeat, winner);
      assert.equal(view.game.players[winner].melds[0].type, claimType);
      assert.equal(view.game.players[3 - winner].melds.length, 0);
      assert.deepEqual(
        view.game.players.map((player) => player.score),
        expectedScores,
      );
      assert.equal(
        view.game.players[winner].radishes.length,
        claimType === "mingGang" ? 1 : 0,
      );
      assert.equal(
        view.game.wallCount,
        wallBefore - (claimType === "mingGang" ? 2 : 0),
      );
      assert.equal(
        view.game.history.filter((event) => event.type === claimType).length,
        1,
      );
    }
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    await checkStored(api);
  });
}
// 场景：胡牌优先于已经提交的杠牌，落败的杠不扣分也不补牌
// Scenario: hu outranks an already submitted kong and does not charge or draw for the losing kong
test("hu outranks an already submitted kong and does not charge or draw for the losing kong", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t);
  let views = await installFixture(
    api,
    apiFixture({
      hands: [WINNING_HAND, WAITING_HAND, KONG_CLAIM_HAND],
      head: [8, 8],
      tail: [7, 7, 8, 8, 15, 15],
    }),
  );
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(
    (
      await api.host.action(views[0].revision, {
        type: "discard",
        tile: 17,
      })
    ).status,
    200,
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  views = await snapshots(api.clients);
  const kong = await api.clients[2].action(views[2].revision, {
    type: "mingGang",
    tile: 17,
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(kong.status, 200);
  assert.equal(kong.body.state.game.phase, "claim");
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const hu = await api.clients[1].action(kong.body.state.revision, {
    type: "hu",
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(hu.status, 200);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  views = await snapshots(api.clients);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(views[0].game.players[1].huCount, 1);
  assert.equal(views[0].game.players[2].melds.length, 0);
  assert.equal(views[0].game.players[2].radishes.length, 0);
  assert.equal(views[0].game.players[2].score, 0);
  assert.equal(
    views[0].game.history.some((event) => event.type === "mingGang"),
    false,
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await checkStored(api);
});
// 逐项覆盖 ['anGang','buGang','addGang']；同一组检查用于每个样本，顺序以代码列出的集合为准。
// Exercise each entry in ['anGang','buGang','addGang'] with the same checks, preserving the listed order.
for (const type of ["anGang", "buGang", "addGang"]) {
  // 场景：${type} 在并发重试下仍立即且仅一次收取准确分值
  // Scenario: ${type} immediately pays the exact amount once under concurrent retries
  test(`${type} immediately pays the exact amount once under concurrent retries`, async (t) => {
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    const api = await table(t);
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.
    const upgrade = type !== "anGang";
    const hand = upgrade
      ? [17, 0, 1, 2, 3, 4, 5, 9, 10, 11, 12]
      : [17, 17, 17, 17, 0, 1, 2, 3, 4, 5, 9, 10, 11, 12];
    const meld = {
      type: type === "buGang" ? "peng" : "anGang",
      tile: 17,
      tiles: Array(type === "buGang" ? 3 : 4).fill(17),
    };
    const fixture = apiFixture({
      hands: [hand, WAITING_HAND, WAITING_HAND],
      melds: [upgrade ? [meld] : [], [], []],
      head: [8],
      tail: [16],
    });
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    const views = await installFixture(api, fixture);
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.
    const action = {
      type,
      tile: 17,
    };
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    const results = await Promise.all([
      api.host.action(views[0].revision, action),
      api.host.action(views[0].revision, action),
    ]);
    // 核对接口返回及版本，区分成功、冲突与未变化响应。
    // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    const after = await snapshots(api.clients);
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.
    const amount = type === "anGang" ? 2 : 1;
    // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
    // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
    // 逐项覆盖 after；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in after with the same checks, preserving the listed order.
    for (const view of after) {
      assert.deepEqual(
        view.game.players.map((player) => player.score),
        [amount * 2, -amount, -amount],
      );
      assert.equal(view.game.players[0].radishes.length, 1);
      assert.equal(view.game.players[0].kongCount, 1);
      assert.equal(view.game.wallCount, fixture.wall.length - 2);
      assert.equal(
        view.game.players[0].melds[0].tiles.length,
        type === "addGang" ? 5 : 4,
      );
      assert.equal(
        view.game.history.filter((event) => event.type === type).length,
        1,
      );
    }
    // 非补杠变体使用真杠相关场景，不把碰组升级的语义混入其中。
    // Non-supplemental variants use genuine-kong setup rather than peng-upgrade semantics.
    if (type !== "buGang")
      // 逐项覆盖 after.slice(1)；同一组检查用于每个样本，顺序以代码列出的集合为准。
      // Exercise each entry in after.slice(1) with the same checks, preserving the listed order.
      for (const view of after.slice(1))
        assert.deepEqual(
          view.game.players[0].melds[0].tiles,
          Array(type === "addGang" ? 5 : 4).fill(null),
        );
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    await checkStored(api);
  });
}
// 场景：最后一批同时双胡先完整结算，再以三家均胡结束，且不额外摸牌
// Scenario: the final simultaneous two-winner batch fully settles before all-three-hu finish, without an extra draw
test("the final simultaneous two-winner batch fully settles before all-three-hu finish, without an extra draw", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const fixture = apiFixture({
    wins: [[16], [], []],
    kongSeats: [0],
    head: [8],
    tail: [6, 6, 7, 7, 8, 8, 15, 15, 16, 16, 6, 7],
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let views = await installFixture(api, fixture);
  const discard = await api.host.action(views[0].revision, {
    type: "discard",
    tile: 17,
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(discard.status, 200);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  views = await snapshots(api.clients);
  const responses = await Promise.all([
    api.clients[1].action(views[1].revision, {
      type: "hu",
    }),
    api.clients[2].action(views[2].revision, {
      type: "hu",
    }),
  ]);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [200, 409],
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const losingIndex = responses.findIndex(
    (response) => response.status === 409,
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  views = await snapshots(api.clients);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(views[0].game.phase, "claim");
  assert.deepEqual(
    views[0].game.players.map((player) => player.huCount),
    [1, 0, 0],
    "no winner settled until all replies arrive",
  );
  assert.equal(views[0].game.wallCount, fixture.wall.length);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const finalSeat = losingIndex + 1;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const finals = await Promise.all([
    api.clients[finalSeat].action(views[finalSeat].revision, {
      type: "hu",
    }),
    api.clients[finalSeat].action(views[finalSeat].revision, {
      type: "hu",
    }),
  ]);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.deepEqual(
    finals.map((response) => response.status).sort(),
    [200, 409],
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  views = await snapshots(api.clients);
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 views；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in views with the same checks, preserving the listed order.
  for (const view of views) {
    assert.equal(view.phase, "finished");
    assert.equal(view.game.finishReason, "allPlayersHu");
    assert.deepEqual(
      view.game.players.map((player) => player.huCount),
      [1, 1, 1],
    );
    assert.deepEqual(
      view.game.players.map((player) => player.radishes.length),
      [0, 6, 6],
    );
    assert.deepEqual(
      view.game.players.map((player) => player.score),
      [-2, 1, 1],
    );
    assert.equal(view.game.wallCount, fixture.wall.length - 12);
    assert.equal(
      view.game.history.filter((event) => event.type === "draw").length,
      0,
    );
    assert.deepEqual(
      view.game.history.slice(-3).map((event) => event.type),
      ["hu", "hu", "finish"],
    );
    assert.equal(view.game.players[1].winPile[0].virtual, false);
    assert.equal(view.game.players[2].winPile[0].virtual, true);
    assert.equal(view.game.players[1].winPile[0].tile, 17);
    assert.equal(view.game.players[2].winPile[0].tile, 17);
    assert.deepEqual(view.game.discards[0].huSeats, [1, 2]);
    assert.deepEqual(view.game.legalActions, []);
  }
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await checkStored(api);
  const before = JSON.stringify((await api.store.get(api.roomId)).game);
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  assertError(
    await api.host.action(views[0].revision, {
      type: "discard",
      tile: 0,
    }),
    422,
    "ILLEGAL_ACTION",
  );
  assert.equal(JSON.stringify((await api.store.get(api.roomId)).game), before);
});
// 逐项覆盖 [[1,1],[2,2],[3,4],[4,8],[5,10],[6,12],[7,14],[10,20]]；同一组检查用于每个样本，顺序以代码列出的集合为准。
// Exercise each entry in [[1,1],[2,2],[3,4],[4,8],[5,10],[6,12],[7,14],[10,20]] with the same checks, preserving the listed order.
for (const [fan, expected] of [
  [1, 1],
  [2, 2],
  [3, 4],
  [4, 8],
  [5, 10],
  [6, 12],
  [7, 14],
  [10, 20],
]) {
  // 场景：HTTP 计分明细将 ${fan} 番换算为 ${expected} 分
  // Scenario: HTTP scoring breakdown maps ${fan} fan to ${expected} points
  test(`HTTP scoring breakdown maps ${fan} fan to ${expected} points`, async (t) => {
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    const api = await table(t);
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.
    const fixture = apiFixture({
      rules: {
        baseFan: fan,
      },
      head: [6, 8],
      tail: [7, 7, 8, 8, 15, 15],
    });
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    const views = await installFixture(api, fixture);
    const scored = await api.host.action(views[0].revision, {
      type: "hu",
    });
    // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
    // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
    assert.equal(scored.status, 200);
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.
    const score = scored.body.state.game.players[0].lastScoreBreakdown;
    // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
    // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
    assert.equal(score.fan, fan);
    assert.equal(score.copyFanBonus, 0);
    assert.equal(score.fanPoints, expected);
    assert.equal(score.radishBonus, 0);
    assert.equal(score.dragonBonus, 0);
    assert.equal(score.total, expected);
    assert.deepEqual(
      scored.body.state.game.players.map((player) => player.score),
      [expected * 2, -expected, -expected],
    );
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    await checkStored(api);
  });
}
// 场景：四张和五张相同牌跨自己的手牌、副露和历史胡牌区计数，排除对手的牌
// Scenario: four and five identical tiles count across own hand, open meld and historical win pile, excluding opponents
test("four and five identical tiles count across own hand, open meld and historical win pile, excluding opponents", async (t) => {
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 [[0,2,2],[1,3,4]]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [[0,2,2],[1,3,4]] with the same checks, preserving the listed order.
  for (const [priorWins, expectedFan, expectedPoints] of [
    [0, 2, 2],
    [1, 3, 4],
  ]) {
    const api = await table(t);
    const hand = [0, 1, 2, 6, 7, 8, 9, 10, 11, 17, 17];
    const opponent = [6, ...WAITING_HAND.slice(1)];
    const fixture = apiFixture({
      hands: [hand, opponent, opponent],
      melds: [
        [
          {
            type: "peng",
            tile: 6,
            tiles: [6, 6, 6],
          },
        ],
        [],
        [],
      ],
      wins: [Array(priorWins).fill(6), [], []],
      head: [15, 15],
      tail: [3, 3, 4, 4, 5, 5],
      drawTile: 17,
    });
    const views = await installFixture(api, fixture);
    const answer = await api.host.action(views[0].revision, {
      type: "hu",
    });
    assert.equal(answer.status, 200);
    const score = answer.body.state.game.players[0].lastScoreBreakdown;
    assert.equal(score.fan, expectedFan);
    assert.equal(score.copyFanBonus, priorWins + 1);
    assert.equal(score.fanPoints, expectedPoints);
    assert.equal(score.total, expectedPoints);
    assert.deepEqual(
      answer.body.state.game.players.map((player) => player.score),
      [expectedPoints * 2, -expectedPoints, -expectedPoints],
    );
    await checkStored(api);
  }
});
// 场景：胡牌后只能打出刚摸到的牌，且可胡牌时不提供杠牌选择
// Scenario: after a win only the drawn tile can be discarded and an available hu suppresses kong
test("after a win only the drawn tile can be discarded and an available hu suppresses kong", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5];
  const fixture = apiFixture({
    hands: [hand, WAITING_HAND, WAITING_HAND],
    wins: [[16], [], []],
    drawTile: 5,
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const views = await installFixture(api, fixture);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const legal = views[0].game.legalActions;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.ok(legal.some((action) => action.type === "hu"));
  assert.equal(
    legal.some((action) => action.type.endsWith("Gang")),
    false,
  );
  assert.deepEqual(
    legal.filter((action) => action.type === "discard"),
    [
      {
        type: "discard",
        tile: 5,
      },
    ],
  );
  assertError(
    await api.host.action(views[0].revision, {
      type: "discard",
      tile: 0,
    }),
    422,
    "ILLEGAL_ACTION",
  );
  assertError(
    await api.host.action(views[0].revision, {
      type: "anGang",
      tile: 0,
    }),
    422,
    "ILLEGAL_ACTION",
  );
  assertError(
    await api.host.action(views[0].revision, {
      type: "draw",
    }),
    422,
    "ILLEGAL_ACTION",
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const passed = await api.host.action(views[0].revision, {
    type: "pass",
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(passed.status, 200);
  assert.equal(passed.body.state.game.discards[0].tile, 5);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await checkStored(api);
});
// 场景：v3 HTTP 自摸统计个人全部萝卜相关牌区，排除已经胡牌的付款方，并拒绝重复扣分
// Scenario: v3 HTTP selfdraw uses all personal radish zones, excludes already-hu payer and rejects duplicate charge
test("v3 HTTP selfdraw uses all personal radish zones, excludes already-hu payer and rejects duplicate charge", async (t) => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  const { DEFAULT_RULES, assertGameInvariants: assertLatest } = await import(
    "../shared/game.js"
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [0, 1, 2, 3, 4, 5, 9, 10, 11, 15, 16, 17, 6, 6];
  const game = apiFixture({
    hands: [hand, WAITING_HAND, WAITING_HAND],
    wins: [[15, 12], [7], []],
    radishes: [[], [15, 12, 12], []],
    drawTile: 6,
    head: [8],
  });
  game.schemaVersion = 3;
  game.rules = {
    ...structuredClone(DEFAULT_RULES),
    allowPungUpgrade: true,
  };
  game.firstHuRadishesRevealed = true;
  game.dragonSettlement = {
    settled: false,
    entries: [],
  };
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assertLatest(game);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let views = await installFixture(api, game);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const rev = views[0].revision;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const responses = await Promise.all([
    api.host.action(rev, {
      type: "hu",
    }),
    api.host.action(rev, {
      type: "hu",
    }),
  ]);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  views = await snapshots(api.clients);
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 views；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in views with the same checks, preserving the listed order.
  for (const view of views) {
    const event = view.game.history.find((e) => e.type === "hu");
    assert.equal(event.score.radishBonus, 4);
    assert.equal(event.score.fan, 1);
    assert.deepEqual(event.payments, [
      {
        seat: 2,
        delta: -5,
      },
      {
        seat: 0,
        delta: 5,
      },
    ]);
    assert.deepEqual(
      view.game.players.map((p) => p.score),
      [5, 0, -5],
    );
    assert.equal(view.game.history.filter((e) => e.type === "hu").length, 1);
  }
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  assertLatest((await api.store.get(api.roomId)).game);
});
// 场景：v3 HTTP 对反馈场景中的杠后打出五筒，向受锁定的玩家提供再次胡牌，并仅结算一次
// Scenario: v3 HTTP exposes and settles locked repeat hu on the reported kong-discard five circles exactly once
test("v3 HTTP exposes and settles locked repeat hu on the reported kong-discard five circles exactly once", async (t) => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  const { DEFAULT_RULES, assertGameInvariants: assertLatest } = await import(
    "../shared/game.js"
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const receiver = [4, 5, 6, 6, 7, 7, 7, 8, 11, 12, 13, 14, 15];
  const source = [2, 3, 5, 6, 7, 8, 8, 8, 10, 14, 14];
  const game = apiFixture({
    hands: [source, receiver, WAITING_HAND],
    melds: [
      [
        {
          type: "peng",
          tile: 10,
          tiles: [10, 10, 10],
        },
      ],
      [],
      [],
    ],
    wins: [[], [16, 10, 16, 13, 16], []],
    locks: [[], [10, 13, 16], []],
    drawTile: 10,
    head: [13, 0],
    tail: [16],
  });
  game.schemaVersion = 3;
  game.rules = {
    ...structuredClone(DEFAULT_RULES),
    allowPungUpgrade: true,
  };
  game.firstHuRadishesRevealed = true;
  game.dragonSettlement = {
    settled: false,
    entries: [],
  };
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assertLatest(game);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let views = await installFixture(api, game);
  let answer = await api.host.action(views[0].revision, {
    type: "buGang",
    tile: 10,
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(answer.status, 200);
  // 持续推进场景直到 answer.body.state.game.phase==='claim'&&answer.body.state.game.claim.kind==='robKong' 不再成立；循环内的动作/断言负责保证进展。
  // Advance while answer.body.state.game.phase==='claim'&&answer.body.state.game.claim.kind==='robKong' holds; actions/assertions inside are responsible for progress.
  while (
    answer.body.state.game.phase === "claim" &&
    answer.body.state.game.claim.kind === "robKong"
  ) {
    const claim = answer.body.state.game.claim;
    const seat = claim.eligibleSeats.find(
      (seat) => !claim.respondedSeats.includes(seat),
    );
    answer = await api.clients[seat].action(answer.body.state.revision, {
      type: "pass",
    });
    assert.equal(answer.status, 200);
  }
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  answer = await api.host.action(answer.body.state.revision, {
    type: "discard",
    tile: 13,
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(answer.status, 200);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  views = await snapshots(api.clients);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(views[1].game.huDiagnostic.code, "AVAILABLE");
  assert.ok(views[1].game.legalActions.some((action) => action.type === "hu"));
  assert.equal(views[1].game.discards.at(-1).afterKong, true);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const revision = views[1].revision;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const answers = await Promise.all([
    api.clients[1].action(revision, {
      type: "hu",
    }),
    api.clients[1].action(revision, {
      type: "hu",
    }),
  ]);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.deepEqual(answers.map((answer) => answer.status).sort(), [200, 409]);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  views = await snapshots(api.clients);
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  // 逐项覆盖 views；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in views with the same checks, preserving the listed order.
  for (const view of views) {
    assert.equal(view.game.players[1].huCount, 6);
    const events = view.game.history.filter((event) => event.type === "hu");
    assert.equal(events.length, 1);
    assert.equal(events[0].tile, 13);
    assert.equal(events[0].source, "kongDiscard");
    assert.deepEqual(events[0].payments, [
      {
        seat: 0,
        delta: -events[0].points,
      },
      {
        seat: 1,
        delta: events[0].points,
      },
    ]);
    assert.equal(events[0].fromSeat, 0);
    assert.equal(
      view.game.players[2].score,
      -1,
      "bystander pays its original kong fee but no kong-discard hu fee",
    );
    assert.match(events[0].message, /仅出牌者付款/);
    assert.doesNotMatch(events[0].message, /按自摸/);
  }
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  assertLatest((await api.store.get(api.roomId)).game);
});
// 场景：v3 HTTP 第三家杠后弃牌胡八分只由第一家支付，重连后保持结果且拒绝重复扣分
// Scenario: v3 HTTP seat-three eight-point kong-discard win charges only seat one, survives reconnect and rejects duplicate charges
test("v3 HTTP seat-three eight-point kong-discard win charges only seat one, survives reconnect and rejects duplicate charges", async (t) => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  const { DEFAULT_RULES, assertGameInvariants: assertLatest } = await import(
    "../shared/game.js"
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  // 逐项覆盖 ['enabled','disabled','absent']；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in ['enabled','disabled','absent'] with the same checks, preserving the listed order.
  for (const paymentFlags of ["enabled", "disabled", "absent"]) {
    const api = await table(t);
    const game = apiFixture({
      wins: [[7], [], []],
      kongSeats: [0],
      head: [6],
    });
    game.schemaVersion = 3;
    game.rules = {
      ...structuredClone(DEFAULT_RULES),
      allowPungUpgrade: true,
      baseFan: 4,
      specialHuPatterns: false,
    };
    // 逐项覆盖 ['selfDrawOnlyUnwon','finalHuPaymentExceptions']；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in ['selfDrawOnlyUnwon','finalHuPaymentExceptions'] with the same checks, preserving the listed order.
    for (const key of ["selfDrawOnlyUnwon", "finalHuPaymentExceptions"]) {
      // 两项付款配置均删除，模拟引入开关前保存的牌局。
      // Remove both payment flags to model a game saved before they existed.
      if (paymentFlags === "absent") delete game.rules[key];
      else game.rules[key] = paymentFlags === "enabled";
    }
    game.firstHuRadishesRevealed = true;
    game.dragonSettlement = {
      settled: false,
      entries: [],
    };
    assertLatest(game);
    let views = await installFixture(api, game);
    let answer = await api.host.action(views[0].revision, {
      type: "discard",
      tile: 17,
    });
    assert.equal(answer.status, 200);
    answer = await api.clients[1].action(answer.body.state.revision, {
      type: "pass",
    });
    assert.equal(answer.status, 200);
    const revision = answer.body.state.revision;
    const answers = await Promise.all([
      api.clients[2].action(revision, {
        type: "hu",
      }),
      api.clients[2].action(revision, {
        type: "hu",
      }),
    ]);
    assert.deepEqual(answers.map((result) => result.status).sort(), [200, 409]);
    assertError(
      answers.find((result) => result.status === 409),
      409,
      "STALE_STATE",
    );
    views = await snapshots(api.clients);
    const reconnected = client(api, api.roomId, api.clients[2].token, 2);
    views.push((await reconnected.get()).body.state);
    // 逐项覆盖 views；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in views with the same checks, preserving the listed order.
    for (const view of views) {
      const events = view.game.history.filter((event) => event.type === "hu");
      assert.equal(events.length, 1);
      assert.equal(events[0].seat, 2);
      assert.equal(events[0].tile, 17);
      assert.equal(events[0].source, "kongDiscard");
      assert.equal(events[0].fromSeat, 0);
      assert.equal(events[0].points, 8);
      assert.deepEqual(events[0].payments, [
        {
          seat: 0,
          delta: -8,
        },
        {
          seat: 2,
          delta: 8,
        },
      ]);
      assert.deepEqual(
        view.game.players.map((player) => player.score),
        [-8, 0, 8],
      );
      assert.match(events[0].message, /仅出牌者付款/);
      assert.doesNotMatch(events[0].message, /按自摸|另外两家/);
    }
    assertLatest((await api.store.get(api.roomId)).game);
  }
});
// 场景：v3 HTTP 胡后强制杠拒绝旧客户端的过牌和出牌请求且不修改状态，重连后仍生效
// Scenario: v3 HTTP mandatory post-hu kongs reject old-client pass and discard without mutation and survive reconnect
test("v3 HTTP mandatory post-hu kongs reject old-client pass and discard without mutation and survive reconnect", async (t) => {
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  // 逐项覆盖 ['anGang','buGang','addGang']；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in ['anGang','buGang','addGang'] with the same checks, preserving the listed order.
  for (const type of ["anGang", "buGang", "addGang"]) {
    const api = await table(t);
    const game = postHuKongGame({
      type,
    });
    const tile = game.lastDraw.tile;
    const views = await installFixture(api, game);
    const before = await api.store.get(api.roomId);
    assert.deepEqual(views[0].game.legalActions, [
      {
        type,
        tile,
      },
    ]);
    // 逐项覆盖 [{type:'pass'},{type:'discard',tile}]；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in [{type:'pass'},{type:'discard',tile}] with the same checks, preserving the listed order.
    for (const action of [
      {
        type: "pass",
      },
      {
        type: "discard",
        tile,
      },
    ]) {
      assertError(
        await api.host.action(views[0].revision, action),
        422,
        "ILLEGAL_ACTION",
      );
      assert.deepEqual(await api.store.get(api.roomId), before);
    }
    const restored = client(api, api.roomId, api.host.token, 0);
    const reconnected = (await restored.get()).body.state;
    assert.equal(reconnected.revision, views[0].revision);
    assert.deepEqual(reconnected.game, views[0].game);
    const result = await restored.action(reconnected.revision, {
      type,
      tile,
    });
    assert.equal(result.status, 200);
    assert.equal(
      result.body.state.game.history.filter((event) => event.type === type)
        .length,
      1,
    );
    assert.equal(
      result.body.state.game.history.filter(
        (event) => event.type === "draw" && event.source === "replacement",
      ).length,
      1,
    );
    assert.ok(
      result.body.state.game.legalActions.some(
        (action) => action.type === "hu",
      ),
    );
    assert.ok(
      result.body.state.game.legalActions.some(
        (action) => action.type === "pass",
      ),
    );
  }
});
// 场景：v3 HTTP 已保存的五张杠可扩为六、七、八张，每次付费补牌只执行一次
// Scenario: v3 HTTP extends a saved five-tile kong through six, seven and eight exactly once per paid replacement
test("v3 HTTP extends a saved five-tile kong through six, seven and eight exactly once per paid replacement", async (t) => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  const { DEFAULT_RULES, assertGameInvariants: assertLatest } = await import(
    "../shared/game.js"
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  // 逐项覆盖 ['anGang','buGang']；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in ['anGang','buGang'] with the same checks, preserving the listed order.
  for (const meldType of ["anGang", "buGang"]) {
    const api = await table(t);
    const noTwo = WAITING_HAND.map((tile) => (tile === 2 ? 6 : tile));
    const game = apiFixture({
      hands: [[2, 3, 4, 5, 6, 7, 8, 10, 11, 17, 17], noTwo, noTwo],
      melds: [
        [
          {
            type: meldType,
            tile: 2,
            tiles: Array(5).fill(2),
            extended: true,
          },
        ],
        [],
        [],
      ],
      wins: [[9], [], []],
      drawTile: 2,
      head: [2, 2, 9],
      tail: [15, 16, 8],
    });
    game.schemaVersion = 3;
    game.rules = {
      ...structuredClone(DEFAULT_RULES),
      allowPungUpgrade: true,
      turnDirection: "clockwise",
      specialHuPatterns: false,
    };
    game.firstHuRadishesRevealed = true;
    game.dragonSettlement = {
      settled: false,
      entries: [],
    };
    game.players[0].kongCount = 2;
    assertLatest(game);
    let views = await installFixture(api, game);
    // 逐项覆盖 [6,7,8]；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in [6,7,8] with the same checks, preserving the listed order.
    for (const size of [6, 7, 8]) {
      assert.deepEqual(views[0].game.legalActions, [
        {
          type: "addGang",
          tile: 2,
        },
      ]);
      const revision = views[0].revision;
      const answers = await Promise.all([
        api.host.action(revision, {
          type: "addGang",
          tile: 2,
        }),
        api.host.action(revision, {
          type: "addGang",
          tile: 2,
        }),
      ]);
      assert.deepEqual(
        answers.map((answer) => answer.status).sort(),
        [200, 409],
      );
      assertError(
        answers.find((answer) => answer.status === 409),
        409,
        "STALE_STATE",
      );
      const after = (await api.store.get(api.roomId)).game;
      assertError(
        await api.host.action(revision, {
          type: "addGang",
          tile: 2,
        }),
        409,
        "STALE_STATE",
      );
      assert.deepEqual((await api.store.get(api.roomId)).game, after);
      views = await snapshots(api.clients);
      const count = size - 5;
      // 逐项覆盖 views；同一组检查用于每个样本，顺序以代码列出的集合为准。
      // Exercise each entry in views with the same checks, preserving the listed order.
      for (const view of views) {
        assertPrivateView(
          view,
          view.you,
          api.clients.map((player) => player.token),
        );
        assert.deepEqual(
          view.game.players.map((player) => player.score),
          [count * 2, -count, -count],
        );
        assert.deepEqual(
          view.game.players[0].radishes,
          [8, 16, 15].slice(0, count),
        );
        assert.equal(view.game.players[0].kongCount, 2 + count);
        assert.equal(view.game.wallCount, game.wall.length - count * 2);
        const meld = view.game.players[0].melds[0];
        assert.equal(meld.type, meldType);
        assert.deepEqual(
          meld.tiles,
          Array(size).fill(meldType === "anGang" && view.you !== 0 ? null : 2),
        );
        assert.equal(
          meld.tile,
          meldType === "anGang" && view.you !== 0 ? null : 2,
        );
        const events = view.game.history.filter(
          (event) => event.type === "addGang",
        );
        assert.equal(events.length, count);
        assert.deepEqual(events.at(-1).payments, [
          {
            seat: 1,
            delta: -1,
          },
          {
            seat: 2,
            delta: -1,
          },
          {
            seat: 0,
            delta: 2,
          },
        ]);
        assert.equal(events.at(-1).tile, meldType === "anGang" ? undefined : 2);
        const replacements = view.game.history.filter(
          (event) => event.type === "draw" && event.source === "replacement",
        );
        assert.equal(replacements.length, count);
        assert.ok(replacements.every((event) => event.tile === undefined));
      }
      assertLatest(after);
      const restored = client(api, api.roomId, api.host.token, 0);
      assert.deepEqual((await restored.get()).body.state.game, views[0].game);
    }
    assert.equal(views[0].game.players[0].melds[0].tiles.length, 8);
    assert.equal(
      views[0].game.legalActions.some((action) => action.type === "addGang"),
      false,
    );
    const beforeNinth = (await api.store.get(api.roomId)).game;
    assertError(
      await api.host.action(views[0].revision, {
        type: "addGang",
        tile: 2,
      }),
      422,
      "ILLEGAL_ACTION",
    );
    assert.deepEqual((await api.store.get(api.roomId)).game, beforeNinth);
    const won = await api.host.action(views[0].revision, {
      type: "hu",
    });
    assert.equal(won.status, 200);
    const score = won.body.state.game.history.find(
      (event) => event.type === "hu",
    ).score;
    assert.equal(score.copyFanBonus, 5);
    assert.equal(score.fan, 6);
    assertLatest((await api.store.get(api.roomId)).game);
  }
});
// 场景：HTTP 已保存的旧版与 v2 牌局保留五张杠上限，不转交 v3 处理
// Scenario: HTTP saved legacy and v2 games retain the five-tile kong limit rather than routing through v3
test("HTTP saved legacy and v2 games retain the five-tile kong limit rather than routing through v3", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const { DEFAULT_RULES: LEGACY_RULES } = await import(
    "../shared/legacy-game.js"
  );
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  // 逐项覆盖 [undefined,1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [undefined,1,2] with the same checks, preserving the listed order.
  for (const schemaVersion of [undefined, 1, 2]) {
    const api = await table(t);
    const noTwo = WAITING_HAND.map((tile) => (tile === 2 ? 6 : tile));
    const game = apiFixture({
      hands: [[2, 3, 4, 5, 6, 7, 8, 10, 11, 17, 17], noTwo, noTwo],
      melds: [
        [
          {
            type: "anGang",
            tile: 2,
            tiles: Array(5).fill(2),
            extended: true,
          },
        ],
        [],
        [],
      ],
      drawTile: 2,
    });
    // 无版本场景必须删除版本字段，让真实版本路由执行兼容判断。
    // Delete the version field for unversioned saves so real compatibility routing is exercised.
    if (schemaVersion === undefined) delete game.schemaVersion;
    else game.schemaVersion = schemaVersion;
    // 非第二版的旧局使用独立的 legacy 规则，不能混入第二版默认配置。
    // Non-v2 legacy games use their own rules rather than v2 defaults.
    if (schemaVersion !== 2) game.rules = structuredClone(LEGACY_RULES);
    const views = await installFixture(api, game);
    assert.equal(views[0].game.schemaVersion, schemaVersion === 2 ? 2 : 1);
    assert.equal(
      views[0].game.legalActions.some((action) => action.type === "addGang"),
      false,
    );
    const before = (await api.store.get(api.roomId)).game;
    assertError(
      await api.host.action(views[0].revision, {
        type: "addGang",
        tile: 2,
      }),
      422,
      "ILLEGAL_ACTION",
    );
    assert.deepEqual((await api.store.get(api.roomId)).game, before);
    const restored = client(api, api.roomId, api.host.token, 0);
    assert.deepEqual((await restored.get()).body.state.game, views[0].game);
  }
});
// 场景：v3 HTTP 明杠补牌胡只由供杠者支付，旧状态重连后保持归属，继续行动后清除该归属
// Scenario: v3 HTTP exposed-kong replacement hu charges only its source, survives old-state reconnect and clears on continuation
test("v3 HTTP exposed-kong replacement hu charges only its source, survives old-state reconnect and clears on continuation", async (t) => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  const { DEFAULT_RULES, assertGameInvariants: assertLatest } = await import(
    "../shared/game.js"
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  // 逐项覆盖 [false,true]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [false,true] with the same checks, preserving the listed order.
  // 逐项覆盖 [false,true]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  for (const savedWithoutProvenance of [false, true])
    for (const thirdHasHu of [false, true]) {
      const api = await table(t);
      const receiver = [2, 2, 2, 3, 4, 5, 6, 7, 8, 10, 11, 17, 17];
      const game = apiFixture({
        hands: [[...WAITING_HAND, 2], receiver, WAITING_HAND],
        wins: [[], [], thirdHasHu ? [16] : []],
        drawTile: 2,
        head: [9, 9, 6],
        tail: [15],
      });
      game.schemaVersion = 3;
      game.rules = {
        ...structuredClone(DEFAULT_RULES),
        allowPungUpgrade: true,
        turnDirection: "clockwise",
        specialHuPatterns: false,
      };
      game.firstHuRadishesRevealed = true;
      game.dragonSettlement = {
        settled: false,
        entries: [],
      };
      assertLatest(game);
      let views = await installFixture(api, game);
      let result = await api.host.action(views[0].revision, {
        type: "discard",
        tile: 2,
      });
      assert.equal(result.status, 200);
      result = await api.clients[1].action(result.body.state.revision, {
        type: "mingGang",
        tile: 2,
      });
      assert.equal(result.status, 200);
      const pending = (await api.store.get(api.roomId)).game;
      assert.deepEqual(pending.lastDraw.kongSource, {
        type: "mingGang",
        fromSeat: 0,
      });
      assert.equal(pending.lastDraw.tile, 9);
      // 删除补牌来源字段模拟旧存档，再检查重连是否能安全恢复明确的来源。
      // Remove replacement provenance to model an old save, then test safe recovery on reconnect.
      if (savedWithoutProvenance) {
        delete pending.lastDraw.kongSource;
        await installFixture(api, pending);
      }
      const restored = client(api, api.roomId, api.clients[1].token, 1);
      const reconnected = (await restored.get()).body.state;
      assert.ok(
        reconnected.game.legalActions.some((action) => action.type === "hu"),
      );
      const scores = reconnected.game.players.map((player) => player.score);
      assert.deepEqual(scores, [-2, 2, 0]);
      const revision = reconnected.revision;
      const answers = await Promise.all([
        restored.action(revision, {
          type: "hu",
        }),
        restored.action(revision, {
          type: "hu",
        }),
      ]);
      assert.deepEqual(
        answers.map((answer) => answer.status).sort(),
        [200, 409],
      );
      assertError(
        answers.find((answer) => answer.status === 409),
        409,
        "STALE_STATE",
      );
      views = await snapshots(api.clients);
      // 逐项覆盖 views；同一组检查用于每个样本，顺序以代码列出的集合为准。
      // Exercise each entry in views with the same checks, preserving the listed order.
      for (const view of views) {
        const events = view.game.history.filter((event) => event.type === "hu");
        assert.equal(events.length, 1);
        const event = events[0];
        assert.equal(event.source, "selfDraw");
        assert.equal(event.fromSeat, null);
        assert.deepEqual(event.kongSource, {
          type: "mingGang",
          fromSeat: 0,
        });
        assert.deepEqual(event.payments, [
          {
            seat: 0,
            delta: -event.points,
          },
          {
            seat: 1,
            delta: event.points,
          },
        ]);
        assert.deepEqual(
          view.game.players.map((player, seat) => player.score - scores[seat]),
          [-event.points, event.points, 0],
        );
      }
      const continued = (await api.store.get(api.roomId)).game;
      assert.equal(continued.lastDraw.source, "continuation");
      assert.equal(continued.lastDraw.kongSource, undefined);
      result = await restored.action(views[1].revision, {
        type: "hu",
      });
      assert.equal(result.status, 200);
      const second = result.body.state.game.history.filter(
        (event) => event.type === "hu",
      )[1];
      assert.equal(second.kongSource, undefined);
      assert.deepEqual(
        second.payments
          .filter((payment) => payment.delta < 0)
          .map((payment) => payment.seat),
        thirdHasHu ? [0] : [0, 2],
      );
      assertLatest((await api.store.get(api.roomId)).game);
    }
});
// 场景：v3 HTTP 自己杠后补牌胡由两名对手支付，即使其中一人已胡牌
// Scenario: v3 HTTP own-kong replacement hu charges both opponents even when one has already won
test("v3 HTTP own-kong replacement hu charges both opponents even when one has already won", async (t) => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  const { assertGameInvariants: assertLatest } = await import(
    "../shared/game.js"
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  // 逐项覆盖 ['anGang','buGang','addGang']；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in ['anGang','buGang','addGang'] with the same checks, preserving the listed order.
  for (const type of ["anGang", "buGang", "addGang"]) {
    const api = await table(t);
    const game = postHuKongGame({
      type,
    });
    const priorTile = 13;
    game.wall.splice(game.wall.indexOf(priorTile), 1);
    game.retiredTiles.push({
      seat: 1,
      tile: priorTile,
    });
    game.players[1].huCount = 1;
    game.players[1].winPile = [
      {
        tile: priorTile,
        source: "selfDraw",
        virtual: false,
      },
    ];
    assertLatest(game);
    let views = await installFixture(api, game);
    let result = await api.host.action(views[0].revision, {
      type,
      tile: game.lastDraw.tile,
    });
    assert.equal(result.status, 200);
    const pending = (await api.store.get(api.roomId)).game;
    assert.deepEqual(pending.lastDraw.kongSource, {
      type,
      fromSeat: null,
    });
    const scores = result.body.state.game.players.map((player) => player.score);
    const restored = client(api, api.roomId, api.host.token, 0);
    const revision = (await restored.get()).body.state.revision;
    const answers = await Promise.all([
      restored.action(revision, {
        type: "hu",
      }),
      restored.action(revision, {
        type: "hu",
      }),
    ]);
    assert.deepEqual(answers.map((answer) => answer.status).sort(), [200, 409]);
    views = await snapshots(api.clients);
    // 逐项覆盖 views；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in views with the same checks, preserving the listed order.
    for (const view of views) {
      const events = view.game.history.filter((event) => event.type === "hu");
      assert.equal(events.length, 1);
      const event = events[0];
      assert.equal(event.source, "selfDraw");
      assert.deepEqual(event.kongSource, {
        type,
        fromSeat: null,
      });
      assert.deepEqual(event.payments, [
        {
          seat: 1,
          delta: -event.points,
        },
        {
          seat: 2,
          delta: -event.points,
        },
        {
          seat: 0,
          delta: event.points * 2,
        },
      ]);
      assert.deepEqual(
        view.game.players.map((player, seat) => player.score - scores[seat]),
        [event.points * 2, -event.points, -event.points],
      );
    }
    assertLatest((await api.store.get(api.roomId)).game);
  }
});
// 场景：v3 HTTP 明杠后待结算的最后一家首次胡牌仍只有一个付款方，并在个人历史中保留安全的来源信息
// Scenario: v3 HTTP pending final first-hu after exposed-kong still has one payer and preserves safe provenance in profile history
test("v3 HTTP pending final first-hu after exposed-kong still has one payer and preserves safe provenance in profile history", async (t) => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  const { DEFAULT_RULES, assertGameInvariants: assertLatest } = await import(
    "../shared/game.js"
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const receiver = [3, 4, 5, 6, 7, 8, 9, 10, 11, 17, 17];
  const game = apiFixture({
    hands: [WAITING_HAND, receiver, WAITING_HAND],
    melds: [
      [],
      [
        {
          type: "mingGang",
          tile: 2,
          tiles: [2, 2, 2, 2],
          fromSeat: 0,
        },
      ],
      [],
    ],
    wins: [[16], [], [16]],
    currentSeat: 1,
    drawTile: 9,
    head: [6],
  });
  game.schemaVersion = 3;
  game.rules = {
    ...structuredClone(DEFAULT_RULES),
    allowPungUpgrade: true,
    turnDirection: "clockwise",
    specialHuPatterns: false,
  };
  game.firstHuRadishesRevealed = true;
  game.dragonSettlement = {
    settled: false,
    entries: [],
  };
  game.drawKind = "replacement";
  game.lastDraw.source = "replacement";
  game.lastDraw.kongSource = {
    type: "mingGang",
    fromSeat: 0,
  };
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assertLatest(game);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let views = await installFixture(api, game);
  const result = await api.clients[1].action(views[1].revision, {
    type: "hu",
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(result.status, 200);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  views = await snapshots(api.clients);
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 views；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in views with the same checks, preserving the listed order.
  for (const view of views) {
    assert.equal(view.game.finishReason, "allPlayersHu");
    assert.equal(view.game.wallCount, game.wall.length);
    const event = view.game.history.find((item) => item.type === "hu");
    assert.deepEqual(event.kongSource, {
      type: "mingGang",
      fromSeat: 0,
    });
    assert.deepEqual(event.payments, [
      {
        seat: 0,
        delta: -event.points,
      },
      {
        seat: 1,
        delta: event.points,
      },
    ]);
    assert.equal(view.game.players[2].score, 0);
  }
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const profile = await api.request("/api/profile", {
    method: "POST",
    body: {},
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(profile.status, 201);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const profileToken = profile.body.playerToken;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const bound = await api.request(`/api/rooms/${api.roomId}/resume`, {
    method: "POST",
    token: api.clients[1].token,
    body: {
      profileToken,
    },
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(bound.status, 200);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const history = await api.request("/api/profile/history", {
    token: profileToken,
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(history.status, 200);
  assert.equal(history.body.records.length, 1);
  assert.deepEqual(
    history.body.records[0].events.find((event) => event.type === "hu")
      .kongSource,
    {
      type: "mingGang",
      fromSeat: 0,
    },
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const serialized = JSON.stringify(history.body);
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  // 逐项覆盖 [profileToken,...api.clients.map(player=>player.token)]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [profileToken,...api.clients.map(player=>player.token)] with the same checks, preserving the listed order.
  for (const secret of [
    profileToken,
    ...api.clients.map((player) => player.token),
  ])
    assert.equal(serialized.includes(secret), false);
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.doesNotMatch(
    serialized,
    /"(?:hand|wall|lastDraw|drawnTile|tokenHash|playerHash)":/,
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  assertLatest((await api.store.get(api.roomId)).game);
});
// 场景：v3 特殊七对再次胡牌的扩展听口仅对本人公开，且重连后保留
// Scenario: v3 special seven-pairs repeat exposes expanded waits only to its owner and persists through reconnect
test("v3 special seven-pairs repeat exposes expanded waits only to its owner and persists through reconnect", async (t) => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  const { DEFAULT_RULES, assertGameInvariants: assertLatest } = await import(
    "../shared/game.js"
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hand = [0, 0, 2, 2, 4, 4, 6, 6, 9, 9, 11, 11, 13, 13];
  const game = apiFixture({
    hands: [hand, WAITING_HAND, WAITING_HAND],
    drawTile: 13,
    head: [2, 7],
    tail: [8, 8, 8, 15, 15, 15],
  });
  game.schemaVersion = 3;
  game.rules = {
    ...structuredClone(DEFAULT_RULES),
    allowPungUpgrade: true,
  };
  game.firstHuRadishesRevealed = false;
  game.dragonSettlement = {
    settled: false,
    entries: [],
  };
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assertLatest(game);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const views = await installFixture(api, game);
  let answer = await api.host.action(views[0].revision, {
    type: "hu",
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(answer.status, 200);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let snapshotsNow = await snapshots(api.clients);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(snapshotsNow[0].game.waitTiles, [0, 2, 4, 6, 9, 11, 13]);
  assert.equal(snapshotsNow[0].game.specialHuPattern.kind, "sevenPairs");
  assert.equal(snapshotsNow[0].game.drawnTile, 2);
  assert.ok(
    snapshotsNow[0].game.legalActions.some((action) => action.type === "hu"),
  );
  assert.equal(snapshotsNow[1].game.specialHuPattern, null);
  assert.equal(snapshotsNow[2].game.specialHuPattern, null);
  // 逐项覆盖 snapshotsNow；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in snapshotsNow with the same checks, preserving the listed order.
  // Exercise each entry in snapshot.game.players with the same checks, preserving the listed order.
  // 逐项覆盖 snapshot.game.players；同一组检查用于每个样本，顺序以代码列出的集合为准。
  for (const snapshot of snapshotsNow)
    for (const player of snapshot.game.players)
      assert.equal(player.firstHuPattern, undefined);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const reconnected = client(api, api.roomId, api.host.token, 0);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.deepEqual(
    (await reconnected.get()).body.state.game.specialHuPattern,
    snapshotsNow[0].game.specialHuPattern,
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  answer = await api.host.action(snapshotsNow[0].revision, {
    type: "hu",
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(answer.status, 200);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  snapshotsNow = await snapshots(api.clients);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(snapshotsNow[0].game.players[0].huCount, 2);
  assert.equal(snapshotsNow[0].game.players[0].winPile.at(-1).tile, 2);
  assert.equal(snapshotsNow[0].game.players[0].hand.length, 13);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  assertLatest((await api.store.get(api.roomId)).game);
});
// 构造可抢杠的 HTTP 场景，分别控制加杠者、抢杠者已胡状态和补牌来源。
// Build an HTTP rob-kong scenario with controlled upgrader/receiver win status and replacement provenance.
async function robKongHttpFixture({
  sourceWon = false,
  replacement = false,
  receiverWon = false,
  type = "buGang",
  currentSeat = 0,
} = {}) {
  const { DEFAULT_RULES, assertGameInvariants: assertLatest } = await import(
    "../shared/game.js"
  );
  const hands = [WAITING_HAND, WAITING_HAND, WAITING_HAND].map((hand) => [
    ...hand,
  ]);
  hands[currentSeat] = [0, 1, 2, 3, 4, 5, 9, 10, 11, 15, 17];
  const melds = [[], [], []];
  melds[currentSeat] = [
    {
      type: type === "buGang" ? "peng" : "buGang",
      tile: 17,
      tiles: Array(type === "buGang" ? 3 : 4).fill(17),
    },
  ];
  const wins = [[], [], []];
  // 为出牌/加杠来源设置已胡状态，用于验证已胡来源保护与补牌例外。
  // Mark the source as already won to exercise source protection and replacement exceptions.
  if (sourceWon) wins[currentSeat] = [15];
  // 设置接收者曾经胡牌，检验连续胡和锁定规则而非仅首次胡。
  // Mark the receiver as previously won to test repeat-win/lock behavior rather than first wins only.
  if (receiverWon) wins[(currentSeat + 1) % 3] = [16];
  const game = apiFixture({
    hands,
    melds,
    wins,
    currentSeat,
    drawTile: 17,
    head: [15, 8],
    tail: [7],
  });
  game.schemaVersion = 3;
  game.rules = {
    ...structuredClone(DEFAULT_RULES),
    allowPungUpgrade: true,
    turnDirection: "clockwise",
    specialHuPatterns: false,
  };
  game.firstHuRadishesRevealed = true;
  game.dragonSettlement = {
    settled: false,
    entries: [],
  };
  // 明确标记补牌来源，使杠后行为与普通自然摸牌的计分/保护分支分开。
  // Mark replacement provenance so kong continuation differs from ordinary natural-draw policy.
  if (replacement) {
    game.lastDraw.source = "replacement";
    game.drawKind = "replacement";
    game.lastDraw.kongSource = {
      type: "anGang",
      fromSeat: null,
    };
    game.players[currentSeat].pendingKongDiscard = true;
  }
  // 设置接收者曾经胡牌，检验连续胡和锁定规则而非仅首次胡。
  // Mark the receiver as previously won to test repeat-win/lock behavior rather than first wins only.
  if (receiverWon) {
    const receiver = game.players[(currentSeat + 1) % 3];
    receiver.huLockActive = true;
    receiver.lockedWaits = [17];
  }
  assertLatest(game);
  return game;
}
// 场景：v3 HTTP 抢杠开启可持久化的仅胡响应窗口，尚不提交杠费、萝卜或副露变更
// Scenario: v3 HTTP rob-kong opens a persistent hu-only window without committing fees, radishes or the meld
test("v3 HTTP rob-kong opens a persistent hu-only window without committing fees, radishes or the meld", async (t) => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  const { assertGameInvariants: assertLatest } = await import(
    "../shared/game.js"
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  // 逐项覆盖 ['buGang','addGang']；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in ['buGang','addGang'] with the same checks, preserving the listed order.
  for (const type of ["buGang", "addGang"]) {
    const api = await table(t);
    const initial = await robKongHttpFixture({
      type,
    });
    const views = await installFixture(api, initial);
    const revision = views[0].revision;
    const answers = await Promise.all([
      api.host.action(revision, {
        type,
        tile: 17,
      }),
      api.host.action(revision, {
        type,
        tile: 17,
      }),
    ]);
    assert.deepEqual(answers.map((answer) => answer.status).sort(), [200, 409]);
    let states = await snapshots(api.clients);
    assert.equal(states[0].game.phase, "claim");
    assert.deepEqual(states[0].game.legalActions, []);
    // 逐项覆盖 [1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in [1,2] with the same checks, preserving the listed order.
    for (const seat of [1, 2])
      assert.deepEqual(
        states[seat].game.legalActions.map((action) => action.type).sort(),
        ["hu", "pass"],
      );
    let stored = (await api.store.get(api.roomId)).game;
    assert.deepEqual(
      stored.players.map((player) => player.score),
      [0, 0, 0],
    );
    assert.deepEqual(stored.players[0].melds, initial.players[0].melds);
    assert.deepEqual(
      stored.players.map((player) => player.radishes),
      [[], [], []],
    );
    assert.equal(stored.wall.length, initial.wall.length);
    assert.equal(
      stored.history.filter((event) => event.type === type).length,
      0,
    );
    assertLatest(stored);
    const restored = client(api, api.roomId, api.clients[1].token, 1);
    assert.deepEqual((await restored.get()).body.state.game, states[1].game);
    // 逐项覆盖 [{type:'peng',tile:17},{type:'mingGang',tile:17}]；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in [{type:'peng',tile:17},{type:'mingGang',tile:17}] with the same checks, preserving the listed order.
    for (const action of [
      {
        type: "peng",
        tile: 17,
      },
      {
        type: "mingGang",
        tile: 17,
      },
    ]) {
      assertError(
        await restored.action(states[1].revision, action),
        422,
        "ILLEGAL_ACTION",
      );
      assert.deepEqual((await api.store.get(api.roomId)).game, stored);
    }
    const passed = await restored.action(states[1].revision, {
      type: "pass",
    });
    assert.equal(passed.status, 200);
    states = await snapshots(api.clients);
    assert.equal(states[0].game.phase, "claim");
    assert.deepEqual(states[1].game.legalActions, []);
    assert.equal(states[0].game.wallCount, initial.wall.length);
    const committed = await api.clients[2].action(states[2].revision, {
      type: "pass",
    });
    assert.equal(committed.status, 200);
    stored = (await api.store.get(api.roomId)).game;
    assert.equal(
      stored.players[0].melds[0].tiles.length,
      initial.players[0].melds[0].tiles.length + 1,
    );
    assert.deepEqual(
      stored.players.map((player) => player.score),
      [2, -1, -1],
    );
    assert.deepEqual(stored.players[0].radishes, [7]);
    assert.equal(stored.wall.length, initial.wall.length - 2);
    assert.equal(
      stored.history.filter((event) => event.type === type).length,
      1,
    );
    assert.equal(
      stored.history.filter(
        (event) => event.type === "draw" && event.source === "replacement",
      ).length,
      1,
    );
    assertLatest(stored);
  }
});
// 场景：v3 HTTP 抢杠双胡始终按顺时针结算，不受响应顺序影响，且仅向加杠者扣款一次
// Scenario: v3 HTTP rob-kong settles both winners clockwise regardless of response order and charges only the upgrader once
test("v3 HTTP rob-kong settles both winners clockwise regardless of response order and charges only the upgrader once", async (t) => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  const { assertGameInvariants: assertLatest } = await import(
    "../shared/game.js"
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  // 逐项覆盖 [0,1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [0,1,2] with the same checks, preserving the listed order.
  // Exercise each entry in [false,true] with the same checks, preserving the listed order.
  // 逐项覆盖 [false,true]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  for (const sourceSeat of [0, 1, 2])
    for (const reverse of [false, true]) {
      const api = await table(t);
      const initial = await robKongHttpFixture({
        currentSeat: sourceSeat,
      });
      const views = await installFixture(api, initial);
      const opened = await api.clients[sourceSeat].action(
        views[sourceSeat].revision,
        {
          type: "buGang",
          tile: 17,
        },
      );
      assert.equal(opened.status, 200);
      const clockwise = [(sourceSeat + 1) % 3, (sourceSeat + 2) % 3];
      const responseOrder = reverse ? [...clockwise].reverse() : clockwise;
      let revision = opened.body.state.revision;
      const first = await api.clients[responseOrder[0]].action(revision, {
        type: "hu",
      });
      assert.equal(first.status, 200);
      assert.equal(
        first.body.state.game.history.filter((event) => event.type === "hu")
          .length,
        0,
      );
      revision = first.body.state.revision;
      const answers = await Promise.all([
        api.clients[responseOrder[1]].action(revision, {
          type: "hu",
        }),
        api.clients[responseOrder[1]].action(revision, {
          type: "hu",
        }),
      ]);
      assert.deepEqual(
        answers.map((answer) => answer.status).sort(),
        [200, 409],
      );
      const stored = (await api.store.get(api.roomId)).game;
      const events = stored.history.filter((event) => event.type === "hu");
      assert.deepEqual(
        events.map((event) => event.seat),
        clockwise,
      );
      // 逐项覆盖 events；同一组检查用于每个样本，顺序以代码列出的集合为准。
      // Exercise each entry in events with the same checks, preserving the listed order.
      for (const event of events) {
        assert.equal(event.source, "robKong");
        assert.equal(event.fromSeat, sourceSeat);
        assert.equal(event.score.fan, 2);
        assert.deepEqual(event.payments, [
          {
            seat: sourceSeat,
            delta: -event.points,
          },
          {
            seat: event.seat,
            delta: event.points,
          },
        ]);
      }
      assert.deepEqual(
        stored.players[sourceSeat].melds,
        initial.players[sourceSeat].melds,
      );
      assert.equal(
        stored.players[sourceSeat].kongCount,
        initial.players[sourceSeat].kongCount,
      );
      assert.deepEqual(
        stored.players.map((player) => player.radishes),
        [[], [], []],
      );
      assert.equal(
        stored.history.some((event) => event.type === "buGang"),
        false,
      );
      assert.equal(
        stored.history.some(
          (event) => event.type === "draw" && event.source === "replacement",
        ),
        false,
      );
      assert.equal(
        stored.players[sourceSeat].score,
        -events.reduce((sum, event) => sum + event.points, 0),
      );
      assertLatest(stored);
      const states = await snapshots(api.clients);
      // 逐项覆盖 states；同一组检查用于每个样本，顺序以代码列出的集合为准。
      // Exercise each entry in states with the same checks, preserving the listed order.
      for (const state of states)
        assert.deepEqual(
          state.game.history.filter((event) => event.type === "hu"),
          events,
        );
      assertError(
        await api.clients[responseOrder[1]].action(revision, {
          type: "hu",
        }),
        409,
        "STALE_STATE",
      );
      assert.deepEqual((await api.store.get(api.roomId)).game, stored);
    }
});
// 场景：v3 HTTP 已胡牌的加杠者在普通摸牌时受保护，但补牌后的加杠可被听口锁定的已胡玩家抢胡
// Scenario: v3 HTTP already-won upgrader is protected on ordinary draw but replacement upgrade is robbable by locked previous winners
test("v3 HTTP already-won upgrader is protected on ordinary draw but replacement upgrade is robbable by locked previous winners", async (t) => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  const { assertGameInvariants: assertLatest } = await import(
    "../shared/game.js"
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  // 逐项覆盖 [false,true]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [false,true] with the same checks, preserving the listed order.
  for (const replacement of [false, true]) {
    const api = await table(t);
    const initial = await robKongHttpFixture({
      sourceWon: true,
      replacement,
      receiverWon: true,
    });
    const views = await installFixture(api, initial);
    const result = await api.host.action(views[0].revision, {
      type: "buGang",
      tile: 17,
    });
    assert.equal(result.status, 200);
    const states = await snapshots(api.clients);
    // 自然摸牌场景走普通来源路径，不能继承杠后补牌的特权或付款方式。
    // Ordinary draws use normal provenance rather than inheriting kong-replacement exceptions.
    if (!replacement) {
      assert.equal(states[0].game.phase, "turn");
      assert.equal(states[0].game.players[0].melds[0].tiles.length, 4);
      assert.deepEqual(
        states[0].game.players.map((player) => player.score),
        [2, -1, -1],
      );
    } else {
      assert.equal(states[0].game.phase, "claim");
      // 逐项覆盖 [1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
      // Exercise each entry in [1,2] with the same checks, preserving the listed order.
      for (const seat of [1, 2])
        assert.deepEqual(
          states[seat].game.legalActions.map((action) => action.type).sort(),
          ["hu", "pass"],
        );
      const passed = await api.clients[2].action(states[2].revision, {
        type: "pass",
      });
      assert.equal(passed.status, 200);
      const won = await api.clients[1].action(passed.body.state.revision, {
        type: "hu",
      });
      assert.equal(won.status, 200);
      const event = won.body.state.game.history.find(
        (item) => item.type === "hu",
      );
      assert.equal(event.source, "robKong");
      assert.deepEqual(event.payments, [
        {
          seat: 0,
          delta: -event.points,
        },
        {
          seat: 1,
          delta: event.points,
        },
      ]);
      assert.equal(won.body.state.game.players[0].melds[0].tiles.length, 3);
    }
    assertLatest((await api.store.get(api.roomId)).game);
  }
});
// 场景：HTTP 旧版与 v2 加杠保留原有的立即提交行为
// Scenario: HTTP legacy and v2 upgrades keep their original immediate-commit behavior
test("HTTP legacy and v2 upgrades keep their original immediate-commit behavior", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const { DEFAULT_RULES: LEGACY_RULES } = await import(
    "../shared/legacy-game.js"
  );
  const { DEFAULT_RULES: V2_RULES } = await import("../shared/v2-game.js");
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  // 逐项覆盖 [undefined,1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [undefined,1,2] with the same checks, preserving the listed order.
  for (const schemaVersion of [undefined, 1, 2]) {
    const api = await table(t);
    const game = await robKongHttpFixture();
    // 无版本场景必须删除版本字段，让真实版本路由执行兼容判断。
    // Delete the version field for unversioned saves so real compatibility routing is exercised.
    if (schemaVersion === undefined) delete game.schemaVersion;
    else game.schemaVersion = schemaVersion;
    game.rules = structuredClone(schemaVersion === 2 ? V2_RULES : LEGACY_RULES);
    const views = await installFixture(api, game);
    const result = await api.host.action(views[0].revision, {
      type: "buGang",
      tile: 17,
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.notEqual(result.body.state.game.claim?.kind, "robKong");
    assert.equal(result.body.state.game.players[0].melds[0].tiles.length, 4);
    assert.deepEqual(
      result.body.state.game.players.map((player) => player.score),
      schemaVersion === 2 ? [2, -1, -1] : [0, 0, 0],
    );
    assert.equal(
      result.body.state.game.history.filter((event) => event.type === "buGang")
        .length,
      1,
    );
  }
});
// 场景：v3 HTTP 最后一批抢杠胡保持原子性，并保留公开历史而不暴露私有待响应状态
// Scenario: v3 HTTP final rob-kong wins remain atomic and preserve public history without private pending state
test("v3 HTTP final rob-kong wins remain atomic and preserve public history without private pending state", async (t) => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  const { assertGameInvariants: assertLatest } = await import(
    "../shared/game.js"
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t);
  const initial = await robKongHttpFixture({
    sourceWon: true,
    replacement: true,
  });
  const views = await installFixture(api, initial);
  const opened = await api.host.action(views[0].revision, {
    type: "buGang",
    tile: 17,
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(opened.status, 200);
  assert.equal(opened.body.state.game.claim.kind, "robKong");
  assert.equal(opened.body.state.game.claim.kongType, "buGang");
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const first = await api.clients[2].action(opened.body.state.revision, {
    type: "hu",
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(first.status, 200);
  assert.equal(first.body.state.game.phase, "claim");
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const last = await api.clients[1].action(first.body.state.revision, {
    type: "hu",
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(last.status, 200);
  assert.equal(last.body.state.game.finishReason, "allPlayersHu");
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const finished = (await api.store.get(api.roomId)).game;
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  assert.equal(finished.wall.length, initial.wall.length);
  assert.deepEqual(
    finished.history
      .filter((event) => event.type === "hu")
      .map((event) => event.seat),
    [1, 2],
  );
  assert.equal(
    finished.history.some((event) => event.type === "draw"),
    false,
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  assertLatest(finished);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const profile = await api.request("/api/profile", {
    method: "POST",
    body: {},
  });
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const profileToken = profile.body.playerToken;
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  assert.equal(
    (
      await api.request(`/api/rooms/${api.roomId}/resume`, {
        method: "POST",
        token: api.host.token,
        body: {
          profileToken,
        },
      })
    ).status,
    200,
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const history = await api.request("/api/profile/history", {
    token: profileToken,
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(history.status, 200);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const wins = history.body.records[0].events.filter(
    (event) => event.type === "hu",
  );
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  assert.deepEqual(
    wins.map((event) => event.source),
    ["robKong", "robKong"],
  );
  assert.ok(wins.every((event) => event.score.robKongBonus === 1));
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const serialized = JSON.stringify(history.body);
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  // 逐项覆盖 [profileToken,...api.clients.map(player=>player.token)]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [profileToken,...api.clients.map(player=>player.token)] with the same checks, preserving the listed order.
  for (const token of [
    profileToken,
    ...api.clients.map((player) => player.token),
  ])
    assert.equal(serialized.includes(token), false);
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.doesNotMatch(
    serialized,
    /"(?:hand|wall|lastDraw|drawnTile|tokenHash|playerHash|responses|options)":/,
  );
});
// 建立首次胡牌前的杠萝卜延期场景，供 HTTP 保存及重连断言使用。
// Prepare deferred pre-first-win kong-radish state for HTTP persistence and reconnect assertions.
async function deferredRadishHttpFixture(options = {}) {
  const game = await robKongHttpFixture(options);
  game.firstHuRadishesRevealed = false;
  game.pendingKongRadishes = 0;
  return game;
}
// 场景：v3 HTTP 首胡前的杠累加公开待翻数量，不泄露或抽取萝卜，随后首次胡牌只翻七张一次
// Scenario: v3 HTTP pre-first-hu kong accrues a public count without revealing or drawing radishes, then first hu flips seven once
test("v3 HTTP pre-first-hu kong accrues a public count without revealing or drawing radishes, then first hu flips seven once", async (t) => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  const { assertGameInvariants: assertLatest } = await import(
    "../shared/game.js"
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t);
  const initial = await deferredRadishHttpFixture();
  const views = await installFixture(api, initial);
  const opened = await api.host.action(views[0].revision, {
    type: "buGang",
    tile: 17,
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(opened.status, 200);
  assert.equal(opened.body.state.game.pendingKongRadishes, 0);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const { states } = await passClaims(api.clients);
  const beforeHu = (await api.store.get(api.roomId)).game;
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  assert.equal(beforeHu.pendingKongRadishes, 1);
  assert.equal(beforeHu.wall.length, initial.wall.length - 1);
  assert.deepEqual(
    beforeHu.players.map((player) => player.radishes),
    [[], [], []],
  );
  assert.equal(beforeHu.lastDraw.tile, initial.wall[0]);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const event = beforeHu.history.find((event) => event.type === "buGang");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(event.radishDeferred, true);
  assert.equal(event.pendingKongRadishes, 1);
  assert.equal(Object.hasOwn(event, "radish"), false);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  assertLatest(beforeHu);
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  // 逐项覆盖 states；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in states with the same checks, preserving the listed order.
  for (const state of states) {
    assert.equal(state.game.pendingKongRadishes, 1);
    assert.deepEqual(state.game.sharedRadishes, []);
    assert.equal(state.game.wallCount, initial.wall.length - 1);
  }
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const resumed = client(api, api.roomId, api.host.token, 0);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.deepEqual((await resumed.get()).body.state.game, states[0].game);
  assert.ok(states[0].game.legalActions.some((action) => action.type === "hu"));
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const answers = await Promise.all([
    resumed.action(states[0].revision, {
      type: "hu",
    }),
    resumed.action(states[0].revision, {
      type: "hu",
    }),
  ]);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.deepEqual(answers.map((answer) => answer.status).sort(), [200, 409]);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const after = (await api.store.get(api.roomId)).game;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(after.firstHuRadishesRevealed, true);
  assert.equal(after.pendingKongRadishes, 0);
  assert.equal(after.players.flatMap((player) => player.radishes).length, 7);
  assert.deepEqual(
    after.history.find((event) => event.type === "hu").newRadishes,
    beforeHu.wall.slice(-7).reverse(),
  );
  assert.equal(after.history.filter((event) => event.type === "hu").length, 1);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  assertLatest(after);
});
// 场景：v3 HTTP 首次同时胡牌只翻一次基础六张加五次待翻杠萝卜，被抢的杠不增加数量
// Scenario: v3 HTTP first simultaneous hu flips base six plus five pending kongs only once and robbed kong adds nothing
test("v3 HTTP first simultaneous hu flips base six plus five pending kongs only once and robbed kong adds nothing", async (t) => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  const { assertGameInvariants: assertLatest } = await import(
    "../shared/game.js"
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t);
  const initial = await deferredRadishHttpFixture();
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  initial.pendingKongRadishes = 5;
  initial.players[0].kongCount = 5;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const views = await installFixture(api, initial);
  const opened = await api.host.action(views[0].revision, {
    type: "buGang",
    tile: 17,
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(opened.status, 200);
  assert.equal(opened.body.state.game.pendingKongRadishes, 5);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const first = await api.clients[2].action(opened.body.state.revision, {
    type: "hu",
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(first.status, 200);
  assert.equal(first.body.state.game.sharedRadishes.length, 0);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const last = await api.clients[1].action(first.body.state.revision, {
    type: "hu",
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(last.status, 200);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const after = (await api.store.get(api.roomId)).game;
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const hu = after.history.filter((event) => event.type === "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(
    hu.map((event) => event.seat),
    [1, 2],
  );
  assert.deepEqual(
    hu.map((event) => event.newRadishes.length),
    [11, 0],
  );
  assert.equal(after.pendingKongRadishes, 0);
  assert.equal(after.players.flatMap((player) => player.radishes).length, 11);
  assert.equal(after.players[0].kongCount, 5);
  assert.equal(after.players[0].melds[0].tiles.length, 3);
  assert.equal(
    after.history.some((event) => event.type === "buGang"),
    false,
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const restored = await snapshots(api.clients);
  // 核对事件消费或播放顺序；未提交、过期与已消费事件不应重复播报。
  // Check event consumption/playback order; uncommitted, expired or consumed events must not replay.
  // 逐项覆盖 restored；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in restored with the same checks, preserving the listed order.
  for (const state of restored) {
    assert.equal(state.game.sharedRadishes.length, 11);
    assert.equal(state.game.pendingKongRadishes, 0);
  }
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  assertLatest(after);
});
// 场景：v3 HTTP 旧状态中首胡前已翻开的杠萝卜保持公开，首次胡牌不再重复统计
// Scenario: v3 HTTP old exposed pre-first-hu radishes stay exposed and are not counted again on first hu
test("v3 HTTP old exposed pre-first-hu radishes stay exposed and are not counted again on first hu", async (t) => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  const { DEFAULT_RULES, assertGameInvariants: assertLatest } = await import(
    "../shared/game.js"
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const initial = apiFixture({
    radishes: [[7, 8], [], []],
    head: [17, 6],
    tail: [15, 15, 15, 16, 16, 16],
  });
  initial.schemaVersion = 3;
  initial.rules = {
    ...structuredClone(DEFAULT_RULES),
    allowPungUpgrade: true,
  };
  initial.firstHuRadishesRevealed = false;
  initial.dragonSettlement = {
    settled: false,
    entries: [],
  };
  initial.players[0].kongCount = 2;
  delete initial.pendingKongRadishes;
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assertLatest(initial);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const views = await installFixture(api, initial);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(views[0].game.sharedRadishes, [7, 8]);
  assert.equal(views[0].game.pendingKongRadishes, 0);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const answer = await api.host.action(views[0].revision, {
    type: "hu",
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(answer.status, 200);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const after = (await api.store.get(api.roomId)).game;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(after.players[0].radishes.slice(0, 2), [7, 8]);
  assert.equal(after.players.flatMap((player) => player.radishes).length, 8);
  assert.equal(
    after.history.find((event) => event.type === "hu").newRadishes.length,
    6,
  );
  assert.equal(after.pendingKongRadishes, 0);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  assertLatest(after);
});
// 场景：下一局由上一局首位胡牌者坐庄，同时保持房主权限和已归档积分不变
// Scenario: next hand gives dealer to first previous winner while host authorization and archived scores remain intact
test("next hand gives dealer to first previous winner while host authorization and archived scores remain intact", async (t) => {
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  // 逐项覆盖 [0,1,2]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [0,1,2] with the same checks, preserving the listed order.
  for (const winner of [0, 1, 2]) {
    const api = await table(t);
    const room = await api.store.get(api.roomId);
    room.game.phase = "finished";
    room.game.turnStep = null;
    room.game.finishReason = "wallExhausted";
    room.game.history = [
      {
        type: "start",
      },
      {
        type: "hu",
        seat: winner,
        revision: 3,
        message: "首胡",
      },
      {
        type: "hu",
        seat: (winner + 1) % 3,
        revision: 3,
        message: "双响第二家",
      },
    ];
    room.game.players[winner].score = 9;
    room.game.players[(winner + 1) % 3].score = -9;
    await api.store.compareAndSwap(room, room.revision);
    const before = structuredClone(room.game);
    assertError(await api.clients[1].start(room.revision), 403, "HOST_ONLY");
    const start = await api.host.start(room.revision);
    assert.equal(start.status, 200, JSON.stringify(start.body));
    assert.equal(start.body.state.game.dealerSeat, winner);
    assert.equal(start.body.state.game.currentSeat, winner);
    const stored = await api.store.get(api.roomId);
    assert.equal(stored.hostSeat, 0);
    assert.deepEqual(
      stored.archivedGames.at(-1).game.players.map((p) => p.score),
      before.players.map((p) => p.score),
    );
    assert.deepEqual(stored.archivedGames.at(-1).game.history, before.history);
    assert.deepEqual(
      stored.game.players.map((p) => p.hand.length),
      [0, 1, 2].map((s) => (s === winner ? 14 : 13)),
    );
    assert.equal(stored.game.lastDraw.seat, winner);
    // 逐项覆盖 api.clients；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in api.clients with the same checks, preserving the listed order.
    for (const c of api.clients) {
      const reconnect = await c.get();
      assert.equal(reconnect.body.state.game.dealerSeat, winner);
      assert.equal(
        reconnect.body.state.game.legalActions.length > 0,
        c.seat === winner,
      );
    }
    assertError(await api.host.start(room.revision), 409, "STALE_STATE");
    const revision = (await api.host.get()).body.state.revision;
    assertError(await api.host.start(revision), 409, "PLAYING");
  }
});
// 场景：上一局无人胡牌时下一局仍由零号座位起手；已结束旧版牌局则使用其首位胡牌者
// Scenario: next hand with no previous hu keeps original seat-zero opening; starting legacy finished rounds uses their first hu
test("next hand with no previous hu keeps original seat-zero opening; starting legacy finished rounds uses their first hu", async (t) => {
  // 核对牌数据或可见边界，注意本人数据与对手数据的区别。
  // Check tile data or visibility boundaries, distinguishing own data from opponents’ data.
  // 逐项覆盖 [undefined,1,2,3]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [undefined,1,2,3] with the same checks, preserving the listed order.
  for (const schemaVersion of [undefined, 1, 2, 3]) {
    const api = await table(t);
    let room = await api.store.get(api.roomId);
    room.game.schemaVersion = schemaVersion;
    room.game.phase = "finished";
    room.game.turnStep = null;
    room.game.dealerSeat = 2;
    room.game.history = [
      {
        type: "hu",
        seat: 1,
        revision: 1,
      },
    ];
    await api.store.compareAndSwap(room, room.revision);
    let result = await api.host.start(room.revision);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.state.game.dealerSeat, 1);
    room = await api.store.get(api.roomId);
    room.game.phase = "finished";
    room.game.turnStep = null;
    room.game.history = [
      {
        type: "finish",
        reason: "wallExhausted",
      },
    ];
    await api.store.compareAndSwap(room, room.revision);
    result = await api.host.start(room.revision);
    assert.equal(result.status, 200);
    assert.equal(result.body.state.game.dealerSeat, 0);
  }
});
// 复现四筒普通弃牌的连续胡局面；版本与出牌者已胡状态用于区分保护规则。
// Reproduce repeat hu on an ordinary four-dots discard; version/source win status distinguish protection rules.
async function repeatedFourDotsHttpFixture({
  sourceWon = false,
  schemaVersion = 3,
} = {}) {
  const { DEFAULT_RULES, assertGameInvariants: assertLatest } = await import(
    "../shared/game.js"
  );
  const game = apiFixture({
    hands: [
      [0, 0, 1, 2, 3, 4, 6, 7, 8, 9, 12, 14, 15, 16],
      [1, 2, 3, 10, 11, 12, 12],
      WAITING_HAND,
    ],
    melds: [
      [],
      [
        {
          type: "mingGang",
          tile: 13,
          tiles: [13, 13, 13, 13],
          fromSeat: 0,
        },
        {
          type: "peng",
          tile: 5,
          tiles: [5, 5, 5],
          fromSeat: 0,
        },
      ],
      [],
    ],
    wins: [sourceWon ? [8] : [], [12], []],
    locks: [[], [9, 12], []],
    drawTile: 12,
    head: [6, 8],
  });
  game.history = [
    {
      revision: 0,
      type: "hu",
      seat: 1,
      tile: 12,
      source: "discard",
      fromSeat: 2,
      message: "保存的首次四筒胡牌记录",
    },
    {
      revision: 0,
      type: "draw",
      seat: 1,
      source: "continuation",
      message: "2号位胡后补摸。",
    },
  ];
  // 只对第三版设置本分支的数据，避免把新版字段错误写入旧引擎场景。
  // Apply this branch’s setup only to version three, keeping new fields out of legacy fixtures.
  if (schemaVersion === 3) {
    game.schemaVersion = 3;
    game.rules = {
      ...structuredClone(DEFAULT_RULES),
      allowPungUpgrade: true,
    };
    game.firstHuRadishesRevealed = true;
    game.dragonSettlement = {
      settled: false,
      entries: [],
    };
    assertLatest(game);
  }
  return game;
}
// 场景：v3 HTTP 反馈的普通四筒弃牌允许自然摸牌前再次胡牌，重连与重试仅扣分一次
// Scenario: v3 HTTP reported ordinary four-dot discard offers repeat hu before natural draw and reconnect/retries charge once
test("v3 HTTP reported ordinary four-dot discard offers repeat hu before natural draw and reconnect/retries charge once", async (t) => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  const { assertGameInvariants: assertLatest } = await import(
    "../shared/game.js"
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t);
  const initial = await repeatedFourDotsHttpFixture();
  const views = await installFixture(api, initial);
  const discard = await api.host.action(views[0].revision, {
    type: "discard",
    tile: 12,
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(discard.status, 200);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  let states = await snapshots(api.clients);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(states[1].game.phase, "claim");
  assert.equal(states[1].game.huDiagnostic.code, "AVAILABLE");
  assert.deepEqual(
    states[1].game.legalActions.map((action) => action.type),
    ["hu", "pass"],
  );
  assert.equal(
    states[1].game.huLockActive,
    true,
    "saved lock metadata may remain but cannot reject repeat hu",
  );
  assert.equal(
    states[1].game.history.some(
      (event) =>
        event.type === "draw" && event.seat === 1 && event.source === "normal",
    ),
    false,
  );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const reconnect = client(api, api.roomId, api.clients[1].token, 1);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const current = (await reconnect.get()).body.state;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(current.game.legalActions, states[1].game.legalActions);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const answers = await Promise.all([
    reconnect.action(current.revision, {
      type: "hu",
    }),
    api.clients[1].action(current.revision, {
      type: "hu",
    }),
  ]);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.deepEqual(answers.map((answer) => answer.status).sort(), [200, 409]);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const stored = (await api.store.get(api.roomId)).game;
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  assertLatest(stored);
  // 准备：构造该变体的规则、牌局或对照快照，保持旧历史与当前输入分离。
  // Arrange this variant’s rules, game or comparison snapshot, keeping saved history separate from current input.
  const events = stored.history.filter((event) => event.type === "hu");
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(events.length, 2);
  assert.deepEqual(
    stored.history.slice(0, initial.history.length),
    initial.history,
  );
  assert.equal(events.at(-1).source, "discard");
  assert.equal(events.at(-1).tile, 12);
  assert.equal(events.at(-1).fromSeat, 0);
  assert.deepEqual(events.at(-1).payments, [
    {
      seat: 0,
      delta: -events.at(-1).points,
    },
    {
      seat: 1,
      delta: events.at(-1).points,
    },
  ]);
  assert.equal(stored.players[1].huCount, 2);
  assert.equal(stored.players[2].score, 0);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  states = await snapshots(api.clients);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 逐项覆盖 states；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in states with the same checks, preserving the listed order.
  for (const state of states)
    assert.deepEqual(state.game.history, stored.history);
});
// 场景：v3 HTTP 再次荣胡规则变化保留已胡来源保护，并保持 v2 锁定规则不变
// Scenario: v3 HTTP repeat-discard change preserves won-source protection and frozen v2 lock
test("v3 HTTP repeat-discard change preserves won-source protection and frozen v2 lock", async (t) => {
  // 核对渲染结果或源码结构；正则/字符串是匹配条件，不是一次真实浏览器操作。
  // Check rendered output or source structure; regex/string matches are not real browser interactions.
  // 逐项覆盖 [{sourceWon:true},{schemaVersion:2}]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [{sourceWon:true},{schemaVersion:2}] with the same checks, preserving the listed order.
  for (const options of [
    {
      sourceWon: true,
    },
    {
      schemaVersion: 2,
    },
  ]) {
    const api = await table(t);
    const initial = await repeatedFourDotsHttpFixture(options);
    const views = await installFixture(api, initial);
    const result = await api.host.action(views[0].revision, {
      type: "discard",
      tile: 12,
    });
    assert.equal(result.status, 200);
    const stored = (await api.store.get(api.roomId)).game;
    assert.equal(stored.discards[0].tile, 12);
    assert.equal(stored.discards[0].huSeats, undefined);
    assert.equal(stored.players[1].huCount, 1);
    assert.equal(
      stored.history.filter((event) => event.type === "hu").length,
      1,
    );
    const state = (await api.clients[1].get()).body.state;
    assert.equal(
      state.game.legalActions.some((action) => action.type === "hu"),
      false,
    );
  }
});
// 场景：v3 HTTP 两名已胡玩家均可胡普通弃牌，优先级稳定且只结算一次
// Scenario: v3 HTTP two already-won players can both claim ordinary discard with stable priority and one settlement
test("v3 HTTP two already-won players can both claim ordinary discard with stable priority and one settlement", async (t) => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  const { DEFAULT_RULES, assertGameInvariants: assertLatest } = await import(
    "../shared/game.js"
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  // 逐项覆盖 [false,true]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [false,true] with the same checks, preserving the listed order.
  for (const reverse of [false, true]) {
    const api = await table(t);
    const initial = apiFixture({
      wins: [[], [17], [17]],
      locks: [[], [17], [17]],
      head: [6, 8],
    });
    initial.schemaVersion = 3;
    initial.rules = {
      ...structuredClone(DEFAULT_RULES),
      allowPungUpgrade: true,
    };
    initial.firstHuRadishesRevealed = true;
    initial.dragonSettlement = {
      settled: false,
      entries: [],
    };
    assertLatest(initial);
    const views = await installFixture(api, initial);
    const opened = await api.host.action(views[0].revision, {
      type: "discard",
      tile: 17,
    });
    assert.equal(opened.status, 200);
    const order = reverse ? [2, 1] : [1, 2];
    const first = await api.clients[order[0]].action(
      opened.body.state.revision,
      {
        type: "hu",
      },
    );
    assert.equal(first.status, 200);
    assert.equal(
      first.body.state.game.history.filter((event) => event.type === "hu")
        .length,
      0,
    );
    const fresh = await snapshots(api.clients);
    assert.equal(fresh[order[0]].game.legalActions.length, 0);
    const answers = await Promise.all([
      api.clients[order[1]].action(first.body.state.revision, {
        type: "hu",
      }),
      api.clients[order[1]].action(first.body.state.revision, {
        type: "hu",
      }),
    ]);
    assert.deepEqual(answers.map((answer) => answer.status).sort(), [200, 409]);
    const stored = (await api.store.get(api.roomId)).game;
    assertLatest(stored);
    const events = stored.history.filter((event) => event.type === "hu");
    assert.deepEqual(
      events.map((event) => event.seat),
      [2, 1],
    );
    assert.deepEqual(
      events.map((event) => event.source),
      ["discard", "discard"],
    );
    // 逐项覆盖 events；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in events with the same checks, preserving the listed order.
    for (const event of events)
      assert.deepEqual(event.payments, [
        {
          seat: 0,
          delta: -event.points,
        },
        {
          seat: event.seat,
          delta: event.points,
        },
      ]);
    assert.equal(stored.players[1].huCount, 2);
    assert.equal(stored.players[2].huCount, 2);
  }
});
// 建立大单钓听牌付款场景；legacy 和 beforePeng 分别覆盖旧规则与第四碰尚未完成。
// Prepare big-single-ready payment scenarios; legacy and beforePeng cover saved rules and the incomplete fourth peng.
async function bigSingleReadyHttpFixture({
  legacy = false,
  beforePeng = false,
} = {}) {
  const { DEFAULT_RULES, assertGameInvariants: assertLatest } = await import(
    "../shared/game.js"
  );
  const groups = [0, 3, 9, 12].map((tile) => ({
    type: "peng",
    tile,
    tiles: Array(3).fill(tile),
    fromSeat: 1,
  }));
  const initial = apiFixture(
    beforePeng
      ? {
          hands: [
            [12, 12, 8, 16],
            [6, 0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17],
            WAITING_HAND,
          ],
          melds: [groups.slice(0, 3), [], []],
          currentSeat: 1,
          drawTile: 6,
          head: [6],
        }
      : {
          hands: [[8, 16], WAITING_HAND, WAITING_HAND],
          melds: [groups, [], []],
          drawTile: 16,
          head: [6],
        },
  );
  initial.schemaVersion = 3;
  initial.rules = {
    ...structuredClone(DEFAULT_RULES),
    allowPungUpgrade: true,
  };
  initial.firstHuRadishesRevealed = false;
  initial.pendingKongRadishes = 0;
  initial.dragonSettlement = {
    settled: false,
    entries: [],
  };
  // 明确构造旧规则的兼容分支，不把新局默认行为默默带入旧存档。
  // Construct the saved-rule compatibility branch explicitly without importing new-game defaults.
  if (legacy) delete initial.rules.bigSingleReadyPayment;
  assertLatest(initial);
  return initial;
}
// 场景：v3 HTTP 听牌单次付款具有原子性、对所有人可见，且重试或重连不能重复触发
// Scenario: v3 HTTP ready single payment is atomic, visible to all, and cannot be duplicated by retry or reconnect
test("v3 HTTP ready single payment is atomic, visible to all, and cannot be duplicated by retry or reconnect", async (t) => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  const { assertGameInvariants: assertLatest } = await import(
    "../shared/game.js"
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t);
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.equal(api.state.game.rules.bigSingleReadyPayment, true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const initial = await bigSingleReadyHttpFixture();
  const views = await installFixture(api, initial);
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  assert.deepEqual(
    (await api.store.get(api.roomId)).game.players.map((p) => p.score),
    [0, 0, 0],
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const answers = await Promise.all([
    api.host.action(views[0].revision, {
      type: "discard",
      tile: 16,
    }),
    api.host.action(views[0].revision, {
      type: "discard",
      tile: 16,
    }),
  ]);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.deepEqual(answers.map((answer) => answer.status).sort(), [200, 409]);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const stored = (await api.store.get(api.roomId)).game;
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  assertLatest(stored);
  // 准备：构造该变体的规则、牌局或对照快照，保持旧历史与当前输入分离。
  // Arrange this variant’s rules, game or comparison snapshot, keeping saved history separate from current input.
  const ready = stored.history.filter(
    (event) => event.type === "bigSingleReady",
  );
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(ready.length, 1);
  assert.equal(ready[0].seat, 0);
  assert.equal(ready[0].points, 50);
  assert.deepEqual(ready[0].payments, [
    {
      seat: 1,
      delta: -50,
    },
    {
      seat: 2,
      delta: -50,
    },
    {
      seat: 0,
      delta: 100,
    },
  ]);
  assert.deepEqual(
    stored.players.map((p) => p.score),
    [100, -50, -50],
  );
  assert.equal(stored.players[0].bigSingleReadyPaid, true);
  assert.equal(stored.players[0].huCount, 0);
  assert.equal(stored.firstHuRadishesRevealed, false);
  assert.deepEqual(
    stored.players.flatMap((p) => p.radishes),
    [],
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const after = await snapshots(api.clients);
  // 核对分数、付款来源或番数；断言中的精确数值属于当前场景的规则契约。
  // Check scores, payers or fan; exact asserted numbers are this scenario’s rule contract.
  // 逐项覆盖 after；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in after with the same checks, preserving the listed order.
  for (const state of after) {
    assert.equal(state.revision, views[0].revision + 1);
    assert.deepEqual(state.game.history, stored.history);
    assert.deepEqual(
      state.game.players.map((p) => p.score),
      [100, -50, -50],
    );
  }
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const reconnected = client(api, api.roomId, api.host.token, 0);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.deepEqual((await reconnected.get()).body.state.game, after[0].game);
  assertError(
    await reconnected.action(views[0].revision, {
      type: "discard",
      tile: 16,
    }),
    409,
    "STALE_STATE",
  );
  assert.deepEqual((await api.store.get(api.roomId)).game, stored);
});
// 场景：v3 HTTP 第四次碰牌后，直到碰牌者真正出牌才发放听牌付款
// Scenario: v3 HTTP fourth peng does not award ready payment until the caller actually discards
test("v3 HTTP fourth peng does not award ready payment until the caller actually discards", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t);
  const views = await installFixture(
    api,
    await bigSingleReadyHttpFixture({
      beforePeng: true,
    }),
  );
  const discard = await api.clients[1].action(views[1].revision, {
    type: "discard",
    tile: 12,
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(discard.status, 200, JSON.stringify(discard.body));
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const fresh = (await api.host.get()).body.state;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.ok(fresh.game.legalActions.some((action) => action.type === "peng"));
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const peng = await api.host.action(fresh.revision, {
    type: "peng",
    tile: 12,
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(peng.status, 200, JSON.stringify(peng.body));
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await passClaims(api.clients);
  const before = (await api.host.get()).body.state;
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  assert.equal(before.game.players[0].hand.length, 2);
  assert.equal(
    before.game.history.some((event) => event.type === "bigSingleReady"),
    false,
  );
  assert.deepEqual(
    before.game.players.map((p) => p.score),
    [0, 0, 0],
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const ready = await api.host.action(before.revision, {
    type: "discard",
    tile: 16,
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(ready.status, 200, JSON.stringify(ready.body));
  assert.equal(
    ready.body.state.game.history.filter(
      (event) => event.type === "bigSingleReady",
    ).length,
    1,
  );
  assert.deepEqual(
    ready.body.state.game.players.map((p) => p.score),
    [100, -50, -50],
  );
});
// 场景：v3 HTTP 缺少听牌付款开关的旧牌局保留原有账本，不追补扣款
// Scenario: v3 HTTP legacy game without ready-payment flag retains its ledger and does not retroactively charge
test("v3 HTTP legacy game without ready-payment flag retains its ledger and does not retroactively charge", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t);
  const initial = await bigSingleReadyHttpFixture({
    legacy: true,
  });
  const views = await installFixture(api, initial);
  const result = await api.host.action(views[0].revision, {
    type: "discard",
    tile: 16,
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(result.status, 200);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const stored = (await api.store.get(api.roomId)).game;
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(
    stored.history.some((event) => event.type === "bigSingleReady"),
    false,
  );
  assert.deepEqual(
    stored.players.map((p) => p.score),
    [0, 0, 0],
  );
  assert.equal(stored.players[0].bigSingleReadyPaid, undefined);
  assert.deepEqual(
    (await api.host.get()).body.state.game.history,
    stored.history,
  );
});
// 场景：开局选项仅房主可操作，经过验证后原子保存，并对所有已验证玩家可见
// Scenario: start option is host-only, validated, atomic and saved for every authenticated player
test("start option is host-only, validated, atomic and saved for every authenticated player", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t, {
    start: false,
  });
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const start = (player, options, revision = api.state.revision) =>
    api.request(`/api/rooms/${api.roomId}/start`, {
      method: "POST",
      token: player.token,
      body: {
        revision,
        options,
      },
    });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const before = await api.store.get(api.roomId);
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  assertError(
    await start(api.clients[1], {
      autoDiscardAfterHu: false,
    }),
    403,
    "HOST_ONLY",
  );
  // 逐项覆盖 下列集合；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in the following collection with the same checks, preserving the listed order.
  for (const options of [
    null,
    false,
    [],
    "false",
    {
      autoDiscardAfterHu: "false",
    },
    {
      autoDiscardAfterHu: 0,
    },
    {
      autoDiscardAfterHu: null,
    },
    {
      autoDiscardAfterHu: false,
      baseFan: 50,
    },
    JSON.parse('{"__proto__": {"autoDiscardAfterHu":false}}'),
  ]) {
    assertError(await start(api.host, options), 400, "BAD_START_OPTIONS");
    assert.deepEqual(await api.store.get(api.roomId), before);
  }
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const attempts = await Promise.all([
    start(api.host, {
      autoDiscardAfterHu: false,
    }),
    start(api.host, {
      autoDiscardAfterHu: true,
    }),
  ]);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.deepEqual(attempts.map((answer) => answer.status).sort(), [200, 409]);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const accepted = attempts.find((answer) => answer.status === 200).body.state;
  const chosen = accepted.game.rules.autoDiscardAfterHu;
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(chosen, attempts[0].status === 200 ? false : true);
  assertError(
    attempts.find((answer) => answer.status === 409),
    409,
    "STALE_STATE",
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const saved = await api.store.get(api.roomId);
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  assert.equal(saved.game.rules.autoDiscardAfterHu, chosen);
  // 逐项覆盖 await snapshots(api.clients)；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in await snapshots(api.clients) with the same checks, preserving the listed order.
  for (const state of await snapshots(api.clients)) {
    assert.equal(state.game.rules.autoDiscardAfterHu, chosen);
    assertPrivateView(
      state,
      state.you,
      api.clients.map((player) => player.token),
    );
  }
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assertError(
    await start(
      api.host,
      {
        autoDiscardAfterHu: !chosen,
      },
      accepted.revision,
    ),
    409,
    "PLAYING",
  );
  assert.deepEqual(await api.store.get(api.roomId), saved);
});
// 场景：省略开局选项时默认为自动模式，下一局可修改该选项而不改写上一局
// Scenario: omitted start option defaults to automatic and next hand can change it without rewriting the prior game
test("omitted start option defaults to automatic and next hand can change it without rewriting the prior game", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(api.state.game.rules.autoDiscardAfterHu, true);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const room = await api.store.get(api.roomId);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  room.game.phase = "finished";
  room.game.turnStep = null;
  room.game.finishReason = "wallExhausted";
  room.game.history = [
    {
      type: "hu",
      seat: 2,
      revision: 1,
      message: "首胡",
    },
  ];
  room.game.players[2].score = 9;
  room.game.players[0].score = -9;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  await api.store.compareAndSwap(room, room.revision);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const previousGame = structuredClone(room.game);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const result = await api.request(`/api/rooms/${api.roomId}/start`, {
    method: "POST",
    token: api.host.token,
    body: {
      revision: room.revision,
      options: {
        autoDiscardAfterHu: false,
      },
    },
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.state.game.rules.autoDiscardAfterHu, false);
  assert.equal(result.body.state.game.dealerSeat, 2);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const saved = await api.store.get(api.roomId);
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  assert.deepEqual(
    saved.archivedGames.at(-1).game.history,
    previousGame.history,
  );
  assert.deepEqual(
    saved.archivedGames.at(-1).game.players.map((player) => player.score),
    previousGame.players.map((player) => player.score),
  );
  assert.equal(
    saved.archivedGames.at(-1).game.finishReason,
    previousGame.finishReason,
  );
  assert.equal(saved.hostSeat, 0);
});
// 场景：手动胡后出牌模式的 HTTP 暂停在 FileStore 重载后保留，忽略伪造规则变更，并发过牌只接受一次
// Scenario: manual post-hu HTTP pause survives FileStore reload, ignores forged rule changes and accepts one concurrent pass
test("manual post-hu HTTP pause survives FileStore reload, ignores forged rule changes and accepts one concurrent pass", async (t) => {
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  const { DEFAULT_RULES, assertGameInvariants: assertLatest } = await import(
    "../shared/game.js"
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const directory = await mkdtemp(join(tmpdir(), "flower-post-hu-option-"));
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  t.after(() =>
    rm(directory, {
      recursive: true,
      force: true,
    }),
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t, {
    store: new FileStore(directory),
    start: false,
  });
  const started = await api.request(`/api/rooms/${api.roomId}/start`, {
    method: "POST",
    token: api.host.token,
    body: {
      revision: api.state.revision,
      options: {
        autoDiscardAfterHu: false,
      },
    },
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(started.status, 200);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const game = apiFixture({
    head: [6, 7],
    tail: [1, 2, 3, 4, 5, 6],
  });
  game.schemaVersion = 3;
  game.rules = {
    ...structuredClone(DEFAULT_RULES),
    allowPungUpgrade: true,
    autoDiscardAfterHu: started.body.state.game.rules.autoDiscardAfterHu,
    specialHuPatterns: false,
  };
  game.firstHuRadishesRevealed = false;
  game.pendingKongRadishes = 0;
  game.dragonSettlement = {
    settled: false,
    entries: [],
  };
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const installed = await installFixture(api, game);
  const won = await api.host.action(
    installed[0].revision,
    {
      type: "hu",
    },
    {
      rules: {
        autoDiscardAfterHu: true,
      },
      options: {
        autoDiscardAfterHu: true,
      },
    },
  );
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(won.status, 200);
  assert.equal(won.body.state.game.rules.autoDiscardAfterHu, false);
  assert.equal(won.body.state.game.currentSeat, 0);
  assert.equal(won.body.state.game.discards.length, 0);
  assert.deepEqual(won.body.state.game.legalActions, [
    {
      type: "pass",
    },
  ]);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const waitingStates = await snapshots(api.clients);
  const waitingRoom = await api.store.get(api.roomId);
  const reloadedApi = await harness(t, new FileStore(directory));
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const reconnected = api.clients.map((player) =>
    client(reloadedApi, player.roomId, player.token, player.seat),
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const restored = await snapshots(reconnected);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.deepEqual(restored, waitingStates);
  // 逐项覆盖 restored；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in restored with the same checks, preserving the listed order.
  for (const state of restored)
    assertPrivateView(
      state,
      state.you,
      api.clients.map((player) => player.token),
    );
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const current = restored[0];
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  // 逐项覆盖 [{type:'discard',tile:6},{type:'discard',tile:0}]；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in [{type:'discard',tile:6},{type:'discard',tile:0}] with the same checks, preserving the listed order.
  for (const action of [
    {
      type: "discard",
      tile: 6,
    },
    {
      type: "discard",
      tile: 0,
    },
  ])
    assertError(
      await reconnected[0].action(current.revision, action, {
        options: {
          autoDiscardAfterHu: true,
        },
      }),
      422,
      "ILLEGAL_ACTION",
    );
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assertError(
    await reconnected[1].action(
      current.revision,
      {
        type: "pass",
      },
      {
        seat: 0,
      },
    ),
    422,
    "ILLEGAL_ACTION",
  );
  assert.deepEqual(await reloadedApi.store.get(api.roomId), waitingRoom);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const results = await Promise.all([
    reconnected[0].action(current.revision, {
      type: "pass",
    }),
    reconnected[0].action(current.revision, {
      type: "pass",
    }),
  ]);
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const after = await reloadedApi.store.get(api.roomId);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  assert.equal(after.game.rules.autoDiscardAfterHu, false);
  assert.equal(after.game.discards.length, 1);
  assert.equal(after.game.discards[0].tile, 6);
  assert.equal(after.game.currentSeat, 2);
  assert.equal(after.game.lastDraw.tile, 7);
  assert.deepEqual(
    after.game.players.map((player) => player.score),
    waitingRoom.game.players.map((player) => player.score),
  );
  assert.equal(after.game.players[0].huCount, 1);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  assertLatest(after.game);
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  assertError(
    await reconnected[0].action(current.revision, {
      type: "pass",
    }),
    409,
    "STALE_STATE",
  );
  assert.deepEqual(await reloadedApi.store.get(api.roomId), after);
});
// 场景：HTTP 中未勾选自动选项也不能绕过胡后强制杠
// Scenario: unchecked option cannot bypass mandatory post-hu kongs through HTTP
test("unchecked option cannot bypass mandatory post-hu kongs through HTTP", async (t) => {
  // 检查拒绝路径：无效请求必须失败，不能悄悄执行。
  // Verify rejection: invalid input must fail rather than execute silently.
  // 逐项覆盖 ['anGang','buGang','addGang']；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in ['anGang','buGang','addGang'] with the same checks, preserving the listed order.
  for (const type of ["anGang", "buGang", "addGang"]) {
    const api = await table(t);
    const game = postHuKongGame({
      type,
    });
    game.rules.autoDiscardAfterHu = false;
    const views = await installFixture(api, game);
    const before = await api.store.get(api.roomId);
    assert.deepEqual(views[0].game.legalActions, [
      {
        type,
        tile: game.lastDraw.tile,
      },
    ]);
    // 逐项覆盖 [{type:'pass'},{type:'discard',tile:game.lastDraw.tile}]；同一组检查用于每个样本，顺序以代码列出的集合为准。
    // Exercise each entry in [{type:'pass'},{type:'discard',tile:game.lastDraw.tile}] with the same checks, preserving the listed order.
    for (const action of [
      {
        type: "pass",
      },
      {
        type: "discard",
        tile: game.lastDraw.tile,
      },
    ]) {
      assertError(
        await api.host.action(views[0].revision, action),
        422,
        "ILLEGAL_ACTION",
      );
      assert.deepEqual(await api.store.get(api.roomId), before);
    }
    const next = await api.host.action(views[0].revision, {
      type,
      tile: game.lastDraw.tile,
    });
    assert.equal(next.status, 200);
    assert.deepEqual(next.body.state.game.legalActions, [
      {
        type: "hu",
      },
      {
        type: "pass",
      },
    ]);
    assert.equal(next.body.state.game.rules.autoDiscardAfterHu, false);
  }
});
// 场景：HTTP 中碰后待打牌状态阻止伪造补杠，并在重连后保留
// Scenario: HTTP pending post-peng discard blocks forged upgrade and survives reconnect
test("HTTP pending post-peng discard blocks forged upgrade and survives reconnect", async (t) => {
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.equal(api.state.game.rules.allowPungUpgrade, true);
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  const game = postHuKongGame({
    huCount: 0,
  });
  game.rules.allowPungUpgrade = false;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  game.players[0].pendingPungDiscard = true;
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const installed = await installFixture(api, game);
  const before = await api.store.get(api.roomId);
  // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
  // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
  // 逐项覆盖 installed；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in installed with the same checks, preserving the listed order.
  for (const state of installed)
    assert.equal(state.game.rules.allowPungUpgrade, false);
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.equal(
    installed[0].game.legalActions.some((action) => action.type === "buGang"),
    false,
  );
  assertError(
    await api.host.action(
      installed[0].revision,
      {
        type: "buGang",
        tile: 2,
      },
      {
        rules: {
          allowPungUpgrade: true,
        },
      },
    ),
    422,
    "ILLEGAL_ACTION",
  );
  assert.deepEqual(await api.store.get(api.roomId), before);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const reconnected = await api.request(`/api/rooms/${api.roomId}/resume`, {
    method: "POST",
    token: api.host.token,
    body: {},
  });
  // 核对接口返回及版本，区分成功、冲突与未变化响应。
  // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
  assert.equal(reconnected.status, 200);
  assert.equal(reconnected.body.state.game.rules.allowPungUpgrade, false);
  assert.equal(
    reconnected.body.state.game.legalActions.some(
      (action) => action.type === "buGang",
    ),
    false,
  );
  assert.deepEqual(await api.store.get(api.roomId), before);
});
// Scenario: HTTP start saves ${points} ready points, preserves prior round, validates and rejects changes midgame
for (const points of [0, 75, 100000]) // 场景：HTTP 开局保存每家 ${points} 分喜钱，保留上一局，校验输入并拒绝局中改值
  test(`HTTP start saves ${points} ready points, preserves prior round, validates and rejects changes midgame`, async (t) => {
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    const api = await table(t);
    // 核对本步骤的期望结果；严格比较同时检查值和结构，而不只检查是否有返回值。
    // Verify this step’s expected result; strict assertions check values/structure rather than mere presence.
    // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
    // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
    assert.equal(api.state.game.rules.bigSingleReadyPoints, 50);
    // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
    // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
    let room = await api.store.get(api.roomId);
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.
    room.game.phase = "finished";
    room.game.turnStep = null;
    room.game.finishReason = "wallExhausted";
    const previous = structuredClone(room.game);
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    await api.store.compareAndSwap(room, room.revision);
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.
    // 准备：构造该变体的规则、牌局或对照快照，保持旧历史与当前输入分离。
    // Arrange this variant’s rules, game or comparison snapshot, keeping saved history separate from current input.
    const start = (player, options, revision = room.revision) =>
      api.request(`/api/rooms/${api.roomId}/start`, {
        method: "POST",
        token: player.token,
        body: {
          revision,
          options,
        },
      });
    // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
    // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
    assertError(
      await start(api.clients[1], {
        bigSingleReadyPoints: points,
      }),
      403,
      "HOST_ONLY",
    );
    // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
    // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
    for (const invalid of [
      -1,
      1.5,
      100001,
      9007199254740992,
      "50",
      "",
      null,
      true,
      false,
      {},
      [],
    ]) {
      assertError(
        await start(api.host, {
          bigSingleReadyPoints: invalid,
        }),
        400,
        "BAD_START_OPTIONS",
      );
      assert.deepEqual(await api.store.get(api.roomId), room);
    }
    const choices = await Promise.all([
      start(api.host, {
        bigSingleReadyPoints: points,
      }),
      start(api.host, {
        bigSingleReadyPoints: points,
      }),
    ]);
    // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
    // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
    assert.deepEqual(choices.map((result) => result.status).sort(), [200, 409]);
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    const saved = await api.store.get(api.roomId);
    // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
    // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
    // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
    // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
    assert.equal(saved.game.rules.bigSingleReadyPoints, points);
    assert.deepEqual(saved.archivedGames.at(-1).game.history, previous.history);
    assert.deepEqual(
      saved.archivedGames.at(-1).game.players.map((p) => p.score),
      previous.players.map((p) => p.score),
    );
    assert.equal(
      saved.archivedGames.at(-1).game.finishReason,
      previous.finishReason,
    );
    // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
    // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
    for (const state of await snapshots(api.clients))
      assert.equal(state.game.rules.bigSingleReadyPoints, points);
    // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
    // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
    assertError(
      await start(
        api.host,
        {
          bigSingleReadyPoints: 2,
        },
        saved.revision,
      ),
      409,
      "PLAYING",
    );
    assert.deepEqual(await api.store.get(api.roomId), saved);
  });
// 场景：自定义喜钱经 FileStore 重载仍保留，动作请求伪造选项不能改值
// Scenario: custom ready payment survives FileStore reload and ignores forged options on action
test("custom ready payment survives FileStore reload and ignores forged options on action", async (t) => {
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  const directory = await mkdtemp(join(tmpdir(), "flower-ready-points-"));
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.
  t.after(() =>
    rm(directory, {
      recursive: true,
      force: true,
    }),
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const api = await table(t, {
    store: new FileStore(directory),
  });
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const initial = await bigSingleReadyHttpFixture();
  // 准备：构造该变体的规则、牌局或对照快照，保持旧历史与当前输入分离。
  // Arrange this variant’s rules, game or comparison snapshot, keeping saved history separate from current input.
  initial.rules.bigSingleReadyPoints = 80;
  // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
  // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
  const views = await installFixture(api, initial);
  const answers = await Promise.all(
    [0, 1].map(() =>
      api.host.action(
        views[0].revision,
        {
          type: "discard",
          tile: 16,
        },
        {
          options: {
            bigSingleReadyPoints: 999,
          },
          rules: {
            bigSingleReadyPoints: 999,
          },
        },
      ),
    ),
  );
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.deepEqual(answers.map((result) => result.status).sort(), [200, 409]);
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const saved = await api.store.get(api.roomId);
  // 核对快照或旧值，防止修改输入、重复提交或覆盖已保存状态。
  // Compare snapshots/saved values to detect input mutation, duplicate commits or overwritten state.
  // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
  // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
  assert.deepEqual(
    saved.game.players.map((p) => p.score),
    [160, -80, -80],
  );
  assert.equal(
    saved.game.history.filter((e) => e.type === "bigSingleReady").length,
    1,
  );
  assert.equal(
    saved.game.history.find((e) => e.type === "bigSingleReady").points,
    80,
  );
  // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
  // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
  const reloaded = await harness(t, new FileStore(directory));
  // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
  // Arrange: prepare this step’s input or reference data within the synthetic scenario.

  for (const player of api.clients) {
    const state = (
      await reloaded.request(`/api/rooms/${api.roomId}`, {
        token: player.token,
      })
    ).body.state;
    assert.equal(state.game.rules.bigSingleReadyPoints, 80);
    assert.deepEqual(
      state.game.players.map((p) => p.score),
      [160, -80, -80],
    );
    assert.deepEqual(state.game.history, saved.game.history);
  }
});
// Scenario: HTTP real peng discard and later held-tile upgrade persist through reload (old v0.7.0=${oldRoom})
for (const oldRoom of [false, true]) // 场景：HTTP 真实碰牌后先打一次，再用已持有牌补杠；重载保留状态（旧 v0.7.0=${oldRoom}）
  test(`HTTP real peng discard and later held-tile upgrade persist through reload (old v0.7.0=${oldRoom})`, async (t) => {
    // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
    // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
    const { pungUpgradeGame, takePeng } = await import(
      "./fixtures/pung-upgrade.js"
    );
    const directory = await mkdtemp(join(tmpdir(), "flower-peng-delay-"));
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.
    t.after(() =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    );
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    const api = await table(t, {
      store: new FileStore(directory),
    });
    const game = takePeng(
      pungUpgradeGame({
        heldFourth: true,
        head: [15, 15, 9, 9],
      }),
    );
    // 准备：构造该变体的规则、牌局或对照快照，保持旧历史与当前输入分离。
    // Arrange this variant’s rules, game or comparison snapshot, keeping saved history separate from current input.
    if (oldRoom) {
      game.rules.allowPungUpgrade = false;
      // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
      // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
      delete game.rules.pungUpgradeAfterDiscard;
      for (const p of game.players) delete p.pendingPungDiscard;
    }
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    let views = await installFixture(api, game);
    let before = await api.store.get(api.roomId);
    // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
    // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
    assert.equal(
      views[1].game.legalActions.some((a) => a.type === "buGang"),
      false,
    );
    assertError(
      await api.clients[1].action(
        views[1].revision,
        {
          type: "buGang",
          tile: 0,
        },
        {
          rules: {
            allowPungUpgrade: true,
            pungUpgradeAfterDiscard: false,
          },
          pendingPungDiscard: false,
        },
      ),
      422,
      "ILLEGAL_ACTION",
    );
    assert.deepEqual(await api.store.get(api.roomId), before);
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    const reloaded = await harness(t, new FileStore(directory));
    // 准备：建立本步骤的输入或保留对照数据；这些值属于当前合成场景。
    // Arrange: prepare this step’s input or reference data within the synthetic scenario.

    // 准备：构造该变体的规则、牌局或对照快照，保持旧历史与当前输入分离。
    // Arrange this variant’s rules, game or comparison snapshot, keeping saved history separate from current input.
    const clients = api.clients.map((p) =>
      client(reloaded, api.roomId, p.token, p.seat),
    );
    // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
    // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
    views = await snapshots(clients);
    // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
    // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
    assert.equal(
      views[1].game.legalActions.some((a) => a.type === "buGang"),
      false,
    );
    // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
    // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
    const discard = await clients[1].action(views[1].revision, {
      type: "discard",
      tile: 17,
    });
    // 核对接口返回及版本，区分成功、冲突与未变化响应。
    // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
    assert.equal(discard.status, 200);
    // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
    // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
    // 准备：构造该变体的规则、牌局或对照快照，保持旧历史与当前输入分离。
    // Arrange this variant’s rules, game or comparison snapshot, keeping saved history separate from current input.
    let state = discard.body.state;
    // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
    // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
    for (let steps = 0; steps < 12; steps++) {
      // 先完成所有抢牌回应；反应窗未关闭时不能直接跳到下一位自然回合。
      // Resolve claim responses before advancing to another natural turn.
      if (state.game.phase === "claim") {
        const seat = state.game.claim.eligibleSeats.find(
          (s) => !state.game.claim.respondedSeats.includes(s),
        );
        const answer = await clients[seat].action(state.revision, {
          type: "pass",
        });
        // 核对接口返回及版本，区分成功、冲突与未变化响应。
        // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
        assert.equal(answer.status, 200);
        // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
        // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
        state = answer.body.state;
      } else if (state.game.currentSeat !== 1) {
        // 还未回到碰牌座位时，让当前玩家打出新摸牌，保持真实轮转而不是直接改 currentSeat。
        // Until the caller’s turn returns, discard the current player’s drawn tile instead of rewriting currentSeat.
        const seat = state.game.currentSeat;
        const own = (await clients[seat].get()).body.state;
        const answer = await clients[seat].action(own.revision, {
          type: "discard",
          tile: own.game.drawnTile,
        });
        // 核对接口返回及版本，区分成功、冲突与未变化响应。
        // Check response/revision contracts, distinguishing success, conflicts and unchanged replies.
        assert.equal(answer.status, 200);
        // 执行：调用被测入口或推进异步步骤；后续断言检查实际返回的状态。
        // Act: invoke the tested entry point or advance asynchronous work; subsequent assertions check the resulting state.
        state = answer.body.state;
      } else break;
    }
    const own = (await clients[1].get()).body.state;
    // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
    // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
    assert.equal(own.game.drawnTile, 9);
    assert.ok(
      own.game.legalActions.some((a) => a.type === "buGang" && a.tile === 0),
    );
    // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
    // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
    before = await reloaded.store.get(api.roomId);
    // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
    // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
    assert.equal(before.game.players[1].pendingPungDiscard, false);
    // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
    // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
    const attempts = await Promise.all(
      [0, 1].map(() =>
        clients[1].action(own.revision, {
          type: "buGang",
          tile: 0,
        }),
      ),
    );
    // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
    // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
    assert.deepEqual(attempts.map((a) => a.status).sort(), [200, 409]);
    // 执行：通过真实入口推进动作、保存或界面更新；后续核对服务端或引擎的权威结果。
    // Act through the real entry point, persistence or UI update; check authoritative server/engine results afterward.
    const after = await reloaded.store.get(api.roomId);
    // 断言：检查本步骤的精确结果，尤其是一次性收费、待打牌限制及已保存规则不被重写。
    // Assert exact outcomes, including one-time charges, pending-discard restrictions and preserved saved rules.
    assert.equal(after.game.players[1].melds[0].type, "buGang");
    assert.deepEqual(
      after.game.players.map((p) => p.score),
      [-1, 2, -1],
    );
    assert.equal(after.game.pendingKongRadishes, 1);
    assert.deepEqual(
      after.game.history.slice(0, game.history.length),
      game.history,
    );
  });
