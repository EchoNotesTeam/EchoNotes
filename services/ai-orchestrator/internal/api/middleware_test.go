package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// nextHandler is a trivial http.Handler that records whether it was called.
type nextHandler struct{ called bool }

func (h *nextHandler) ServeHTTP(w http.ResponseWriter, _ *http.Request) {
	h.called = true
	w.WriteHeader(http.StatusOK)
}

func applyMiddleware(token string, r *http.Request) (*httptest.ResponseRecorder, *nextHandler) {
	next := &nextHandler{}
	w := httptest.NewRecorder()
	InternalTokenMiddleware(token)(next).ServeHTTP(w, r)
	return w, next
}

func newRequest(header, value string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	if header != "" {
		r.Header.Set(header, value)
	}
	return r
}

// ─── Correct token ────────────────────────────────────────────────────────────

func TestMiddleware_CorrectToken_PassesThrough(t *testing.T) {
	const secret = "super-secret-token-32-bytes-long"
	r := newRequest("X-Internal-Token", secret)
	w, next := applyMiddleware(secret, r)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	if !next.called {
		t.Error("expected next handler to be called")
	}
}

// ─── Wrong token ─────────────────────────────────────────────────────────────

func TestMiddleware_WrongToken_Returns401(t *testing.T) {
	r := newRequest("X-Internal-Token", "wrong-token")
	w, next := applyMiddleware("correct-token", r)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
	if next.called {
		t.Error("next handler must NOT be called on rejected token")
	}
}

// ─── Missing token header ─────────────────────────────────────────────────────

func TestMiddleware_MissingToken_Returns401(t *testing.T) {
	r := newRequest("", "") // no X-Internal-Token header
	w, next := applyMiddleware("some-token", r)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
	if next.called {
		t.Error("next handler must NOT be called when token is missing")
	}
}

// ─── Empty server token (misconfiguration) ────────────────────────────────────

func TestMiddleware_EmptyServerToken_Returns500(t *testing.T) {
	// When the server is misconfigured with an empty token, every request
	// must be rejected with 500 so the operator is alerted immediately.
	r := newRequest("X-Internal-Token", "")
	w, next := applyMiddleware("", r) // both empty

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500 for misconfigured empty token, got %d", w.Code)
	}
	if next.called {
		t.Error("next handler must NOT be called when server token is empty")
	}
}

// ─── Timing safety (constant-time compare) ───────────────────────────────────

func TestMiddleware_SimilarTokens_Rejected(t *testing.T) {
	// Ensure that a token differing only in the last byte is still rejected.
	token := "abcdefghijklmnopqrstuvwxyz123456"
	almostRight := "abcdefghijklmnopqrstuvwxyz12345X"

	r := newRequest("X-Internal-Token", almostRight)
	w, _ := applyMiddleware(token, r)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for near-match token, got %d", w.Code)
	}
}
