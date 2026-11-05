import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, getPlayerView, getLegalActions, assertGameInvariants } from '../shared/game.js';
const waiting = [1,2,3,4,5,6,10,11,12,13,14,15,17];
const meld = (tile, type = 'peng', count = type === 'peng' ? 3 : 4) => ({ type, tile, tiles: Array(count).fill(tile) });
function fixture({ seat = 0, hand = [16,17], melds = [meld(0),meld(3),meld(6),meld(9)], head = [8,8], rules = {}, waitingTurn = false } = {}) {
  const game = createGame({ seed: 'ready-fee', rules: { allowPungUpgrade: true, ...rules } });
  game.players.forEach((player, i) => { player.hand = [...(i === seat ? hand : waiting)]; player.melds = i === seat ? structuredClone(melds) : []; player.kongCount = player.melds.filter(m => m.type !== 'peng').length; });
  game.currentSeat = seat; game.lastDraw = { seat, tile: hand.at(-1), source: 'normal' };
  if (waitingTurn) { game.turnStep = 'draw'; game.lastDraw = null; }
  game.history = []; game.discards = []; game.retiredTiles = [];
  const counts = Array(18).fill(8);
  for (const player of game.players) for (const tile of [...player.hand,...player.melds.flatMap(m => m.tiles)]) assert.ok(--counts[tile] >= 0);
  for (const tile of head) assert.ok(--counts[tile] >= 0);
  game.wall = [...head, ...counts.flatMap((n,tile) => Array(n).fill(tile))];
  assertGameInvariants(game); return game;
}
const act = (g,s,type,tile) => applyAction(g,s,tile === undefined ? {type} : {type,tile});
const fees = g => g.history.filter(e => e.type === 'bigSingleReady');
function passAll(g) { while (g.phase === 'claim') g = act(g,g.claim.eligibleSeats.find(s => !g.claim.responses[s]),'pass'); return g; }

test('ready payment is explicit for new games and validates configuration', () => {
  assert.equal(createGame({seed:1}).rules.bigSingleReadyPayment,true);
  assert.throws(() => createGame({rules:{bigSingleReadyPayment:1}}));
});
for (const seat of [0,1,2]) test(`seat ${seat} collects two independent 50 payments only on stable ready discard`, () => {
  const original = fixture({seat});
  const untouched = structuredClone(original); getPlayerView(original,seat);
  assert.deepEqual(original,untouched); assert.equal(fees(original).length,0);
  const game = act(original,seat,'discard',17);
  assert.equal(fees(game).length,1); assert.equal(game.players[seat].bigSingleReadyPaid,true);
  assert.deepEqual(game.players.map(p => p.score), [0,1,2].map(s => s === seat ? 100 : -50));
  assert.deepEqual(fees(game)[0].payments,[...[0,1,2].filter(s => s !== seat).map(s => ({seat:s,delta:-50})),{seat,delta:100}]);
  const restored = JSON.parse(JSON.stringify(game)); getPlayerView(restored,seat); getLegalActions(restored,seat);
  assert.deepEqual(restored,game); assert.deepEqual(original,untouched);
  assert.throws(() => act(game,seat,'discard',17)); assertGameInvariants(game);
});

test('fourth peng does not charge until the required discard', () => {
  let game = fixture({seat:1,waitingTurn:true,hand:[9,9,16,17],melds:[meld(0),meld(3),meld(6)]});
  // Move one wall nine into the other player as their just-drawn discard.
  game.wall.splice(game.wall.indexOf(9),1); game.players[0].hand.push(9);
  game.currentSeat=0; game.turnStep='discard'; game.lastDraw={seat:0,tile:9,source:'normal'};
  game=act(game,0,'discard',9); game=act(game,1,'peng',9); game=passAll(game);
  assert.equal(game.players[1].melds.length,4); assert.equal(game.players[1].hand.length,2); assert.equal(fees(game).length,0);
  game=act(game,1,'discard',17); assert.equal(fees(game).length,1); assert.equal(fees(game)[0].seat,1);
});

