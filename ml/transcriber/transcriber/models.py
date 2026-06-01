"""Pydantic v2 request/response models for the ML service.

The JSON contract between the Go orchestrator (client) and this service
is defined here and must stay in sync with ml/client.go in the Go service.
"""

from typing import Any

from pydantic import BaseModel, Field


class TranscribeOptions(BaseModel):
    """Tunable parameters forwarded to each pipeline stage."""

    onset_threshold: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Basic Pitch onset confidence threshold (0–1). "
        "Higher = fewer but more precise note onsets.",
    )
    note_threshold: float = Field(
        default=0.3,
        ge=0.0,
        le=1.0,
        description="Basic Pitch frame (note presence) confidence threshold.",
    )
    minimum_note_length: float = Field(
        default=0.058,
        ge=0.0,
        description="Minimum note duration in seconds.",
    )


class TranscribeRequest(BaseModel):
    """Body for POST /transcribe."""

    audio_path: str = Field(
        description="Absolute path to the uploaded audio file on the shared volume."
    )
    instrument_hint: str = Field(
        default="piano",
        description="'guitar' or 'piano'. Influences quantization aggressiveness "
        "and instrument label in the score.",
    )
    options: TranscribeOptions = Field(default_factory=TranscribeOptions)


class TranscribeResponse(BaseModel):
    """Successful response from POST /transcribe.

    Binary artifacts (MIDI, PDF) are base64-encoded so they can travel
    through the JSON body without a multipart upload.
    """

    midi_b64: str = Field(description="Base64-encoded Standard MIDI File (.mid).")
    music_xml: str = Field(description="MusicXML document (UTF-8 string).")
    svg: str = Field(
        description="SVG score rendered by Verovio. Single tall page "
        "(adjustPageHeight=1) suitable for web display."
    )
    pdf_b64: str = Field(
        description="Base64-encoded PDF. Empty string if PDF generation failed "
        "(pipeline still succeeds; only the download button is affected)."
    )
    key: str = Field(description="Detected key signature, e.g. 'C major', 'A minor'.")
    time_signature: str = Field(description="Detected time signature, e.g. '4/4'.")
    tempo_bpm: float = Field(description="Estimated tempo in beats per minute.")
    duration_seconds: float = Field(description="Audio duration in seconds.")
    confidence_map: dict[str, Any] = Field(
        description="Per-stage confidence statistics from Basic Pitch."
    )
    stage_timings: dict[str, float] = Field(
        description="Wall-clock time (seconds) spent in each pipeline stage."
    )


class ErrorDetail(BaseModel):
    """Error body returned on HTTP 422 (processing error) or 500."""

    error_code: str
    message: str


class HealthResponse(BaseModel):
    ok: bool
    models_loaded: list[str]


class VersionResponse(BaseModel):
    basic_pitch: str
    music21: str
    verovio: str
    service: str
