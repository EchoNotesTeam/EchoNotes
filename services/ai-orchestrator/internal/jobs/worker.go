package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/echonotes/ai-orchestrator/internal/db"
	"github.com/echonotes/ai-orchestrator/internal/ml"
	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
)

const TaskTypeTranscribe = "transcribe"

type TranscribePayload struct {
	JobID      string `json:"job_id"`
	SheetID    string `json:"sheet_id"`
	UserID     string `json:"user_id"`
	AudioPath  string `json:"audio_path"`
	Instrument string `json:"instrument"`
}

func NewTranscribeTask(payload TranscribePayload) (*asynq.Task, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	// Use the job UUID as the asynq task ID so the inspector can cancel it.
	return asynq.NewTask(TaskTypeTranscribe, data, asynq.TaskID(payload.JobID)), nil
}

type Worker struct {
	pool         *pgxpool.Pool
	mlClient     *ml.Client
	pubsub       *PubSub
	artifactRoot string
	log          zerolog.Logger
}

func NewWorker(pool *pgxpool.Pool, mlClient *ml.Client, pubsub *PubSub, artifactRoot string, log zerolog.Logger) *Worker {
	return &Worker{
		pool:         pool,
		mlClient:     mlClient,
		pubsub:       pubsub,
		artifactRoot: artifactRoot,
		log:          log,
	}
}

func (w *Worker) HandleTranscribe(ctx context.Context, t *asynq.Task) error {
	var payload TranscribePayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	queries := db.New(w.pool)
	log := w.log.With().Str("job_id", payload.JobID).Logger()

	// Guard: skip if the job was cancelled while it was queued.
	job, err := queries.GetJob(ctx, payload.JobID)
	if err != nil {
		log.Error().Err(err).Msg("job not found in DB, skipping")
		return nil
	}
	if job.Status == "failed" {
		log.Info().Msg("job was cancelled before pickup, skipping")
		return nil
	}

	if err := queries.UpdateJobProcessing(ctx, payload.JobID); err != nil {
		log.Error().Err(err).Msg("failed to update job to processing")
		return err
	}

	w.emitProgress(payload.JobID, payload.SheetID, "processing", 5, "Starting transcription pipeline")

	if err := queries.UpdateSheetStatus(ctx, payload.SheetID, "processing", nil); err != nil {
		log.Error().Err(err).Msg("failed to update sheet status to processing")
	}

	// The ML service streams a progress event per pipeline stage over SSE;
	// forward each one straight through to the job's subscribers.
	result, err := w.mlClient.Transcribe(payload.AudioPath, payload.Instrument,
		func(stage string, pct int, message string) {
			w.emitProgress(payload.JobID, payload.SheetID, stage, pct, message)
		},
	)
	if err != nil {
		log.Error().Err(err).Msg("ML transcription failed")
		_ = queries.UpdateJobFailed(ctx, payload.JobID, "ML_ERROR", err.Error())
		_ = queries.UpdateSheetStatus(ctx, payload.SheetID, "failed", nil)
		w.pubsub.Publish(payload.JobID, ProgressEvent{
			JobID:   payload.JobID,
			SheetID: payload.SheetID,
			Stage:   "failed",
			Failed:  true,
			Message: err.Error(),
		})
		return nil
	}

	w.emitProgress(payload.JobID, payload.SheetID, "saving", 70, "Saving artifacts to disk")

	// Pre-generate the transcription UUID and use it as the artifact directory
	// name. This guarantees that ARTIFACT_ROOT/artifacts/{transcriptionId}
	// resolves correctly from both the Go service and the TypeScript API,
	// since the sheet record stores this exact UUID in transcription_id.
	transcriptionID := uuid.New().String()
	artifactDir := filepath.Join(w.artifactRoot, "artifacts", transcriptionID)
	if err := os.MkdirAll(artifactDir, 0o755); err != nil {
		log.Error().Err(err).Msg("failed to create artifact directory")
		_ = queries.UpdateJobFailed(ctx, payload.JobID, "FS_ERROR", err.Error())
		_ = queries.UpdateSheetStatus(ctx, payload.SheetID, "failed", nil)
		w.pubsub.Publish(payload.JobID, ProgressEvent{JobID: payload.JobID, Failed: true})
		return nil
	}

	musicxmlPath := filepath.Join(artifactDir, "score.musicxml")
	if err := os.WriteFile(musicxmlPath, []byte(result.MusicXML), 0o644); err != nil {
		return w.failJob(ctx, queries, payload, "FS_ERROR", err)
	}

	svgPath := filepath.Join(artifactDir, "score.svg")
	if err := os.WriteFile(svgPath, []byte(result.SVG), 0o644); err != nil {
		return w.failJob(ctx, queries, payload, "FS_ERROR", err)
	}

	pdfBytes, err := ml.DecodePDF(result.PdfB64)
	if err != nil {
		return w.failJob(ctx, queries, payload, "DECODE_ERROR", err)
	}
	pdfPath := filepath.Join(artifactDir, "score.pdf")
	if err := os.WriteFile(pdfPath, pdfBytes, 0o644); err != nil {
		return w.failJob(ctx, queries, payload, "FS_ERROR", err)
	}

	midiBytes, err := ml.DecodeMIDI(result.MidiB64)
	if err != nil {
		return w.failJob(ctx, queries, payload, "DECODE_ERROR", err)
	}
	midiPath := filepath.Join(artifactDir, "notes.midi")
	if err := os.WriteFile(midiPath, midiBytes, 0o644); err != nil {
		return w.failJob(ctx, queries, payload, "FS_ERROR", err)
	}

	w.emitProgress(payload.JobID, payload.SheetID, "persisting", 90, "Saving transcription metadata")

	keySig := result.Key
	timeSig := result.TimeSignature
	tempo := result.TempoBPM

	transcription, err := queries.CreateTranscription(ctx, db.CreateTranscriptionParams{
		ID:            transcriptionID,
		JobID:         payload.JobID,
		MusicxmlPath:  musicxmlPath,
		SvgPath:       svgPath,
		PdfPath:       pdfPath,
		MidiPath:      midiPath,
		KeySignature:  &keySig,
		TimeSignature: &timeSig,
		TempoBpm:      &tempo,
		ModelVersion:  "basic-pitch-v1",
	})
	if err != nil {
		log.Error().Err(err).Msg("failed to create transcription record")
		_ = queries.UpdateJobFailed(ctx, payload.JobID, "DB_ERROR", err.Error())
		_ = queries.UpdateSheetStatus(ctx, payload.SheetID, "failed", nil)
		w.pubsub.Publish(payload.JobID, ProgressEvent{JobID: payload.JobID, Failed: true})
		return nil
	}

	if err := queries.UpdateJobDone(ctx, payload.JobID); err != nil {
		log.Error().Err(err).Msg("failed to mark job done")
	}

	if err := queries.UpdateSheetStatus(ctx, payload.SheetID, "ready", &transcription.ID); err != nil {
		log.Error().Err(err).Msg("failed to update sheet status to ready")
	}

	w.emitProgress(payload.JobID, payload.SheetID, "done", 100, "Transcription complete")
	w.pubsub.Publish(payload.JobID, ProgressEvent{
		JobID:   payload.JobID,
		SheetID: payload.SheetID,
		Stage:   "done",
		Pct:     100,
		Done:    true,
	})

	log.Info().Str("transcription_id", transcription.ID).Msg("transcription completed successfully")
	return nil
}

