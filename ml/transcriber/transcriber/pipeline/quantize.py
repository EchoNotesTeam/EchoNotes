"""Stage 2 — Rhythmic quantization via librosa beat tracking.

Without quantization, Basic Pitch produces notes with continuous timing
offsets (e.g. onset at 1.372 s). music21 would then generate notation with
bizarre fractional durations (e.g. 73/512 quarter notes) that is completely
unreadable as sheet music.

This stage:
  1. Estimates tempo (BPM) and beat positions using librosa.
  2. Builds a 16th-note (or finer/coarser depending on tempo) subdivision grid.
  3. Snaps every note onset and offset to the nearest grid point.
  4. Estimates the time signature (heuristic — defaults to 4/4).

The result is a PrettyMIDI object with note timings aligned to the beat
grid, which music21 can convert to clean, readable sheet music.
"""

from __future__ import annotations

import time

import numpy as np
import pretty_midi
import structlog

logger = structlog.get_logger()


def run(
    midi_data: pretty_midi.PrettyMIDI,
    audio_path: str,
    instrument_hint: str,  # noqa: ARG001 — reserved for future instrument-specific logic
) -> tuple[pretty_midi.PrettyMIDI, float, str, float]:
    """Quantize MIDI to the beat grid.

    Args:
        midi_data:       Raw PrettyMIDI from the Basic Pitch stage.
        audio_path:      Path to the original audio (needed for beat tracking).
        instrument_hint: 'guitar' or 'piano'.

    Returns:
        Tuple of (quantized_midi, tempo_bpm, time_signature_str, elapsed_seconds).
    """
    import librosa

    t_start = time.perf_counter()

    # Load audio at its native sample rate for accurate beat tracking.
    y, sr = librosa.load(audio_path, sr=None, mono=True)

    # Compute onset strength envelope (more stable than raw audio for beat tracking).
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)

    # Beat tracking: returns tempo estimate and frame indices of beat events.
    tempo_arr, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset_env,
        sr=sr,
        units="frames",
    )

    # librosa ≥0.10 may return a scalar or a 1-element array.
    tempo_bpm = float(np.atleast_1d(tempo_arr).mean())

    # Clamp to musical range; very extreme values indicate a tracking failure.
    tempo_bpm = max(40.0, min(240.0, tempo_bpm))

    beat_times: np.ndarray = librosa.frames_to_time(beat_frames, sr=sr)

    # Choose quantization subdivision based on tempo:
    #   slow (<60 BPM)  → 32nd notes (8 per beat) — finer for expressive playing
    #   normal (60–160) → 16th notes (4 per beat)  — standard
    #   fast (>160 BPM) → 8th notes  (2 per beat)  — avoid too many short notes
    beat_dur = 60.0 / tempo_bpm
    if tempo_bpm < 60:
        subdiv_count = 8
    elif tempo_bpm > 160:
        subdiv_count = 2
    else:
        subdiv_count = 4

    subdiv_dur = beat_dur / subdiv_count

    # Heuristic time signature estimation.
    time_sig = _estimate_time_signature(beat_times, onset_env, sr)

    # Build the quantization grid extending a few beats past the audio end.
    total_dur = max(midi_data.get_end_time() + beat_dur * 4, len(y) / sr + beat_dur)
    n_steps = int(total_dur / subdiv_dur) + subdiv_count * 4
    grid = np.linspace(0.0, n_steps * subdiv_dur, n_steps, endpoint=False)

    quantized = _apply_grid(midi_data, grid, subdiv_dur, tempo_bpm, time_sig)

    logger.debug(
        "quantize_complete",
        tempo_bpm=round(tempo_bpm, 1),
        beat_count=len(beat_times),
        subdiv=f"1/{4 * subdiv_count}",
        time_sig=time_sig,
    )

    return quantized, tempo_bpm, time_sig, time.perf_counter() - t_start


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _estimate_time_signature(
    beat_times: np.ndarray,
    onset_env: np.ndarray,
    sr: int,
) -> str:
    """Heuristic: compare the autocorrelation weight of 3- vs 4-beat groups.

    Returns '3/4' or '4/4'. Defaults conservatively to '4/4'.
    """
    if len(beat_times) < 6:
        return "4/4"

    ibis = np.diff(beat_times)
    median_ibi = float(np.median(ibis))
    if median_ibi <= 0:
        return "4/4"

    # High coefficient of variation → irregular beats → don't trust meter detection.
    cv = float(np.std(ibis)) / median_ibi
    if cv > 0.25:
        return "4/4"

    # Compare variance of 3-beat vs 4-beat group sums.
    # Smaller variance for a group size suggests that meter.
    def group_variance(n: int) -> float:
        groups = [
            float(np.sum(ibis[i : i + n]))
            for i in range(0, len(ibis) - n + 1, n)
        ]
        return float(np.var(groups)) if len(groups) > 1 else float("inf")

    var3 = group_variance(3)
    var4 = group_variance(4)

    # Use 3/4 only when the evidence is clear (var3 significantly lower than var4).
    if var3 < var4 * 0.7:
        return "3/4"

    return "4/4"


def _apply_grid(
    midi_data: pretty_midi.PrettyMIDI,
    grid: np.ndarray,
    subdiv_dur: float,
    tempo_bpm: float,
    time_sig: str,
) -> pretty_midi.PrettyMIDI:
    """Snap every note onset/offset to the nearest grid position."""
    num, den = (int(x) for x in time_sig.split("/"))

    new_midi = pretty_midi.PrettyMIDI(initial_tempo=tempo_bpm)
    new_midi.time_signature_changes = [
        pretty_midi.TimeSignature(numerator=num, denominator=den, time=0.0)
    ]

    def snap(t: float) -> float:
        idx = int(np.argmin(np.abs(grid - t)))
        return float(grid[idx])

    for instrument in midi_data.instruments:
        new_instr = pretty_midi.Instrument(
            program=instrument.program,
            is_drum=instrument.is_drum,
            name=instrument.name,
        )

        for note in instrument.notes:
            q_start = snap(note.start)
            q_end = snap(note.end)

            # Guarantee at least one subdivision of duration.
            if q_end <= q_start:
                q_end = q_start + subdiv_dur

            new_instr.notes.append(
                pretty_midi.Note(
                    velocity=max(1, min(127, note.velocity)),
                    pitch=note.pitch,
                    start=q_start,
                    end=q_end,
                )
            )

        new_instr.notes.sort(key=lambda n: n.start)
        new_midi.instruments.append(new_instr)

    return new_midi
