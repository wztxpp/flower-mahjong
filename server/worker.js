// 当前 Cloudflare 托管运行入口：API 使用 D1，其余请求交给静态资源绑定。
// Active Cloudflare hosted entry: API uses D1; other requests go to the static asset binding.
import { createApi } from './api.js';
import { D1Store } from './store.js';
// 按数据库绑定缓存 API 实例；Worker 实例间不共享这个内存缓存。
// Cache the API per database binding; separate Worker isolates do not share this memory.
let database, api;
export default {
  // 每个请求的入口；缺少 DB 时明确报错，不退回易丢失的内存存储。
  // Per-request entry; report missing DB explicitly rather than falling back to ephemeral memory.
  async fetch(request, env) {
    if (new URL(request.url).pathname.startsWith('/api/')) {
      if (!env.DB)
        return Response.json(
          {
            error: '数据库未配置',
            code: 'DATABASE_REQUIRED',
          },
          {
            status: 503,
          },
        );
      // 绑定变化时重建存储适配器，避免复用指向旧数据库的 API。
      // Rebuild the store adapter if the binding changes to avoid using the previous database.
      if (database !== env.DB) {
        database = env.DB;
        api = createApi(new D1Store(env.DB));
      }
      return api(request);
    }
    // 非 API 页面由平台静态资源处理，绝不返回 D1 内的原始房间 JSON。
    // Serve non-API pages through platform assets, never raw room JSON from D1.
    return env.ASSETS.fetch(request);
  },
};
