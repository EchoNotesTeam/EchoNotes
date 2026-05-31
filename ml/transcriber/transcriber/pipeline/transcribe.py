"""Stage 1 — Audio → MIDI note events via Basic Pitch.

Basic Pitch is a polyphonic pitch transcription model from Spotify.
It uses a TensorFlow model trained on the MAESTRO piano dataset and
generalizes reasonably well to guitar recordings.

Reference: Bitteur et al., "A Lightweight Instrument-Agnostic Model for
Polyphonic Note Transcription and Multipitch Estimation", ICASSP 2022.
"""

from __future__ import annotations

import time
from typing import Any

import numpy as np
import pretty_midi
import structlog

logger = structlog.get_logger()

# Module-level model reference — loaded once at startup, reused forever.
_model = None


def load_model() -> None:
    """Load the Basic Pitch TensorFlow model into memory.

    Must be called before any call to run(). This is intentionally
    done at service startup (lifespan hook) so that the first request
    does not pay the ~5 s cold-start cost.
    """
    global _model
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import Model

    logger.info("loading_basic_pitch_model", path=str(ICASSP_2022_MODEL_PATH))
    _model = Model(ICASSP_2022_MODEL_PATH)
    logger.info("basic_pitch_model_loaded")


def models_loaded() -> list[str]:
    """Return a list of model names that are currently in memory."""
    return ["basic_pitch"] if _model is not None else []


def run(
    audio_path: str,
    instrument_hint: str,
    options: dict[str, Any],
) -> tuple[pretty_midi.PrettyMIDI, dict[str, Any], float]:
    """Transcribe audio to MIDI using Basic Pitch.

    Args:
        audio_path: Absolute path to the audio file (wav/mp3/flac/etc.).
        instrument_hint: 'guitar' or 'piano' — influences onset thresholds.
        options: Dict from TranscribeOptions.model_dump().

    Returns:
        Tuple of (midi_data, confidence_map, elapsed_seconds).

    Raises:
        RuntimeError: If load_model() has not been called.
        ValueError:   If no notes are detected in the audio.
    """
    if _model is None:
        raise RuntimeError("Basic Pitch model not loaded. Call load_model() at startup.")

    from basic_pitch.inference import predict

    t_start = time.perf_counter()

    # Instrument-specific threshold adjustments.
    # Guitar has more attack transients → lower onset_threshold helps.
    # Piano has cleaner envelopes → defaults work well.
    onset_threshold: float = options.get("onset_threshold", 0.5)
    frame_threshold: float = options.get("note_threshold", 0.3)
    min_note_len: float = options.get("minimum_note_length", 0.058)

    if instrument_hint == "guitar":
        onset_threshold = max(0.3, onset_threshold - 0.1)

    model_output, midi_data, note_events = predict(
        audio_path,
        _model,
        onset_threshold=onset_threshold,
        frame_threshold=frame_threshold,
        minimum_note_length=min_note_len,
        # Start with a neutral tempo; librosa will compute the real BPM in stage 2.
        midi_tempo=120.0,
    )

    if not note_events:
        raise ValueError(
            "No notes detected. Please upload a clear solo recording "
            "(single instrument, no silence longer than the full file)."
        )

    elapsed = time.perf_counter() - t_start

    # Build confidence statistics for the response payload.
    amplitudes = [float(e[3]) for e in note_events]
    pitches = [int(e[2]) for e in note_events]

    # Basic Pitch model output includes "note" (frame-level activations).
    note_frame_activations = model_output.get("note", np.array([]))
    mean_frame_conf = (
        float(np.mean(note_frame_activations))
        if note_frame_activations.size > 0
        else None
    )

    confidence_map: dict[str, Any] = {
        "note_count": len(note_events),
        "mean_amplitude": round(float(np.mean(amplitudes)), 4),
        "pitch_range_midi": [min(pitches), max(pitches)],
    }
    if mean_frame_conf is not None:
        confidence_map["mean_frame_confidence"] = round(mean_frame_conf, 4)

    return midi_data, confidence_map, elapsed
