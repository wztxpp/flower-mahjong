// 可见诊断控件只调用同源iframe中的纯视图API；不控制浏览器或执行真实游戏动作。
// Visible diagnostics call the same-origin frame's view API only, never browser automation or real game actions.
import { writeStableTableReport, clearStableTableReport } from '../helpers/stable-table-report.js';
import { STABLE_TABLE_CASES, STABLE_TABLE_COMPAT_CASES, STABLE_TABLE_STAGES, STABLE_TABLE_MANUAL_STAGES, STABLE_TABLE_CHARACTERS } from '../helpers/stable-table-fixtures.js';
const frame = document.querySelector('#fixture-frame');
const caseInput = document.querySelector('#fixture-case');
const seatInput = document.querySelector('#fixture-seat');
const widthInput = document.querySelector('#fixture-width');
const heightInput = document.querySelector('#fixture-height');
const characterInput = document.querySelector('#fixture-character');
const characterLabels = ['小桃 · 粉', '清岚 · 紫', '晴禾 · 金黄', '地主 · 棕金', '老实人 · 青灰', '富婆 · 绿金', '女明星 · 蓝'];
STABLE_TABLE_CHARACTERS.forEach((id, index) => {
  const option = document.createElement('option'); option.value = id; option.textContent = characterLabels[index]; characterInput.append(option);
});
const stageInput = document.querySelector('#fixture-stage');
const status = document.querySelector('#fixture-status');
const output = document.querySelector('#fixture-json');
const rawOutput = document.querySelector('#fixture-raw-json');
for (const [id, label] of [['flower-legacy-1', '旧schema1花麻将'], ['flower-legacy-2', '旧schema2花麻将'], ['flower-spectator', '花麻将观战'], ['chengdu-spectator', '成都观战']]) {
  const option = document.createElement('option'); option.value = id; option.textContent = label; caseInput.append(option);
}
for (const [id, label] of [...STABLE_TABLE_STAGES, ...STABLE_TABLE_MANUAL_STAGES]) {
  const option = document.createElement('option'); option.value = id; option.textContent = label; stageInput.append(option);
}
// 可见结果只保留有界摘要；完整测量留在独立非渲染JSON节点供审计读取。
// Show a bounded summary; retain complete measurements in the separate non-rendered JSON node for audit reads.
function report(result) { writeStableTableReport(result, output, rawOutput); }
async function ready() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (frame.contentWindow.stableTablePreview) return frame.contentWindow.stableTablePreview;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('真实组件未就绪，请检查预览终端编译错误');
}
async function configure() {
  frame.width = widthInput.value;
  frame.height = heightInput.value;
  frame.style.height = `${heightInput.value}px`;
  const api = await ready();
  await api.set(caseInput.value, stageInput.value, characterInput.value, Number(seatInput.value));
  return api;
}
// 每次操作保留可见状态/错误；审计期间禁用并发诊断输入，不能用重叠运行制造假基线。
// Keep visible status/errors and disable concurrent controls during an audit, preventing overlapping fake baselines.
async function run(label, operation) {
  const controls = [...document.querySelectorAll('button, select')];
  controls.forEach((control) => { control.disabled = true; });
  clearStableTableReport(output, rawOutput);
  status.textContent = label;
  try { const result = await operation(); report(result); status.textContent = result.passed === undefined ? '已完成诊断操作' : result.passed ? '通过：请继续目视与键盘复核' : '发现差异：详见下方 JSON'; }
  catch (error) { report({ passed: false, error: error.message, stack: error.stack }); status.textContent = '诊断失败，未宣称通过'; }
  finally { controls.forEach((control) => { control.disabled = false; }); }
}
document.querySelector('#fixture-apply').onclick = () => run('切换纯视图…', async () => { const api = await configure(); return api.measure(); });
for (const action of ['load', 'finish', 'open', 'close', 'poll', 'new-game']) {
  document.querySelector(`#fixture-summary-${action}`).onclick = () => run('切换本地终局总览…', async () => {
    const api = await ready();
    return api.summary(action, document.querySelector('#fixture-summary-variant').value);
  });
}
document.querySelector('#fixture-focus-actions').onclick = () => run('检查真实动作撤下后的焦点…', async () => (await ready()).actionFocus());
document.querySelector('#fixture-select-hand').onclick = () => run('本地选牌并量测浮层间距…', async () => (await ready()).selectHand());
document.querySelector('#fixture-summary-measure').onclick = () => run('量测终局弹层…', async () => (await ready()).summaryMeasure());
document.querySelector('#fixture-measure').onclick = () => run('量测当前DOM…', async () => (await ready()).measure());
document.querySelector('#fixture-audit').onclick = () => run('正在审计当前玩法/尺寸…', async () => (await ready()).audit());
document.querySelector('#fixture-accessibility').onclick = () => run('量测内部滚动可达性…', async () => (await ready()).reachability());
for (const position of ['middle', 'bottom']) document.querySelector(`#fixture-${position}`).onclick = () => run('只设置牌河内部回看位置…', async () => (await ready()).riverPosition(position));
// 兼容组单独运行，不把旧版/观众结果混同为原六组玩家验收。
// Run compatibility separately, without conflating legacy/spectator results with the six player cases.
async function auditCases(cases) {
  const reports = [];
  for (const width of [1280, 390]) {
    widthInput.value = String(width); frame.width = String(width);
    for (const caseId of cases) {
      caseInput.value = caseId; stageInput.value = 'empty';
      status.textContent = `正在审计 ${caseId} / ${width}px`;
      const api = await configure(); const result = await api.audit(); reports.push(result);
      report({ completed: reports.length, reports });
    }
  }
  return { passed: reports.every((result) => result.passed), reports };
}
document.querySelector('#fixture-audit-all').onclick = () => run('正在审计3种玩法 × 2种真实视口…', () => auditCases(STABLE_TABLE_CASES));
document.querySelector('#fixture-audit-compat').onclick = () => run('正在审计旧版/观战兼容八组…', () => auditCases(STABLE_TABLE_COMPAT_CASES));
await ready(); status.textContent = '纯视图已就绪。选择玩法/尺寸后先按“切换合成画面”，或按“审计全部六组”。';
