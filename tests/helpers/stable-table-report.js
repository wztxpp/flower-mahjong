// 诊断报告的纯格式化/DOM写入边界；完整数据留在非渲染JSON节点，避免数万行pre拖慢布局与AX。
// Diagnostic formatting/DOM boundary: retain full data in a non-rendered JSON node, avoiding tens of thousands of pre lines in layout/AX.
// 只改变诊断页结果展示，不改快照、iframe、测量、容差或通过结论。
// Change diagnostic result presentation only, never snapshots, frames, measurements, tolerances, or pass/fail decisions.
export const MAX_VISIBLE_REPORT_BYTES = 24 * 1024;
const RAW_DATA_NOTICE = '完整原始测量保存在DOM #fixture-raw-json 的textContent；此处只显示有界摘要。';

// 失败详情限制在每组前两项，其余计数明确保留；原始数组完整进入raw，不截断证据。
// Show the first two failures per group with total counts; raw arrays remain complete and evidence is never truncated.
function summarizeReport(report) {
  const failedStages = report.samples.filter((sample) => !sample.fromBaseline.passed || !sample.fromPrevious.passed);
  const failedRetention = report.scrollRetention.filter((sample) => !sample.passed);
  const failedReachability = report.reachability.results.filter((sample) => !sample.passed);
  return {
    caseId: report.caseId, viewport: report.baseline.viewport, passed: report.passed,
    resourcesReady: report.resourcesReady,
    failureCounts: { stages: failedStages.length, retention: failedRetention.length, reachability: failedReachability.length },
    failedStages: failedStages.slice(0, 2).map((sample) => ({
      stageId: sample.stageId,
      fromBaseline: Object.fromEntries(Object.entries(sample.fromBaseline.differences).filter(([, value]) => Math.abs(value) > 1)),
      fromPrevious: Object.fromEntries(Object.entries(sample.fromPrevious.differences).filter(([, value]) => Math.abs(value) > 1)),
    })),
    failedRetention: failedRetention.slice(0, 2).map((sample) => ({ position: sample.position, preserved: sample.preserved, geometry: sample.geometry })),
    failedReachability: failedReachability.slice(0, 2),
  };
}

// 任何输入的可见输出都有明确字节上限；过大摘要退回计数，不把截断字符串冒充有效JSON。
// Visible output has an explicit byte ceiling for any input; oversized summaries fall back to counts, never invalid truncated JSON.
export function formatStableTableReport(result) {
  const reports = result.reports || (result.samples ? [result] : []);
  const summary = reports.map(summarizeReport);
  const rawText = JSON.stringify(summary.length ? { summary, ...result } : result, null, 2);
  let visibleText = JSON.stringify(summary.length
    ? { passed: result.passed, completed: result.completed, reportCount: reports.length, note: RAW_DATA_NOTICE, summary: summary.slice(0, 8) }
    : result, null, 2);
  if (new TextEncoder().encode(visibleText).length > MAX_VISIBLE_REPORT_BYTES) {
    visibleText = JSON.stringify({
      passed: result.passed ?? null, reportCount: reports.length,
      summaryTruncated: true, note: RAW_DATA_NOTICE,
    }, null, 2);
  }
  return { visibleText, rawText };
}

// textContent不会解析HTML；script[type=application/json]不执行也不进入可见布局。
// textContent never parses HTML; application/json scripts neither execute nor participate in visible layout.
export function writeStableTableReport(result, visibleOutput, rawOutput) {
  const { visibleText, rawText } = formatStableTableReport(result);
  rawOutput.textContent = rawText;
  visibleOutput.textContent = visibleText;
}

// 新操作先撤下上一轮的全文/摘要，防止待运行期间仍背负旧报告布局，也防止误读旧通过结果。
// Clear prior full/summary results before a new operation, avoiding old layout pressure and stale success claims.
export function clearStableTableReport(visibleOutput, rawOutput) {
  const pending = JSON.stringify({ status: 'running', passed: null });
  rawOutput.textContent = pending;
  visibleOutput.textContent = pending;
}
