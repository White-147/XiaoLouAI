<div align="center">
  <img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# XiaoLou Frontend

Language: [简体中文](README.md) | [English](README.en.md)

## Standard Development Flow

Required services:

- `3000`, or the current Vite port: `XIAOLOU-main` frontend
- `4100`: `core-api` backend during migration
- `5174` / `57988`: Jaaz UI / Jaaz API for the agent canvas

One-command startup:

```text
scripts\start_xiaolou_stack.cmd
```

Manual startup:

```bash
cd core-api && npm run dev
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
| Playground | `/playground` | Route kept only; external service removed |

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
- `/create/agent-studio` uses the Jaaz service, whose ports are separate from
  the main frontend.
- The external `/playground` implementation has been removed. The route remains
  as a future entry point for native XiaoLou capabilities.

## README Language Policy

Keep this README and `README.md` in sync. Any future README change should update
both language versions.
