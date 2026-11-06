/** Synthetic clients only; never opens an existing room. Tokens remain in memory. */ // 显式执行的合成三客户端生命周期冒烟脚本。local 使用临时本机服务；URL 模式会写目标服务。
// Explicit synthetic three-client lifecycle smoke script. local starts an ephemeral loopback server; URL mode writes to its target service.
// 阅读说明见 docs/TESTING-READING-GUIDE.md；固定种子与凭证仅为测试，不应移入真实用户数据。
// See docs/TESTING-READING-GUIDE.md; seeded data and test credentials must stay separate from real user data.
import assert from "node:assert/strict";
// 推荐使用 local。若传入 URL，脚本会在该服务注册身份、建桌和结算，绝不是只读健康检查。
// Prefer local. A URL registers identities, creates rooms and settles games on that service; this is not a read-only health check.
const [base] = process.argv.slice(2);
// 缺少目标时先显示用法并停止，防止把请求误发到猜测的环境。
// Stop with usage when no target is provided rather than guessing a destination.
if (!base)
  throw Error("Usage: node tests/smoke/room-lifecycle.mjs https://your-site");
let server;
// local 明确选择临时回环服务和内存存储；URL 分支则使用调用者指定的服务。
// local selects an ephemeral loopback server and memory store; URL mode uses the supplied service.
if (base === "local") {
  const { createServer } = await import("node:http");
  const { apiMiddleware } = await import("../../server/node.js");
  const { MemoryStore } = await import("../../server/store.js");
  server = createServer(apiMiddleware(new MemoryStore()));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  server.unref();
}
const origin = server
  ? `http://127.0.0.1:${server.address().port}`
  : new URL(base).origin;
let requests = 0;
const times = [];
// 对选定 origin 发出合成请求，记录耗时并断言状态码；POST 会实际改变该目标服务的数据。
// Send a synthetic request to the selected origin, record latency and assert status; POST genuinely mutates that target.
async function req(path, { body, token, expected = 200 } = {}) {
  const start = performance.now();
  const response = await fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
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
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  requests++;
  times.push(performance.now() - start);
  assert.equal(
    response.status,
    expected,
    `${path}: ${response.status} ${data.code || ""}`,
  );
  return data;
}
const health = await req("/api/health");
// 保留既有旧版本验收断言：当前服务版本不匹配会在此停止。这不是允许为通过测试随意改版本号。
// Preserve the existing old-version acceptance assertion: a current version mismatch stops here, not permission to change versions merely to pass.
assert.equal(health.version, "0.4.2");
// 为三位合成玩家分别注册个人身份；个人历史凭证不等于同桌座位凭证。
// Register three independent synthetic profiles; history credentials differ from room-seat credentials.
const profiles = [];
for (let i = 0; i < 3; i++)
  profiles.push(
    (
      await req("/api/profile", {
        body: {},
        expected: 201,
      })
    ).playerToken,
  );
// 第一个身份创建全新合成桌，随后两个身份加入；不打开已有用户房间。
// The first identity creates a fresh synthetic room and two others join; no existing user room is opened.
const created = await req("/api/rooms", {
  body: {
    name: "生命周期验收甲",
    profileToken: profiles[0],
  },
  expected: 201,
});
const path = `/api/rooms/${created.roomId}`;
const people = [
  {
    token: created.token,
    profile: profiles[0],
  },
];
for (let i = 1; i < 3; i++) {
  const p = await req(path + "/join", {
    body: {
      name: `生命周期验收${i}`,
      profileToken: profiles[i],
    },
    expected: 201,
  });
  people.push({
    token: p.token,
    profile: profiles[i],
  });
}
// 座位读取使用对应座位 token，防止测试无意共用房主视角。
// Read each seat with its own token instead of accidentally sharing the host viewpoint.
const get = async (i) =>
  (
    await req(path, {
      token: people[i].token,
    })
  ).state;
// 个人历史必须使用个人 token，而不是用房间 token 冒充身份。
// Profile history uses the profile token, not a room token impersonating an identity.
const hist = async (i) =>
  req("/api/profile/history", {
    token: profiles[i],
  });
