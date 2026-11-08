// 立绘生命周期协调器：只编排展示，不读取牌局、发请求动作或改变三秒表情计时。
// Portrait lifecycle coordinator: presentation only, with no game access, actions or reaction timer changes.
// createRenderer 接收错误回调与代次检查；Vue 在异步 SDK 返回后、构造 GL 之前再次校验 DOM。
// createRenderer receives an error callback and generation guard; Vue rechecks DOM identity before GL construction.
import { safelyRelease } from './cleanup.js';

export class PortraitController {
  constructor({ createRenderer, onStatus = () => {} }) {
    this.createRenderer = createRenderer;
    this.onStatus = onStatus;
    this.generation = 0;
    this.descriptor = null;
    this.renderer = null;
    this.pending = false;
    this.failed = false;
    this.disposed = false;
    this.state = {};
    this.status = 'original';
  }

  // 回调只在展示状态改变时发出，避免每次房间轮询反复更新组件。
  // Notify only on presentation changes, rather than on every room polling update.
  report(status) {
    if (this.status === status) return;
    this.status = status;
    this.onStatus(status);
  }

  // 调用者给出纯显示条件；角色换代立即释放旧所有权，普通胡/放炮仅暂停复用。
  // The caller supplies presentation conditions; role changes release ownership while reactions pause and reuse.
  sync(state) {
    if (this.disposed) return;
    const wasEnabled = this.state.enabled === true;
    this.state = state;
    // 关闭动态与换角同样撤销所有权：dispose 会中止 renderer 的模型/纹理请求，迟到 SDK 不得复活。
    // Disabling revokes ownership like a role change: dispose aborts model/texture work and late SDK readiness cannot revive it.
    if (this.descriptor !== state.descriptor || (wasEnabled && state.enabled !== true)) {
      this.generation += 1;
      const oldRenderer = this.renderer;
      this.renderer = null;
      this.pending = false;
      this.failed = false;
      this.descriptor = state.descriptor;
      safelyRelease(oldRenderer);
    }
    this.refresh();
  }

  shouldAnimate() {
    return !!this.descriptor && this.state.enabled === true && this.state.visible === true &&
      this.state.foreground === true && !this.state.reducedMotion && this.state.reaction === 'base';
  }

  // 首次出现在视口才加载；后台、减少动态、反应图都不能启动持续绘制。
  // Load only upon visibility; background pages, reduced motion and reaction art do not start continuous drawing.
  refresh() {
    if (this.failed) {
      this.report('fallback');
      return;
    }
    if (!this.shouldAnimate()) {
      try { this.renderer?.stop(); } catch { this.fail(); return; }
      this.report('original');
      return;
    }
    if (this.renderer?.loaded) {
      try {
        this.renderer.start();
        this.report('live2d');
      } catch { this.fail(); }
    } else if (!this.pending) {
      // load 内部处理所有错误；不能让装饰资源的拒绝变成未处理 Promise 或麻将失败。
      // load handles its errors so decorative failures cannot become unhandled promises or Mahjong failures.
      void this.load();
    }
  }

  async load() {
    if (this.disposed || this.pending || this.failed || !this.shouldAnimate()) return;
    const generation = this.generation;
    const descriptor = this.descriptor;
    const isCurrent = () => !this.disposed && this.generation === generation && this.descriptor === descriptor;
    this.pending = true;
    this.report('loading');
    let renderer;
    try {
      renderer = await this.createRenderer(() => { if (isCurrent()) this.fail(); }, isCurrent);
      if (!isCurrent()) { safelyRelease(renderer); return; }
      if (!renderer) throw new Error('No current portrait renderer');
      this.renderer = renderer;
      await renderer.load(descriptor);
      if (!isCurrent()) { safelyRelease(renderer); return; }
      if (!renderer.loaded) throw new Error('Portrait did not complete a visible first draw');
      this.pending = false;
      this.refresh();
    } catch {
      safelyRelease(renderer);
      if (isCurrent()) this.fail();
    } finally {
      if (isCurrent()) this.pending = false;
    }
  }

  // 清理可能自身报错，仍必须使在途操作失效并恢复原图；同一角色不无限重试损坏资源。
  // Cleanup may itself fail; still invalidate pending work and restore art without endlessly retrying a damaged role.
  fail() {
    if (this.disposed) return;
    this.generation += 1;
    this.failed = true;
    this.pending = false;
    const renderer = this.renderer;
    this.renderer = null;
    safelyRelease(renderer);
    this.report('fallback');
  }

  // 先撤销所有权再释放 SDK，迟到的加载无法复活已离桌的画布。
  // Revoke ownership before SDK cleanup so late loads cannot revive an unmounted table canvas.
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.pending = false;
    const renderer = this.renderer;
    this.renderer = null;
    safelyRelease(renderer);
  }
}
