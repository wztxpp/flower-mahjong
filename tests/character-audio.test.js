import test from 'node:test'
import assert from 'node:assert/strict'
import { CHARACTERS, ActionVoiceCursor, CharacterAudio, clipForEvent, clipsForEvent } from '../src/character-audio.js'
const state = (history, revision = history.length, id = 'game-1') => ({ id: 'room-1', revision, game: { id, history, characters: ['sunny','sweet','elegant'] } })
test('23 correct clips per character, only confirmed discard/peng/hu/kong', () => {
  for (let seat = 0; seat < 3; seat++) {
    const clips = new Set(Array.from({length:18}, (_,tile) => clipForEvent({type:'discard',tile,seat})))
    for (const type of ['peng','hu','anGang']) clips.add(clipForEvent({type,seat}))
    for (const source of ['selfDraw','discard','kongDiscard']) for (const clip of clipsForEvent({type:'hu',seat,source})) clips.add(clip)
    assert.equal(clips.size,23)
    assert.ok([...clips].every(url => url.startsWith(`/voices/${CHARACTERS[seat].id}/`)))
  }
  for (const type of ['draw','pass','start','finish','claim','dragonSettlement']) assert.equal(clipForEvent({type,seat:0}),null)
  assert.equal(clipForEvent({type:'discard',seat:0,tile:0}),'/voices/sweet/tiao-1.mp3')
  assert.equal(clipForEvent({type:'discard',seat:0,tile:17}),'/voices/sweet/tong-9.mp3')
  assert.equal(clipForEvent({type:'discard',seat:0,tile:null}),null)
  for (const type of ['mingGang','anGang','buGang','addGang']) assert.equal(clipForEvent({type,seat:2}),'/voices/sunny/gang.mp3')
})
test('wins announce their committed source in the winning character, for every seat and viewer', () => {
  const characters = ['sunny','sweet','elegant']
  for (let seat = 0; seat < 3; seat++) {
    for (const [source,prefix] of [['selfDraw','zimo'],['discard','fangpao'],['kongDiscard','fangpao']]) {
      const event = {type:'hu',seat,source,from:(seat+1)%3}
      const expected = [`/voices/${characters[seat]}/${prefix}.mp3`,`/voices/${characters[seat]}/hu.mp3`]
      assert.deepEqual(clipsForEvent(event,characters),expected)
      for (let viewer = 0; viewer < 3; viewer++) {
        const cursor = new ActionVoiceCursor()
        cursor.consume({...state([]),seat:viewer})
        assert.deepEqual(cursor.consume({...state([event]),seat:viewer}),expected)
        assert.deepEqual(cursor.consume({...state([event]),seat:viewer}),[])
      }
    }
    for (const source of [undefined,null,'unknown','selfdraw']) {
      assert.deepEqual(clipsForEvent({type:'hu',seat,source},characters),[`/voices/${characters[seat]}/hu.mp3`])
    }
    assert.deepEqual(clipsForEvent({type:'hu',seat,source:'selfDraw'},['invalid']),[`/voices/${CHARACTERS[seat].id}/zimo.mp3`,`/voices/${CHARACTERS[seat].id}/hu.mp3`])
  }
  for (const seat of [undefined,null,-1,3,1.5,'1']) assert.deepEqual(clipsForEvent({type:'hu',seat,source:'selfDraw'}),[])
  for (const type of ['draw','pass','claim','finish']) assert.deepEqual(clipsForEvent({type,seat:0,source:'selfDraw'}),[])
  assert.deepEqual(clipsForEvent({type:'peng',seat:0,source:'selfDraw'}),['/voices/sweet/peng.mp3'])
})
test('cursor never replays initial/reconnected/new-game history or duplicate updates', () => {
  const cursor = new ActionVoiceCursor(), a={type:'discard',seat:0,tile:1}, b={type:'peng',seat:1}
  assert.deepEqual(cursor.consume(state([a])),[])
  assert.deepEqual(cursor.consume(state([a,b])),['/voices/sweet/peng.mp3'])
  assert.deepEqual(cursor.consume(state([a,b])),[])
  assert.deepEqual(cursor.consume(state([a],1)),[])
  assert.deepEqual(cursor.consume(state([a,b,{type:'hu',seat:2,source:'selfDraw'}],3),{silent:true}),[])
  assert.deepEqual(cursor.consume(state([a,b,{type:'hu',seat:2,source:'selfDraw'}],3)),[])
  cursor.reset(); assert.deepEqual(cursor.consume(state([a,b,{type:'hu',seat:2,source:'discard'}])),[])
  assert.deepEqual(cursor.consume(state([a],4,'game-2')),[])
})
test('same-revision batch events all played once in order, including automatic discard', () => {
  const c=new ActionVoiceCursor(); c.consume(state([],1))
  const events=[{type:'hu',seat:1,source:'discard'},{type:'hu',seat:2,source:'kongDiscard'},{type:'draw',seat:0},{type:'discard',seat:0,tile:9,automatic:true}]
  assert.deepEqual(c.consume(state(events,2)),['/voices/sweet/fangpao.mp3','/voices/sweet/hu.mp3','/voices/elegant/fangpao.mp3','/voices/elegant/hu.mp3','/voices/sunny/tong-1.mp3'])
  assert.deepEqual(c.consume(state(events,2)),[])
})
function audioFixture(options = {}) {
  const played=[], sources=[]
  const context={state:'running',sampleRate:24000,resume:async()=>{},close(){},createBuffer:()=> 'silent',decodeAudioData:async bytes=>bytes,createBufferSource(){const source={connect(){},start(){played.push(this.buffer);if(this.buffer==='silent') queueMicrotask(()=>this.onended?.())},stop(){this.onended?.()}};sources.push(source);return source}}
  const engine=new CharacterAudio({createContext:()=>context,fetchAudio:async url=>({ok:true,headers:{get:()=> 'audio/mpeg'},arrayBuffer:async()=>url}),...options})
  return {engine,played,sources,context}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve))
