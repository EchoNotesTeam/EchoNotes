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
import json
import os
import tempfile
import time
from collections.abc import Callable
from contextlib import asynccontextmanager
from importlib.metadata import version as pkg_version

import structlog
import verovio
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse

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
    logger.info("startup", phase="loading_models")
    try:
        transcribe_stage.load_model()
        logger.info("startup", phase="models_ready", models=transcribe_stage.models_loaded())
    except Exception as exc:
        logger.error("startup", phase="model_load_failed", error=str(exc))
        raise
    yield
    logger.info("shutdown", phase="service_stopping")


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
async def transcribe(request: TranscribeRequest, http_request: Request):
    """Run the full four-stage transcription pipeline on an audio file.

    The audio file must already be present on the shared filesystem volume
    (written there by the TypeScript API before calling the Go orchestrator,
    which then calls this endpoint).

    When the caller sends ``Accept: text/event-stream`` (the Go orchestrator
    always does), the pipeline streams a ``progress`` event per stage and a
    terminal ``result`` event. Otherwise it runs to completion and returns the
    payload as a single JSON response.
    """
    if "text/event-stream" in http_request.headers.get("accept", ""):
        return StreamingResponse(
            _transcribe_sse(request),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

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


async def _transcribe_sse(request: TranscribeRequest):
    """Run the pipeline in a worker thread, streaming per-stage SSE events.

    The blocking pipeline runs in the default executor so it never stalls the
    event loop. Each stage pushes a ``progress`` event through an asyncio queue;
    the final payload arrives as a ``result`` event (or ``error`` on failure).
    This is the exact contract the Go orchestrator consumes.
    """
    loop = asyncio.get_event_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def progress(stage: str, pct: int, message: str) -> None:
        loop.call_soon_threadsafe(
            queue.put_nowait,
            {"type": "progress", "stage": stage, "pct": pct, "message": message},
        )

    def worker() -> None:
        try:
            result = _run_pipeline(request, progress)
            payload = {"type": "result", "data": result.model_dump()}
        except HTTPException as exc:
            detail = exc.detail
            if not isinstance(detail, dict):
                detail = {"error_code": "PROCESSING_ERROR", "message": str(detail)}
            payload = {"type": "error", "detail": detail}
        except ValueError as exc:
            payload = {"type": "error", "detail": {"error_code": "PROCESSING_ERROR", "message": str(exc)}}
        except Exception as exc:  # noqa: BLE001 — surfaced to the client as an error event
            logger.exception("pipeline_unexpected_error", error=str(exc))
            payload = {"type": "error", "detail": {"error_code": "INTERNAL_ERROR", "message": str(exc)}}
        loop.call_soon_threadsafe(queue.put_nowait, payload)
        loop.call_soon_threadsafe(queue.put_nowait, {"type": "__sentinel__"})

    fut = loop.run_in_executor(None, worker)
    try:
        while True:
            item = await queue.get()
            kind = item["type"]
            if kind == "__sentinel__":
                break
            if kind == "progress":
                data = json.dumps(
                    {"stage": item["stage"], "pct": item["pct"], "message": item["message"]}
                )
                yield f"event: progress\ndata: {data}\n\n"
            elif kind == "result":
                yield f"event: result\ndata: {json.dumps(item['data'])}\n\n"
            elif kind == "error":
                yield f"event: error\ndata: {json.dumps(item['detail'])}\n\n"
    finally:
        await fut


def _run_pipeline(
    request: TranscribeRequest,
    progress: Callable[[str, int, str], None] | None = None,
) -> TranscribeResponse:
    """Synchronous pipeline — runs in a thread pool executor.

    ``progress`` is an optional callback invoked at the start of each stage
    with ``(stage, pct, message)``. The SSE streaming path uses it to report
    real per-stage progress; the blocking JSON path passes ``None``.
    """
    if progress is None:
        def progress(_stage: str, _pct: int, _message: str) -> None:  # noqa: ARG001
            return None

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
    progress("transcribe", 15, "Transcribing audio with Basic Pitch")
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
    progress("quantize", 35, "Detecting tempo and quantizing rhythm")
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
    progress("notate", 55, "Generating notation with music21")
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
    progress("render", 65, "Rendering score with Verovio")
    log.info("stage_start", stage="render")
    svg, pdf_b64, t4 = render_stage.run(music_xml)
    timings["render_s"] = round(t4, 3)
    log.info("stage_done", stage="render", elapsed_s=timings["render_s"])

    # ------------------------------------------------------------------
    # Encode final MIDI as base64 for the JSON response
    # ------------------------------------------------------------------
    midi_b64 = _encode_midi(quantized_midi)
    duration_seconds = _audio_duration(request.audio_path, quantized_midi)

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
        duration_seconds=round(duration_seconds, 2),
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


def _audio_duration(audio_path: str, midi_data) -> float:  # midi_data: pretty_midi.PrettyMIDI
    """Best-effort audio duration in seconds.

    Reads only the audio header via soundfile (fast, no full decode); falls back
    to the quantized MIDI end time if the header can't be read (some compressed
    formats), so the field is always populated.
    """
    try:
        import soundfile as sf

        return float(sf.info(audio_path).duration)
    except Exception:
        return float(midi_data.get_end_time())
