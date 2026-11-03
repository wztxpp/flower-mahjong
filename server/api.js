import { createGame, applyAction, getPlayerView } from '../shared/game.js';
import { applyAction as applyLegacyAction, getPlayerView as getLegacyView } from '../shared/legacy-game.js';

// Existing saved games keep their exact original rules and physical state.
// Only a new game receives schemaVersion 2; no database migration rewrites hands.
function engineFor(game) {
  if (game.schemaVersion === 2) return { apply: applyAction, view: getPlayerView };
  if (game.schemaVersion === undefined || game.schemaVersion === 1) return { apply: applyLegacyAction, view: getLegacyView };
  fail(409, 'UNSUPPORTED_GAME_VERSION', '这桌使用了更新的规则版本，请刷新页面后重试');
}

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status=status; this.code=code; }
}
const fail=(status,code,message)=>{throw new ApiError(status,code,message)};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomCode(){return Array.from(crypto.getRandomValues(new Uint8Array(8)),n=>alphabet[n%alphabet.length]).join('');}
function randomToken(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');}
export async function hashToken(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');}
function playerName(name){if(typeof name!=='string')fail(400,'BAD_NAME','请填写落座名字'); const value=name.trim().normalize('NFC'); if(!value||[...value].length>16||/[\p{Cc}\p{Cf}]/u.test(value))fail(400,'BAD_NAME','名字需为 1–16 个字符，不能含控制字符');return value;}
async function bodyOf(request){
  if(Number(request.headers.get('content-length')||0)>2048)fail(413,'TOO_LARGE','请求内容过长');
  const reader=request.body?.getReader();let total=0,chunks=[];
  if(reader){while(true){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>2048){await reader.cancel();fail(413,'TOO_LARGE','请求内容过长');}chunks.push(value);}}
  const data=new Uint8Array(total);let offset=0;for(const c of chunks){data.set(c,offset);offset+=c.length;}
  try{const body=JSON.parse(new TextDecoder().decode(data));if(!body||Array.isArray(body)||typeof body!=='object')throw Error();return body;}catch{fail(400,'BAD_JSON','请求格式不正确');}
}
function publicRoom(room,seat){
  const game=room.game?{...engineFor(room.game).view(room.game,seat),schemaVersion:room.game.schemaVersion??1}:null;
  return {id:room.id,revision:room.revision,phase:room.game?(room.game.phase==='finished'?'finished':'playing'):'lobby',hostSeat:room.hostSeat,you:seat,createdAt:room.createdAt,
    rulesVersion:game?.schemaVersion??2,
    seats:room.seats.map((p,i)=>p?{seat:i,name:p.name,connected:Date.now()-p.lastSeen<30000,score:game?.players?.[i]?.score??0,handCount:game?.players?.[i]?.handCount??room.game?.players?.[i]?.hand.length??0,huCount:game?.players?.[i]?.huCount??0,melds:game?.players?.[i]?.melds??[],radishes:game?.players?.[i]?.radishes??[],winPile:game?.players?.[i]?.winPile??[],lastScoreBreakdown:game?.players?.[i]?.lastScoreBreakdown??null}:null), game};
}
async function authenticate(room,request){const authorization=request.headers.get('authorization')||''; if(!/^Bearer [a-f0-9]{64}$/.test(authorization))fail(401,'UNAUTHORIZED','座位凭证失效，请重新进入房间');const hash=await hashToken(authorization.slice(7));const seat=room.seats.findIndex(p=>p?.tokenHash===hash);if(seat<0)fail(401,'UNAUTHORIZED','座位凭证失效，请重新进入房间');return seat;}
function revisionMatches(body,room){if(!Number.isSafeInteger(body.revision)||body.revision!==room.revision)fail(409,'STALE_STATE','牌桌已更新，请看最新牌面后再操作');}
async function commit(store,previous,next){next.revision=previous.revision+1;next.updatedAt=Date.now();if(!await store.compareAndSwap(next,previous.revision))fail(409,'STALE_STATE','有人刚刚操作了牌桌，请刷新后重试');}

export function createApi(store){
  const recentCreates=new Map();
  const handle=async function(request){try{
    const url=new URL(request.url), method=request.method;
    if(!url.pathname.startsWith('/api/'))return null;
    const origin=request.headers.get('origin');if(origin&&origin!==url.origin)fail(403,'ORIGIN','不接受跨站请求');
    if(method==='GET'&&url.pathname==='/api/health')return json({ok:true,service:'flower-mahjong',version:'0.2.0',rulesVersion:2});
    if(method==='POST'&&url.pathname==='/api/rooms'){
      const body=await bodyOf(request),name=playerName(body.name); const ip=request.headers.get('cf-connecting-ip')||'local';const now=Date.now();
      const recent=(recentCreates.get(ip)||[]).filter(n=>now-n<60000);if(recent.length>=10)fail(429,'RATE_LIMIT','建房太频繁，请稍后再试');recent.push(now);recentCreates.set(ip,recent);if(recentCreates.size>5000)recentCreates.clear();
      const token=randomToken(); const person={name,tokenHash:await hashToken(token),lastSeen:now};
      for(let attempt=0;attempt<5;attempt++){const room={id:randomCode(),revision:0,hostSeat:0,seats:[person,null,null],game:null,createdAt:now,updatedAt:now};if(await store.insert(room))return json({roomId:room.id,token,state:publicRoom(room,0)},201);}
      fail(503,'BUSY','暂时无法建房，请稍后再试');
    }
    const match=url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{8})(?:\/(join|action|start))?$/);if(!match)fail(404,'NOT_FOUND','没有找到这个接口');
    const[,id,operation]=match; const room=await store.get(id);if(!room)fail(404,'ROOM_NOT_FOUND','没有找到这个房间，请检查房间号');
    if(Date.now()-room.updatedAt>7*24*3600*1000)fail(410,'ROOM_EXPIRED','这个房间已过期，请新建房间');
    if(method==='POST'&&operation==='join'){
      const body=await bodyOf(request),name=playerName(body.name);if(room.game)fail(409,'STARTED','牌局已经开始，请使用原来的浏览器重连');
      if(room.seats.some(p=>p?.name===name))fail(409,'NAME_TAKEN','已有同名玩家，请换一个落座名字');
      let seat=body.seat;if(seat===undefined)seat=room.seats.findIndex(p=>!p);if(!Number.isInteger(seat)||seat<0||seat>2)fail(409,'ROOM_FULL','三个位置都坐满了');if(room.seats[seat])fail(409,'SEAT_TAKEN','这个座位已有人，请换一个位置');
      const token=randomToken(),next=structuredClone(room);next.seats[seat]={name,tokenHash:await hashToken(token),lastSeen:Date.now()};await commit(store,room,next);return json({roomId:id,token,state:publicRoom(next,seat)},201);
    }
    const seat=await authenticate(room,request);
    if(method==='GET'&&!operation){
      // Most polls only need a revision check: one read, no hand serialization,
      // and no heartbeat write more often than once per ten seconds per seat.
      const now=Date.now();
      if(now-room.seats[seat].lastSeen>=10000){await store.touch(id,seat,now);room.seats[seat].lastSeen=now;}
      const since=url.searchParams.get('since');
      if(since!==null&&/^\d+$/.test(since)&&Number(since)===room.revision){
        return json({unchanged:true,revision:room.revision,connections:room.seats.map(p=>Boolean(p&&now-p.lastSeen<30000))});
      }
      return json({state:publicRoom(room,seat)});
    }
    if(method==='POST'&&operation==='start'){
      const body=await bodyOf(request);revisionMatches(body,room);if(seat!==room.hostSeat)fail(403,'HOST_ONLY','只有房主可以开始');if(room.seats.some(p=>!p))fail(409,'NOT_FULL','三位玩家都落座后才能开始');if(room.game&&room.game.phase!=='finished')fail(409,'PLAYING','这一局还没结束');
      const next=structuredClone(room);next.game=createGame();next.seats[seat].lastSeen=Date.now();await commit(store,room,next);return json({state:publicRoom(next,seat)});
    }
    if(method==='POST'&&operation==='action'){
      const body=await bodyOf(request);revisionMatches(body,room);if(!room.game)fail(409,'NOT_STARTED','房主还没有开始这局');
      const a=body.action;if(!a||typeof a!=='object'||Array.isArray(a)||typeof a.type!=='string')fail(400,'BAD_ACTION','操作格式不正确');
      const action={type:a.type};if(a.tile!==undefined){if(!Number.isInteger(a.tile)||a.tile<0||a.tile>17)fail(400,'BAD_TILE','牌的编号不正确');action.tile=a.tile;}
      const engine=engineFor(room.game);
      const next=structuredClone(room);try{next.game=engine.apply(room.game,seat,action);}catch(error){fail(422,'ILLEGAL_ACTION',error.message||'当前不能这样操作');}next.seats[seat].lastSeen=Date.now();await commit(store,room,next);return json({state:publicRoom(next,seat)});
    }
    fail(405,'METHOD','不支持这种操作');
  }catch(error){if(error instanceof ApiError)return json({error:error.message,code:error.code},error.status);console.error('Request failed:',error?.name,error?.message);return json({error:'服务器暂时出了点问题，请稍后刷新',code:'SERVER_ERROR'},500);}};
  return async request=>{
    const started=performance.now();
    const response=await handle(request);
    if(response)response.headers.set('server-timing',`app;dur=${(performance.now()-started).toFixed(1)}`);
    return response;
  };
}