test('audio requires unlock, plays serially, and mute clears pending clips', async()=>{
  const {engine,played,sources}=audioFixture()
  engine.enqueue(['ignored']); assert.deepEqual(played,[])
  await engine.unlock(); engine.enqueue(['one','two']); await tick()
  assert.deepEqual(played,['silent','one'])
  sources.at(-1).onended(); await tick(); assert.deepEqual(played,['silent','one','two'])
  engine.enqueue(['three']); engine.setMuted(true); await tick()
  assert.equal(played.includes('three'),false)
  engine.setMuted(false); await tick(); assert.equal(played.includes('three'),false)
})
test('fetch failure is reported and does not block later clips',async()=>{
  const {engine,played}=audioFixture(); const statuses=[]; engine.onStatus=s=>statuses.push(s)
  engine.fetchAudio=async url=>({ok:url!=='bad',headers:{get:()=> 'audio/mpeg'},arrayBuffer:async()=>url})
  await engine.unlock(); engine.enqueue(['bad','good']); await tick()
  assert.ok(statuses.includes('unavailable')); assert.ok(played.includes('good'))
  engine.dispose()
})

test('clearing a stalled download releases queue for the next room',async()=>{
  const {engine,played}=audioFixture()
  engine.fetchAudio=async url=>url==='stalled' ? new Promise(()=>{}) : ({ok:true,headers:{get:()=> 'audio/mpeg'},arrayBuffer:async()=>url})
  await engine.unlock(); engine.enqueue(['stalled']); await tick()
  engine.clear(); engine.enqueue(['new-room']); await tick()
  assert.ok(played.includes('new-room')); assert.equal(played.includes('stalled'),false)
  engine.dispose()
})
test('suspended context becomes locked and can resume on next gesture',async()=>{
  const {engine}=audioFixture(); const statuses=[]; engine.onStatus=s=>statuses.push(s)
  await engine.unlock(); engine.context.state='suspended'; engine.context.onstatechange()
  assert.equal(engine.unlocked,false); assert.equal(statuses.at(-1),'locked')
  engine.context.resume=async()=>{engine.context.state='running'}
  assert.equal(await engine.unlock(),true)
  engine.dispose()
})

test('simultaneous wins stay serial and adjacent, with duplicate updates ignored',async()=>{
  const {engine,played,sources}=audioFixture(), cursor=new ActionVoiceCursor()
  const events=[{type:'hu',seat:1,source:'discard'},{type:'hu',seat:2,source:'kongDiscard'}]
  cursor.consume(state([])); await engine.unlock()
  engine.enqueue(cursor.consume(state(events))); await tick()
  engine.enqueue(cursor.consume(state(events)))
  engine.enqueue(['/voices/sunny/tong-1.mp3'])
  const expected=['/voices/sweet/fangpao.mp3','/voices/sweet/hu.mp3','/voices/elegant/fangpao.mp3','/voices/elegant/hu.mp3','/voices/sunny/tong-1.mp3']
  for(let index=0;index<expected.length;index++) {
    assert.deepEqual(played,['silent',...expected.slice(0,index+1)])
    sources.at(-1).onended(); await tick()
  }
  assert.deepEqual(played,['silent',...expected]); engine.dispose()
})

