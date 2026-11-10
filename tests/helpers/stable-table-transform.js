// 只在独立Vite预览中改写真实App的脚本；模板、样式与生产文件字节不变。
// Rewrite only the real App script in isolated Vite preview; template, CSS, and production files stay untouched.
import { parse as parseSfc } from '@vue/compiler-sfc';
import { parse as parseJavaScript } from '@babel/parser';

// 用语法节点范围定位生命周期/API，避免正则吞掉相邻模板或嵌套函数。
// AST node ranges locate lifecycle/API code without regex consuming adjacent templates or nested functions.
export function transformStableTableApp(source) {
  const { descriptor } = parseSfc(source);
  const script = descriptor.scriptSetup;
  if (!script) throw new Error('App script setup is required');
  const ast = parseJavaScript(script.content, { sourceType: 'module' });
  const edits = [];
  let lifecycleCount = 0;
  let apiCount = 0;
  for (const node of ast.program.body) {
    if (node.type === 'ExpressionStatement' && node.expression.type === 'CallExpression' &&
      ['onMounted', 'onUnmounted'].includes(node.expression.callee.name)) {
      edits.push([node.start, node.end, '']);
      lifecycleCount += 1;
    }
    if (node.type === 'FunctionDeclaration' && node.id.name === 'api') {
      edits.push([node.body.start, node.body.end, '{ throw new Error("View-only fixture: API disabled"); }']);
      apiCount += 1;
    }
  }
  if (lifecycleCount !== 2 || apiCount !== 1) throw new Error('App lifecycle/API changed; inspect the isolation adapter before running');
  let content = script.content;
  for (const [start, end, replacement] of edits.sort((left, right) => right[0] - left[0])) {
    content = content.slice(0, start) + replacement + content.slice(end);
  }
  // 只保存本页视图，session只是无凭证的inRoom展示哨兵；绝不调用applyState/initialize/mutate。
  // Set page-local views only; session is a credential-free inRoom sentinel, never applyState/initialize/mutate.
  content += `\nwindow.__stableTableFixture = Object.freeze({
    // 隔离页面可由URL选择初始展示，不写偏好存储，也不调用游戏动作。
    // The isolated page selects its initial presentation without stored preferences or game actions.
    async setPresentation(value) { tablePresentation.value = ['landscape', 'realistic'].includes(value) ? value : 'classic'; await nextTick(); },
    async setSnapshot(input) {
      const snapshot = structuredClone(input);
      session.value = { roomId: 'VIEWONLY' };
      state.value = snapshot.state;
      busy.value = snapshot.ui.busy;
      syncing.value = snapshot.ui.syncing;
      offline.value = snapshot.ui.offline;
      selectedTile.value = null;
      selectedHandIndex.value = null;
      await nextTick();
    },
    async openSummary() { openNextRound(); await nextTick(); },
    async closeSummary() { closeModal(); await nextTick(); },
    async pollSummary() { state.value = { ...state.value, revision: state.value.revision + 1 }; await nextTick(); },
    getSummaryState() { return { open: showNextRound.value, phase: state.value?.phase, gameId: game.value?.id, busy: busy.value }; }
  });
  // 原挂载被隔离后仅注册真正的键盘处理器，卸载成对清理；不恢复任何联网生命周期。
  // Register only the real keyboard handler after isolating mounted hooks; remove it without restoring network lifecycles.
  window.addEventListener('keydown', onKey);
  onUnmounted(() => {
    window.removeEventListener('keydown', onKey);
    document.body.style.overflow = '';
    characterAudio.dispose();
    delete window.__stableTableFixture;
  });\n`;
  return source.slice(0, script.loc.start.offset) + content + source.slice(script.loc.end.offset);
}
