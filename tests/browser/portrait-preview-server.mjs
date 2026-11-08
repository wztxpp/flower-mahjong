// 真实 App 的隔离验收：只用内存存储，不加载生产数据或主 Vite 配置。
// Isolated actual-App QA: memory only, no production data or main Vite configuration.
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { apiMiddleware } from '../../server/node.js';
import { MemoryStore } from '../../server/store.js';
const store = new MemoryStore();
const servers = [];
for (const port of [5380, 5381, 5382]) {
  const server = await createServer({ configFile: false, plugins: [vue(), {
    name: 'isolated-memory-api',
    configureServer(server) { server.middlewares.use(apiMiddleware(store)); },
  }], server: { host: '127.0.0.1', port, strictPort: true } });
  await server.listen();
  servers.push(server);
  server.printUrls();
}
// 终止时只关闭本测试服务器，不触碰其他进程。
// Close only these test listeners on termination.
process.on('SIGTERM', async () => { await Promise.all(servers.map((server) => server.close())); process.exit(0); });
