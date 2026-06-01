package ml

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

// ─── Transcribe — success path ────────────────────────────────────────────────

func TestTranscribe_SuccessResponse(t *testing.T) {
	midiB64 := base64.StdEncoding.EncodeToString([]byte{0x4D, 0x54, 0x68, 0x64})
	pdfB64 := base64.StdEncoding.EncodeToString([]byte{0x25, 0x50, 0x44, 0x46})

	fakeResp := TranscribeResponse{
		MidiB64:       midiB64,
		MusicXML:      "<score-partwise/>",
		SVG:           "<svg/>",
		PdfB64:        pdfB64,
		Key:           "C major",
		TimeSignature: "4/4",
		TempoBPM:      120.0,
		ConfidenceMap: map[string]any{"note_count": float64(42)},
		StageTimings:  map[string]any{"transcribe_s": float64(1.2)},
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/transcribe" {
			http.Error(w, "unexpected request", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(fakeResp)
	}))
	defer srv.Close()

	client := NewClient(srv.URL)
	result, err := client.Transcribe("/audio/test.wav", "piano")
	if err != nil {
		t.Fatalf("Transcribe error: %v", err)
	}
	if result.Key != "C major" {
		t.Errorf("Key: want 'C major', got %q", result.Key)
	}
	if result.TempoBPM != 120.0 {
		t.Errorf("TempoBPM: want 120.0, got %f", result.TempoBPM)
	}
	if result.MidiB64 != midiB64 {
		t.Errorf("MidiB64 mismatch")
	}
}

// ─── Transcribe — FastAPI error response ─────────────────────────────────────

func TestTranscribe_FastAPIError422(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnprocessableEntity)
		// FastAPI wraps errors inside "detail"
		_, _ = w.Write([]byte(`{"detail":{"error_code":"FILE_NOT_FOUND","message":"Audio file not found: /missing.wav"}}`))
	}))
	defer srv.Close()

	client := NewClient(srv.URL)
	_, err := client.Transcribe("/missing.wav", "guitar")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	want := "ml error [FILE_NOT_FOUND]: Audio file not found: /missing.wav"
	if err.Error() != want {
		t.Errorf("want %q, got %q", want, err.Error())
	}
}

func TestTranscribe_ServerDown(t *testing.T) {
	// Point to a port nothing is listening on
	client := NewClient("http://127.0.0.1:19999")
	_, err := client.Transcribe("/audio/test.wav", "piano")
	if err == nil {
		t.Fatal("expected connection error, got nil")
	}
}

func TestTranscribe_MalformedJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{invalid json`))
	}))
	defer srv.Close()

	client := NewClient(srv.URL)
	_, err := client.Transcribe("/audio/test.wav", "piano")
	if err == nil {
		t.Fatal("expected JSON parse error, got nil")
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
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	client := NewClient(srv.URL)
	if err := client.Healthz(); err == nil {
		t.Fatal("expected error for 503, got nil")
	}
}
