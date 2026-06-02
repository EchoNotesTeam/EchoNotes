package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/echonotes/ai-orchestrator/internal/db"
	"github.com/echonotes/ai-orchestrator/internal/jobs"
	"github.com/echonotes/ai-orchestrator/internal/ml"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-playground/validator/v10"
	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
)

// Database is the subset of *pgxpool.Pool the handlers and health check rely on.
// Declaring it as an interface lets tests inject a fake db.DBTX without a live
// Postgres connection; *pgxpool.Pool satisfies it in production.
type Database interface {
	db.DBTX
	Ping(ctx context.Context) error
}

type Server struct {
	router      chi.Router
	pool        Database
	asynqClient *asynq.Client
	pubsub      *jobs.PubSub
	mlClient    *ml.Client
	validate    *validator.Validate
	log         zerolog.Logger
}

type CreateJobRequest struct {
	SheetID    string `json:"sheet_id" validate:"required,uuid"`
	UserID     string `json:"user_id" validate:"required,uuid"`
	AudioPath  string `json:"audio_path" validate:"required"`
	Instrument string `json:"instrument" validate:"required,oneof=guitar piano"`
}

type JobStatusResponse struct {
	ID              string  `json:"id"`
	Status          string  `json:"status"`
	Stage           string  `json:"stage,omitempty"`
	Pct             int     `json:"pct,omitempty"`
	ErrorCode       *string `json:"error_code,omitempty"`
	ErrorMsg        *string `json:"error_msg,omitempty"`
	TranscriptionID *string `json:"transcription_id,omitempty"`
}

func NewServer(
	pool *pgxpool.Pool,
	asynqClient *asynq.Client,
	pubsub *jobs.PubSub,
	mlClient *ml.Client,
	internalToken string,
	log zerolog.Logger,
) *Server {
	s := &Server{
		pool:        pool,
		asynqClient: asynqClient,
		pubsub:      pubsub,
		mlClient:    mlClient,
		validate:    validator.New(),
		log:         log,
	}

	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Use(middleware.RequestID)

	// /healthz is intentionally public — the docker-compose healthcheck calls
	// this endpoint without any authentication header. Gating it with the
	// internal token would cause the AI service to never become "healthy",
	// preventing the TypeScript API from starting (depends_on: ai healthy).
	r.Get("/healthz", s.handleHealthz)

	// All other endpoints are internal-only and require the shared service token.
	r.Group(func(pr chi.Router) {
		pr.Use(InternalTokenMiddleware(internalToken))
		pr.Post("/jobs", s.handleCreateJob)
		pr.Get("/jobs/{id}", s.handleGetJob)
		pr.Get("/jobs/{id}/stream", s.handleStreamJob)
		pr.Delete("/jobs/{id}", s.handleDeleteJob)
		pr.Get("/transcriptions/{id}", s.handleGetTranscription)
	})

	s.router = r
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.router.ServeHTTP(w, r)
}

func (s *Server) handleCreateJob(w http.ResponseWriter, r *http.Request) {
	var req CreateJobRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": map[string]string{"code": "INVALID_JSON", "message": err.Error()},
		})
		return
	}

	if err := s.validate.Struct(req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": map[string]string{"code": "VALIDATION_ERROR", "message": err.Error()},
		})
		return
	}

	queries := db.New(s.pool)
	job, err := queries.CreateJob(r.Context(), req.SheetID, req.UserID, req.AudioPath, req.Instrument)
	if err != nil {
		s.log.Error().Err(err).Msg("failed to create job")
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": map[string]string{"code": "DB_ERROR", "message": "Failed to create job"},
		})
		return
	}

	payload := jobs.TranscribePayload{
		JobID:      job.ID,
		SheetID:    req.SheetID,
		UserID:     req.UserID,
		AudioPath:  req.AudioPath,
		Instrument: req.Instrument,
	}

	task, err := jobs.NewTranscribeTask(payload)
	if err != nil {
		s.log.Error().Err(err).Msg("failed to create task")
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": map[string]string{"code": "QUEUE_ERROR", "message": "Failed to enqueue job"},
		})
		return
	}

	if _, err := s.asynqClient.Enqueue(task); err != nil {
		s.log.Error().Err(err).Msg("failed to enqueue task")
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": map[string]string{"code": "QUEUE_ERROR", "message": "Failed to enqueue job"},
		})
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]any{
		"job_id": job.ID,
		"status": job.Status,
	})
}

