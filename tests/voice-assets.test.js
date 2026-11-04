import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { CHARACTERS, clipsForEvent } from '../src/character-audio.js'
const root = new URL('../public/', import.meta.url)
test('release includes 69 active distinct generated calls plus three retained legacy hu assets',()=>{
  const hashes=new Set()
  for(let seat=0;seat<3;seat++) {
    const events=[...Array.from({length:18},(_,tile)=>({type:'discard',tile,seat})),...['peng','anGang'].map(type=>({type,seat})),...['selfDraw','discard','kongDiscard','robKong'].map(source=>({type:'hu',seat,source}))]
    const paths=new Set(events.flatMap(event=>clipsForEvent(event)))
    assert.equal(paths.size,23)
    assert.equal(readdirSync(new URL(`voices/${CHARACTERS[seat].id}/`,root)).filter(file=>file.endsWith('.mp3')).length,24)
    for(const path of paths) {
      const bytes=readFileSync(new URL(path.slice(1),root))
      assert.ok(bytes.length>1024,`${path} is too short to be a generated clip`)
      assert.ok(bytes.subarray(0,3).toString()==='ID3'||(bytes[0]===255&&(bytes[1]&224)===224),`${path} is not MP3`)
      hashes.add(createHash('sha256').update(bytes).digest('hex'))
    }
  }
  assert.equal(hashes.size,69,'Every character call must be its own generated file')
})
test('three distinct PNG portraits ship with the voice characters',()=>{
  const hashes=new Set()
  for(const character of CHARACTERS){
    const bytes=readFileSync(new URL(character.portrait.slice(1),root))
    assert.equal(bytes.subarray(1,4).toString(),'PNG')
    hashes.add(createHash('sha256').update(bytes).digest('hex'))
  }
  assert.equal(hashes.size,3)
})

test('manifest active calls match runtime paths and retain unused hu provenance separately',()=>{
  const manifest=JSON.parse(readFileSync(new URL('voices/manifest.json',root),'utf8'))
  assert.equal(manifest.clipCount,69)
  assert.equal(manifest.expectedClipCount,69)
  assert.equal(manifest.storedClipCount,72)
  assert.equal(manifest.legacyClipCount,3)
  for(const character of CHARACTERS) {
    const voice=manifest.voices[character.id]
    assert.equal(Object.keys(voice.clips).length,23)
    assert.equal(voice.clips.hu,undefined)
    assert.equal(voice.clips.qianggang.text,'抢杠')
    assert.equal(voice.legacyClips.hu.src,`/voices/${character.id}/hu.mp3`)
    for(const clip of [...Object.values(voice.clips),...Object.values(voice.legacyClips)]) {
      const bytes=readFileSync(new URL(clip.src.slice(1),root))
      assert.equal(createHash('sha256').update(bytes).digest('hex'),clip.sha256)
    }
  }
})
