#!/usr/bin/env bash
# Bootstrap script — runs Prisma migrations (TS schemas) then Goose migrations (Go schemas).
# Usage: ./infra/scripts/migrate.sh
# Must be called from the repo root with DATABASE_URL set in the environment.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "==> Running Prisma migrations (auth, sheets schemas)..."
cd "$ROOT/apps/api"
pnpm prisma migrate deploy

echo "==> Running Goose migrations (jobs, transcriptions schemas)..."
cd "$ROOT/services/ai-orchestrator"
DATABASE_URL="${DATABASE_URL}" go run ./cmd/migrate ./sql/migrations

echo "==> All migrations applied."
