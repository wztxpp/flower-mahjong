// 本地纯视图预览。显式禁用主配置，不导入API、存储、数据库或房间创建路径。
// Local view-only preview: disable the main config; import no API, store, database, or room-creation path.
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { rejectStableTableApi } from '../helpers/stable-table-server-boundary.js';
import { transformStableTableApp } from '../helpers/stable-table-transform.js';
const root = fileURLToPath(new URL('../../', import.meta.url));
// 托管预览附加 --port 时优先使用其指定端口，仍只启动一个隔离实例。
// Honor the managed preview port override while running one isolated instance only.
const portFlag = process.argv.indexOf('--port');
const port = Number(portFlag >= 0 ? process.argv[portFlag + 1] : process.argv[2] || 5518);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid preview port');
const server = await createServer({
  root, configFile: false,
  plugins: [{
    name: 'stable-table-view-only', enforce: 'pre',
    transform(source, id) {
      if (id.split('?')[0] === resolve(root, 'src/App.vue') && !id.includes('vue&type=')) return { code: transformStableTableApp(source), map: null };
    },
    configureServer(instance) {
      instance.middlewares.use(rejectStableTableApi);
      instance.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url || '/', `http://127.0.0.1:${port}`).pathname;
        if (pathname === '/') request.url = '/tests/browser/stable-table-preview.html';
        next();
      });
    },
  }, vue()],
  server: { host: '127.0.0.1', port, strictPort: true, cors: false },
});
await server.listen();
server.printUrls();
console.log(`View-only fixture: http://127.0.0.1:${port}/tests/browser/stable-table-preview.html`);
// 只关闭当前诊断实例，不改变其他服务或文件。
// Close only this diagnostic instance, without modifying other servers/files.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.close(); process.exit(0); });
