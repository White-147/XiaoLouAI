@echo off
:: ============================================================
:: 启动 Caddy 反向代理（HTTP 80 + HTTPS 443）
:: 运行前请确认：
::   1. 防火墙已开放 80 和 443 入站（本脚本会自动尝试添加规则）
::   2. 前端 Vite 已在 3000 端口运行
::   3. core-api 已在 4100 端口运行
:: ============================================================
echo.
echo [caddy] 正在添加防火墙入站规则 (80 / 443) ...
netsh advfirewall firewall delete rule name="XiaolouAI-HTTP-80" >nul 2>&1
netsh advfirewall firewall delete rule name="XiaolouAI-HTTPS-443" >nul 2>&1
netsh advfirewall firewall add rule name="XiaolouAI-HTTP-80"  dir=in action=allow protocol=TCP localport=80
netsh advfirewall firewall add rule name="XiaolouAI-HTTPS-443" dir=in action=allow protocol=TCP localport=443

echo.
echo [caddy] 启动 Caddy（Caddyfile: %~dp0..\caddy\Caddyfile）...
echo [caddy] 首次运行会自动申请 Let's Encrypt TLS 证书，请保持 80/443 可公网访问。
echo [caddy] 按 Ctrl+C 停止服务。
echo.

cd /d "%~dp0..\caddy"
caddy.exe run --config Caddyfile
