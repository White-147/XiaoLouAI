# Retained Legacy Local Material

This directory contains operator-approved, non-secret legacy local material
moved out of `legacy/` during G11l so it can travel with GitHub-based
deployments without keeping `legacy/` as a live workspace root.
`MATERIALS.sha256` records the retained file hashes after local-only secret
material was excluded.

Included material:

- `core-api/data/canvas-library/`: retained canvas-library sample assets,
  images, videos, and workflow JSON.
- `core-api/uploads/`: retained legacy upload media for cross-host reference or
  restore/import work.
- `core-api/backup/sqlite-2026-05-01T04-50-19-844Z/`: retained backup material
  excluding real env/demo state secrets.
- `jaaz/server/user_data/`: retained Jaaz local user data approved for the
  deployment handoff, excluding `config.toml` because it contains non-empty
  API-key fields.

Excluded from Git:

- Real env and service-account files are under ignored
  `deploy/local-secrets/legacy/`.
- `demo.sqlite` files with secret-like app-state text are under ignored
  `deploy/local-secrets/legacy/`.
- `jaaz/server/user_data/config.toml` is under ignored
  `deploy/local-secrets/legacy/`.

This is not production source and must not restore `legacy/` as a production
runtime entrypoint. If a deployment host needs this material, copy or import it
through an explicit deployment/restore owner.
