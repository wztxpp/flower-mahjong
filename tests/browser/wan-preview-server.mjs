// 只启动组件预览；显式禁用主配置，绝不加载房间 API 或 FileStore。
// Start a component-only preview; disable the main config so room APIs and FileStore never load.
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
const server = await createServer({
  configFile: false,
  plugins: [vue()],
  server: { host: '127.0.0.1', port: 5374, strictPort: true },
});
await server.listen();
server.printUrls();
// 终止预览时释放监听端口；不触碰任何牌局数据。
// Release the listener on termination without touching game data.
process.on('SIGTERM', async () => { await server.close(); process.exit(0); });
