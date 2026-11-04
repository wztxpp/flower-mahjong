import { build as viteBuild } from 'vite';
import { build as esbuild } from 'esbuild';
import { mkdir, writeFile, rm } from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});
await viteBuild();await mkdir('dist/server',{recursive:true});
await esbuild({entryPoints:['server/worker.js'],outfile:'dist/server/index.js',bundle:true,platform:'browser',format:'esm',target:'es2022'});
await writeFile('dist/server/wrangler.json',JSON.stringify({name:'flower-mahjong',main:'index.js',compatibility_date:'2026-05-15',assets:{directory:'../client',binding:'ASSETS',not_found_handling:'single-page-application'},d1_databases:[{binding:'DB',database_name:'site-creator-d1',database_id:'00000000-0000-4000-8000-000000000000'}]}));
