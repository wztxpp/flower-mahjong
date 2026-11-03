# 部署说明

## 最简单：单进程 Node

`npm ci && npm run build && npm start`。通过反向代理提供 HTTPS，并将 5182 转发到该服务。配置持久目录 `MAHJONG_DATA_DIR`。如 TLS 由可信反向代理终止，设置 `TRUST_PROXY=1`，并由代理覆盖 `X-Forwarded-Proto: https`；不要把该配置用于直接暴露的 HTTP 服务。服务不要求任何第三方登录或付费账号。

不能只托管静态前端：`/api/rooms`、加入、开局和操作接口必须连到同一后端。

## Cloudflare Workers / D1 适配器

`server/worker.js` 导出标准 Workers `fetch`。需要 `ASSETS` 静态资源绑定以及 `DB` D1 绑定。使用实际的数据库迁移系统在部署时创建表，不在用户请求中执行建表：

```sql
CREATE TABLE mahjong_rooms (
  id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL,
  state TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

把 Vue/Vite 输出作为 `ASSETS`，并将 `server/worker.js` 以 ES module 方式打包。所有 API 响应均 `private, no-store`。状态修改使用 `UPDATE ... WHERE id = ? AND revision = ?`；只有一个并发操作成功，其他操作返回 409，客户端刷新但不自动重放出牌。

服务器保留完整牌墙与私有手牌，`getPlayerView` 只返回本人手牌。没有把种子、牌墙顺序、其他座位令牌或服务器 JSON 放进前端包。

不要将开发环境与生产环境的数据库混用。部署权限、访问范围、域名和收费方案均由运行方自行确认；本项目不会自动创建付费资源或更改仓库可见性。
