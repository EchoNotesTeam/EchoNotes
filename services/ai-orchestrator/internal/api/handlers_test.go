package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/go-playground/validator/v10"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rs/zerolog"
)

// ─── Fake DBTX ────────────────────────────────────────────────────────────────

type fakeRow struct{ scanErr error }

func (r fakeRow) Scan(_ ...any) error { return r.scanErr }

// fakeDB satisfies the Database interface (db.DBTX + Ping) with no real Postgres.
// queryRowErr controls what every QueryRow().Scan() returns, which is enough to
// drive the not-found path through the db query layer.
type fakeDB struct {
	queryRowErr error
}

func (f fakeDB) Exec(_ context.Context, _ string, _ ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, nil
}

func (f fakeDB) Query(_ context.Context, _ string, _ ...any) (pgx.Rows, error) {
	return nil, errors.New("Query not implemented in fakeDB")
}

func (f fakeDB) QueryRow(_ context.Context, _ string, _ ...any) pgx.Row {
	return fakeRow{scanErr: f.queryRowErr}
}

func (f fakeDB) Ping(_ context.Context) error { return nil }

// newTestServer builds a Server with just the fields the tested handlers touch.
func newTestServer(fake Database) *Server {
	return &Server{
		pool:     fake,
		validate: validator.New(),
		log:      zerolog.Nop(),
	}
}

// decodeErrorCode pulls error.code out of the JSON envelope the handlers write.
func decodeErrorCode(t *testing.T, body []byte) string {
	t.Helper()
	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("failed to decode error envelope: %v (body=%s)", err, body)
	}
	return env.Error.Code
}

// ─── handleCreateJob — input validation (no DB needed) ────────────────────────

func TestHandleCreateJob_InvalidJSON_Returns400(t *testing.T) {
	s := newTestServer(fakeDB{})
	r := httptest.NewRequest(http.MethodPost, "/jobs", bytes.NewBufferString("{not json"))
	w := httptest.NewRecorder()

	s.handleCreateJob(w, r)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
	if code := decodeErrorCode(t, w.Body.Bytes()); code != "INVALID_JSON" {
		t.Errorf("expected INVALID_JSON, got %q", code)
	}
}

func TestHandleCreateJob_ValidationError_Returns400(t *testing.T) {
	s := newTestServer(fakeDB{})
	// Well-formed JSON, but sheet_id/user_id are not UUIDs and the instrument is
	// not in the allowed set — go-playground/validator must reject it before any
	// DB or queue call happens.
	body := `{"sheet_id":"nope","user_id":"nope","audio_path":"/a.wav","instrument":"tuba"}`
	r := httptest.NewRequest(http.MethodPost, "/jobs", bytes.NewBufferString(body))
	w := httptest.NewRecorder()

	s.handleCreateJob(w, r)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
	if code := decodeErrorCode(t, w.Body.Bytes()); code != "VALIDATION_ERROR" {
		t.Errorf("expected VALIDATION_ERROR, got %q", code)
	}
}

// ─── handleGetJob — not found ─────────────────────────────────────────────────

func TestHandleGetJob_NotFound_Returns404(t *testing.T) {
	// QueryRow().Scan() returns ErrNoRows → GetJob errors → handler returns 404.
	s := newTestServer(fakeDB{queryRowErr: pgx.ErrNoRows})

	r := httptest.NewRequest(http.MethodGet, "/jobs/missing-id", nil)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", "missing-id")
	r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
	w := httptest.NewRecorder()

	s.handleGetJob(w, r)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
	if code := decodeErrorCode(t, w.Body.Bytes()); code != "NOT_FOUND" {
		t.Errorf("expected NOT_FOUND, got %q", code)
	}
}