func (s *Server) handleGetJob(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	queries := db.New(s.pool)

	job, err := queries.GetJob(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{
			"error": map[string]string{"code": "NOT_FOUND", "message": "Job not found"},
		})
		return
	}

	resp := JobStatusResponse{
		ID:        job.ID,
		Status:    job.Status,
		ErrorCode: job.ErrorCode,
		ErrorMsg:  job.ErrorMsg,
	}

	events, err := queries.ListJobEvents(r.Context(), job.ID)
	if err == nil && len(events) > 0 {
		last := events[len(events)-1]
		resp.Stage = last.Stage
		resp.Pct = int(last.Pct)
	}

	if job.Status == "done" {
		transcription, err := queries.GetTranscriptionByJob(r.Context(), job.ID)
		if err == nil {
			resp.TranscriptionID = &transcription.ID
		}
	}

	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleStreamJob(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	queries := db.New(s.pool)
	job, err := queries.GetJob(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{
			"error": map[string]string{"code": "NOT_FOUND", "message": "Job not found"},
		})
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	// If the job already reached a terminal state, replay the final event and close.
	if job.Status == "done" || job.Status == "failed" {
		var event jobs.ProgressEvent
		if job.Status == "done" {
			transcription, _ := queries.GetTranscriptionByJob(r.Context(), id)
			_ = transcription
			event = jobs.ProgressEvent{
				JobID:   id,
				SheetID: job.SheetID,
				Stage:   "done",
				Pct:     100,
				Done:    true,
			}
		} else {
			event = jobs.ProgressEvent{
				JobID:   id,
				Stage:   "failed",
				Failed:  true,
				Message: ptrToStr(job.ErrorMsg),
			}
		}
		data, _ := json.Marshal(event)
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
		return
	}

	// Replay persisted events so a late subscriber doesn't miss early stages.
	existingEvents, _ := queries.ListJobEvents(r.Context(), id)
	for _, ev := range existingEvents {
		data, _ := json.Marshal(jobs.ProgressEvent{
			JobID:   id,
			Stage:   ev.Stage,
			Pct:     int(ev.Pct),
			Message: ptrToStr(ev.Message),
		})
		fmt.Fprintf(w, "data: %s\n\n", data)
	}
	flusher.Flush()

	sub := s.pubsub.Subscribe(id)
	defer s.pubsub.Unsubscribe(id, sub)

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case event, ok := <-sub.Ch:
			if !ok {
				return
			}
			data, _ := json.Marshal(event)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
			if event.Done || event.Failed {
				return
			}
		}
	}
}

func (s *Server) handleDeleteJob(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	queries := db.New(s.pool)

	job, err := queries.GetJob(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{
			"error": map[string]string{"code": "NOT_FOUND", "message": "Job not found"},
		})
		return
	}

	if job.Status == "done" || job.Status == "failed" {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": map[string]string{"code": "INVALID_STATE", "message": "Cannot cancel a completed or failed job"},
		})
		return
	}

	if err := queries.UpdateJobFailed(r.Context(), id, "CANCELLED", "Job cancelled by user"); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": map[string]string{"code": "DB_ERROR", "message": "Failed to cancel job"},
		})
		return
	}

	_ = queries.UpdateSheetStatus(r.Context(), job.SheetID, "failed", nil)

	s.pubsub.Publish(id, jobs.ProgressEvent{
		JobID:   id,
		Failed:  true,
		Message: "Job cancelled",
	})

	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

// handleGetTranscription exposes transcription metadata so the TypeScript
// backend can look up artifact paths without direct DB access.
func (s *Server) handleGetTranscription(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	queries := db.New(s.pool)

	transcription, err := queries.GetTranscriptionByID(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{
			"error": map[string]string{"code": "NOT_FOUND", "message": "Transcription not found"},
		})
		return
	}

	writeJSON(w, http.StatusOK, transcription)
}

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	status := map[string]string{"db": "ok", "ml": "ok"}
	healthy := true

	if err := s.pool.Ping(ctx); err != nil {
		status["db"] = "unreachable"
		healthy = false
		s.log.Error().Err(err).Msg("healthz: db ping failed")
	}

	if err := s.mlClient.Healthz(); err != nil {
		status["ml"] = "unreachable"
		// ML being down doesn't mark the service as unhealthy for readiness
		// purposes — the queue will hold jobs until it recovers.
		s.log.Warn().Err(err).Msg("healthz: ml service unreachable")
	}

	code := http.StatusOK
	if !healthy {
		code = http.StatusServiceUnavailable
	}
	writeJSON(w, code, map[string]any{"ok": healthy, "services": status})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func ptrToStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
