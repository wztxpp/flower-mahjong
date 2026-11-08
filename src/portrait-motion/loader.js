// 懒加载纯Canvas2D模块，不注入script、不下载SDK；组件负责本地开关和异步代次。
// Lazily load only Canvas2D code, without script injection or SDK downloads; the component owns settings and generation guards.
export function loadPortraitMotionRuntime() {
  return import('./renderer.js');
}
