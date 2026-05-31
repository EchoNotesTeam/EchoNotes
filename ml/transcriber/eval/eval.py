"""EchoNotes ML Evaluation Harness.

Computes note-level precision, recall and F1 score against a reference MIDI
dataset, broken down by instrument (guitar / piano).  This is the primary
academic metric for the thesis (§12.3 of the design plan).

Metric definition
-----------------
A transcribed note is considered correct (True Positive) when it matches a
reference note on all three criteria simultaneously:
  - Onset within ±50 ms of the reference onset.
  - Pitch within ±1 semitone of the reference pitch.
  - Offset within max(50 ms, 20% of reference note duration) of the
    reference offset.

This is the standard used by MIREX (Music Information Retrieval EXchange)
and implemented in the ``mir_eval`` library.

Usage
-----
Install extras first:
    pip install -e ".[eval]"

Run against a dataset directory:
    python -m eval.eval \\
        --audio-dir  /path/to/wav_files \\
        --midi-dir   /path/to/reference_midi \\
        --instrument piano \\
        --output     results_piano.json

Directory structure expected:
    audio-dir/
        piece_01.wav
        piece_02.wav
        ...
    midi-dir/
        piece_01.mid
        piece_02.mid
        ...

The audio and MIDI files are matched by stem name (without extension).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

import numpy as np
import structlog

logger = structlog.get_logger()


# ---------------------------------------------------------------------------
# Core evaluation functions
# ---------------------------------------------------------------------------


def transcribe_file(audio_path: str, instrument: str) -> dict[str, Any]:
    """Run the full pipeline on one audio file and return the response dict."""
    from transcriber.pipeline import notate as notate_stage
    from transcriber.pipeline import quantize as quantize_stage
    from transcriber.pipeline import render as render_stage
    from transcriber.pipeline import transcribe as transcribe_stage

    # Load model on first call (idempotent).
    if not transcribe_stage.models_loaded():
        transcribe_stage.load_model()

    midi_data, confidence_map, _ = transcribe_stage.run(audio_path, instrument, {})
    quantized_midi, tempo_bpm, time_sig, _ = quantize_stage.run(midi_data, audio_path, instrument)
    music_xml, key_sig, _ = notate_stage.run(quantized_midi, instrument, tempo_bpm, time_sig)
    svg, pdf_b64, _ = render_stage.run(music_xml)

    return {
        "quantized_midi": quantized_midi,
        "music_xml": music_xml,
        "key": key_sig,
        "tempo_bpm": tempo_bpm,
        "time_signature": time_sig,
        "confidence_map": confidence_map,
    }


def midi_to_note_intervals(midi_path: str) -> tuple[np.ndarray, np.ndarray]:
    """Load a MIDI file and return (intervals, pitches) arrays for mir_eval.

    Returns:
        intervals: shape (N, 2) — [[onset, offset], ...] in seconds.
        pitches:   shape (N,)   — MIDI pitch numbers (float Hz expected by
                                  mir_eval.transcription; we convert).
    """
    import pretty_midi

    pm = pretty_midi.PrettyMIDI(midi_path)
    notes = []
    for instrument in pm.instruments:
        for note in instrument.notes:
            notes.append((note.start, note.end, note.pitch))

    if not notes:
        return np.zeros((0, 2)), np.zeros(0)

    notes.sort(key=lambda x: x[0])
    intervals = np.array([[n[0], n[1]] for n in notes])
    # mir_eval.transcription expects pitches in Hz (not MIDI).
    pitches = np.array([440.0 * (2.0 ** ((n[2] - 69) / 12.0)) for n in notes])
    return intervals, pitches


def pretty_midi_to_note_intervals(pm) -> tuple[np.ndarray, np.ndarray]:
    """Same as midi_to_note_intervals but for an in-memory PrettyMIDI object."""
    notes = []
    for instrument in pm.instruments:
        for note in instrument.notes:
            notes.append((note.start, note.end, note.pitch))

    if not notes:
        return np.zeros((0, 2)), np.zeros(0)

    notes.sort(key=lambda x: x[0])
    intervals = np.array([[n[0], n[1]] for n in notes])
    pitches = np.array([440.0 * (2.0 ** ((n[2] - 69) / 12.0)) for n in notes])
    return intervals, pitches


def evaluate_pair(
    audio_path: str,
    reference_midi_path: str,
    instrument: str,
) -> dict[str, float]:
    """Compute precision/recall/F1 for one audio–MIDI pair.

    Returns a dict with keys: precision, recall, f1, note_count_ref,
    note_count_pred.
    """
    try:
        import mir_eval
    except ImportError:
        raise ImportError(
            "mir_eval is required for evaluation. Install with: pip install -e '.[eval]'"
        )

    # Transcribe
    result = transcribe_file(audio_path, instrument)
    pred_midi = result["quantized_midi"]

    # Load reference
    ref_intervals, ref_pitches = midi_to_note_intervals(reference_midi_path)
    pred_intervals, pred_pitches = pretty_midi_to_note_intervals(pred_midi)

    if len(ref_pitches) == 0 or len(pred_pitches) == 0:
        return {
            "precision": 0.0,
            "recall": 0.0,
            "f1": 0.0,
            "note_count_ref": int(len(ref_pitches)),
            "note_count_pred": int(len(pred_pitches)),
        }

    # mir_eval note-level evaluation with standard tolerances:
    #   onset: ±50 ms, offset: max(50 ms, 20% of ref duration), pitch: ±1 semitone.
    precision, recall, f1, _ = mir_eval.transcription.precision_recall_f1_overlap(
        ref_intervals,
        ref_pitches,
        pred_intervals,
        pred_pitches,
        onset_tolerance=0.05,   # 50 ms
        pitch_tolerance=50.0,   # 50 cents = 1 semitone
        offset_ratio=0.2,
        offset_min_tolerance=0.05,
    )

    return {
        "precision": round(float(precision), 4),
        "recall": round(float(recall), 4),
        "f1": round(float(f1), 4),
        "note_count_ref": int(len(ref_pitches)),
        "note_count_pred": int(len(pred_pitches)),
    }


# ---------------------------------------------------------------------------
# Dataset evaluation
# ---------------------------------------------------------------------------


def evaluate_dataset(
    audio_dir: Path,
    midi_dir: Path,
    instrument: str,
) -> dict[str, Any]:
    """Evaluate the pipeline over an entire dataset directory.

    Returns aggregated metrics (mean ± std) plus per-file results.
    """
    audio_files = sorted(
        f for f in audio_dir.iterdir()
        if f.suffix.lower() in {".wav", ".mp3", ".flac", ".ogg"}
    )

    if not audio_files:
        raise FileNotFoundError(f"No audio files found in {audio_dir}")

    per_file: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    for audio_path in audio_files:
        stem = audio_path.stem

        # Match reference MIDI by stem name (try .mid and .midi extensions)
        ref_midi = None
        for ext in (".mid", ".midi"):
            candidate = midi_dir / (stem + ext)
            if candidate.exists():
                ref_midi = candidate
                break

        if ref_midi is None:
            logger.warning("no_reference_midi", file=stem)
            continue

        logger.info("evaluating", file=stem, instrument=instrument)
        try:
            metrics = evaluate_pair(str(audio_path), str(ref_midi), instrument)
            metrics["file"] = stem
            per_file.append(metrics)
            logger.info(
                "eval_result",
                file=stem,
                f1=metrics["f1"],
                precision=metrics["precision"],
                recall=metrics["recall"],
            )
        except Exception as exc:
            logger.error("eval_error", file=stem, error=str(exc))
            errors.append({"file": stem, "error": str(exc)})

    if not per_file:
        return {"error": "No files could be evaluated", "errors": errors}

    f1s = [r["f1"] for r in per_file]
    precisions = [r["precision"] for r in per_file]
    recalls = [r["recall"] for r in per_file]

    summary = {
        "instrument": instrument,
        "n_files": len(per_file),
        "f1_mean": round(float(np.mean(f1s)), 4),
        "f1_std": round(float(np.std(f1s)), 4),
        "f1_min": round(float(np.min(f1s)), 4),
        "f1_max": round(float(np.max(f1s)), 4),
        "precision_mean": round(float(np.mean(precisions)), 4),
        "recall_mean": round(float(np.mean(recalls)), 4),
        "per_file": per_file,
        "errors": errors,
    }

    logger.info(
        "dataset_eval_complete",
        instrument=instrument,
        n_files=len(per_file),
        f1_mean=summary["f1_mean"],
        f1_std=summary["f1_std"],
    )
    return summary


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="EchoNotes ML evaluation harness — computes note-level F1 score."
    )
    parser.add_argument(
        "--audio-dir",
        required=True,
        type=Path,
        help="Directory containing .wav/.mp3/.flac audio files.",
    )
    parser.add_argument(
        "--midi-dir",
        required=True,
        type=Path,
        help="Directory containing reference .mid MIDI files (matched by filename stem).",
    )
    parser.add_argument(
        "--instrument",
        choices=["piano", "guitar", "both"],
        default="both",
        help="Instrument to evaluate. 'both' evaluates all files with each label.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Path to write the JSON results file. Defaults to stdout.",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()

    instruments = ["piano", "guitar"] if args.instrument == "both" else [args.instrument]
    results: dict[str, Any] = {}

    for instrument in instruments:
        print(f"\n=== Evaluating {instrument} ===", file=sys.stderr)
        results[instrument] = evaluate_dataset(args.audio_dir, args.midi_dir, instrument)

    output_json = json.dumps(results, indent=2)

    if args.output:
        args.output.write_text(output_json, encoding="utf-8")
        print(f"\nResults written to {args.output}", file=sys.stderr)
    else:
        print(output_json)

    # Print summary table to stderr.
    print("\n=== Summary ===", file=sys.stderr)
    for instrument, res in results.items():
        if "error" in res:
            print(f"  {instrument}: ERROR — {res['error']}", file=sys.stderr)
        else:
            print(
                f"  {instrument}: F1 = {res['f1_mean']:.4f} ± {res['f1_std']:.4f} "
                f"(n={res['n_files']})",
                file=sys.stderr,
            )


if __name__ == "__main__":
    main()
