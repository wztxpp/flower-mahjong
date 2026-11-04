import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, getPlayerView, getLegalActions, assertGameInvariants } from '../shared/game.js';
const own = [0,1,2,3,9,10,11,12,13,14,17];
const wait = [1,2,3,4,5,9,10,11,12,13,14,17,17];
const move=(g,s,type,tile)=>applyAction(g,s,tile===undefined?{type}:{type,tile});
const passAll=g=>{while(g.phase==='claim')g=move(g,g.claim.eligibleSeats.find(s=>!g.claim.responses[s]),'pass');return g;};
function fixture({head=[0,0,0,0,17,6],first=false,oldRadishes=[],pending=0,wallLimit=null}={}){
  const g=createGame({seed:'deferred-radishes'});
  g.players.forEach((p,s)=>{p.hand=[...(s===0?own:wait)];p.melds=s===0?[{type:'peng',tile:0,tiles:[0,0,0]}]:[];});
  g.players[0].radishes=[...oldRadishes];g.players[0].kongCount=oldRadishes.length+pending;
  g.pendingKongRadishes=pending;g.firstHuRadishesRevealed=first;
  g.lastDraw={seat:0,tile:0,source:'normal'};g.history=[];
  const counts=Array(18).fill(8);
  for(const t of [...head,...g.players.flatMap(p=>[...p.hand,...p.melds.flatMap(m=>m.tiles),...p.radishes])])assert.ok(--counts[t]>=0);
  g.wall=[...head,...counts.flatMap((n,t)=>Array(n).fill(t))];
  if(wallLimit!==null){const retired=g.wall.splice(wallLimit);g.retiredTiles.push(...retired.map(tile=>({seat:0,tile})));}
  assertGameInvariants(g);return g;
}
test('five successful kongs defer five tail tiles until first hu then reveal eleven exactly once',()=>{
  let g=fixture();const original=g.wall.slice();const tail=original.slice(-11).reverse();
  for(let n=1;n<=5;n++){
    g=passAll(move(g,0,n===1?'buGang':'addGang',0));
    assert.equal(g.pendingKongRadishes,n);
    assert.equal(g.wall.length,original.length-n);
    assert.deepEqual(g.wall.slice(-11),original.slice(-11));
    assert.deepEqual(g.players.flatMap(p=>p.radishes),[]);
    assert.equal(g.history.filter(e=>e.radishDeferred).length,n);
    assert.ok(g.history.filter(e=>e.type.endsWith('Gang')).every(e=>e.radish===undefined));
    for(let seat=0;seat<3;seat++){const view=getPlayerView(g,seat);assert.equal(view.pendingKongRadishes,n);assert.deepEqual(view.sharedRadishes,[]);}
    g=JSON.parse(JSON.stringify(g));assertGameInvariants(g);
  }
  assert.equal(g.lastDraw.tile,17);
  g=move(g,0,'hu');
  const event=g.history.find(e=>e.type==='hu');
  assert.deepEqual(event.newRadishes,tail);
  assert.equal(g.pendingKongRadishes,0);assert.equal(g.firstHuRadishesRevealed,true);
  assert.deepEqual(g.players.flatMap(p=>p.radishes),tail);
  assertGameInvariants(g);
});
test('robbed first upgrade counts no kong radish; simultaneous first hu flips six only once',()=>{
  let g=fixture({head:[6]});const wall=g.wall.slice();
  g=move(g,0,'buGang',0);g=move(g,2,'hu');
  assert.equal(g.pendingKongRadishes,0);assert.deepEqual(g.wall,wall);
  g=move(g,1,'hu');
  const events=g.history.filter(e=>e.type==='hu');
  assert.equal(events.length,2);assert.deepEqual(events.map(e=>e.newRadishes.length),[6,0]);
  assert.equal(g.pendingKongRadishes,0);assert.equal(g.players[0].kongCount,0);
  assert.deepEqual(g.players[0].melds[0].tiles,[0,0,0]);assertGameInvariants(g);
});
test('post-first-hu kong still flips one immediately and preserves wall head replacement order',()=>{
  let g=fixture({head:[6],first:true});
  const tail=g.wall.at(-1),length=g.wall.length;
  g=passAll(move(g,0,'buGang',0));
  assert.deepEqual(g.players[0].radishes,[tail]);assert.equal(g.lastDraw.tile,6);
  assert.equal(g.wall.length,length-2);assert.equal(g.pendingKongRadishes,0);
});
test('legacy schema-3 already exposed kong radishes remain exposed and are never flipped again',()=>{
  let g=fixture({head:[17,6],oldRadishes:[8,8]});delete g.pendingKongRadishes;
  const old=[...g.players[0].radishes];
  g=passAll(move(g,0,'buGang',0));
  assert.deepEqual(g.players[0].radishes,old);assert.equal(g.pendingKongRadishes,1);
  g=move(g,0,'hu');
  assert.equal(g.history.find(e=>e.type==='hu').newRadishes.length,7);
  assert.deepEqual(g.players[0].radishes.slice(0,2),old);
  assert.equal(g.players.flatMap(p=>p.radishes).length,9);assertGameInvariants(g);
});
test('short wall first win reveals only available tiles and clears accrued count',()=>{
  let g=fixture({head:[17,6],pending:5,wallLimit:4});
  g=passAll(move(g,0,'buGang',0));
  assert.equal(g.pendingKongRadishes,6);assert.equal(g.wall.length,3);
  g=move(g,0,'hu');
  assert.equal(g.history.find(e=>e.type==='hu').newRadishes.length,3);
  assert.equal(g.pendingKongRadishes,0);assert.equal(g.phase,'finished');
  assertGameInvariants(g);
});
test('pending radish count rejects negative, noninteger, impossible and post-reveal values',()=>{
  for(const pending of [-1,0.5,99]){
    const g=fixture();g.pendingKongRadishes=pending;assert.throws(()=>assertGameInvariants(g),/待翻萝卜/);
  }
  const g=fixture({pending:1});g.firstHuRadishesRevealed=true;assert.throws(()=>assertGameInvariants(g),/待翻萝卜/);
});

test('wall exhaustion without any hu never reveals accrued radishes',()=>{
  let g=fixture({head:[6,7],wallLimit:2});
  g=passAll(move(g,0,'buGang',0));
  assert.equal(g.pendingKongRadishes,1);
  while(g.phase!=='finished'){
    if(g.phase==='claim')g=passAll(g);
    else {const a=getLegalActions(g,g.currentSeat).find(a=>a.type==='discard');assert.ok(a);g=applyAction(g,g.currentSeat,a);}
  }
  assert.equal(g.firstHuRadishesRevealed,false);assert.equal(g.pendingKongRadishes,1);
  assert.deepEqual(g.players.flatMap(p=>p.radishes),[]);
  assert.equal(g.history.filter(e=>e.type==='hu').length,0);assertGameInvariants(g);
});
