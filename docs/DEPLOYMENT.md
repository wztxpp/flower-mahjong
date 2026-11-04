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

## 0.2 的旧局兼容和增量查询

已保存 JSON 中没有 `game.schemaVersion` 或值为1时，路由到 `shared/legacy-game.js`，保留原有数据、手动摸牌和规则。新建牌局返回2；只有房主在一局结束后重新开始，才生成新规则牌局。不运行全表迁移、清空或覆盖正在玩的旧房间。未知更高版本拒绝操作，不能误按旧版解释。

`GET /api/rooms/:id?since=N` 先校验该座位的 Bearer 凭证。当 N 等于当前 room revision，只返回 `unchanged`、`revision` 和公开连接状态；有更新才序列化对应玩家的私有视图。读取只需一次数据库查询，心跳最多每10秒每座位更新一次。正常操作直接返回最新权威视图，客户端不再额外强制请求一次完整快照。

可见的进行中牌桌以350毫秒为目标轮询间隔，始终不重叠请求；后台标签页降频。HTTP 响应含无私密信息的 `Server-Timing`，供测量应用处理耗时；它不等同于用户手机的点击到渲染时间。

## Source and migration compatibility

Publish only verified GitHub main source; see [release workflow](RELEASE-WORKFLOW.md). Keep the same live Worker and database bindings. Manual SQL migrations remain under `db/migrations/` for compatibility, and are equivalent to the tracked Drizzle SQL. Use only one migration path and preserve existing applied-migration history. Source synchronization does not reset rooms, profiles or historical scores.
