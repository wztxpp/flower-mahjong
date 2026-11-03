import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { apiMiddleware } from './node.js';
const root=resolve('dist'),api=apiMiddleware();
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const server=createServer((req,res)=>api(req,res,async()=>{try{
  let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(name==='/')name='/index.html';let file=resolve(root,'.'+name);if(!file.startsWith(root+sep)){res.statusCode=403;return res.end();}
  try{if(!(await stat(file)).isFile())throw Error();}catch{file=resolve(root,'index.html');}
  const data=await readFile(file);res.setHeader('content-type',types[extname(file)]||'application/octet-stream');res.setHeader('x-content-type-options','nosniff');res.end(data);
}catch{res.statusCode=404;res.end('请先运行 npm run build');}}));
const port=Number(process.env.PORT||5182);server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`端口 ${port} 已被占用，请关闭旧进程后重试。`:e.message);process.exit(1);});server.listen(port,'0.0.0.0',()=>console.log(`花间: http://localhost:${port}（同一局请连接同一服务器）`));
