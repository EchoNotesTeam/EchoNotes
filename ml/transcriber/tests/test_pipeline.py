"""Integration tests for the ML transcription pipeline.

Each test exercises a specific stage or the full end-to-end flow.
Tests use synthetic audio generated in conftest.py — no external dataset needed.

Run with:
    cd ml/transcriber
    pip install -e ".[dev]"
    pytest -v
"""

from __future__ import annotations

import base64

import pytest


# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------


def test_load_model_succeeds():
    """Basic Pitch model must load without error."""
    from transcriber.pipeline import transcribe as transcribe_stage

    transcribe_stage.load_model()
    assert transcribe_stage.models_loaded() == ["basic_pitch"]


# ---------------------------------------------------------------------------
# Stage 1 — Basic Pitch transcription
# ---------------------------------------------------------------------------


class TestTranscribeStage:
    def test_piano_produces_notes(self, piano_c_major_wav):
        from transcriber.pipeline import transcribe as stage

        stage.load_model()
        midi_data, confidence_map, elapsed = stage.run(
            piano_c_major_wav,
            "piano",
            {"onset_threshold": 0.4, "note_threshold": 0.3, "minimum_note_length": 0.05},
        )

        assert confidence_map["note_count"] >= 1
        assert elapsed > 0
        assert len(midi_data.instruments) >= 1
        total_notes = sum(len(i.notes) for i in midi_data.instruments)
        assert total_notes >= 1

    def test_guitar_produces_notes(self, guitar_e_minor_wav):
        from transcriber.pipeline import transcribe as stage

        stage.load_model()
        midi_data, confidence_map, elapsed = stage.run(
            guitar_e_minor_wav,
            "guitar",
            {},
        )
        assert confidence_map["note_count"] >= 1

    def test_missing_file_raises(self):
        from transcriber.pipeline import transcribe as stage

        stage.load_model()
        # app.py validates existence before calling stage; replicate that check here
        import os

        with pytest.raises((FileNotFoundError, Exception)):
            stage.run("/non/existent/audio.wav", "piano", {})


# ---------------------------------------------------------------------------
# Stage 2 — librosa quantization
# ---------------------------------------------------------------------------


class TestQuantizeStage:
    def test_returns_valid_tempo(self, piano_c_major_wav):
        from transcriber.pipeline import quantize as q_stage
        from transcriber.pipeline import transcribe as t_stage

        t_stage.load_model()
        midi_data, _, _ = t_stage.run(piano_c_major_wav, "piano", {})
        quantized, tempo, time_sig, elapsed = q_stage.run(midi_data, piano_c_major_wav, "piano")

        assert 40.0 <= tempo <= 240.0
        assert "/" in time_sig  # e.g. '4/4'
        assert elapsed > 0

    def test_notes_are_sorted(self, piano_c_major_wav):
        from transcriber.pipeline import quantize as q_stage
        from transcriber.pipeline import transcribe as t_stage

        t_stage.load_model()
        midi_data, _, _ = t_stage.run(piano_c_major_wav, "piano", {})
        quantized, _, _, _ = q_stage.run(midi_data, piano_c_major_wav, "piano")

        for instrument in quantized.instruments:
            starts = [n.start for n in instrument.notes]
            assert starts == sorted(starts)

    def test_no_zero_duration_notes(self, piano_c_major_wav):
        from transcriber.pipeline import quantize as q_stage
        from transcriber.pipeline import transcribe as t_stage

        t_stage.load_model()
        midi_data, _, _ = t_stage.run(piano_c_major_wav, "piano", {})
        quantized, _, _, _ = q_stage.run(midi_data, piano_c_major_wav, "piano")

        for instrument in quantized.instruments:
            for note in instrument.notes:
                assert note.end > note.start, "Zero-duration note found after quantization"


# ---------------------------------------------------------------------------
# Stage 3 — music21 notation
# ---------------------------------------------------------------------------


