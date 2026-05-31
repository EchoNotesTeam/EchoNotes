package ml

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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
	MidiB64       string         `json:"midi_b64"`
	MusicXML      string         `json:"music_xml"`
	SVG           string         `json:"svg"`
	PdfB64        string         `json:"pdf_b64"`
	Key           string         `json:"key"`
	TimeSignature string         `json:"time_signature"`
	TempoBPM      float64        `json:"tempo_bpm"`
	ConfidenceMap map[string]any `json:"confidence_map"`
	StageTimings  map[string]any `json:"stage_timings"`
}

type ErrorResponse struct {
	ErrorCode string `json:"error_code"`
	Message   string `json:"message"`
}

func (c *Client) Transcribe(audioPath, instrument string) (*TranscribeResponse, error) {
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

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		var errResp ErrorResponse
		if jsonErr := json.Unmarshal(respBody, &errResp); jsonErr == nil && errResp.ErrorCode != "" {
			return nil, fmt.Errorf("ml error [%s]: %s", errResp.ErrorCode, errResp.Message)
		}
		return nil, fmt.Errorf("ml service returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result TranscribeResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("unmarshal response: %w", err)
	}

	return &result, nil
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
