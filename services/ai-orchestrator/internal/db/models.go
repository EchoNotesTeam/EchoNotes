package db

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type DBTX interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgtype.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type Queries struct {
	db DBTX
}

func New(db DBTX) *Queries {
	return &Queries{db: db}
}

type TranscriptionJob struct {
	ID         string     `json:"id"`
	SheetID    string     `json:"sheet_id"`
	UserID     string     `json:"user_id"`
	AudioPath  string     `json:"audio_path"`
	Instrument string     `json:"instrument"`
	Status     string     `json:"status"`
	ErrorCode  *string    `json:"error_code"`
	ErrorMsg   *string    `json:"error_msg"`
	StartedAt  *time.Time `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at"`
	CreatedAt  time.Time  `json:"created_at"`
}

type JobEvent struct {
	ID        int64     `json:"id"`
	JobID     string    `json:"job_id"`
	Stage     string    `json:"stage"`
	Pct       int16     `json:"pct"`
	Message   *string   `json:"message"`
	CreatedAt time.Time `json:"created_at"`
}

type Transcription struct {
	ID              string    `json:"id"`
	JobID           string    `json:"job_id"`
	MusicxmlPath    string    `json:"musicxml_path"`
	SvgPath         string    `json:"svg_path"`
	PdfPath         string    `json:"pdf_path"`
	MidiPath        string    `json:"midi_path"`
	KeySignature    *string   `json:"key_signature"`
	TimeSignature   *string   `json:"time_signature"`
	TempoBpm        *float64  `json:"tempo_bpm"`
	DurationSeconds *float64  `json:"duration_seconds"`
	ModelVersion    string    `json:"model_version"`
	CreatedAt       time.Time `json:"created_at"`
}