test('fourth concealed kong pays ready fee before replacement and preserves kong provenance', () => {
  let game=fixture({hand:[9,9,9,9,16],melds:[meld(0),meld(3),meld(6)],head:[16]});
  game=act(game,0,'anGang',9);
  assert.equal(fees(game).length,1); assert.equal(game.lastDraw.source,'replacement');
  assert.deepEqual(game.lastDraw.kongSource,{type:'anGang',fromSeat:null});
  assert.deepEqual(game.history.map(e=>e.type),['bigSingleReady','anGang','draw']);
  assert.deepEqual(game.players.map(p=>p.score),[104,-52,-52]);
  const after=act(game,0,'hu'); assert.equal(fees(after).length,1);
  assert.ok(after.history.find(e=>e.type==='hu').points < 50); assertGameInvariants(after);
});

test('fourth exposed kong preserves source payer and ready payment is separate', () => {
  let game=fixture({seat:1,waitingTurn:true,hand:[9,9,9,16],melds:[meld(0),meld(3),meld(6)],head:[16]});
  game.wall.splice(game.wall.indexOf(9),1); game.players[0].hand.push(9); game.currentSeat=0; game.turnStep='discard'; game.lastDraw={seat:0,tile:9,source:'normal'};
  game=act(game,0,'discard',9); game=act(game,1,'mingGang',9); game=passAll(game);
  assert.equal(fees(game).length,1); assert.deepEqual(game.lastDraw.kongSource,{type:'mingGang',fromSeat:0});
  assert.deepEqual(game.players.map(p=>p.score),[-52,102,-50]);
  game=act(game,1,'hu'); assert.equal(fees(game).length,1);
  assert.deepEqual(game.history.find(e=>e.type==='hu').payments.map(p=>p.seat),[0,1]);
});

test('serialized paid marker prevents charge on a later stable-ready discard', () => {
  let game=fixture(); game.players[0].bigSingleReadyPaid=true;
  game=act(JSON.parse(JSON.stringify(game)),0,'discard',17);
  assert.equal(fees(game).length,0); assert.deepEqual(game.players.map(p=>p.score),[0,0,0]);
});

test('legacy missing flag or explicitly disabled rule never backfills a ready payment', () => {
  for (const missing of [true,false]) {
    let game=fixture({rules:{bigSingleReadyPayment:false}});
    if(missing) {delete game.rules.bigSingleReadyPayment; delete game.players[0].bigSingleReadyPaid;}
    game=act(game,0,'discard',17); assert.equal(fees(game).length,0); assert.deepEqual(game.players.map(p=>p.score),[0,0,0]);
  }
});

test('four groups with an exhausted ninth-copy wait do not qualify as ready', () => {
  let game=fixture({hand:[0,17],melds:[meld(0,'anGang',7),meld(3),meld(6),meld(9)]});
  game=act(game,0,'discard',17); assert.equal(fees(game).length,0); assertGameInvariants(game);
});

test('a pending or robbed upgrade never creates a speculative ready payment', () => {
  let game=fixture({hand:[9,16]});
  game.players[1].hand.splice(game.players[1].hand.indexOf(17),1,9);
  game.wall.splice(game.wall.indexOf(9),1,17);
  game=act(game,0,'buGang',9);
  assert.equal(game.claim.kind,'robKong'); assert.equal(fees(game).length,0);
  const before=JSON.stringify(game); getPlayerView(game,0); assert.equal(JSON.stringify(game),before);
  game=act(game,1,'hu');
  if(game.phase==='claim') game=passAll(game);
  assert.equal(fees(game).length,0); assert.equal(game.players[0].melds[3].tiles.length,3);
});

test('explicit legacy scoring does not combine the old 50 hu with a new ready payment', () => {
  let game=fixture({rules:{specialHuPatterns:false}});
  game=act(game,0,'discard',17); assert.equal(fees(game).length,0);
});
