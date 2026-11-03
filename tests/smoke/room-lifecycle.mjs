/** Synthetic clients only; never opens an existing room. Tokens remain in memory. */
import assert from 'node:assert/strict';
const [base] = process.argv.slice(2);
if (!base) throw Error('Usage: node tests/smoke/room-lifecycle.mjs https://your-site');
let server;
if (base === 'local') {
 const { createServer } = await import('node:http'); const { apiMiddleware } = await import('../../server/node.js'); const { MemoryStore } = await import('../../server/store.js');
 server = createServer(apiMiddleware(new MemoryStore())); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); server.unref();
}
const origin = server ? `http://127.0.0.1:${server.address().port}` : new URL(base).origin;
let requests = 0; const times = [];
async function req(path, { body, token, expected = 200 } = {}) {
  const start = performance.now();
  const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : {'content-type':'application/json'}) },
    ...(body === undefined ? {} : {body:JSON.stringify(body)}), signal:AbortSignal.timeout(30000) });
  const data = await response.json(); requests++; times.push(performance.now()-start);
  assert.equal(response.status,expected,`${path}: ${response.status} ${data.code||''}`); return data;
}
const health=await req('/api/health');assert.equal(health.version,'0.3.0');
const profiles=[];for(let i=0;i<3;i++)profiles.push((await req('/api/profile',{body:{},expected:201})).playerToken);
const created=await req('/api/rooms',{body:{name:'生命周期验收甲',profileToken:profiles[0]},expected:201});
const path=`/api/rooms/${created.roomId}`;
const people=[{token:created.token,profile:profiles[0]}];
for(let i=1;i<3;i++){const p=await req(path+'/join',{body:{name:`生命周期验收${i}`,profileToken:profiles[i]},expected:201});people.push({token:p.token,profile:profiles[i]});}
const get=async i=>(await req(path,{token:people[i].token})).state;
const hist=async i=>req('/api/profile/history',{token:profiles[i]});
function privacy(s,i){assert.equal(s.you,i);assert.equal(s.game.players.filter(p=>Array.isArray(p.hand)).length,1);assert.equal(s.game.players.findIndex(p=>Array.isArray(p.hand)),i);assert.equal('wall' in s.game,false);assert.equal(JSON.stringify(s).includes(people[(i+1)%3].token),false);}
let s=(await req(path+'/start',{token:people[0].token,body:{revision:(await get(0)).revision}})).state;
for(let i=0;i<3;i++)privacy(await get(i),i);
await req(path+'/leave',{token:people[0].token,body:{profileToken:profiles[0]}});
let remaining=await get(1);assert.equal(remaining.hostSeat,1);assert.equal(remaining.seats[0].detached,true);assert.equal(remaining.game.wallCount,s.game.wallCount);
await req(path,{token:people[0].token,expected:409});
assert.equal((await hist(0)).records[0].status,'detached');
const resumed=await req(path+'/resume',{token:people[0].token,body:{profileToken:profiles[0]}});s=resumed.state;assert.equal(s.hostSeat,1);assert.equal(s.seats[0].detached,false);
await req(path,{token:'0'.repeat(64),expected:401});await req('/api/profile/history',{token:'0'.repeat(64),expected:401});
let actions=0,hu=0,kong=0;
while(s.game.phase!=='finished'&&actions<450){
 const order=[s.game.currentSeat,0,1,2].filter((v,i,a)=>Number.isInteger(v)&&a.indexOf(v)===i);let acted=false;
 for(const seat of order){const view=await get(seat);privacy(view,seat);if(view.game.phase==='finished'){s=view;break;}
  const legal=view.game.legalActions;const a=legal.find(x=>x.type==='hu')||legal.find(x=>['anGang','mingGang','buGang','addGang'].includes(x.type))||legal.find(x=>x.type==='pass')||legal.find(x=>x.type==='discard')||legal.find(x=>x.type==='draw');
  if(!a)continue; s=(await req(path+'/action',{token:people[seat].token,body:{revision:view.revision,action:a}})).state;actions++;if(a.type==='hu')hu++;if(a.type.endsWith('Gang'))kong++;acted=true;break;
 }
 if(!acted&&s.game.phase!=='finished')throw Error('No legal actor');
}
assert.equal(s.game.phase,'finished');
const histories=[];for(let i=0;i<3;i++){const h=await hist(i);assert.equal(h.summary.settledGames,1);assert.equal(h.records.length,1);assert.equal(h.records[0].score,s.game.players[i].score);assert.equal('hand' in h.records[0],false);histories.push(h);}
assert.equal(histories.reduce((n,h)=>n+h.summary.totalScore,0),0);
const currentHost=s.hostSeat;const final=await get(currentHost);
await req(path+'/start',{token:people[currentHost].token,body:{revision:final.revision}});
for(let i=0;i<3;i++){const h=await hist(i);assert.equal(h.records.length,2);assert.equal(h.summary.settledGames,1);assert.equal(h.summary.totalScore,histories[i].summary.totalScore);await req(path+'/leave',{token:people[i].token,body:{profileToken:profiles[i]}});}
const repeated=await req(path+'/leave',{token:people[0].token,body:{profileToken:profiles[0]}});assert.equal(repeated.left,true);
const h=await hist(0);assert.equal(h.records.filter(r=>r.status==='finished').length,1);assert.equal(h.records.filter(r=>r.status==='detached').length,1);
const empty=await req('/api/rooms',{body:{name:'独立新桌',profileToken:profiles[0]},expected:201});
await req(`/api/rooms/${empty.roomId}/leave`,{token:empty.token,body:{profileToken:profiles[0]}});
const sorted=times.sort((a,b)=>a-b);console.log(JSON.stringify({origin,version:health.version,requests,actions,hu,kong,checks:['three private clients','host handoff','active detach and explicit resume','forged credential rejection','full real game settlement','per-profile score zero sum','new round keeps one settled record','duplicate leave idempotent','new table does not erase previous history'],latencyMs:{p50:Math.round(sorted[Math.floor(sorted.length*.5)]),p95:Math.round(sorted[Math.floor(sorted.length*.95)])},measuredAt:new Date().toISOString()},null,2));

if (server) { server.closeAllConnections(); server.close(); }
