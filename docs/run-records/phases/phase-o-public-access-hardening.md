# Phase O - 公网访问硬化队列

## 范围

本记录整理 public-access-hardening-owner-queue 的公开摘要，覆盖 object storage public contract、API 限流/并发/body cap、Home-to-Playground 预热预算、metadata compression/cache 和 public capacity verification。

## 已完成 owner

- O1 public-access-constraints-preflight：本轮没有业务代码修改。
- O2 media-object-storage-public-contract-owner：上传走 `/api/media/object-upload/*`，稳定读走 `/api/media/object-content/*`，前端不再把外部对象存储/CDN URL 改写成本地 urlPath。
- O3 edge-and-api-rate-limit-owner：Control API 与 Caddy/IIS 示例都有公网 body ceiling、固定窗口和并发保护。
- O4 home-playground-prewarm-budget-owner：`/home` 不再定时隐藏挂载 Playground，只在明确交互时预取 lazy route chunk。
- O5 api-compression-cache-contract-owner：仅对已审查稳定 JSON metadata routes 启用动态压缩、private `max-age=30` 和 weak ETag。
- O6 capacity-and-load-verification-owner：新增公网容量验证脚本，默认离线核算 PostgreSQL pool、worker lease throughput、active-job polling 和 body caps。

## 验证入口

```powershell
.\scripts\windows\verify-public-access-capacity.ps1
```

公网 HTTP smoke：

```powershell
.\scripts\windows\verify-public-access-capacity.ps1 `
  -RunHttp `
  -BaseUrl "https://xiaolou.example.com" `
  -ClientApiToken "<public client token or canary assertion>" `
  -ObjectContentPath "/api/media/object-content/<bucket>/<objectKey>"
```

## 来源

- [运维与证据边界](../../operations-and-evidence.md)
- [Windows Native Ops Runbook](../../../deploy/windows/ops-runbook.md)
- [开发与验证](../../development.md)
- [短棒交接](../../../XIAOLOU_REFACTOR_HANDOFF.md)