func (w *Worker) failJob(ctx context.Context, queries *db.Queries, payload TranscribePayload, code string, err error) error {
	w.log.Error().Err(err).Str("code", code).Msg("job failed")
	_ = queries.UpdateJobFailed(ctx, payload.JobID, code, err.Error())
	_ = queries.UpdateSheetStatus(ctx, payload.SheetID, "failed", nil)
	w.pubsub.Publish(payload.JobID, ProgressEvent{
		JobID:   payload.JobID,
		SheetID: payload.SheetID,
		Failed:  true,
		Message: err.Error(),
	})
	return nil
}

func (w *Worker) emitProgress(jobID, sheetID, stage string, pct int, message string) {
	queries := db.New(w.pool)
	msg := message
	_, _ = queries.InsertJobEvent(context.Background(), jobID, stage, int16(pct), &msg)

	w.pubsub.Publish(jobID, ProgressEvent{
		JobID:   jobID,
		SheetID: sheetID,
		Stage:   stage,
		Pct:     pct,
		Message: message,
	})
}

func (w *Worker) RecoverStalledJobs(ctx context.Context, client *asynq.Client) error {
	queries := db.New(w.pool)
	stalled, err := queries.ListStalledJobs(ctx)
	if err != nil {
		return fmt.Errorf("list stalled jobs: %w", err)
	}

	for _, job := range stalled {
		w.log.Warn().Str("job_id", job.ID).Str("status", job.Status).Msg("recovering stalled job")

		payload := TranscribePayload{
			JobID:      job.ID,
			SheetID:    job.SheetID,
			UserID:     job.UserID,
			AudioPath:  job.AudioPath,
			Instrument: job.Instrument,
		}

		task, err := NewTranscribeTask(payload)
		if err != nil {
			w.log.Error().Err(err).Str("job_id", job.ID).Msg("failed to create recovery task")
			_ = queries.UpdateJobFailed(ctx, job.ID, "RECOVERY_ERROR", err.Error())
			continue
		}

		if _, err := client.Enqueue(task); err != nil {
			w.log.Error().Err(err).Str("job_id", job.ID).Msg("failed to re-enqueue stalled job")
			_ = queries.UpdateJobFailed(ctx, job.ID, "RECOVERY_ERROR", err.Error())
		}
	}

	return nil
}
