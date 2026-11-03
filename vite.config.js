import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { apiMiddleware } from './server/node.js';
export default defineConfig({
  plugins:[vue(),{name:'mahjong-server',configureServer(server){server.middlewares.use(apiMiddleware());}}],
  server:{host:'0.0.0.0',port:5182,strictPort:true,allowedHosts:['terminal.local']},
  preview:{host:'0.0.0.0',port:5182,strictPort:true},
});
