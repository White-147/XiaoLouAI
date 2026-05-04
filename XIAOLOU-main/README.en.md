<div align="center">
  <img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# XiaoLou Frontend

Language: [简体中文](README.md) | [English](README.en.md)

## Standard Development Flow

Required services:

- `3000`, or the current Vite port: `XIAOLOU-main` frontend
- `4100`: `.NET` Control API, the primary entry for production canonical public routes
- `legacy/core-api`: archived reference for migration-only read-only compatibility, login/assertion transition, or local comparison; do not reopen old write routes or use it as the production control plane.
- `5174` / `57988`: Jaaz UI / Jaaz API only for local agent-canvas comparison or embed debugging, not the production control plane

One-command startup:

```text
scripts\start_xiaolou_stack.cmd
```

Manual startup:

```powershell
cd control-plane-dotnet && dotnet run --project .\src\XiaoLou.ControlApi\XiaoLou.ControlApi.csproj
cd XIAOLOU-main && npm run dev
```

## Feature Entrances

| Page | Path | Notes |
|------|------|-------|
| Image creation | `/create/image` | Primary creation entry |
| Video creation | `/create/video` | Primary creation entry |
| Native canvas | `/create/canvas` | XiaoLou native canvas |
| Agent studio | `/create/agent-studio` | Embedded Jaaz canvas |
| Asset management | `/assets` | Project assets and agent-canvas assets |
| Homepage toolbox | `/` | Canonical capability cards and queued toolbox runs |
| Playground | `/playground` | Native canonical conversations, messages, memories, and chat jobs |

## Frontend Environment Variables

```text
VITE_CORE_API_BASE_URL=http://127.0.0.1:4100
VITE_CORE_API_PROXY_TARGET=http://127.0.0.1:4100
VITE_JAAZ_AGENT_CANVAS_URL=/jaaz/?embed=xiaolou
VITE_JAAZ_DEV_PROXY_TARGET=http://localhost:5174
VITE_JAAZ_API_PROXY_TARGET=http://127.0.0.1:57988
```

## Current Notes

- `/create/canvas` is compiled directly into the main frontend and no longer
  needs a separate canvas port.
- `/create/agent-studio` no longer depends on old Jaaz writes by default; use
  Jaaz ports only for local embed comparison.
- The external `/playground` implementation has been removed. The route now
  uses `.NET` canonical `/api/playground/config|models|conversations|chat-jobs|memories`.
- Project, canvas, agent-canvas, and create image/video list-delete flows now
  call the first-batch `.NET` canonical source endpoints:
  `/api/projects*`, `/api/canvas-projects*`, `/api/agent-canvas/projects*`,
  `/api/create/images*`, and `/api/create/videos*`. Source verification,
  elevated publish/restart/P0, and `http://127.0.0.1:4100` runtime smoke have
  passed, so the running Windows service includes this batch.
- Login/register, profile, organization members, and API-center settings now
  call the second-batch `.NET` canonical identity/config endpoints:
  `/api/auth*`, `/api/me`, `/api/organizations/*/members`, and
  `/api/api-center*`. The 4100 runtime smoke covered login, profile update,
  enterprise registration, organization member writes, and API-center
  defaults/key/test/model writes.
- Project-adjacent assets/storyboards/videos/dubbings/exports now call the
  third-batch `.NET` canonical endpoints:
  `/api/projects/{projectId}/assets*`, `/storyboards*`, `/videos`,
  `/dubbings`, and `/exports`. This batch has passed elevated
  publish/restart/P0 plus a 4100 runtime smoke, so the running Windows service
  includes it.
- Admin pricing/order reads now call the admin/system `.NET` canonical
  endpoints: `/api/admin/pricing-rules` and `/api/admin/orders`. Manual admin
  recharge review remains retired with a 410 response, and enterprise
  applications use `/api/enterprise-applications*`.
- Playground conversations, messages, memory preferences, memories, and chat
  job creation now call `/api/playground*`. The batch has passed source build,
  frontend lint/build, frontend legacy dependency gate, temporary 4110 P0, and
  elevated 4100 publish/restart/P0.
- Homepage toolbox capability discovery and runnable tools now call
  `/api/capabilities` and `/api/toolbox*`. Character replacement, motion
  transfer, upscale/restore, reverse prompt, storyboard grid, and translation
  requests create canonical `toolbox_runs` plus queued `jobs` instead of using
  legacy `/api/jobs` shortcuts. The batch has passed frontend build, the
  frontend legacy dependency gate, temporary 4110 P0, strict projection
  verification, and patched 4100 P0 smoke.

## README Language Policy

Keep this README and `README.md` in sync. Any future README change should update
both language versions.
