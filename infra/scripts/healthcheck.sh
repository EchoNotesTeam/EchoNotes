#!/usr/bin/env bash
# EchoNotes — healthcheck.sh
#
# Checks the liveness of all five services and reports their status.
# Exits 0 if everything is healthy, non-zero otherwise.
#
# Usage (from repo root):
#   ./infra/scripts/healthcheck.sh
#
# Optional env overrides (defaults to localhost ports from docker-compose.yml):
#   API_URL  — Fastify API        (default: http://localhost:3000)
#   AI_URL   — Go Orchestrator    (default: http://localhost:8080)
#   ML_URL   — Python ML Service  (default: http://localhost:8001)
#   DB_HOST  — PostgreSQL host    (default: localhost)
#   DB_PORT  — PostgreSQL port    (default: 5432)
#   REDIS_HOST — Redis host       (default: localhost)
#   REDIS_PORT — Redis port       (default: 6379)

set -euo pipefail

API_URL="${API_URL:-http://localhost:3000}"
AI_URL="${AI_URL:-http://localhost:8080}"
ML_URL="${ML_URL:-http://localhost:8001}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
REDIS_HOST="${REDIS_HOST:-localhost}"
REDIS_PORT="${REDIS_PORT:-6379}"

PASS=0
FAIL=0

check_http() {
  local name="$1"
  local url="$2"
  local result
  local http_code

  http_code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null || echo "000")

  if [[ "$http_code" == "200" ]]; then
    echo "  ✓  ${name} — ${url} (HTTP ${http_code})"
    PASS=$((PASS + 1))
  else
    echo "  ✗  ${name} — ${url} (HTTP ${http_code})"
    FAIL=$((FAIL + 1))
  fi
}

check_tcp() {
  local name="$1"
  local host="$2"
  local port="$3"

  if nc -z -w 3 "$host" "$port" 2>/dev/null; then
    echo "  ✓  ${name} — ${host}:${port} (TCP reachable)"
    PASS=$((PASS + 1))
  else
    echo "  ✗  ${name} — ${host}:${port} (TCP unreachable)"
    FAIL=$((FAIL + 1))
  fi
}

echo "EchoNotes healthcheck — $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "─────────────────────────────────────────────────"

# HTTP services
check_http "Fastify API     " "${API_URL}/healthz"
check_http "Go Orchestrator " "${AI_URL}/healthz"
check_http "Python ML Svc   " "${ML_URL}/healthz"

# TCP-only checks for DB/cache (no HTTP endpoint without auth)
check_tcp  "PostgreSQL      " "$DB_HOST"    "$DB_PORT"
check_tcp  "Redis           " "$REDIS_HOST" "$REDIS_PORT"

echo "─────────────────────────────────────────────────"
echo "  Passed: ${PASS}  Failed: ${FAIL}"

if [[ "$FAIL" -gt 0 ]]; then
  echo ""
  echo "One or more services are unhealthy. Check logs with:"
  echo "  docker compose -f infra/docker-compose.yml logs -f <service>"
  exit 1
fi

echo ""
echo "All services healthy."
