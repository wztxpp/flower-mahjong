// 可重复清理边界：取消/换角色不应因一个资源释放失败而留下其他资源。
// Repeatable cleanup boundaries ensure one failing release cannot retain the remaining resources during cancellation or role changes.

// 尝试每一项清理并返回错误列表；调用方仍在 finally 清空自己的引用。
// Attempt every cleanup step and return errors; callers still clear their own references in finally.
export function runCleanup(steps) {
  const errors = [];
  for (const step of steps) {
    try {
      step();
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

// 控制器和组件只通过这一入口释放实例；即使 dispose 抛错也不阻止后续生命周期操作。
// Controllers/components release instances through this guard so a throwing dispose cannot block later lifecycle work.
export function safelyRelease(renderer) {
  if (!renderer) return [];
  return runCleanup([() => renderer.dispose()]);
}

// R5 编译失败可能留下数字 0，共享着色器集还可能复用同一 program；逐项容错并只删一次。
// R5 compilation failures can leave numeric zero, while shader sets share programs; tolerate each entry and delete each program once.
export function releaseShaderPrograms(shader, gl) {
  const errors = [];
  const programs = new Set();
  const sets = shader?._shaderSets;
  if (!sets) return errors;
  try {
    const size = Array.isArray(sets) ? sets.length : sets.getSize();
    for (let index = 0; index < size; index += 1) {
      try {
        const entry = Array.isArray(sets) ? sets[index] : sets.at(index);
        const program = entry && typeof entry === 'object' ? entry.shaderProgram : null;
        if (!program || programs.has(program)) continue;
        programs.add(program);
        gl.deleteProgram(program);
      } catch (error) {
        errors.push(error);
      }
    }
  } finally {
    // 清空私有上下文的程序引用；不能调用会清掉其他画框的全局 deleteInstance。
    // Clear this context's program references, never the global deleteInstance that would affect other portraits.
    errors.push(...runCleanup([() => {
      if (Array.isArray(sets)) sets.length = 0;
      else sets.clear();
    }]));
  }
  return errors;
}

// 官方 R5 管理器按 GL 缓存着色器；只删当前键，避免四个画框互相破坏程序。
// The official R5 manager caches shaders by GL; remove only this key so simultaneous portraits cannot destroy one another's programs.
export function releaseContextShaders(manager, gl) {
  if (!manager || !gl) return [];
  const errors = [];
  try {
    errors.push(...releaseShaderPrograms(manager.getShader(gl), gl));
  } catch (error) {
    errors.push(error);
  } finally {
    errors.push(...runCleanup([() => manager._shaderMap.delete(gl)]));
  }
  return errors;
}
