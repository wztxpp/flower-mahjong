// Node 适配层：私有 JSON 文件持久化，并把 Node 请求转换为 Web Request/Response。
// Node adapter: persist private JSON files and bridge Node requests to Web Request/Response.
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { MemoryStore } from './store.js';
import { createApi } from './api.js';
// 只支持一个进程写同一目录；不可把 .data 放入静态站点或提交 Git。
// Only one process may write the directory; never serve .data publicly or commit it to Git.
export class FileStore extends MemoryStore {
  // 解析数据目录并读取已有存档；只有文件不存在时才当作空数据，损坏文件必须报错。
  // Resolve the data directory and load saved state; only missing files mean empty data, corruption must fail.
  constructor(directory = process.env.MAHJONG_DATA_DIR || '.data') {
    const dir = resolve(directory);
    mkdirSync(dir, {
      recursive: true,
    });
    // 读取助手只吞 ENOENT；权限问题和 JSON 损坏不能静默抹掉旧记录。
    // The reader catches only ENOENT; permission failures and corrupt JSON must not silently erase records.
    const read = (name) => {
      try {
        return JSON.parse(readFileSync(resolve(dir, name), 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return [];
      }
    };
    super(read('rooms.json'), read('profiles.json'));
    this.filename = resolve(dir, 'rooms.json');
    this.profilesFilename = resolve(dir, 'profiles.json');
  }
  // 先写个人索引再写房间；临时文件 rename 分别替换，两个文件不是跨文件事务。
  // Write profiles before rooms; each temp-file rename replaces one file, not a transaction across both.
  async persist() {
    for (const [filename, data] of [
      [this.profilesFilename, [...this.profiles.values()]],
      [this.filename, [...this.rooms.values()]],
    ]) {
      // 临时文件按 0600 权限创建；rename 避免把半写入 JSON 留作正式文件。
      // Create temporary files with mode 0600; rename avoids leaving partial JSON as the main file.
      writeFileSync(filename + '.tmp', JSON.stringify(data), {
        mode: 0o600,
      });
      renameSync(filename + '.tmp', filename);
    }
  }
}
// 可由开发服务或独立 Node 服务挂载；非 API 请求交给 next。
// Mount in development or standalone Node service; forward non-API requests to next.
export function apiMiddleware(store = new FileStore()) {
  const api = createApi(store);
  return async (req, res, next) => {
    if (!req.url?.startsWith('/api/')) return next?.();
    try {
      const host = req.headers.host || 'localhost:5182';
      // 只有明确 TRUST_PROXY=1 才采信代理 HTTPS 头；不默认相信客户端自报协议。
      // Trust the forwarded HTTPS header only when TRUST_PROXY=1, not by default.
      const protocol =
        process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-proto'] === 'https'
          ? 'https'
          : 'http';
      const headers = new Headers();
      // Node 头可能是数组；用逗号连接后转换为 Web Headers。
      // Node header values may be arrays; join them before constructing Web Headers.
      for (const [k, v] of Object.entries(req.headers))
        if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(',') : v);
      // 本地限流地址取真实 socket，不采信客户端伪造的同名头。
      // Use the socket address for local throttling, overriding a client-supplied header.
      headers.set('cf-connecting-ip', req.socket.remoteAddress || 'local');
      const options = {
        method: req.method,
        headers,
      };
      // Node 流转成 Web 流需要 duplex=half；GET/HEAD 不附带请求体。
      // Converting Node streams requires duplex=half; GET/HEAD carry no body.
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        options.body = Readable.toWeb(req);
        options.duplex = 'half';
      }
      // 转发接口状态码、响应头和字节体；外层故障只返回通用错误，不泄露内部状态。
      // Forward status, headers, and response bytes; adapter failures expose only a generic error.
      const response = await api(new Request(`${protocol}://${host}${req.url}`, options));
      res.statusCode = response.status;
      for (const [k, v] of response.headers) res.setHeader(k, v);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          error: '服务器暂时不可用',
          code: 'SERVER_ERROR',
        }),
      );
    }
  };
}