class TestNotateStage:
    def test_produces_valid_musicxml(self, piano_c_major_wav):
        from transcriber.pipeline import notate as n_stage
        from transcriber.pipeline import quantize as q_stage
        from transcriber.pipeline import transcribe as t_stage

        t_stage.load_model()
        midi, _, _ = t_stage.run(piano_c_major_wav, "piano", {})
        quantized, tempo, time_sig, _ = q_stage.run(midi, piano_c_major_wav, "piano")
        music_xml, key, elapsed = n_stage.run(quantized, "piano", tempo, time_sig)

        assert "<score-partwise" in music_xml or "<score-timewise" in music_xml
        assert len(music_xml) > 200
        assert "major" in key or "minor" in key
        assert elapsed > 0

    def test_key_detection_not_empty(self, piano_c_major_wav):
        from transcriber.pipeline import notate as n_stage
        from transcriber.pipeline import quantize as q_stage
        from transcriber.pipeline import transcribe as t_stage

        t_stage.load_model()
        midi, _, _ = t_stage.run(piano_c_major_wav, "piano", {})
        quantized, tempo, time_sig, _ = q_stage.run(midi, piano_c_major_wav, "piano")
        _, key, _ = n_stage.run(quantized, "piano", tempo, time_sig)

        assert key != ""


# ---------------------------------------------------------------------------
# Stage 4 — Verovio rendering
# ---------------------------------------------------------------------------


class TestRenderStage:
    def test_produces_svg(self, piano_c_major_wav):
        from transcriber.pipeline import notate as n_stage
        from transcriber.pipeline import quantize as q_stage
        from transcriber.pipeline import render as r_stage
        from transcriber.pipeline import transcribe as t_stage

        t_stage.load_model()
        midi, _, _ = t_stage.run(piano_c_major_wav, "piano", {})
        quantized, tempo, time_sig, _ = q_stage.run(midi, piano_c_major_wav, "piano")
        music_xml, _, _ = n_stage.run(quantized, "piano", tempo, time_sig)
        svg, pdf_b64, elapsed = r_stage.run(music_xml)

        assert svg.strip().startswith("<svg") or "svg" in svg[:500].lower()
        assert elapsed > 0
        # pdf_b64 may be empty if PDF generation unavailable — that's OK
        assert isinstance(pdf_b64, str)


# ---------------------------------------------------------------------------
# HTTP endpoint tests
# ---------------------------------------------------------------------------


class TestHTTPEndpoints:
    def test_healthz_ok(self, test_client):
        resp = test_client.get("/healthz")
        assert resp.status_code == 200
        body = resp.json()
        assert body["ok"] is True
        assert "basic_pitch" in body["models_loaded"]

    def test_version_endpoint(self, test_client):
        resp = test_client.get("/version")
        assert resp.status_code == 200
        body = resp.json()
        assert "basic_pitch" in body
        assert "music21" in body
        assert "verovio" in body

    def test_transcribe_piano_end_to_end(self, test_client, piano_c_major_wav):
        resp = test_client.post(
            "/transcribe",
            json={"audio_path": piano_c_major_wav, "instrument_hint": "piano"},
        )
        assert resp.status_code == 200
        body = resp.json()

        # Required response fields
        assert body["midi_b64"] != ""
        assert body["music_xml"] != ""
        assert body["svg"] != ""
        assert body["key"] != ""
        assert body["time_signature"] != ""
        assert body["tempo_bpm"] > 0

        # Verify MIDI is valid base64 and non-empty
        midi_bytes = base64.b64decode(body["midi_b64"])
        assert len(midi_bytes) > 0
        # Standard MIDI file magic bytes: 0x4D 0x54 0x68 0x64 ("MThd")
        assert midi_bytes[:4] == b"MThd"

    def test_transcribe_sse_streams_progress(self, test_client, piano_c_major_wav):
        resp = test_client.post(
            "/transcribe",
            json={"audio_path": piano_c_major_wav, "instrument_hint": "piano"},
            headers={"Accept": "text/event-stream"},
        )
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers["content-type"]

        body = resp.text
        # Every pipeline stage reports progress, then a terminal result event.
        assert "event: progress" in body
        assert "event: result" in body
        for stage in ("transcribe", "quantize", "notate", "render"):
            assert f'"stage": "{stage}"' in body

    def test_transcribe_guitar_end_to_end(self, test_client, guitar_e_minor_wav):
        resp = test_client.post(
            "/transcribe",
            json={"audio_path": guitar_e_minor_wav, "instrument_hint": "guitar"},
        )
        assert resp.status_code == 200
        assert resp.json()["tempo_bpm"] > 0

    def test_transcribe_missing_file_returns_422(self, test_client):
        resp = test_client.post(
            "/transcribe",
            json={"audio_path": "/does/not/exist.wav", "instrument_hint": "piano"},
        )
        assert resp.status_code == 422

    def test_transcribe_invalid_body_returns_422(self, test_client):
        resp = test_client.post("/transcribe", json={})
        assert resp.status_code == 422
