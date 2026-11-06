// 隔离浏览器测试适配器：三端口共享内存牌桌，不读取任何 FileStore/生产档案。
// Isolated browser adapter: three origins share memory rooms, never FileStore or production records.
import { createServer } from 'node:http';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const repository = resolve(process.argv[2]);
const basePort = Number(process.argv[3] || 5197);
const evidence = resolve(process.argv[4] || '/tmp/mahjong-browser-evidence');
const { createApi } = await import(pathToFileURL(resolve(repository, 'server/api.js')));
const { MemoryStore } = await import(pathToFileURL(resolve(repository, 'server/store.js')));
const store = new MemoryStore();
const api = createApi(store);
const root = resolve(repository, 'dist/client');
const fixtureName = process.argv[5] || '';
if (fixtureName && !['double-hu', 'peng'].includes(fixtureName)) throw new Error('Unknown synthetic fixture');
await mkdir(evidence, { recursive: true });
const logFile = resolve(evidence, 'http.jsonl');
const controlFile = resolve(evidence, 'control.json');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.json': 'application/json' };
let faultEpoch = '';
let remainingConflicts = 0;
let remainingAudioFailures = 0;
let faultStarted = 0;
let queuedOutageUntil = 0;
let queuedOutageArmed = false;
const presentationClients = new Map();

