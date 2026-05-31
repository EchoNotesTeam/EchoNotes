-- name: CreateJob :one
INSERT INTO jobs.transcription_jobs (sheet_id, user_id, audio_path, instrument)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetJob :one
SELECT * FROM jobs.transcription_jobs WHERE id = $1;

-- name: UpdateJobStatus :exec
UPDATE jobs.transcription_jobs
SET status = $2
WHERE id = $1;

-- name: UpdateJobProcessing :exec
UPDATE jobs.transcription_jobs
SET status = 'processing', started_at = now()
WHERE id = $1;

-- name: UpdateJobDone :exec
UPDATE jobs.transcription_jobs
SET status = 'done', finished_at = now()
WHERE id = $1;

-- name: UpdateJobFailed :exec
UPDATE jobs.transcription_jobs
SET status = 'failed', error_code = $2, error_msg = $3, finished_at = now()
WHERE id = $1;

-- name: ListStalledJobs :many
SELECT * FROM jobs.transcription_jobs
WHERE status IN ('queued', 'processing')
ORDER BY created_at ASC;

-- name: InsertJobEvent :one
INSERT INTO jobs.job_events (job_id, stage, pct, message)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListJobEvents :many
SELECT * FROM jobs.job_events
WHERE job_id = $1
ORDER BY id ASC;

-- name: CreateTranscription :one
INSERT INTO transcriptions.transcriptions (
  job_id, musicxml_path, svg_path, pdf_path, midi_path,
  key_signature, time_signature, tempo_bpm, duration_seconds, model_version
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING *;

-- name: GetTranscriptionByJob :one
SELECT * FROM transcriptions.transcriptions WHERE job_id = $1;
