// 隔离测试观察器：仅记录真实 source.start 和 ended，不替换回调或播放器状态。
// Isolated observer: record genuine source.start and ended, without replacing callbacks or player state.
(() => {
  const records = [];
  let sequence = 0;
  function record(kind, source, id) {
    records.push({ at: new Date().toISOString(), kind, id, duration: source.buffer?.duration });
    const output = document.getElementById('test-playback-observation');
    if (output) output.textContent = JSON.stringify(records.slice(-30));
  }
  document.addEventListener('DOMContentLoaded', () => {
    const output = document.createElement('pre');
    output.id = 'test-playback-observation';
    output.setAttribute('aria-label', '真实音源观察');
    output.style.cssText = 'font:11px monospace;white-space:pre-wrap;position:relative;z-index:9999;background:white;color:black';
    document.body.append(output);
  });
  const prototype = window.AudioBufferSourceNode?.prototype;
  if (!prototype) return;
  const originalStart = prototype.start;
  prototype.start = function (...args) {
    // 先执行原生方法；失败时不记录假成功，原异常仍向调用方传播。
    // Call native first; a failure creates no false success and propagates unchanged.
    const result = originalStart.apply(this, args);
    const id = ++sequence;
    record('start', this, id);
    this.addEventListener('ended', () => record('ended', this, id), { once: true });
    return result;
  };
})();