// 仅记录状态、事件序号和屏障公开信息，不保存请求秘密或暗手牌。
// Record only statuses, revisions and public gate fields, never request secrets or concealed hands.
async function log(value) {
  await appendFile(logFile, JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n');
}

// 控制文件仅由测试员写入；故障标签必须与真实服务失败分开分析。
// Only the test operator writes controls; analyze labeled injections separately from organic failures.
async function control() {
  try { return JSON.parse(await readFile(controlFile, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}

for (let client = 0; client < 3; client++) {
  const port = basePort + client;
  const server = createServer(async (request, response) => {
    const started = Date.now();
    try {
      const url = new URL(request.url, `http://localhost:${port}`);
      const settings = await control();
      if (settings.epoch !== faultEpoch) {
        faultEpoch = settings.epoch;
        remainingConflicts = Number(settings.poll409Count || 0);
        remainingAudioFailures = Number(settings.audio503Count || 0);
        faultStarted = Date.now();
        queuedOutageUntil = 0;
        queuedOutageArmed = false;
      }
      // 页面 ID 只用于测试延迟定位，不保存任何座位凭证。
      // Page IDs target injected delays only; no seat credentials are recorded.
      const pageId = request.headers['x-presentation-client'];
      if (pageId && !presentationClients.has(pageId)) presentationClients.set(pageId, presentationClients.size);
      const page = presentationClients.get(pageId);
      const isPoll = request.method === 'GET' && /^\/api\/rooms\/[^/]+$/.test(url.pathname);
      if (url.pathname.startsWith('/api/')) {
        if (isPoll && client === Number(settings.faultClient ?? 0) && (Date.now() < queuedOutageUntil || Date.now() - faultStarted < Number(settings.poll503Ms || 0))) {
          response.writeHead(503, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'Synthetic polling outage' }));
          await log({ client, page, status: 503, synthetic: 'poll-outage' });
          return;
        }
        if (client === Number(settings.faultClient ?? 0) && request.method === 'GET' && /^\/api\/rooms\/[^/]+$/.test(url.pathname) && remainingConflicts > 0) {
          remainingConflicts--;
          response.writeHead(409, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'Synthetic polling conflict', code: 'STALE_STATE' }));
          await log({ client, path: url.pathname, status: 409, synthetic: 'poll-409', remainingConflicts });
          return;
        }
        const parts = [];
        for await (const part of request) parts.push(part);
        const body = Buffer.concat(parts);
        const options = { method: request.method, headers: request.headers, ...(body.length ? { body } : {}) };
        let result = await api(new Request(url, options));
        // 只在独立测试进程明确启用时，开局后安装守恒夹具；浏览器仍通过真实动作接口胡牌。
        // Explicit test-only opt-in installs a conserved fixture after start; browsers still use genuine hu actions.
        if (fixtureName && url.pathname.endsWith('/start') && result.status === 200) {
          const roomId = url.pathname.split('/')[3];
          const room = await store.get(roomId);
          const expectedRevision = room.revision;
          const { postHuWinClaim } = await import(pathToFileURL(resolve(repository, 'tests/fixtures/post-hu-win.js')));
          const { assertGameInvariants } = await import(pathToFileURL(resolve(repository, 'shared/game.js')));
          const { pungUpgradeGame } = await import(pathToFileURL(resolve(repository, 'tests/fixtures/pung-upgrade.js')));
          room.game = fixtureName === 'double-hu' ? postHuWinClaim({ multiple: true }) : pungUpgradeGame();
          room.game.rules.autoDiscardAfterHu = true;
          assertGameInvariants(room.game);
          room.revision++;
          if (!await store.compareAndSwap(room, expectedRevision)) throw new Error('Fixture CAS failed');
          await log({ synthetic: `conserved-${fixtureName}-fixture-installed`, roomId });
          result = await api(new Request(new URL('/api/rooms/' + roomId, url), { headers: request.headers }));
        }
        const json = await result.json();
        // 在真实 API 计算完后延迟响应，制造旧页落后；不改返回快照。
        // Delay only delivery after the real API computes its unchanged snapshot.
        if (isPoll && page === settings.delayPage && settings.pollDelayMs > 0) {
          await log({ client, page, synthetic: 'poll-delay-start', delayMs: settings.pollDelayMs });
          await new Promise(done => setTimeout(done, settings.pollDelayMs));
        }
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(JSON.stringify(json));
        const state = json.state;
        // 先真实送达指定长度的队列，再让后续轮询失败，避免手工注入时队列已经播完。
        // Deliver the real history prefix first, then fail later polls so manual timing cannot miss the backlog.
        if (!queuedOutageArmed && client === Number(settings.faultClient ?? 0) && settings.outageAfterHistoryCount > 0 && state?.game?.history?.length >= settings.outageAfterHistoryCount) {
          queuedOutageArmed = true;
          queuedOutageUntil = Date.now() + Number(settings.queuedOutageMs || 9000);
          await log({ client, page, synthetic: 'received-queue-outage-armed', historyCount: state.game.history.length, durationMs: Number(settings.queuedOutageMs || 9000) });
        }
        await log({ client, page, method: request.method, path: url.pathname, status: result.status, code: json.code, elapsedMs: Date.now() - started,
          history: state?.game?.history?.map((event, index) => ({ index, type: event.type, seat: event.seat, ...(['discard', 'peng', 'hu', 'mingGang', 'buGang', 'addGang'].includes(event.type) ? { tile: event.tile } : {}) })), revision: state?.revision, gameRevision: state?.game?.revision, legalCount: state?.game?.legalActions?.length,
          presentation: state?.presentation ? { id: state.presentation.id, requiredSeats: state.presentation.requiredSeats, completedSeats: state.presentation.completedSeats, remainingMs: state.presentation.remainingMs } : null });
        return;
      }
      // 只给第三 origin 的真实 mp3 响应增加延迟，绝不伪造播放结束或游戏状态。
      // Delay actual MP3 responses on the selected origin, never fabricate playback completion or game state.
      if (url.pathname.endsWith('.mp3') && client === Number(settings.audioFailureClient ?? 0) && remainingAudioFailures > 0) {
        remainingAudioFailures--;
        response.writeHead(503, { 'content-type': 'text/plain' });
        response.end('Synthetic one-shot media failure');
        await log({ client, path: url.pathname, status: 503, synthetic: 'media-503' });
        return;
      }
      const delayMs = client === Number(settings.slowClient ?? 2) && url.pathname.endsWith('.mp3') ? Number(settings.audioDelayMs || 0) : 0;
      if (delayMs > 0) {
        await log({ client, path: url.pathname, synthetic: 'media-delay-start', delayMs });
        await new Promise(resolveDelay => setTimeout(resolveDelay, delayMs));
      }
      const file = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
      if (!file.startsWith(root + '/')) throw new Error('Static path outside root');
      let data = await readFile(file);
      if (extname(file) === '.html') {
        const observer = await readFile(new URL('./playback-observer.js', import.meta.url), 'utf8');
        data = Buffer.from(data.toString().replace('<head>', `<head><script>${observer}</script>`));
      }
      response.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      response.end(data);
      if (url.pathname.endsWith('.mp3')) await log({ client, path: url.pathname, status: 200, elapsedMs: Date.now() - started, synthetic: delayMs ? 'media-delay-end' : undefined });
    } catch (error) {
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'Test adapter failure' }));
      await log({ client, status: 500, adapterError: error.message });
    }
  });
  server.listen(port, '127.0.0.1', () => console.log(`Synthetic client ${client}: http://localhost:${port}`));
}
