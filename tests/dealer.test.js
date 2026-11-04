import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame, dealerForNextGame, getLegalActions, getPlayerView, applyAction, assertGameInvariants} from '../shared/game.js';
for (const dealerSeat of [0,1,2]) test(`dealer seat ${dealerSeat} owns the opening tile and first action`,()=>{
 const game=createGame({seed:'dealer',dealerSeat});
 assert.equal(game.dealerSeat,dealerSeat);assert.equal(game.currentSeat,dealerSeat);assert.equal(game.lastDraw.seat,dealerSeat);
 assert.deepEqual(game.players.map(p=>p.hand.length),[0,1,2].map(s=>s===dealerSeat?14:13));
 for(const seat of [0,1,2]) {assert.equal(getPlayerView(game,seat).dealerSeat,dealerSeat);assert.equal(getLegalActions(game,seat).length>0,seat===dealerSeat);}
 const action=getLegalActions(game,dealerSeat).find(a=>a.type==='discard');
 assertGameInvariants(applyAction(game,dealerSeat,action));
 assert.match(game.history[0].message,new RegExp(`${dealerSeat+1}号位坐庄`));
});
test('next dealer uses first committed hu, not latest win or response time',()=>{
 for(const seat of [0,1,2]) { const previous={dealerSeat:(seat+1)%3,history:[{type:'draw',seat:2},{type:'hu',seat,revision:5},{type:'hu',seat:(seat+2)%3,revision:5},{type:'hu',seat:(seat+1)%3,revision:9}]};const copy=structuredClone(previous);assert.equal(dealerForNextGame(previous),seat);assert.deepEqual(previous,copy);}
});
test('no-hu draw retains original seat-zero behavior and old hu history still works',()=>{
 for(const dealerSeat of [0,1,2]) assert.equal(dealerForNextGame({dealerSeat,history:[{type:'finish',reason:'wallExhausted'}]}),0);
 for(const value of [null,undefined,{}, {dealerSeat:3},{dealerSeat:'1'},{history:{}}])assert.equal(dealerForNextGame(value),0);
 for(const schemaVersion of [undefined,1,2,3]) assert.equal(dealerForNextGame({schemaVersion,history:[{type:'hu',seat:2}]}),2);
});
test('invalid new dealer state is rejected without mutating legacy games',()=>{
 for(const dealerSeat of [-1,3,null,'1',1.5])assert.throws(()=>createGame({dealerSeat}),/庄家/);
 const old=createGame({seed:'old'});delete old.dealerSeat;assertGameInvariants(old);assert.equal(getPlayerView(old,2).dealerSeat,0);assert.equal(Object.hasOwn(old,'dealerSeat'),false);
});
