// 原图局部动画的隔离验收服务：四个源共享合成 MemoryStore，不读生产档案。
// Isolated original-art motion acceptance: four origins share a synthetic MemoryStore, never production records.
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { apiMiddleware } from '../../server/node.js';
import { MemoryStore } from '../../server/store.js';

const basePort = Number(process.argv[2] || 5480);
if (!Number.isInteger(basePort) || basePort < 1024 || basePort > 65532) throw new Error('Invalid local base port');
const resourceLog = process.argv[3] ? resolve(process.argv[3]) : null;
if (resourceLog) await mkdir(dirname(resourceLog), { recursive: true });
const store = new MemoryStore();
const servers = [];

for (const port of [basePort, basePort + 1, basePort + 2, basePort + 3]) {
  const server = await createServer({
    configFile: false,
    plugins: [vue(), {
      name: 'portrait-motion-isolated-api',
      configureServer(instance) {
        // 只记录静态路径/状态，借此检查旧 SDK 零请求；不记录查询、正文、身份或暗手。
        // Record static paths/statuses to verify zero old-SDK requests; omit queries, bodies, identities and concealed hands.
        if (resourceLog) instance.middlewares.use((request, response, next) => {
          const path = new URL(request.url || '/', `http://127.0.0.1:${port}`).pathname;
          if (!path.startsWith('/api/') && /\.(?:js|mjs|ts|vue|css|png|webp|json|moc3)$/.test(path)) {
            response.once('finish', () => {
              void appendFile(resourceLog, `${JSON.stringify({ at: new Date().toISOString(), port, path, status: response.statusCode })}\n`)
                .catch((error) => { console.error('Portrait evidence write failed:', error.message); });
            });
          }
          next();
        });
        instance.middlewares.use(apiMiddleware(store));
      },
    }],
    server: { host: '127.0.0.1', port, strictPort: true },
  });
  await server.listen();
  servers.push(server);
  server.printUrls();
}

// 只停止本脚本创建的实例，保持其他测试/用户服务不受影响。
// Stop only instances created here, leaving other tests and user services untouched.
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await Promise.all(servers.map((server) => server.close()));
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
