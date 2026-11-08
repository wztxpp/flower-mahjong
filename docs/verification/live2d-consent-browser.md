# 官方许可选择的真实浏览器验收 / Real browser license-choice verification

2026-11-08，官方 Chromium，隔离的 localhost:5470–5473，MemoryStore，无生产牌局或凭证。通过实际界面点击，不改浏览器存储、内部状态或 GPU 设置。测试服务结束后已 Ctrl+C 停止并确认 shell 提示符。
Official Chromium and isolated in-memory origins were used. All choices were made through the UI; browser storage, internal state and GPU settings were not edited. The test server was stopped and the shell prompt verified.

- 首次进入、明确拒绝及刷新：SDK、模型、renderer 请求均为 **0**；原图正常显示，Core 诊断按钮禁用。
- 展开设置本身不算同意。界面显示 Core / Framework 官方中文及日文链接，只引用本游戏 Live2D 组件使用及保护条款，不新增玩家赔偿、注册或付费承诺。
- 点击“同意并启用动态角色”才开始请求真实 Core、Framework、模型 JSON / moc3。此电脑无可用 WebGL，画框正确保持原图回退。同版本选择在刷新后恢复。
- 同意后的可见诊断按钮实际加载全部七个模型、八张纹理及七张背景；每个模型一致性为 1，192 帧均为有限值且发生真实变化。完整结果见 `live2d-browser-core-consent.json`。这不是 GPU 绘制证据。
- 关闭并刷新后无 Core script、无背景节点、无 canvas；两画框仍为 original。撤销前后日志行数保持 126，不新增动态请求。
- 重启生命周期修复后，重新开启仍能实际加载并安全回退，胡牌原图可见。再次关闭刷新后为 0 canvas / 0 background / 0 Core script，日志行数保持 175。
- 实际 App 的花麻将、成都麻将均有共用非阻塞入口。拒绝后成功创建成都准备桌，所有原有玩法选项和地主原图正常；准备桌本来不挂动态画框，因此即使开启也不提前下载模型。完整开始/定缺/弃牌流程由前一轮真实浏览器报告覆盖，不把本次准备桌检查写成完整重跑。

The checks confirm gating, persistence, withdrawal, original-art reactions and actual Core/resource loading, not visible WebGL animation. Full previous gameplay checks remain separately scoped.

只记录动态路径与 HTTP 状态的日志：`live2d-consent-network.jsonl`，175 行，129 SDK / 43 model / 3 renderer，均来自已同意后的 5470 origin；5471 实际 App 准备桌为 0。日志包含 Vite 开发模块，数量不是生产请求数或性能指标。未记录 API、查询串、Cookie、牌局暗手或凭证。
The evidence contains only resource paths/statuses. Development-module counts are not production performance measurements; no APIs, queries, cookies, concealed hands or credentials are recorded.

用户已选择自行验收实际 GPU 画面。当前 `webglVerified=false` 准确保留，但不再作为必须等待其他设备或官方预审的发布前提。
The owner chose to perform the GPU check personally. The unverified status remains explicit; no additional device or official prereview is imposed as a release prerequisite.