test('queue limit drops an entire pending win instead of leaving an orphan hu',async()=>{
  const {engine,played,sources}=audioFixture()
  await engine.unlock(); engine.enqueue(['blocker']); await tick()
  const later=Array.from({length:11},(_,index)=>`later-${index}`)
  engine.enqueue([...clipsForEvent({type:'hu',seat:0,source:'selfDraw'}),...later])
  assert.deepEqual(engine.queue.flatMap(item=>item.urls),later)
  for(let index=0;index<=later.length;index++) { sources.at(-1).onended(); await tick() }
  assert.deepEqual(played,['silent','blocker',...later]); engine.dispose()
})

test('a started win completes after expiry and queue eviction without interleaving',async()=>{
  let now=0
  const {engine,played,sources}=audioFixture({now:()=>now})
  const win=clipsForEvent({type:'hu',seat:1,source:'discard'})
  await engine.unlock(); engine.enqueue(win); await tick()
  assert.deepEqual(played,['silent',win[0]])
  now=7000
  const later=Array.from({length:13},(_,index)=>`later-${index}`)
  engine.enqueue(later)
  assert.deepEqual(engine.queue.flatMap(item=>item.urls),later.slice(1))
  sources.at(-1).onended(); await tick()
  assert.deepEqual(played,['silent',...win])
  sources.at(-1).onended(); await tick()
  assert.deepEqual(played,['silent',...win,'later-1']); engine.dispose()
})

test('an unstarted expired win is skipped as a whole',async()=>{
  let now=0
  const {engine,played,sources}=audioFixture({now:()=>now})
  await engine.unlock(); engine.enqueue(['blocker']); await tick()
  engine.enqueue(clipsForEvent({type:'hu',seat:2,source:'kongDiscard'}))
  now=6001; engine.enqueue(['fresh'])
  sources.at(-1).onended(); await tick()
  assert.deepEqual(played,['silent','blocker','fresh']); engine.dispose()
})

test('both win clips load before speaking and expiry is checked before the pair starts',async()=>{
  let now=0, resolveHu
  const {engine,played}=audioFixture({now:()=>now})
  const win=clipsForEvent({type:'hu',seat:0,source:'selfDraw'})
  engine.fetchAudio=async url=>({ok:true,headers:{get:()=> 'audio/mpeg'},arrayBuffer:()=>url===win[1] ? new Promise(resolve=>{resolveHu=resolve}) : Promise.resolve(url)})
  await engine.unlock(); engine.enqueue(win); await tick()
  assert.deepEqual(played,['silent'])
  now=6001; resolveHu(win[1]); await tick()
  assert.deepEqual(played,['silent'])
  engine.enqueue(['fresh']); await tick()
  assert.deepEqual(played,['silent','fresh']); engine.dispose()
})

test('a win with an unavailable clip is skipped without splitting it or blocking later events',async()=>{
  for(const unavailable of ['zimo','hu']) {
    const {engine,played}=audioFixture()
    engine.fetchAudio=async url=>({ok:!url.endsWith(`/${unavailable}.mp3`),headers:{get:()=> 'audio/mpeg'},arrayBuffer:async()=>url})
    await engine.unlock(); engine.enqueue([...clipsForEvent({type:'hu',seat:0,source:'selfDraw'}),'good']); await tick()
    assert.deepEqual(played,['silent','good']); engine.dispose()
  }
})

for(const interruption of ['mute','clear','context loss']) {
  test(`${interruption} stops the remainder of a started win, without replaying on resume`,async()=>{
    const {engine,played,context}=audioFixture()
    const win=clipsForEvent({type:'hu',seat:0,source:'selfDraw'})
    await engine.unlock(); engine.enqueue([...win,'old-pending']); await tick()
    assert.deepEqual(played,['silent',win[0]])
    if(interruption==='mute') engine.setMuted(true)
    else if(interruption==='clear') engine.clear()
    else { context.state='suspended'; context.onstatechange() }
    await tick()
    if(interruption==='mute') engine.setMuted(false)
    else if(interruption==='context loss') { context.resume=async()=>{context.state='running'}; await engine.unlock() }
    engine.enqueue(['fresh']); await tick()
    assert.equal(played.includes(win[1]),false)
    assert.equal(played.includes('old-pending'),false)
    assert.equal(played.at(-1),'fresh'); engine.dispose()
  })
}

test('muted confirmed wins are consumed without replaying when sound is enabled again',async()=>{
  const {engine,played}=audioFixture(), cursor=new ActionVoiceCursor()
  const events=[{type:'hu',seat:0,source:'selfDraw'}]
  cursor.consume(state([])); await engine.unlock(); engine.setMuted(true)
  engine.enqueue(cursor.consume(state(events))); await tick()
  engine.setMuted(false); engine.enqueue(cursor.consume(state(events))); await tick()
  assert.deepEqual(played,['silent']); engine.dispose()
})
