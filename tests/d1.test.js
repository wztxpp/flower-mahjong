import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {D1Store} from '../server/store.js';
import {createApi} from '../server/api.js';

function sqliteD1(){const sqlite=new DatabaseSync(':memory:');sqlite.exec('CREATE TABLE mahjong_rooms (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL, updated_at INTEGER NOT NULL)');return {close:()=>sqlite.close(),prepare(sql){return{bind(...values){return{async first(){return sqlite.prepare(sql).get(...values)||null;},async run(){const r=sqlite.prepare(sql).run(...values);return{meta:{changes:Number(r.changes)}};}};}};}};}

test('D1 SQL adapter enforces revision CAS and concurrent seat limit',async()=>{
 const db=sqliteD1(),store=new D1Store(db),api=createApi(store);
 const request=async(path,data,token)=>{const r=await api(new Request(`https://test.local${path}`,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(data?{body:JSON.stringify(data)}:{})}));return {status:r.status,body:await r.json()};};
 try{
  const created=await request('/api/rooms',{name:'东家'});assert.equal(created.status,201);const{id}=created.body.state;
  const first=await request(`/api/rooms/${id}/join`,{name:'南家'});assert.equal(first.status,201);
  const contenders=await Promise.all(['西家','后来者'].map(name=>request(`/api/rooms/${id}/join`,{name})));
  assert.equal(contenders.filter(r=>r.status===201).length,1);assert.equal(contenders.filter(r=>r.status===409).length,1);
  const room=await store.get(id);assert.equal(room.seats.filter(Boolean).length,3);assert.equal(room.revision,2);
  const old=structuredClone(room);old.revision=3;assert.equal(await store.compareAndSwap(old,1),false);
  const auth=await request(`/api/rooms/${id}`,undefined,created.body.token);assert.equal(auth.status,200);assert.ok((await store.get(id)).seats[0].lastSeen>=room.seats[0].lastSeen);
  const started=await request(`/api/rooms/${id}/start`,{revision:2},created.body.token);assert.equal(started.status,200);assert.equal(started.body.state.game.players.filter(p=>p.hand).length,1);
 }finally{db.close();}
});

test('D1 stores game state without plaintext seat credentials',async()=>{
 const db=sqliteD1(),store=new D1Store(db),api=createApi(store);
 try{const response=await api(new Request('https://test.local/api/rooms',{method:'POST',body:JSON.stringify({name:'测试'})}));const data=await response.json();const record=await store.get(data.roomId);assert.equal(JSON.stringify(record).includes(data.token),false);assert.match(record.seats[0].tokenHash,/^[a-f0-9]{64}$/);}finally{db.close();}
});
