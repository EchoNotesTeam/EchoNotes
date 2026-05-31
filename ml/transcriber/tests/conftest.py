"""Pytest fixtures shared across the test suite.

Generates synthetic audio files instead of depending on real audio so that
tests run without any external dataset.
"""

from __future__ import annotations

import math
import struct
import wave
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Audio fixtures
# ---------------------------------------------------------------------------


def _write_wav(path: Path, samples: np.ndarray, sr: int) -> None:
    """Write a float32 numpy array as a 16-bit PCM WAV file."""
    int_samples = (samples * 32767).clip(-32768, 32767).astype(np.int16)
    with wave.open(str(path), "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sr)
        wf.writeframes(int_samples.tobytes())


@pytest.fixture(scope="session")
def piano_c_major_wav(tmp_path_factory) -> str:
    """A 4-second recording of a C-major arpeggio (C4, E4, G4, C5).

    Pitches: MIDI 60, 64, 67, 72. Each note lasts ~0.9 s with a
    small silence gap so Basic Pitch can distinguish onset events.
    The signal is synthesised as pure sinusoids — Basic Pitch handles
    pure tones well for functional testing.
    """
    sr = 22050
    note_dur = 0.9
    gap_dur = 0.1
    pitches_midi = [60, 64, 67, 72]  # C4, E4, G4, C5

    def midi_to_hz(m: int) -> float:
        return 440.0 * (2.0 ** ((m - 69) / 12.0))

    audio = []
    for pitch in pitches_midi:
        freq = midi_to_hz(pitch)
        t = np.linspace(0.0, note_dur, int(sr * note_dur), endpoint=False)
        # Simple ADSR envelope (attack 10ms, decay 50ms, sustain 0.7, release 40ms)
        env = _adsr_envelope(len(t), sr, attack_ms=10, decay_ms=50, sustain=0.7, release_ms=40)
        note = (0.5 * np.sin(2.0 * math.pi * freq * t) * env).astype(np.float32)
        audio.append(note)
        audio.append(np.zeros(int(sr * gap_dur), dtype=np.float32))

    samples = np.concatenate(audio)
    tmp_dir = tmp_path_factory.mktemp("audio")
    path = tmp_dir / "piano_c_major.wav"
    _write_wav(path, samples, sr)
    return str(path)


@pytest.fixture(scope="session")
def guitar_e_minor_wav(tmp_path_factory) -> str:
    """A 3-second recording of an E-minor chord (E2, B2, E3, G3).

    Guitar-range pitches: MIDI 40, 47, 52, 55.
    """
    sr = 22050
    note_dur = 0.7
    gap_dur = 0.1
    pitches_midi = [40, 47, 52, 55]

    def midi_to_hz(m: int) -> float:
        return 440.0 * (2.0 ** ((m - 69) / 12.0))

    audio = []
    for pitch in pitches_midi:
        freq = midi_to_hz(pitch)
        t = np.linspace(0.0, note_dur, int(sr * note_dur), endpoint=False)
        env = _adsr_envelope(len(t), sr, attack_ms=5, decay_ms=80, sustain=0.5, release_ms=60)
        # Add a slight harmonic to make the tone less pure (closer to guitar).
        note = (0.4 * np.sin(2.0 * math.pi * freq * t) +
                0.1 * np.sin(2.0 * math.pi * 2 * freq * t)) * env
        audio.append(note.astype(np.float32))
        audio.append(np.zeros(int(sr * gap_dur), dtype=np.float32))

    samples = np.concatenate(audio)
    tmp_dir = tmp_path_factory.mktemp("audio")
    path = tmp_dir / "guitar_e_minor.wav"
    _write_wav(path, samples, sr)
    return str(path)


def _adsr_envelope(
    n: int,
    sr: int,
    attack_ms: float,
    decay_ms: float,
    sustain: float,
    release_ms: float,
) -> np.ndarray:
    a = min(int(sr * attack_ms / 1000), n)
    d = min(int(sr * decay_ms / 1000), n - a)
    r = min(int(sr * release_ms / 1000), n - a - d)
    s = n - a - d - r

    env = np.zeros(n, dtype=np.float32)
    if a > 0:
        env[:a] = np.linspace(0.0, 1.0, a)
    if d > 0:
        env[a : a + d] = np.linspace(1.0, sustain, d)
    if s > 0:
        env[a + d : a + d + s] = sustain
    if r > 0:
        env[a + d + s :] = np.linspace(sustain, 0.0, r)
    return env


# ---------------------------------------------------------------------------
# FastAPI test client
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def test_client() -> TestClient:
    """FastAPI TestClient with models pre-loaded."""
    from transcriber.app import app
    from transcriber.pipeline import transcribe as transcribe_stage

    transcribe_stage.load_model()
    return TestClient(app)
