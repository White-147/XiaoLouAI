@echo off
:: ============================================================
:: 小楼 AI — 完整栈后台启动入口
:: 推荐直接使用 start_background.cmd（自动请求管理员权限）
:: ============================================================

echo.
echo  ┌──────────────────────────────────────────────────┐
echo  │     小楼 AI — 全栈后台启动器                     │
echo  │                                                   │
echo  │  端口分配：                                       │
echo  │    3000  XIAOLOU-main  (Vite 前端)               │
echo  │    4100  core-api      (后端 + 视频替换)          │
echo  │    80    Caddy         (HTTP 反向代理)            │
echo  │    443   Caddy         (HTTPS + 自动证书)        │
echo  │                                                   │
echo  │  访问地址：                                       │
echo  │    http://127.0.0.1:3000       本地直连           │
echo  │    http://218.92.180.214       公网 IP            │
echo  │    https://www.xiaolouai.cn    公网域名           │
echo  └──────────────────────────────────────────────────┘
echo.

:: 委托给后台启动脚本（自动请求管理员权限）
call "%~dp0start_background.cmd"
