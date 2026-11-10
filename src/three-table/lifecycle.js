// 生命周期门：卸载可重复调用；晚到素材回调和旧FIFO帧都不能复活场景。
// Lifecycle gate: disposal is idempotent; late assets and stale FIFO frames cannot revive the scene.
export function createSceneLifetime() {
  let disposed = false;
  const cleanups = [];
  return {
    get disposed() { return disposed; },
    add(cleanup) { if (disposed) cleanup(); else cleanups.push(cleanup); },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const cleanup of cleanups.reverse()) cleanup();
      cleanups.length = 0;
    },
  };
}

// 挂载帧只作基线；房间/单局/递增序号必须都吻合。reset清空效果而非重播。
// Mount frames are baseline only; room/game/increasing sequence must match. Reset clears rather than replays.
export function createFrameGate(sequence = 0) {
  let lastSequence = sequence;
  return (frame, model) => {
    if (!frame || !Number.isSafeInteger(frame.sequence) || frame.sequence <= lastSequence) return null;
    lastSequence = frame.sequence;
    if (frame.reset) return [];
    if (frame.roomId !== model.roomId || frame.gameId !== model.gameId) return null;
    return (frame.events || []).filter((event) => typeof event.eventKey === 'string');
  };
}
