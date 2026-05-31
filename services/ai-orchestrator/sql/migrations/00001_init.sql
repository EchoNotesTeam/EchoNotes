-- +goose Up

CREATE SCHEMA IF NOT EXISTS jobs;
CREATE SCHEMA IF NOT EXISTS transcriptions;

CREATE TABLE jobs.transcription_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id    uuid NOT NULL,
  user_id     uuid NOT NULL,
  audio_path  text NOT NULL,
  instrument  text NOT NULL,
  status      text NOT NULL DEFAULT 'queued',
  error_code  text,
  error_msg   text,
  started_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs.job_events (
  id         bigserial PRIMARY KEY,
  job_id     uuid NOT NULL REFERENCES jobs.transcription_jobs(id) ON DELETE CASCADE,
  stage      text NOT NULL,
  pct        smallint NOT NULL,
  message    text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transcriptions.transcriptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           uuid NOT NULL REFERENCES jobs.transcription_jobs(id),
  musicxml_path    text NOT NULL,
  svg_path         text NOT NULL,
  pdf_path         text NOT NULL,
  midi_path        text NOT NULL,
  key_signature    text,
  time_signature   text,
  tempo_bpm        numeric(6,2),
  duration_seconds numeric(8,2),
  model_version    text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_jobs_status ON jobs.transcription_jobs(status);
CREATE INDEX idx_jobs_sheet ON jobs.transcription_jobs(sheet_id);
CREATE INDEX idx_events_job ON jobs.job_events(job_id);
CREATE INDEX idx_transcriptions_job ON transcriptions.transcriptions(job_id);

-- +goose Down

DROP TABLE IF EXISTS transcriptions.transcriptions;
DROP TABLE IF EXISTS jobs.job_events;
DROP TABLE IF EXISTS jobs.transcription_jobs;
DROP SCHEMA IF EXISTS transcriptions;
DROP SCHEMA IF EXISTS jobs;
