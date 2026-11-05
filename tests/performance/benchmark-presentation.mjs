/** Compare Vue component patch CPU with an in-memory renderer. No browser/layout/network claim.
 * Usage: node tests/performance/benchmark-presentation.mjs [baseline-git-ref]
 * Only synthetic public table state and one private test hand are used.
 */
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import * as Vue from 'vue';
import {parse,compileScript,compileTemplate} from '@vue/compiler-sfc';
import * as Audio from '../../src/character-audio.js';
import * as PhotoFaces from '../../src/mahjong-photo-faces.js';
const baseline=process.argv[2] || '1de15e9a43ce373a4b408d3fd6b8cddd2aa9247c';
const storage={getItem:()=>null,setItem(){},removeItem(){}};
globalThis.window={location:{href:'https://synthetic.invalid/',search:''},sessionStorage:storage,localStorage:storage};
globalThis.document={hidden:false,activeElement:{blur(){}},body:{style:{}}};
function component(file,source,dependencies={}){
 const {descriptor}=parse(source);const script=compileScript(descriptor,{id:file});
 const template=compileTemplate({source:descriptor.template.content,filename:file,id:file,compilerOptions:{bindingMetadata:script.bindings}});
 if(template.errors.length)throw Error(String(template.errors));
 const modules={vue:{...Vue,onMounted(){},onUnmounted(){}},...dependencies};
 const imports=code=>code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,(_,bindings,module)=>`const {${bindings.replace(/\s+as\s+/g,':')}} = modules[${JSON.stringify(module)}];`).replace(/import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g,(_,binding,module)=>`const ${binding}=modules[${JSON.stringify(module)}];`);
 const c=new Function('modules',imports(script.content).replace('export default','return'))(modules);
 c.render=new Function('modules',`${imports(template.code).replace('export function render','function render')}\nreturn render;`)(modules);return c;
}
const tile=component('MahjongTile.vue',readFileSync(new URL('../../src/MahjongTile.vue',import.meta.url),'utf8'),{'./mahjong-photo-faces.js':PhotoFaces});
const icon=component('Icon.vue',readFileSync(new URL('../../src/Icon.vue',import.meta.url),'utf8'));
const deps={'./MahjongTile.vue':tile,'./Icon.vue':icon,'./character-audio.js':Audio};
const before=component('App.vue',execFileSync('git',['show',`${baseline}:src/App.vue`],{encoding:'utf8'}),deps);
const after=component('App.vue',readFileSync(new URL('../../src/App.vue',import.meta.url),'utf8'),deps);
const node=(type,text='')=>({type,text,props:{},children:[],parent:null,tagName:type.toUpperCase(),style:{},addEventListener(){},removeEventListener(){},setAttribute(){},removeAttribute(){},getAttribute(){return null;}});
function insert(child,parent,anchor=null){if(child.parent){const list=child.parent.children;list.splice(list.indexOf(child),1);}const index=anchor?parent.children.indexOf(anchor):-1;parent.children.splice(index<0?parent.children.length:index,0,child);child.parent=parent;}
const renderer=Vue.createRenderer({patchProp:(el,k,prev,next)=>{el.props[k]=next;},insert,remove(el){if(el.parent)el.parent.children.splice(el.parent.children.indexOf(el),1);},createElement:tag=>node(tag),createText:text=>node('text',text),createComment:text=>node('comment',text),setText:(el,text)=>{el.text=text;},setElementText:(el,text)=>{el.text=text;el.children=[];},parentNode:el=>el.parent,nextSibling:el=>el.parent?.children[el.parent.children.indexOf(el)+1]||null,insertStaticContent(html,parent,anchor){const el=node('static',html);insert(el,parent,anchor);return[el,el];}});
const snapshot=()=>({id:'ABCDEF23',revision:1,you:0,hostSeat:0,phase:'playing',seats:[0,1,2].map(seat=>({seat,name:`Synthetic ${seat}`,connected:true})),game:{id:'benchmark',schemaVersion:3,phase:'turn',turnStep:'discard',currentSeat:0,drawnTile:3,wallCount:42,characters:['sweet','elegant','sunny'],rules:{autoDiscardAfterHu:true},players:[0,1,2].map(seat=>({seat,handCount:13,hand:seat===0?[0,1,2,3,4,4,5,9,10,11,12,13,14,17]:undefined,huCount:0,score:0,melds:[],radishes:[],winPile:[]})),discards:Array.from({length:60},(_,index)=>({seat:index%3,tile:index%18})),history:Array.from({length:150},(_,index)=>({revision:Math.floor(index/3),type:index%2?'draw':'discard',seat:index%3,tile:index%18,message:`Synthetic event ${index}`})),sharedRadishes:[1,2,3,6,8,12],firstHuRadishesRevealed:true,legalActions:[{type:'discard',tile:0},{type:'discard',tile:4}],waitTiles:[]}});
async function measure(component){const app=renderer.createApp(component);app.mount(node('root'));const scope=app._instance.setupState;scope.session={roomId:'ABCDEF23',token:'b'.repeat(64)};let state=snapshot();scope.applyState(state);await Vue.nextTick();const selection=[],updates=[];for(let i=0;i<240;i++){const begin=performance.now();scope.selectHand(i%2?0:4,i%2?0:4);await Vue.nextTick();if(i>=40)selection.push(performance.now()-begin);}for(let i=0;i<120;i++){state=structuredClone(state);state.revision++;state.game.history.push({revision:state.revision+50,type:'pass',seat:i%3,message:`Synthetic update ${i}`});const begin=performance.now();scope.applyState(state);await Vue.nextTick();if(i>=40)updates.push(performance.now()-begin);}scope.resetRoomContext();app.unmount();return{selection,updates};}
const all={before:{selection:[],updates:[]},after:{selection:[],updates:[]}};
for(let round=0;round<6;round++)for(const [label,c]of(round%2?[['after',after],['before',before]]:[['before',before],['after',after]])){const result=await measure(c);for(const key of ['selection','updates'])all[label][key].push(...result[key]);}
function stats(values){values.sort((a,b)=>a-b);const q=n=>+values[Math.floor(values.length*n)].toFixed(3);return{samples:values.length,p50:q(.5),p95:q(.95),max:+values.at(-1).toFixed(3)};}
console.log(JSON.stringify({baseline,method:'Vue 3 client component patch, synthetic in-memory host, 60 discards / 150 initial history events, one appended event per snapshot; six alternating runs; per-run warmup 40; milliseconds; same current tile component in before/after; excludes browser paint, layout, image decode, networking and audio',before:{selectionMs:stats(all.before.selection),snapshotMs:stats(all.before.updates)},after:{selectionMs:stats(all.after.selection),snapshotMs:stats(all.after.updates)}},null,2));
