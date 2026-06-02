#!/usr/bin/env bash
# EchoNotes — cleanup.sh
#
# Nightly cleanup cron — implements §9 of the design plan:
#
#   1. Delete upload files older than 7 days whose job is done/failed.
#   2. Hard-delete artifact directories for sheets soft-deleted > 30 days ago.
#
# Usage (from repo root):
#   ./infra/scripts/cleanup.sh [--dry-run]
#
# Environment:
#   DATABASE_URL  — required
#   ARTIFACT_ROOT — root of the shared volume (default: /var/echonotes)
#
# Install as a nightly cron (example — adjust path as needed):
#   0 3 * * * /bin/bash /opt/echonotes/infra/scripts/cleanup.sh >> /var/log/echonotes-cleanup.log 2>&1
#
# Dry-run mode lists what WOULD be deleted without touching anything.

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required. See infra/.env.example}"
ARTIFACT_ROOT="${ARTIFACT_ROOT:-/var/echonotes}"
DRY_RUN=false

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "[DRY RUN] No files will be deleted."
fi

NOW_ISO=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
echo "==> EchoNotes cleanup — ${NOW_ISO}"

# ── Helper ────────────────────────────────────────────────────────────────────

delete_path() {
  local path="$1"
  if [[ -e "$path" ]]; then
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "    [DRY RUN] would delete: $path"
    else
      rm -rf "$path"
      echo "    deleted: $path"
    fi
  fi
}

# ── Step 1: Old upload files (job done/failed, upload > 7 days old) ──────────
echo ""
echo "--> Step 1: upload files for completed jobs older than 7 days"

UPLOAD_PATHS=$(psql "$DATABASE_URL" -t -A <<'SQL'
SELECT j.audio_path
FROM   jobs.transcription_jobs j
WHERE  j.status IN ('done', 'failed')
  AND  j.finished_at < NOW() - INTERVAL '7 days'
  AND  j.audio_path IS NOT NULL
  AND  j.audio_path LIKE '/var/echonotes/uploads/%';
SQL
)

if [[ -z "$UPLOAD_PATHS" ]]; then
  echo "    nothing to clean up."
else
  UPLOAD_COUNT=0
  while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    delete_path "$path"
    UPLOAD_COUNT=$((UPLOAD_COUNT + 1))
  done <<< "$UPLOAD_PATHS"
  echo "    processed ${UPLOAD_COUNT} upload path(s)."
fi

# ── Step 2: Artifact dirs for hard-deleted sheets (deleted_at > 30 days) ─────
echo ""
echo "--> Step 2: artifact directories for sheets soft-deleted > 30 days ago"

TRANSCRIPTION_IDS=$(psql "$DATABASE_URL" -t -A <<'SQL'
SELECT transcription_id
FROM   sheets.sheets
WHERE  deleted_at IS NOT NULL
  AND  deleted_at < NOW() - INTERVAL '30 days'
  AND  transcription_id IS NOT NULL;
SQL
)

if [[ -z "$TRANSCRIPTION_IDS" ]]; then
  echo "    nothing to clean up."
else
  ARTIFACT_COUNT=0
  while IFS= read -r tid; do
    [[ -z "$tid" ]] && continue
    artifact_dir="${ARTIFACT_ROOT}/artifacts/${tid}"
    delete_path "$artifact_dir"
    ARTIFACT_COUNT=$((ARTIFACT_COUNT + 1))
  done <<< "$TRANSCRIPTION_IDS"
  echo "    processed ${ARTIFACT_COUNT} artifact director(ies)."
fi

# ── Step 3: Disk usage report ─────────────────────────────────────────────────
echo ""
echo "--> Disk usage after cleanup:"
if [[ -d "$ARTIFACT_ROOT" ]]; then
  du -sh "${ARTIFACT_ROOT}/uploads"   2>/dev/null && true
  du -sh "${ARTIFACT_ROOT}/artifacts" 2>/dev/null && true
fi

echo ""
echo "==> Cleanup complete."
