"""EchoNotes ML Service — FastAPI application.

Exposes a single POST /transcribe endpoint that runs the four-stage
transcription pipeline:
  1. Basic Pitch  →  MIDI note events
  2. librosa      →  rhythmic quantization to beat grid
  3. music21      →  MusicXML notation
  4. Verovio      →  SVG + PDF rendering

The service is stateless with respect to jobs; all state lives in the
Go orchestrator. Models are loaded once at startup and reused across requests.
"""

import asyncio
import base64
import os
import tempfile
import time
from contextlib import asynccontextmanager
from importlib.metadata import version as pkg_version

import structlog
import verovio
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse

from transcriber.models import (
    ErrorDetail,
    HealthResponse,
    TranscribeRequest,
    TranscribeResponse,
    VersionResponse,
)
from transcriber.pipeline import notate as notate_stage
from transcriber.pipeline import quantize as quantize_stage
from transcriber.pipeline import render as render_stage
from transcriber.pipeline import transcribe as transcribe_stage

# Configure structlog for JSON output compatible with pino/zerolog in the
# rest of the stack.
structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.add_log_level,
        structlog.processors.JSONRenderer(),
    ]
)

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    """Load ML models on startup. Fail fast if a model cannot be loaded."""
    logger.info("startup", event="loading_models")
    try:
        transcribe_stage.load_model()
        logger.info("startup", event="models_ready", models=transcribe_stage.models_loaded())
    except Exception as exc:
        logger.error("startup", event="model_load_failed", error=str(exc))
        raise
    yield
    logger.info("shutdown", event="service_stopping")


app = FastAPI(
    title="EchoNotes ML Service",
    description="Audio → Sheet music transcription pipeline",
    version="0.1.0",
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# Utility routes
# ---------------------------------------------------------------------------


@app.get("/healthz", response_model=HealthResponse, tags=["ops"])
async def healthz() -> HealthResponse:
    """Liveness + readiness check. Returns 200 only when models are loaded."""
    loaded = transcribe_stage.models_loaded()
    if not loaded:
        raise HTTPException(status_code=503, detail="Models not loaded yet")
    return HealthResponse(ok=True, models_loaded=loaded)


@app.get("/version", response_model=VersionResponse, tags=["ops"])
async def get_version() -> VersionResponse:
    tk = verovio.toolkit()
    return VersionResponse(
        basic_pitch=pkg_version("basic-pitch"),
        music21=pkg_version("music21"),
        verovio=tk.getVersion(),
        service="0.1.0",
    )


# ---------------------------------------------------------------------------
# Core transcription endpoint
# ---------------------------------------------------------------------------


@app.post(
    "/transcribe",
    response_model=TranscribeResponse,
    responses={
        422: {"model": ErrorDetail, "description": "Audio processing error"},
        500: {"model": ErrorDetail, "description": "Unexpected server error"},
    },
    tags=["transcription"],
)
async def transcribe(request: TranscribeRequest) -> TranscribeResponse:
    """Run the full four-stage transcription pipeline on an audio file.

    The audio file must already be present on the shared filesystem volume
    (written there by the TypeScript API before calling the Go orchestrator,
    which then calls this endpoint).
    """
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(None, _run_pipeline, request)
    except HTTPException:
        raise
    except ValueError as exc:
        # Expected failures: no notes detected, bad audio format, etc.
        logger.warning("pipeline_value_error", error=str(exc), audio=request.audio_path)
        raise HTTPException(
            status_code=422,
            detail={"error_code": "PROCESSING_ERROR", "message": str(exc)},
        )
    except Exception as exc:
        logger.exception("pipeline_unexpected_error", error=str(exc))
        raise HTTPException(
            status_code=500,
            detail={"error_code": "INTERNAL_ERROR", "message": str(exc)},
        )
    return result


def _run_pipeline(request: TranscribeRequest) -> TranscribeResponse:
    """Synchronous pipeline — runs in a thread pool executor."""
    log = logger.bind(audio_path=request.audio_path, instrument=request.instrument_hint)
    timings: dict[str, float] = {}

    # ------------------------------------------------------------------
    # Guard: verify the audio file is accessible before doing any work.
    # ------------------------------------------------------------------
    if not os.path.isfile(request.audio_path):
        raise HTTPException(
            status_code=422,
            detail={
                "error_code": "FILE_NOT_FOUND",
                "message": f"Audio file not found: {request.audio_path}",
            },
        )

    # ------------------------------------------------------------------
    # Stage 1 — Basic Pitch: raw audio → MIDI note events
    # ------------------------------------------------------------------
    log.info("stage_start", stage="transcribe")
    midi_data, confidence_map, t1 = transcribe_stage.run(
        request.audio_path,
        request.instrument_hint,
        request.options.model_dump(),
    )
    timings["transcribe_s"] = round(t1, 3)
    log.info(
        "stage_done",
        stage="transcribe",
        notes=confidence_map.get("note_count", 0),
        elapsed_s=timings["transcribe_s"],
    )

    # ------------------------------------------------------------------
    # Stage 2 — librosa: snap notes to the beat grid
    # ------------------------------------------------------------------
    log.info("stage_start", stage="quantize")
    quantized_midi, tempo_bpm, time_sig, t2 = quantize_stage.run(
        midi_data,
        request.audio_path,
        request.instrument_hint,
    )
    timings["quantize_s"] = round(t2, 3)
    log.info(
        "stage_done",
        stage="quantize",
        tempo_bpm=round(tempo_bpm, 1),
        time_sig=time_sig,
        elapsed_s=timings["quantize_s"],
    )

    # ------------------------------------------------------------------
    # Stage 3 — music21: quantized MIDI → MusicXML
    # ------------------------------------------------------------------
    log.info("stage_start", stage="notate")
    music_xml, key_sig, t3 = notate_stage.run(
        quantized_midi,
        request.instrument_hint,
        tempo_bpm,
        time_sig,
    )
    timings["notate_s"] = round(t3, 3)
    log.info(
        "stage_done",
        stage="notate",
        key=key_sig,
        elapsed_s=timings["notate_s"],
    )

    # ------------------------------------------------------------------
    # Stage 4 — Verovio: MusicXML → SVG + PDF
    # ------------------------------------------------------------------
    log.info("stage_start", stage="render")
    svg, pdf_b64, t4 = render_stage.run(music_xml)
    timings["render_s"] = round(t4, 3)
    log.info("stage_done", stage="render", elapsed_s=timings["render_s"])

    # ------------------------------------------------------------------
    # Encode final MIDI as base64 for the JSON response
    # ------------------------------------------------------------------
    midi_b64 = _encode_midi(quantized_midi)

    total = round(sum(timings.values()), 3)
    log.info("pipeline_complete", total_s=total, key=key_sig, tempo=round(tempo_bpm, 1))

    return TranscribeResponse(
        midi_b64=midi_b64,
        music_xml=music_xml,
        svg=svg,
        pdf_b64=pdf_b64,
        key=key_sig,
        time_signature=time_sig,
        tempo_bpm=round(tempo_bpm, 2),
        confidence_map=confidence_map,
        stage_timings=timings,
    )


def _encode_midi(midi_data) -> str:  # pretty_midi.PrettyMIDI
    """Write MIDI to a temp file and return base64-encoded bytes."""
    with tempfile.NamedTemporaryFile(suffix=".mid", delete=False) as tmp:
        path = tmp.name
    try:
        midi_data.write(path)
        with open(path, "rb") as f:
            return base64.b64encode(f.read()).decode("utf-8")
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
