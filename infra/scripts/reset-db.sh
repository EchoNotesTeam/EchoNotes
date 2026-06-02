#!/usr/bin/env bash
# EchoNotes — reset-db.sh
#
# Drops all application schemas and re-runs both Prisma and Goose migrations
# from scratch. Useful for development when you need a clean slate.
#
# Usage (from repo root):
#   ./infra/scripts/reset-db.sh [--force]
#
# Environment:
#   DATABASE_URL — required (see infra/.env.example).
#                  For local dev outside Docker use localhost:5432.
#
# ⚠️  DESTRUCTIVE — all data will be lost. Requires --force to run.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# ── Safety guard ─────────────────────────────────────────────────────────────
if [[ "${1:-}" != "--force" ]]; then
  echo "ERROR: This script deletes all application data."
  echo "       Pass --force to confirm: ./infra/scripts/reset-db.sh --force"
  exit 1
fi

: "${DATABASE_URL:?DATABASE_URL is required. See infra/.env.example}"

echo "==> Dropping application schemas (auth, sheets, jobs, transcriptions)…"
psql "$DATABASE_URL" <<'SQL'
-- Drop schemas owned by the TypeScript backend
DROP SCHEMA IF EXISTS auth        CASCADE;
DROP SCHEMA IF EXISTS sheets      CASCADE;

-- Drop schemas owned by the Go orchestrator
DROP SCHEMA IF EXISTS jobs        CASCADE;
DROP SCHEMA IF EXISTS transcriptions CASCADE;

-- Drop Prisma's migration tracking table
DROP TABLE IF EXISTS public._prisma_migrations;

-- Drop Goose's migration tracking table
DROP TABLE IF EXISTS public.goose_db_version;

SELECT 'schemas dropped' AS status;
SQL

echo "==> Re-running migrations…"
"${ROOT}/infra/scripts/migrate.sh"

echo ""
echo "==> Database reset complete. Run the seed if you want demo data:"
echo "    pnpm --filter @echonotes/api db:seed"
