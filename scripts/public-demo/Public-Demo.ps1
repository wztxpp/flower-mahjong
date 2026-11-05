param([ValidateSet('Start', 'Stop', 'Status')][string]$Action = 'Status')

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$runtime = Join-Path $projectRoot 'work/public-demo'
$tools = Join-Path $projectRoot 'work/cache/public-demo'
$nginxRoot = Join-Path $tools 'nginx-1.31.8'
$nginxExe = Join-Path $nginxRoot 'nginx.exe'
$tunnelExe = Join-Path $tools 'cloudflared.exe'
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$serverEntry = Join-Path $projectRoot 'server/start.js'
$nodePidFile = Join-Path $runtime 'node.pid'
$nginxPidFile = Join-Path $runtime 'nginx.pid'
$tunnelPidFile = Join-Path $runtime 'cloudflared.pid'
$urlFile = Join-Path $runtime 'url.txt'
$prefix = $runtime.Replace('\', '/') + '/'

# PID 会复用，同时核对工具路径；Node 还需核对本项目的入口。
function Get-DemoProcess([string]$PidFile, [string]$Executable) {
    if (-not (Test-Path -LiteralPath $PidFile)) { return $null }
    $processId = 0
    if (-not [int]::TryParse([string](Get-Content -LiteralPath $PidFile -Raw), [ref]$processId) -or $processId -le 0) { return $null }
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if (-not $process -or $process.Path -ne $Executable) { return $null }
    if ($Executable -eq $nodeExe) {
        $details = Get-CimInstance Win32_Process -Filter "ProcessId = $processId"
        if (-not $details.CommandLine.Contains($serverEntry)) { return $null }
    }
    return $process
}

$nodeProcess = Get-DemoProcess $nodePidFile $nodeExe
$nginxProcess = Get-DemoProcess $nginxPidFile $nginxExe
$tunnelProcess = Get-DemoProcess $tunnelPidFile $tunnelExe
if ($Action -eq 'Status') {
    [pscustomobject]@{
        ServerRunning = [bool]$nodeProcess
        NginxRunning = [bool]$nginxProcess
        TunnelRunning = [bool]$tunnelProcess
        Url = if ($tunnelProcess -and (Test-Path -LiteralPath $urlFile)) { (Get-Content -LiteralPath $urlFile -Raw).Trim() } else { $null }
        DataDirectory = Join-Path $projectRoot '.data/public-demo'
    }
    return
}
if ($Action -eq 'Stop') {
    if ($tunnelProcess) { Stop-Process -Id $tunnelProcess.Id; $tunnelProcess.WaitForExit(10000) | Out-Null }
    if ($nginxProcess) {
        & $nginxExe -p $prefix -c nginx.conf -s quit
        if ($LASTEXITCODE -ne 0 -or -not $nginxProcess.WaitForExit(10000)) { throw 'Nginx 尚未停止，请检查日志后重试。' }
    }
    if ($nodeProcess) { Stop-Process -Id $nodeProcess.Id; $nodeProcess.WaitForExit(10000) | Out-Null }
    foreach ($stateFile in @($nodePidFile, $tunnelPidFile, $urlFile)) {
        if (Test-Path -LiteralPath $stateFile) { Remove-Item -LiteralPath $stateFile }
    }
    Write-Output '麻将公网入口与本次 Node 服务已停止；牌局数据保留。'
    return
}
if ($nodeProcess -or $nginxProcess -or $tunnelProcess) { throw '演示进程已经存在，请先 Status 查看，或 Stop 后重新 Start。' }
foreach ($file in @($nginxExe, $tunnelExe, (Join-Path $projectRoot 'dist/client/index.html'))) {
    if (-not (Test-Path -LiteralPath $file)) { throw "缺少 $file，请先按 docs/PUBLIC-DEMO.md 准备工具和构建。" }
}
foreach ($port in @(5182, 8089)) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "端口 $port 已被占用，请先关闭原服务。" }
}
New-Item -ItemType Directory -Force (Join-Path $runtime 'logs'), (Join-Path $runtime 'temp') | Out-Null
$template = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'nginx.conf.template') -Raw -Encoding UTF8
$config = $template.Replace('__MIME_TYPES__', (Join-Path $nginxRoot 'conf/mime.types').Replace('\', '/')).Replace('__WEB_ROOT__', (Join-Path $projectRoot 'dist/client').Replace('\', '/'))
[System.IO.File]::WriteAllText((Join-Path $runtime 'nginx.conf'), $config, [System.Text.UTF8Encoding]::new($false))
& $nginxExe -p $prefix -c nginx.conf -t
if ($LASTEXITCODE -ne 0) { throw 'Nginx 配置检查失败。' }

# 子进程继承专用配置，启动后恢复当前终端的环境。
$settings = @{ HOST = '127.0.0.1'; PORT = '5182'; TRUST_PROXY = '1'; MAHJONG_DATA_DIR = (Join-Path $projectRoot '.data/public-demo') }
$previous = @{}
try {
    foreach ($key in $settings.Keys) { $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process'); [Environment]::SetEnvironmentVariable($key, $settings[$key], 'Process') }
    $nodeProcess = Start-Process -FilePath $nodeExe -ArgumentList ('"' + $serverEntry + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'logs/node-stdout.log') -RedirectStandardError (Join-Path $runtime 'logs/node-stderr.log') -PassThru
    Set-Content -LiteralPath $nodePidFile -Value $nodeProcess.Id
} finally {
    foreach ($key in $previous.Keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
}
Start-Sleep -Seconds 1
$health = Invoke-RestMethod 'http://127.0.0.1:5182/api/health' -TimeoutSec 10
if (-not $health.ok -or $health.service -ne 'flower-mahjong') { throw '麻将 Node 服务检查失败。' }
Start-Process -FilePath $nginxExe -ArgumentList @('-p', ('"' + $prefix + '"'), '-c', 'nginx.conf') -WorkingDirectory $runtime -WindowStyle Hidden
Start-Sleep -Seconds 1
$page = Invoke-WebRequest 'http://127.0.0.1:8089/' -UseBasicParsing -TimeoutSec 10
if ($page.StatusCode -ne 200) { throw '本机网页检查失败。' }
$stderr = Join-Path $runtime 'logs/cloudflared-stderr.log'
$tunnel = Start-Process -FilePath $tunnelExe -ArgumentList @('tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', 'http://127.0.0.1:8089') -WorkingDirectory $runtime -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'logs/cloudflared-stdout.log') -RedirectStandardError $stderr -PassThru
Set-Content -LiteralPath $tunnelPidFile -Value $tunnel.Id
for ($attempt = 0; $attempt -lt 45; $attempt++) {
    Start-Sleep -Seconds 1
    $tunnel.Refresh()
    if ($tunnel.HasExited) { throw "隧道启动失败，请检查 ${stderr}。" }
    $log = Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue
    $url = [regex]::Match([string]$log, 'https://[a-z0-9-]+\.trycloudflare\.com')
    if ($url.Success -and $log.Contains('Registered tunnel connection')) {
        Set-Content -LiteralPath $urlFile -Value $url.Value
        Write-Output "麻将公网地址：$($url.Value)"
        return
    }
}
throw "隧道尚未连接，请查看 ${stderr}；结束或重试前先执行 -Action Stop。"