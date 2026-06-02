package ml

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// ─── DecodeMIDI / DecodePDF ───────────────────────────────────────────────────

func TestDecodeMIDI_RoundTrip(t *testing.T) {
	original := []byte{0x4D, 0x54, 0x68, 0x64, 0x00, 0x01, 0x02, 0x03} // MThd...
	encoded := base64.StdEncoding.EncodeToString(original)
	got, err := DecodeMIDI(encoded)
	if err != nil {
		t.Fatalf("DecodeMIDI error: %v", err)
	}
	if string(got) != string(original) {
		t.Fatalf("want %v, got %v", original, got)
	}
}

func TestDecodePDF_RoundTrip(t *testing.T) {
	original := []byte{0x25, 0x50, 0x44, 0x46} // %PDF
	encoded := base64.StdEncoding.EncodeToString(original)
	got, err := DecodePDF(encoded)
	if err != nil {
		t.Fatalf("DecodePDF error: %v", err)
	}
	if string(got) != string(original) {
		t.Fatalf("want %v, got %v", original, got)
	}
}

func TestDecodeMIDI_EmptyString(t *testing.T) {
	got, err := DecodeMIDI("")
	if err != nil {
		t.Fatalf("unexpected error for empty string: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("expected empty slice, got %v", got)
	}
}

func TestDecodeMIDI_InvalidBase64(t *testing.T) {
	_, err := DecodeMIDI("!!! not base64 !!!")
	if err == nil {
		t.Fatal("expected error for invalid base64, got nil")
	}
}

// ─── parseTranscribeStream (SSE) ──────────────────────────────────────────────

func TestParseTranscribeStream_ProgressThenResult(t *testing.T) {
	sse := "event: progress\ndata: {\"stage\":\"quantize\",\"pct\":60,\"message\":\"snapping\"}\n\n" +
		"event: result\ndata: {\"key\":\"G major\",\"tempo_bpm\":90}\n\n"

	var stages []string
	res, err := parseTranscribeStream(strings.NewReader(sse), func(stage string, _ int, _ string) {
		stages = append(stages, stage)
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Key != "G major" || res.TempoBPM != 90 {
		t.Errorf("unexpected result: %+v", res)
	}
	if len(stages) != 1 || stages[0] != "quantize" {
		t.Errorf("expected one progress event for stage 'quantize', got %v", stages)
	}
}

func TestParseTranscribeStream_ErrorEvent(t *testing.T) {
	sse := "event: error\ndata: {\"error_code\":\"MODEL_FAILURE\",\"message\":\"boom\"}\n\n"
	_, err := parseTranscribeStream(strings.NewReader(sse), nil)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	want := "ml error [MODEL_FAILURE]: boom"
	if err.Error() != want {
		t.Errorf("want %q, got %q", want, err.Error())
	}
}

func TestParseTranscribeStream_NoResult(t *testing.T) {
	sse := "event: progress\ndata: {\"stage\":\"transcribe\",\"pct\":10}\n\n"
	_, err := parseTranscribeStream(strings.NewReader(sse), nil)
	if err == nil {
		t.Fatal("expected error for a stream that never sends a result event, got nil")
	}
}

func TestParseTranscribeStream_MalformedResult(t *testing.T) {
	sse := "event: result\ndata: {invalid json\n\n"
	_, err := parseTranscribeStream(strings.NewReader(sse), nil)
	if err == nil {
		t.Fatal("expected unmarshal error for malformed result, got nil")
	}
}

// ─── Transcribe — end-to-end over httptest ────────────────────────────────────

func TestTranscribe_SSESuccess(t *testing.T) {
	midiB64 := base64.StdEncoding.EncodeToString([]byte{0x4D, 0x54, 0x68, 0x64})
	result := TranscribeResponse{
		MidiB64:       midiB64,
		MusicXML:      "<score-partwise/>",
		Key:           "C major",
		TimeSignature: "4/4",
		TempoBPM:      120.0,
	}
	resultJSON, _ := json.Marshal(result)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/transcribe" {
			http.Error(w, "unexpected request", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "event: progress\ndata: {\"stage\":\"transcribe\",\"pct\":40}\n\n")
		fmt.Fprintf(w, "event: result\ndata: %s\n\n", resultJSON)
	}))
	defer srv.Close()

	var progress []int
	client := NewClient(srv.URL)
	got, err := client.Transcribe("/audio/test.wav", "piano", func(_ string, pct int, _ string) {
		progress = append(progress, pct)
	})
	if err != nil {
		t.Fatalf("Transcribe error: %v", err)
	}
	if got.Key != "C major" {
		t.Errorf("Key: want 'C major', got %q", got.Key)
	}
	if got.MidiB64 != midiB64 {
		t.Errorf("MidiB64 mismatch")
	}
	if len(progress) != 1 || progress[0] != 40 {
		t.Errorf("expected one progress event with pct=40, got %v", progress)
	}
}

// A non-200 status means the ML service rejected the request before streaming;
// the body is a plain JSON error, not SSE.
func TestTranscribe_Non200Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnprocessableEntity)
		_, _ = w.Write([]byte(`{"error_code":"FILE_NOT_FOUND","message":"Audio file not found: /missing.wav"}`))
	}))
	defer srv.Close()

	client := NewClient(srv.URL)
	_, err := client.Transcribe("/missing.wav", "guitar", nil)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	want := "ml error [FILE_NOT_FOUND]: Audio file not found: /missing.wav"
	if err.Error() != want {
		t.Errorf("want %q, got %q", want, err.Error())
	}
}

func TestTranscribe_ServerDown(t *testing.T) {
	// Point to a port nothing is listening on.
	client := NewClient("http://127.0.0.1:19999")
	_, err := client.Transcribe("/audio/test.wav", "piano", nil)
	if err == nil {
		t.Fatal("expected connection error, got nil")
	}
}

// ─── Healthz ─────────────────────────────────────────────────────────────────

func TestHealthz_OK(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/healthz" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	client := NewClient(srv.URL)
	if err := client.Healthz(); err != nil {
		t.Fatalf("Healthz error: %v", err)
	}
}

func TestHealthz_ServiceUnavailable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	client := NewClient(srv.URL)
	if err := client.Healthz(); err == nil {
		t.Fatal("expected error for 503, got nil")
	}
}
