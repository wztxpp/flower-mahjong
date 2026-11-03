/** Anonymous synthetic-room HTTP benchmark. Never reads or mutates existing rooms.
 * Usage: node tests/performance/benchmark-api.mjs URL LABEL OUTPUT.json
 * Tokens and private hands remain in process memory and are never written.
 */
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const [base, label = 'measurement', output] = process.argv.slice(2);
if (!base || !output) throw new Error('Usage: node tests/performance/benchmark-api.mjs URL LABEL OUTPUT.json');
const origin = new URL(base).origin;
const records = [];
async function request(path, { token, body, category } = {}) {
  const begin = performance.now();
  const response = await fetch(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  const raw = await response.text();
  const elapsed = performance.now() - begin;
  const data = JSON.parse(raw);
  const appMatch = response.headers.get('server-timing')?.match(/(?:^|,)\s*app;dur=([0-9.]+)/);
  if (category) records.push({ category, elapsedMs: Number(elapsed.toFixed(2)), responseBytes: Buffer.byteLength(raw), status: response.status, ...(appMatch ? { appMs: Number(appMatch[1]) } : {}) });
  if (!response.ok) throw new Error(`${category || path}: HTTP ${response.status} ${data.code || 'unknown error'}`);
  return data;
}
const health = await request('/api/health');
const created = await request('/api/rooms', { body: { name: '合成压测东' } });
const roomPath = `/api/rooms/${created.roomId}`;
const clients = [{ token: created.token, seat: 0 }];
for (const name of ['合成压测南', '合成压测西']) {
  const joined = await request(`${roomPath}/join`, { body: { name } });
  clients.push({ token: joined.token, seat: joined.state.you });
}
let snapshots = await Promise.all(clients.map(async player => (await request(roomPath, { token: player.token })).state));
await request(`${roomPath}/start`, { token: clients[0].token, body: { revision: snapshots[0].revision } });
async function refresh(category) {
  snapshots = await Promise.all(clients.map(async player => (await request(roomPath, { token: player.token, category })).state));
}
await refresh(); // Warm authenticated reads before measured gameplay.
let discards = 0;
let actions = 0;
while (discards < 6 && actions < 30 && snapshots[0].game.phase !== 'finished') {
  let seat, action;
  for (let i = 0; i < 3; i++) {
    const legal = snapshots[i].game.legalActions;
    const candidate = legal.find(a => a.type === 'pass') || legal.find(a => a.type === 'discard') || legal.find(a => a.type === 'draw');
    if (candidate) { seat = i; action = candidate; break; }
  }
  if (!action) throw new Error('No discard/pass/draw action available in synthetic benchmark');
  await request(`${roomPath}/action`, { token: clients[seat].token, body: { revision: snapshots[seat].revision, action }, category: 'actionPost' });
  actions++;
  if (action.type === 'discard') discards++;
  await refresh('peerRefreshGet');
}
for (let round = 0; round < 4; round++) await refresh('idleFullGet');
let unchanged = 0;
for (let round = 0; round < 4; round++) {
  const answers = await Promise.all(clients.map(player => request(`${roomPath}?since=${snapshots[player.seat].revision}`, { token: player.token, category: 'idleSinceGet' })));
  unchanged += answers.filter(answer => answer.unchanged === true).length;
}
function summary(category) {
  const selected = records.filter(record => record.category === category);
  const sorted = selected.map(record => record.elapsedMs).sort((a, b) => a - b);
  const bytes = selected.map(record => record.responseBytes);
  const app = selected.map(record => record.appMs).filter(value => value !== undefined).sort((a, b) => a - b);
  const quantile = fraction => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
  return { requests: selected.length, ...(app.length ? { appServerMs: { samples: app.length, p50: app[Math.ceil(app.length * .5) - 1], p95: app[Math.ceil(app.length * .95) - 1] } } : {}), latencyMs: { p50: quantile(.5), p95: quantile(.95), max: sorted.at(-1), mean: Number((sorted.reduce((sum, n) => sum + n, 0) / sorted.length).toFixed(2)) }, responseBytes: { min: Math.min(...bytes), max: Math.max(...bytes), mean: Number((bytes.reduce((sum, n) => sum + n, 0) / bytes.length).toFixed(2)) } };
}
const report = {
  label, measuredAt: new Date().toISOString(), origin, serviceVersion: health.version,
  methodology: 'Node fetch HTTP round trip through complete response body; 3 independent bearer clients; own new anonymous room only; warm reads; six discards with necessary pass/manual-draw actions; after each action, 3 concurrent full snapshot GETs; four idle full rounds and four same-revision rounds, each 3 concurrent GETs. No browser/render/click or human-network timing.',
  clientCount: 3, discards, actions, unchangedResponses: unchanged,
  summary: Object.fromEntries(['actionPost', 'peerRefreshGet', 'idleFullGet', 'idleSinceGet'].map(category => [category, summary(category)])),
  records,
};
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output, label, serviceVersion: health.version, discards, actions, unchangedResponses: unchanged, summary: report.summary }, null, 2));
