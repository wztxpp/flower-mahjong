// 独立 Node 启动入口（不是当前托管 Worker 构建入口）；需要与 dist 路径匹配的静态产物。
// Standalone Node entry, not the hosted Worker entry; requires static output matching the dist path.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { apiMiddleware } from './node.js';
// 静态根目录固定为 dist；私有 .data 在根目录之外，不能直接当静态资源返回。
// Serve only dist; private .data stays outside the static root.
const root = resolve('dist'),
  api = apiMiddleware();
// 按扩展名给常用静态资源设置 MIME；未知类型按二进制处理。
// Assign MIME types by extension; unknown types use the binary fallback.
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
// 优先 API，中间件让行后才尝试静态文件；任何静态读取失败走统一 404。
// Handle API first, then static files only when middleware passes through; read failures use a common 404.
const server = createServer((req, res) =>
  api(req, res, async () => {
    try {
      let name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (name === '/') name = '/index.html';
      let file = resolve(root, '.' + name);
      // 规范化后的路径必须位于静态根目录内，阻止 ../ 越界读文件。
      // The resolved path must remain inside the static root, blocking ../ traversal.
      if (!file.startsWith(root + sep)) {
        res.statusCode = 403;
        return res.end();
      }
      try {
        if (!(await stat(file)).isFile()) throw Error();
      } catch {
        // 找不到实际文件时回退首页，支持前端页面路由；不回退私人文件。
        // Fall back to the index for missing files to support client routing, never to private files.
        file = resolve(root, 'index.html');
      }
      const data = await readFile(file);
      res.setHeader('content-type', types[extname(file)] || 'application/octet-stream');
      res.setHeader('x-content-type-options', 'nosniff');
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end('请先运行 npm run build');
    }
  }),
);
// 固定默认端口 5182；端口占用就明确失败，不偷偷改端口让玩家连接错服务器。
// Default to port 5182 and fail explicitly if occupied rather than silently moving players to another port.
const port = Number(process.env.PORT || 5182);
server.on('error', (e) => {
  console.error(
    e.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，请关闭旧进程后重试。` : e.message,
  );
  process.exit(1);
});
server.listen(port, '0.0.0.0', () =>
  console.log(`花间: http://localhost:${port}（同一局请连接同一服务器）`),
);
