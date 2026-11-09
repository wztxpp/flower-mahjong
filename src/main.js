// 浏览器入口：创建一个 Vue 根实例；具体牌局状态由 App 从服务端读取。
// Browser entry: create one Vue root; App retrieves game state from the server.
import { createApp } from 'vue';
import App from './App.vue';
// 先加载基础样式，再加载实体牌桌皮肤；同等优先级时后面的声明获胜，顺序不可交换。
// Load base styles before the physical-table skin; later declarations win at equal specificity, so preserve this order.
import './style.css';
import './tabletop.css';
// 仅 .is-realistic-table 内覆盖，经典桌不受影响。 / Scope new skin overrides to the optional realistic view.
import './realistic-table.css';

// 挂载点来自 index.html 的 #app；mount 之后 Vue 才开始管理这块 DOM。
// index.html provides #app; Vue manages that DOM subtree after mount.
createApp(App).mount('#app');