// 验证每个 HTTP 客户端仅看到本人的手牌，且快照没有牌墙和他人凭证。
// Verify each HTTP client sees only its own hand and no wall or other player’s credential.
function privacy(s, i) {
  assert.equal(s.you, i);
  assert.equal(s.game.players.filter((p) => Array.isArray(p.hand)).length, 1);
  assert.equal(
    s.game.players.findIndex((p) => Array.isArray(p.hand)),
    i,
  );
  assert.equal("wall" in s.game, false);
  assert.equal(JSON.stringify(s).includes(people[(i + 1) % 3].token), false);
}
// 由房主携带最新 revision 开局，然后三个客户端分别验证私有视图。
// Start as host with the latest revision, then verify each client’s private view.
let s = (
  await req(path + "/start", {
    token: people[0].token,
    body: {
      revision: (await get(0)).revision,
    },
  })
).state;
for (let i = 0; i < 3; i++) privacy(await get(i), i);
// 房主离席应转移管理权限但保持正在进行的牌局；这是离席，不是删除桌子。
// Host departure transfers authority while preserving the active game; leaving is not room deletion.
await req(path + "/leave", {
  token: people[0].token,
  body: {
    profileToken: profiles[0],
  },
});
let remaining = await get(1);
assert.equal(remaining.hostSeat, 1);
assert.equal(remaining.seats[0].detached, true);
assert.equal(remaining.game.wallCount, s.game.wallCount);
await req(path, {
  token: people[0].token,
  expected: 409,
});
assert.equal((await hist(0)).records[0].status, "detached");
// 显式恢复原座位后验证 detached 消失，而房主仍留在已接管的座位。
// Explicitly resume the old seat and clear detached status without reclaiming transferred host authority.
const resumed = await req(path + "/resume", {
  token: people[0].token,
  body: {
    profileToken: profiles[0],
  },
});
s = resumed.state;
assert.equal(s.hostSeat, 1);
assert.equal(s.seats[0].detached, false);
await req(path, {
  token: "0".repeat(64),
  expected: 401,
});
await req("/api/profile/history", {
  token: "0".repeat(64),
  expected: 401,
});
// 有界地走完整局：优先胡、杠，再过/打/摸；450 次上限用于发现流程卡住，不是规则限制。
// Play a bounded full game, preferring hu/kong then pass/discard/draw; the 450-action cap detects stalls, not a game-rule limit.
let actions = 0,
  hu = 0,
  kong = 0;
