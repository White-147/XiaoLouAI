# Legacy Surface Evidence

Language: [English](README.md) | [简体中文](README.zh-CN.md)

This directory contains sanitized retained evidence for legacy source-removal
readiness and post-G11k/G11l non-live verifier modes. It is not a runtime
directory and must not contain secrets, uploads, operator-only production
evidence, local database dumps, or deploy-retained local material.

Current retained manifests:

- `final-legacy-surface-manifest-g11k.json`: generated from live
  `legacy/core-api` and `legacy/services-api` after final legacy surface checks
  passed.
- `legacy-projection-manifest-g11k.json`: generated from live `legacy/core-api`
  projection source evidence after projection source checks passed.

G11k removed 421 reviewed git-tracked legacy source candidates from
`legacy/core-api`, `legacy/services-api`, and `legacy/jaaz`. G11l then moved
operator-approved non-secret local material to
`deploy/retained/legacy-local-material/`, moved real env/service-account files,
secret-like demo SQLite state, and Jaaz config with non-empty API-key fields to
ignored `deploy/local-secrets/legacy/`,
removed logs/caches/empty directories, and removed the remaining tracked
legacy `.gitignore` files after root ignore coverage existed.

These manifests support explicit non-live verifier modes; they do not replace
operator-only acceptance evidence, real restore drills, or dependency restore
when a live legacy reference run is intentionally restored.

G11l validation note: cleanup dry-run and release candidate verifiers pass these
manifests into their dependent sub-gates when live legacy roots are absent. RC
or P2 runs that use explicit skips are still reduced warning evidence, not full
final acceptance.
