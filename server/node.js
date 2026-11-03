import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { MemoryStore } from './store.js';
import { createApi } from './api.js';
export class FileStore extends MemoryStore {
  constructor(directory=process.env.MAHJONG_DATA_DIR||'.data'){const dir=resolve(directory);mkdirSync(dir,{recursive:true});let rooms=[];try{rooms=JSON.parse(readFileSync(resolve(dir,'rooms.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}super(rooms);this.filename=resolve(dir,'rooms.json');}
  async persist(){const cutoff=Date.now()-7*24*3600*1000;for(const[id,room]of this.rooms)if(room.updatedAt<cutoff)this.rooms.delete(id);writeFileSync(this.filename+'.tmp',JSON.stringify([...this.rooms.values()]),{mode:0o600});renameSync(this.filename+'.tmp',this.filename);}
}
export function apiMiddleware(store=new FileStore()){
  const api=createApi(store);
  return async (req,res,next)=>{
    if(!req.url?.startsWith('/api/'))return next?.();
    try{
      const host=req.headers.host||'localhost:5182';const protocol=process.env.TRUST_PROXY==='1'&&req.headers['x-forwarded-proto']==='https'?'https':'http';const headers=new Headers();for(const[k,v]of Object.entries(req.headers))if(v!==undefined)headers.set(k,Array.isArray(v)?v.join(','):v);
      headers.set('cf-connecting-ip',req.socket.remoteAddress||'local');
      const options={method:req.method,headers};if(req.method!=='GET'&&req.method!=='HEAD'){options.body=Readable.toWeb(req);options.duplex='half';}
      const response=await api(new Request(`${protocol}://${host}${req.url}`,options));res.statusCode=response.status;for(const[k,v]of response.headers)res.setHeader(k,v);res.end(Buffer.from(await response.arrayBuffer()));
    }catch{res.statusCode=500;res.setHeader('content-type','application/json');res.end(JSON.stringify({error:'服务器暂时不可用',code:'SERVER_ERROR'}));}
  };
}