// 持续推进场景直到 s.game.phase!=='finished'&&actions<450 不再成立；循环内的动作/断言负责保证进展。
// Advance while s.game.phase!=='finished'&&actions<450 holds; actions/assertions inside are responsible for progress.
while (s.game.phase !== "finished" && actions < 450) {
  const order = [s.game.currentSeat, 0, 1, 2].filter(
    (v, i, a) => Number.isInteger(v) && a.indexOf(v) === i,
  );
  let acted = false;
  // 逐项覆盖 order；同一组检查用于每个样本，顺序以代码列出的集合为准。
  // Exercise each entry in order with the same checks, preserving the listed order.
  for (const seat of order) {
    const view = await get(seat);
    privacy(view, seat);
    // 牌局结束后停止继续找动作，避免把正常结束误报为没有合法动作。
    // Stop action search after the game finishes instead of treating completion as missing legal actions.
    if (view.game.phase === "finished") {
      s = view;
      break;
    }
    const legal = view.game.legalActions;
    const a =
      legal.find((x) => x.type === "hu") ||
      legal.find((x) =>
        ["anGang", "mingGang", "buGang", "addGang"].includes(x.type),
      ) ||
      legal.find((x) => x.type === "pass") ||
      legal.find((x) => x.type === "discard") ||
      legal.find((x) => x.type === "draw");
    // 当前视图没有候选动作就检查下一位玩家，而不是提交 undefined。
    // Try the next player when this view offers no candidate rather than submitting undefined.
    if (!a) continue;
    s = (
      await req(path + "/action", {
        token: people[seat].token,
        body: {
          revision: view.revision,
          action: a,
        },
      })
    ).state;
    actions++;
    // 单独累计成功提交的胡牌，便于报告本次冒烟覆盖了多少胡牌动作。
    // Count committed wins separately for smoke-test coverage reporting.
    if (a.type === "hu") hu++;
    // 统计暗杠、明杠、补杠和扩杠这组动作；协议类型的 Gang 后缀不可随意改。
    // Count kong actions using their protocol Gang suffix, which must remain stable.
    if (a.type.endsWith("Gang")) kong++;
    acted = true;
    break;
  }
  // 尚未结束却无人可行动说明流程卡住，应立即失败而不是空转到次数上限。
  // No actor in an unfinished game is a stalled flow: fail rather than spinning to the action limit.
  if (!acted && s.game.phase !== "finished") throw Error("No legal actor");
}
assert.equal(s.game.phase, "finished");
// 逐个人核对恰好一条结算记录、分数一致和没有私有手牌，最后检查总分零和。
// Check exactly one settled record per profile, matching scores and no private hands, then verify zero sum.
const histories = [];
for (let i = 0; i < 3; i++) {
  const h = await hist(i);
  assert.equal(h.summary.settledGames, 1);
  assert.equal(h.records.length, 1);
  assert.equal(h.records[0].score, s.game.players[i].score);
  assert.equal("hand" in h.records[0], false);
  histories.push(h);
}
assert.equal(
  histories.reduce((n, h) => n + h.summary.totalScore, 0),
  0,
);
// 沿用当前房主再开一局，确认历史累计不会因新局而重复结算旧局。
// Start another game under the current host and ensure history does not settle the old game twice.
const currentHost = s.hostSeat;
const final = await get(currentHost);
await req(path + "/start", {
  token: people[currentHost].token,
  body: {
    revision: final.revision,
  },
});
for (let i = 0; i < 3; i++) {
  const h = await hist(i);
  assert.equal(h.records.length, 2);
  assert.equal(h.summary.settledGames, 1);
  assert.equal(h.summary.totalScore, histories[i].summary.totalScore);
  await req(path + "/leave", {
    token: people[i].token,
    body: {
      profileToken: profiles[i],
    },
  });
}
// 重复离席应幂等：返回已离开，但不再追加重复历史或抹掉上一局结算。
// Repeated leave must be idempotent, without duplicate history or erasing previous settlement.
const repeated = await req(path + "/leave", {
  token: people[0].token,
  body: {
    profileToken: profiles[0],
  },
});
assert.equal(repeated.left, true);
const h = await hist(0);
assert.equal(h.records.filter((r) => r.status === "finished").length, 1);
assert.equal(h.records.filter((r) => r.status === "detached").length, 1);
// 最后另建一张空桌再离开，覆盖大厅退出而不影响先前的个人历史。
// Finally create/leave another empty room to cover lobby departure without losing prior history.
const empty = await req("/api/rooms", {
  body: {
    name: "独立新桌",
    profileToken: profiles[0],
  },
  expected: 201,
});
await req(`/api/rooms/${empty.roomId}/leave`, {
  token: empty.token,
  body: {
    profileToken: profiles[0],
  },
});
// 只输出计数、检查清单和延迟分位数；原始凭证与手牌留在进程内存。
// Output counts/checks/latency quantiles only; raw credentials and hands remain in process memory.
const sorted = times.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      origin,
      version: health.version,
      requests,
      actions,
      hu,
      kong,
      checks: [
        "three private clients",
        "host handoff",
        "active detach and explicit resume",
        "forged credential rejection",
        "full real game settlement",
        "per-profile score zero sum",
        "new round keeps one settled record",
        "duplicate leave idempotent",
        "new table does not erase previous history",
      ],
      latencyMs: {
        p50: Math.round(sorted[Math.floor(sorted.length * 0.5)]),
        p95: Math.round(sorted[Math.floor(sorted.length * 0.95)]),
      },
      measuredAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
// 仅关闭本脚本创建的本地服务，不尝试关闭调用者传入的远程服务。
// Close only the local server created by this script, not a supplied remote service.
if (server) {
  server.closeAllConnections();
  server.close();
}
