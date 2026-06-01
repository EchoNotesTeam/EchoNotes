package ml

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Client struct {
	baseURL    string
	httpClient *http.Client
}

func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 10 * time.Minute,
		},
	}
}

type TranscribeRequest struct {
	AudioPath      string `json:"audio_path"`
	InstrumentHint string `json:"instrument_hint"`
	Options        any    `json:"options,omitempty"`
}

// TranscribeResponse is the JSON contract with the Python ML service.
// Binary artifacts (MIDI, PDF) are base64-encoded so they can be
// transported safely in a JSON response body.
type TranscribeResponse struct {
	MidiB64         string         `json:"midi_b64"`
	MusicXML        string         `json:"music_xml"`
	SVG             string         `json:"svg"`
	PdfB64          string         `json:"pdf_b64"`
	Key             string         `json:"key"`
	TimeSignature   string         `json:"time_signature"`
	TempoBPM        float64        `json:"tempo_bpm"`
	DurationSeconds float64        `json:"duration_seconds"`
	ConfidenceMap   map[string]any `json:"confidence_map"`
	StageTimings    map[string]any `json:"stage_timings"`
}

type ErrorResponse struct {
	ErrorCode string `json:"error_code"`
	Message   string `json:"message"`
}

// Transcribe sends the audio to the ML service and consumes its SSE response.
// Each `event: progress` is forwarded to onProgress (which may be nil); the
// payload carried by the terminal `event: result` is returned.
func (c *Client) Transcribe(
	audioPath, instrument string,
	onProgress func(stage string, pct int, message string),
) (*TranscribeResponse, error) {
	reqBody := TranscribeRequest{
		AudioPath:      audioPath,
		InstrumentHint: instrument,
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, c.baseURL+"/transcribe", bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	// A non-200 status means the ML service rejected the request before any
	// streaming began (e.g. FastAPI request-validation 422). The body is a
	// plain JSON error in that case, not an SSE stream.
	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		var errResp ErrorResponse
		if json.Unmarshal(respBody, &errResp) == nil && errResp.ErrorCode != "" {
			return nil, fmt.Errorf("ml error [%s]: %s", errResp.ErrorCode, errResp.Message)
		}
		return nil, fmt.Errorf("ml service returned %d: %s", resp.StatusCode, string(respBody))
	}

	return parseTranscribeStream(resp.Body, onProgress)
}

// parseTranscribeStream reads the SSE stream from POST /transcribe. It uses a
// bufio.Reader (not a Scanner) because the `result` data line carries the full
// MusicXML + SVG + base64 artifacts and can far exceed the Scanner token limit.
func parseTranscribeStream(
	body io.Reader,
	onProgress func(stage string, pct int, message string),
) (*TranscribeResponse, error) {
	reader := bufio.NewReader(body)
	var currentEvent string
	var result *TranscribeResponse
	var streamErr *ErrorResponse

	for {
		line, readErr := reader.ReadString('\n')

		if trimmed := strings.TrimRight(line, "\r\n"); trimmed != "" {
			switch {
			case strings.HasPrefix(trimmed, "event:"):
				currentEvent = strings.TrimSpace(trimmed[len("event:"):])
			case strings.HasPrefix(trimmed, "data:"):
				data := strings.TrimSpace(trimmed[len("data:"):])
				switch currentEvent {
				case "progress":
					var ev struct {
						Stage   string `json:"stage"`
						Pct     int    `json:"pct"`
						Message string `json:"message"`
					}
					if json.Unmarshal([]byte(data), &ev) == nil && onProgress != nil {
						onProgress(ev.Stage, ev.Pct, ev.Message)
					}
				case "result":
					var r TranscribeResponse
					if err := json.Unmarshal([]byte(data), &r); err != nil {
						return nil, fmt.Errorf("unmarshal result event: %w", err)
					}
					result = &r
				case "error":
					var er ErrorResponse
					_ = json.Unmarshal([]byte(data), &er)
					streamErr = &er
				}
			}
		}

		if readErr != nil {
			if readErr == io.EOF {
				break
			}
			return nil, fmt.Errorf("read sse stream: %w", readErr)
		}
	}

	if streamErr != nil {
		return nil, fmt.Errorf("ml error [%s]: %s", streamErr.ErrorCode, streamErr.Message)
	}
	if result == nil {
		return nil, fmt.Errorf("ml stream ended without a result event")
	}
	return result, nil
}

func (c *Client) Healthz() error {
	resp, err := c.httpClient.Get(c.baseURL + "/healthz")
	if err != nil {
		return fmt.Errorf("ml healthz: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("ml healthz returned %d", resp.StatusCode)
	}
	return nil
}

func DecodeMIDI(b64 string) ([]byte, error) {
	return base64.StdEncoding.DecodeString(b64)
}

func DecodePDF(b64 string) ([]byte, error) {
	return base64.StdEncoding.DecodeString(b64)
}
