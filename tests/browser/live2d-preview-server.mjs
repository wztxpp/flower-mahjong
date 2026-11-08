// 四个本地源共享 MemoryStore，可验三/四人真实 App；不读取生产档案或主平台配置。
// Four local origins share MemoryStore for actual three/four-seat App checks, without production records or platform config.
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { apiMiddleware } from '../../server/node.js';
import { MemoryStore } from '../../server/store.js';
const store = new MemoryStore();
const servers = [];
// 可选日志仅记录动态素材路径和HTTP状态，不保存API、查询参数、Cookie或牌局凭证。
// Optional evidence records only dynamic-resource paths/statuses, never APIs, queries, cookies or game credentials.
const resourceLog = process.argv[2] ? resolve(process.argv[2]) : null;
if (resourceLog) await mkdir(dirname(resourceLog), { recursive: true });
// 新端口提供正常的独立浏览器源，避免修改旧测试页的存储来伪造首次访问。
// A fresh base port gives a normal independent origin instead of altering older test-page storage.
const basePort = Number(process.argv[3] || 5460);
if (!Number.isInteger(basePort) || basePort < 1024 || basePort > 65532) throw new Error('Invalid local base port');
for (const port of [basePort, basePort + 1, basePort + 2, basePort + 3]) {
  const server = await createServer({
    configFile: false,
    plugins: [vue(), {
      name: 'live2d-isolated-memory-api',
      configureServer(instance) {
        if (resourceLog) instance.middlewares.use((request, response, next) => {
          const path = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
          const kind = path.includes('/vendor/live2d/') ? 'sdk'
            : path.startsWith('/live2d/') ? 'model'
              : path.endsWith('/src/live2d/renderer.js') ? 'renderer' : null;
          if (kind) response.once('finish', () => {
            void appendFile(resourceLog, `${JSON.stringify({ at: new Date().toISOString(), port, kind, path, status: response.statusCode })}\n`)
              .catch((error) => { console.error('Live2D resource evidence write failed:', error.message); });
          });
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
process.on('SIGTERM', async () => { await Promise.all(servers.map((server) => server.close())); process.exit(0); });
