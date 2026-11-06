/**
 * 当前麻将网站的生产构建入口；只生成本地 dist，不执行发布或数据库迁移。
 * Production build entry for Mahjong; creates local dist only, without publishing or database migration.
 * 顺序必须保持：清理旧产物 → 构建浏览器代码 → 打包 Worker → 写运行配置。
 * Keep this order: clear old output → build the browser → bundle the Worker → write runtime configuration.
 */
import { build as viteBuild } from 'vite';
import { build as esbuild } from 'esbuild';
import { mkdir, writeFile, rm } from 'node:fs/promises';

// 删除的仅是可重新生成的构建目录，不是 .data 或任何生产数据库。
// Remove only reproducible build output, never .data or a production database.
await rm('dist', { recursive: true, force: true });

// Vite 使用根目录 vite.config.ts，将 Vue 页面及资源写入 dist/client。
// Vite reads vite.config.ts and writes the Vue application and assets to dist/client.
await viteBuild();

// 前端构建完成后单独建立服务端输出目录，避免与静态文件混放。
// Create a separate server output directory after the frontend build.
await mkdir('dist/server', { recursive: true });

// Worker 入口是 server/worker.js，不是仓库里保留的 worker/index.ts 模板。
// server/worker.js is the active Worker entry, not the retained worker/index.ts scaffold.
await esbuild({
  entryPoints: ['server/worker.js'],
  outfile: 'dist/server/index.js',
  bundle: true,
  // Workers 使用 Web API；browser 平台不是在浏览器里运行服务端规则。
  // Workers use Web APIs; the browser platform option does not expose server rules as client authority.
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
});

// 写出托管/本地 Wrangler 所需绑定；这里的数据库 ID 是构建占位符，不是实际生产凭证。
// Emit hosting/local Wrangler bindings; the database ID is a build placeholder, not a production credential.
await writeFile(
  'dist/server/wrangler.json',
  JSON.stringify({
    name: 'flower-mahjong',
    main: 'index.js',
    compatibility_date: '2026-05-15',
    assets: {
      directory: '../client',
      binding: 'ASSETS',
      not_found_handling: 'single-page-application',
    },
    d1_databases: [
      {
        binding: 'DB',
        database_name: 'site-creator-d1',
        database_id: '00000000-0000-4000-8000-000000000000',
      },
    ],
  }),
);
