/** Anonymous synthetic-room HTTP benchmark. Never reads or mutates existing rooms.
 * Usage: node tests/performance/benchmark-api.mjs URL LABEL OUTPUT.json
 * Tokens and private hands remain in process memory and are never written.
 */ // 合成新桌 HTTP 延迟采样；会创建房间和执行动作，不能未经授权指向线上。
// HTTP latency sampling in a synthetic new room; creates rooms and actions, so never target production without authorization.
// 阅读说明见 docs/TESTING-READING-GUIDE.md；固定种子与凭证仅为测试，不应移入真实用户数据。
// See docs/TESTING-READING-GUIDE.md; seeded data and test credentials must stay separate from real user data.
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
const [base, label = "measurement", output] = process.argv.slice(2);
// 目标与输出文件都必填；参数不全时不开始建桌或采样。
// Require both target and output path before creating a room or collecting samples.
if (!base || !output)
  throw new Error(
    "Usage: node tests/performance/benchmark-api.mjs URL LABEL OUTPUT.json",
  );
// 只保留 URL 的协议、主机与端口；后续请求会创建合成房间，必须先核实这是获准测试的环境。
// Keep only URL scheme/host/port; later requests create synthetic rooms, so verify this target is authorized.
const origin = new URL(base).origin;
// 只收集测量元数据，不把凭证、私有手牌或完整响应写入报告。
// Collect measurement metadata only, not credentials, private hands or full response bodies.
const records = [];
// 发送本场景指定的请求并读取响应；token 是测试凭证，body 决定请求负载，错误由调用处验证。
// Send the scenario request and read its response; token is a test credential, body is its payload, and callers verify errors.
async function request(path, { token, body, category } = {}) {
  const begin = performance.now();
  const response = await fetch(`${origin}${path}`, {
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
  const raw = await response.text();
  const elapsed = performance.now() - begin;
  const data = JSON.parse(raw);
  const appMatch = response.headers
    .get("server-timing")
    ?.match(/(?:^|,)\s*app;dur=([0-9.]+)/);
  // 只给有分类标签的请求保存测量记录；初始化请求仍执行但不混入对应统计。
  // Record categorized requests only; setup requests still run without entering those statistics.
  if (category)
    records.push({
      category,
      elapsedMs: Number(elapsed.toFixed(2)),
      responseBytes: Buffer.byteLength(raw),
      status: response.status,
      ...(appMatch
        ? {
            appMs: Number(appMatch[1]),
          }
        : {}),
    });
  // HTTP 失败立即结束测量，不能把错误响应当正常业务样本继续执行。
  // Stop on HTTP failure instead of continuing as though an error response were normal game data.
  if (!response.ok)
    throw new Error(
      `${category || path}: HTTP ${response.status} ${data.code || "unknown error"}`,
    );
  return data;
}
// 读取服务版本后才创建独立合成房间；这些准备请求不带测量分类。
// Read the service version then create an independent synthetic room; setup requests have no measurement category.
const health = await request("/api/health");
const created = await request("/api/rooms", {
  body: {
    name: "合成压测东",
  },
});
const roomPath = `/api/rooms/${created.roomId}`;
const clients = [
  {
    token: created.token,
    seat: 0,
  },
];
// 逐项覆盖 ['合成压测南','合成压测西']；同一组检查用于每个样本，顺序以代码列出的集合为准。
// Exercise each entry in ['合成压测南','合成压测西'] with the same checks, preserving the listed order.
for (const name of ["合成压测南", "合成压测西"]) {
  const joined = await request(`${roomPath}/join`, {
    body: {
      name,
    },
  });
  clients.push({
    token: joined.token,
    seat: joined.state.you,
  });
}
// 三个 token 各读自己的快照；写动作时必须使用该座位快照的 revision。
// Each token reads its own snapshot; an action uses the revision from its submitting seat.
let snapshots = await Promise.all(
  clients.map(
    async (player) =>
      (
        await request(roomPath, {
          token: player.token,
        })
      ).state,
  ),
);
await request(`${roomPath}/start`, {
  token: clients[0].token,
  body: {
    revision: snapshots[0].revision,
  },
});
// 并行读取三个客户端快照并覆盖本地 snapshots；category 决定这些读取是否计入对应测量组。
// Refresh all three client snapshots concurrently; category controls whether these reads enter a measured group.
async function refresh(category) {
  snapshots = await Promise.all(
    clients.map(
      async (player) =>
        (
          await request(roomPath, {
            token: player.token,
            category,
          })
        ).state,
    ),
  );
}
// 先预热认证读取；初始化样本不计入后面分组统计。
// Warm authenticated reads before collecting categorized measurement samples.
await refresh(); // Warm authenticated reads before measured gameplay.
// 短测只推进六次弃牌且最多三十次动作；用必要过牌/摸牌保证流程，不宣称覆盖所有规则。
// Limit this short sample to six discards/thirty actions, using required passes/draws without claiming full rule coverage.
let discards = 0;
let actions = 0;
// 持续推进场景直到 discards<6&&actions<30&&snapshots[0].game.phase!=='finished' 不再成立；循环内的动作/断言负责保证进展。
// Advance while discards<6&&actions<30&&snapshots[0].game.phase!=='finished' holds; actions/assertions inside are responsible for progress.
while (discards < 6 && actions < 30 && snapshots[0].game.phase !== "finished") {
  let seat, action;
  for (let i = 0; i < 3; i++) {
    const legal = snapshots[i].game.legalActions;
    const candidate =
      legal.find((a) => a.type === "pass") ||
      legal.find((a) => a.type === "discard") ||
      legal.find((a) => a.type === "draw");
    // 找到可执行动作后固定其所属座位并退出查找，避免动作与凭证错配。
    // Once a candidate is found, retain its seat and stop searching to avoid mismatched credentials.
    if (candidate) {
      seat = i;
      action = candidate;
      break;
    }
  }
  // 没有可执行动作时终止或报错，防止测试静默卡住或使用未定义动作。
  // Stop or fail when no action exists rather than hanging or submitting undefined actions.
  if (!action)
    throw new Error(
      "No discard/pass/draw action available in synthetic benchmark",
    );
  await request(`${roomPath}/action`, {
    token: clients[seat].token,
    body: {
      revision: snapshots[seat].revision,
      action,
    },
    category: "actionPost",
  });
  actions++;
  // 只计算实际弃牌数，必要的过牌或摸牌计入动作数但不算弃牌。
  // Count only actual discards here; required passes/draws count as actions but not discards.
  if (action.type === "discard") discards++;
  await refresh("peerRefreshGet");
}
// 先测四轮全量空闲读取，再与同版本 since 请求的轻量响应比较。
// Measure four full idle-read rounds before comparing lightweight same-revision since responses.
for (let round = 0; round < 4; round++) await refresh("idleFullGet");
// 累计 unchanged=true 的响应，证明这组采样确实走到未变化轮询路径。
// Count unchanged=true replies to confirm samples exercise the unchanged-poll path.
let unchanged = 0;
for (let round = 0; round < 4; round++) {
  const answers = await Promise.all(
    clients.map((player) =>
      request(`${roomPath}?since=${snapshots[player.seat].revision}`, {
        token: player.token,
        category: "idleSinceGet",
      }),
    ),
  );
  unchanged += answers.filter((answer) => answer.unchanged === true).length;
}
// 按采样类别汇总时延与大小；分位数来自已收集样本，不代表所有真实用户体验。
// Aggregate collected latency/size samples; sample quantiles do not represent every real user’s experience.
function summary(category) {
  const selected = records.filter((record) => record.category === category);
  const sorted = selected
    .map((record) => record.elapsedMs)
    .sort((a, b) => a - b);
  const bytes = selected.map((record) => record.responseBytes);
  const app = selected
    .map((record) => record.appMs)
    .filter((value) => value !== undefined)
    .sort((a, b) => a - b);
  const quantile = (fraction) =>
    sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
  return {
    requests: selected.length,
    ...(app.length
      ? {
          appServerMs: {
            samples: app.length,
            p50: app[Math.ceil(app.length * 0.5) - 1],
            p95: app[Math.ceil(app.length * 0.95) - 1],
          },
        }
      : {}),
    latencyMs: {
      p50: quantile(0.5),
      p95: quantile(0.95),
      max: sorted.at(-1),
      mean: Number(
        (sorted.reduce((sum, n) => sum + n, 0) / sorted.length).toFixed(2),
      ),
    },
    responseBytes: {
      min: Math.min(...bytes),
      max: Math.max(...bytes),
      mean: Number(
        (bytes.reduce((sum, n) => sum + n, 0) / bytes.length).toFixed(2),
      ),
    },
  };
}
// 输出采样方法与样本，区分应用耗时和完整 HTTP 往返；不能把这个结果称为页面点击到绘制延迟。
// Report methodology/samples and distinguish server time from full HTTP round trips, not click-to-paint latency.
const report = {
  label,
  measuredAt: new Date().toISOString(),
  origin,
  serviceVersion: health.version,
  methodology:
    "Node fetch HTTP round trip through complete response body; 3 independent bearer clients; own new anonymous room only; warm reads; six discards with necessary pass/manual-draw actions; after each action, 3 concurrent full snapshot GETs; four idle full rounds and four same-revision rounds, each 3 concurrent GETs. No browser/render/click or human-network timing.",
  clientCount: 3,
  discards,
  actions,
  unchangedResponses: unchanged,
  summary: Object.fromEntries(
    ["actionPost", "peerRefreshGet", "idleFullGet", "idleSinceGet"].map(
      (category) => [category, summary(category)],
    ),
  ),
  records,
};
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      output,
      label,
      serviceVersion: health.version,
      discards,
      actions,
      unchangedResponses: unchanged,
      summary: report.summary,
    },
    null,
    2,
  ),
);
