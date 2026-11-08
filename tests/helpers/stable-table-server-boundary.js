// 仅服务本地诊断：所有/API方法都拒绝，不导入或转发业务中间件。
// Local diagnostic boundary: deny every /api method without importing/forwarding business middleware.
export function rejectStableTableApi(request, response, next) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname); }
  catch { response.writeHead(400); response.end('Invalid fixture path'); return; }
  if (/^\/api(?:\/|$)/i.test(pathname)) {
    response.writeHead(403, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'View-only fixture; all API requests are disabled' }));
    return;
  }
  next();
}
