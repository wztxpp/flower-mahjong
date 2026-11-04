import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { sites } from './scripts/vite/sites-vite-plugin';
import { apiMiddleware } from './server/node.js';
export default defineConfig({plugins:[vue(),sites({mockAuth:false}),{name:'mahjong-api',configureServer(s){s.middlewares.use(apiMiddleware());}}],server:{host:'0.0.0.0',port:5182,strictPort:true,allowedHosts:['terminal.local']},build:{outDir:'dist/client'}});
