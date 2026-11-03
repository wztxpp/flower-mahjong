import { createApi } from './api.js';
import { D1Store } from './store.js';
let database,api;
export default {async fetch(request,env){
  if(new URL(request.url).pathname.startsWith('/api/')){
    if(!env.DB)return Response.json({error:'数据库未配置',code:'DATABASE_REQUIRED'},{status:503});
    if(database!==env.DB){database=env.DB;api=createApi(new D1Store(env.DB));}
    return api(request);
  }
  return env.ASSETS.fetch(request);
}};
