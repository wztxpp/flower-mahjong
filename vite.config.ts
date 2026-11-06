// Vite 把 Vue 页面、开发服务器和托管平台适配组合起来；不在这里实现麻将规则。
// Vite composes Vue, the development server, and hosting integration; Mahjong rules live elsewhere.
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { sites } from './scripts/vite/sites-vite-plugin';
import { apiMiddleware } from './server/node.js';

export default defineConfig({
  plugins: [
    // 将 .vue 单文件组件编译为浏览器可执行模块。
    // Compile .vue single-file components into browser modules.
    vue(),
    // 保留平台插件与原认证配置；普通房间权限仍由我们的 API 凭证验证。
    // Preserve hosting integration and authentication settings; the API still verifies seat credentials.
    sites({ mockAuth: false }),
    {
      name: 'mahjong-api',
      // 开发时将 /api 请求交给同一业务服务端，避免前端另写一套假数据逻辑。
      // Route development API requests to the real server implementation rather than frontend mock rules.
      configureServer(s) {
        s.middlewares.use(apiMiddleware());
      },
    },
  ],
  server: {
    host: '0.0.0.0',
    port: 5182,
    // 端口被占用就失败，不能静默换端口让三位玩家连到不同服务。
    // Fail on an occupied port instead of silently moving players to another server.
    strictPort: true,
    allowedHosts: ['terminal.local'],
  },
  build: {
    // 当前自定义构建把静态文件与 Worker 分开存放。
    // The custom build keeps static assets separate from the Worker bundle.
    outDir: 'dist/client',
  },
});
