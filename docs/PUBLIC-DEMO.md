# 本机公网演示

使用本机 Node + Nginx + Cloudflare Quick Tunnel，无需域名、云服务器或平台登录。不修改原 Sites 托管站点；本机的数据与云端 D1 完全独立。

## 准备

- Node.js 22.13 或以上。在项目根目录安装已有锁定依赖后执行 `npm run build`，静态产物为 `dist/client`。
- Nginx 1.31.8 官方包：https://nginx.org/download/nginx-1.31.8.zip ，解压到 `work/cache/public-demo/nginx-1.31.8/`。
- cloudflared 2026.10.7 官方包：https://github.com/cloudflare/cloudflared/releases/download/2026.10.7/cloudflared-windows-amd64.exe ，保存为 `work/cache/public-demo/cloudflared.exe`。
- cloudflared SHA256：`2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343`，使用 `Get-FileHash` 检查。工具与运行文件不提交。

## 启停

在 Windows PowerShell 5.1 或 PowerShell 7 中执行，不要求 `pwsh` 命令在 PATH 中：

```powershell
Set-Location D:\work_space\flower-mahjong
& .\scripts\public-demo\Public-Demo.ps1 -Action Start
& .\scripts\public-demo\Public-Demo.ps1 -Action Status
& .\scripts\public-demo\Public-Demo.ps1 -Action Stop
```

Start 创建三个隐藏后台进程并输出临时地址；关闭当前终端不会自动停止。Stop 关闭本次隧道、Nginx 和本项目 Node 服务，保留数据。已有演示进程或端口占用时拒绝重复启动。启动中断时先 Status 检查，再 Stop 后重试。Status 只报告进程存在，不代表端到端健康。

- Node 监听 `127.0.0.1:5182`，入口为 `server/start.js`。
- Nginx 监听 `127.0.0.1:8089`，提供 `dist/client`；`/api/` 不去前缀，转发到 Node。
- Nginx 保留公网 Host 和请求认证头，传递真实 HTTPS scheme；Node 使用 `TRUST_PROXY=1`，保持原有同源校验。现有通信为 HTTP 轮询，不需要 WebSocket 或 SSE。
- 运行配置、PID、URL 和日志位于 `work/public-demo/`，当前地址保存在 `url.txt`；停止时删除过期地址。

## 数据与分享边界

本次服务独占 `.data/public-demo/`，其中 `rooms.json` 与 `profiles.json` 为本机私有持久数据。没有复制云端牌局、积分或身份。不得让另一个 Node 进程同时写此目录，也不能把它作为静态目录公开。

三个人必须打开同一个临时公网地址，各用自己的浏览器或设备。房主建房后分享邀请链接，满三人即可开局；不分享个人身份或座位凭证。

Quick Tunnel 地址重启后可能变化。浏览器身份在 localStorage、座位凭证在 sessionStorage，按域名隔离；新域名不会自动恢复旧身份或座位，即使服务器文件仍保留。需要同一局连续试打时，应保持本次隧道和服务运行。长期稳定使用应另选固定域名部署，不宣称临时隧道具备持续可用性。

本机需要持续开机联网。公网链路延迟取决于访问者网络，手机移动网络需另行实测。现有 Node 适配器会按代理连接来源限流，所有玩家共享每分钟 10 次建房额度，适合少量熟人试打。