# EchoNotes ML Service — Python 3.11 (Debian Bookworm slim)
#
# Uses Debian (not Alpine) because TensorFlow wheels are not available for
# musl libc (Alpine) without compiling from source.
#
# System library requirements:
#   libsndfile1   — soundfile / librosa WAV+FLAC loading
#   ffmpeg        — librosa MP3/AAC/OGG loading via audioread
#   libcairo2     — cairosvg PDF generation (SVG→PDF fallback)
#   libpango-*    — cairosvg font rendering
#   libgdk-pixbuf — cairosvg image handling
#   libgomp1      — OpenMP runtime for TensorFlow CPU

FROM python:3.11-slim-bookworm AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=120

RUN apt-get update && apt-get install -y --no-install-recommends \
        libsndfile1 \
        ffmpeg \
        libcairo2 \
        libpango-1.0-0 \
        libpangocairo-1.0-0 \
        libgdk-pixbuf-2.0-0 \
        libffi8 \
        libgomp1 \
        curl \
    && rm -rf /var/lib/apt/lists/*

# ── dependency layer (cached unless pyproject.toml changes) ──────────────────
FROM base AS deps
WORKDIR /app
COPY pyproject.toml ./

# Install only the runtime dependencies (not dev/eval extras).
RUN pip install --no-cache-dir --default-timeout=120 --retries=10 ".[dev]" && \
    # Warm up the Basic Pitch model download at build time so the first
    # request does not need to download it at runtime.
    python -c "from basic_pitch import ICASSP_2022_MODEL_PATH; print('model path:', ICASSP_2022_MODEL_PATH)"

# ── final image ──────────────────────────────────────────────────────────────
FROM deps AS final
WORKDIR /app
COPY transcriber/ ./transcriber/

EXPOSE 8000

# One Uvicorn worker — the TF model is not fork-safe so multiple workers
# would require a model-loading strategy (e.g. gunicorn + preload).
# For the thesis MVP, one worker is sufficient: Basic Pitch on CPU handles
# ~0.5× realtime, so a 3-minute file takes ~1.5 minutes, well within
# the job queue's timeout.
CMD ["uvicorn", "transcriber.app:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "1", \
     "--log-level", "info"]
