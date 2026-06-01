# EchoNotes — Design Plan

**Version:** 1.3
**Date:** May 2026
**Status:** Pre-implementation
**Scope:** Thesis MVP (guitar + piano, solo recordings, static rendering, no playback)

---

## 1. Overview

EchoNotes is a web platform that turns audio recordings into editable, instrument-specific sheet music using an AI transcription pipeline, with a community layer for organizing, sharing, and (eventually) collaborating on sheets. This document is the **engineering design plan** for the thesis MVP — it specifies the system architecture, service boundaries, contracts, data flow, and conventions that the implementation must follow.

The product specification (`EchoNotes_Product_Spec.docx`) covers what the system does and why. This plan covers **how it is built**.

### 1.1 Goals of this plan

- Define a clear three-service architecture that is simple to run locally yet justifiable as a production-ready design.
- Specify the contracts between services so each can be developed in isolation.
- Bound the MVP feature set to what is realistically deliverable in ~6 months as a thesis project.
- Leave room for the Phase 2 features (community, forks, search) without painting them into a corner.

### 1.2 Non-goals

- Cloud deployment, autoscaling, or high availability. Thesis defense runs on the developer's machine.
- Real-time / streaming transcription. All processing is asynchronous on uploaded files.
- **Multi-instrument / mixed recordings.** Users must upload a solo recording — one instrument per audio file. The pipeline does not perform source separation.
- Voice, lyrics, percussion, or uncommon orchestral instruments. Scope is guitar and piano.
- Interactive sheet viewer, MIDI playback, tempo control, or cursor-synced practice features. The output is a static rendered sheet.
- Instrument-specific notation (guitar tab, drum notation, etc.). Output is the traditional staff notation music21 produces by default.
- Legal copyright analysis of uploads.

---

## 2. System Architecture

The system is composed of **four services** running on a single host during the MVP, communicating over HTTP and WebSocket. The Python ML service is internal to the AI subsystem; the Go service is internal to the application; only the TypeScript backend is exposed to the browser.

```mermaid
flowchart LR
    Browser["🌐 Browser<br/>Vue 3 SPA (Vite)"]

    subgraph Public["Public surface"]
        TS["⚙️ Main Backend<br/>Fastify (TypeScript)<br/>Auth · Blog · Sheets · WS"]
    end

    subgraph Internal["Internal network (not exposed)"]
        Go["🚦 AI Orchestrator<br/>Go<br/>Jobs · Queue · Audio I/O · MusicXML assembly"]
        Py["🧠 ML Service<br/>Python FastAPI<br/>Demucs · Basic Pitch · madmom · music21"]
    end

    DB[("🗄️ PostgreSQL<br/>shared, schema-scoped")]
    Redis[("⚡ Redis<br/>Go-internal queue")]
    FS[("📁 Local filesystem<br/>audio + artifacts")]

    Browser -- "HTTPS REST + WS" --> TS
    TS -- "REST/JSON (mTLS or shared-secret)" --> Go
    Go -- "REST/JSON" --> Py

    TS --- DB
    Go --- DB
    Go --- Redis
    Go --- FS
    TS --- FS
```

### 2.1 Service responsibilities at a glance

| Service | Language | Responsibility |
|---|---|---|
| **Web** | Vue 3 + TypeScript | UI, sheet rendering (OSMD), playback (Tone.js), WebSocket client |
| **Main backend** | Fastify + TypeScript | User auth, public REST API, MDX blog serving, WebSocket fan-out, calls Go for transcription |
| **AI orchestrator** | Go | Job queue, file ingestion, calls Python ML, assembles final MusicXML, persists job state |
| **ML service** | Python FastAPI | Pure inference: source separation, pitch estimation, beat tracking, notation generation |

### 2.2 Why these boundaries

- **Browser only talks to TS.** The Go service has no exposure on the public network. This keeps the security model trivial (one public surface to harden) and lets us use a simple shared secret or mTLS for service-to-service auth.
- **Go owns the job lifecycle, not TS.** TS submits a job and forgets about it. Go tracks progress, persists artifacts, and exposes a status endpoint. TS polls Go (or subscribes to status changes) and rebroadcasts to the browser over WebSocket. This means transcription state survives TS restarts.
- **Python is dumb on purpose.** The Python service holds no state — it loads models on boot and exposes a `/transcribe` endpoint that takes a file path and returns MIDI + metadata. Everything stateful (jobs, queues, files, retries) lives in Go. This makes the Python service easy to restart, replace, or scale independently when GPU costs become a concern.

---

## 3. Service Detail

### 3.1 Frontend — Vue 3 SPA

**Stack**
- Vue 3 (Composition API) + TypeScript
- Vite for dev and build
- Pinia for global state (auth, current sheet)
- TanStack Query for Vue (server state, caching, optimistic updates)
- Vue Router for routing
- Tailwind CSS for styling
- **markdown-it + Shiki** for rendering MDX blog posts at build time (or runtime fetch)
- **Native WebSocket API** for transcription progress updates
- *No in-browser score rendering or audio playback library is used.* Sheets are displayed as pre-rendered SVGs served by the backend.

**Key views**
- `/` — Landing + featured public sheets
- `/login`, `/signup` — Auth
- `/workspace` — User's sheets, organized
- `/upload` — Drop audio, configure instrument, submit
- `/sheets/:id` — Sheet detail page: shows the pre-rendered SVG inline + download buttons (MusicXML, MIDI, PDF)
- `/blog`, `/blog/:slug` — Admin-authored MDX articles
- `/u/:username` — Public profile

**SEO note.** The SPA route is unindexable for public sheets and blog posts. This is an accepted tradeoff for the MVP. If SEO matters later (e.g., to demonstrate organic traffic), prerendering for the blog and public sheet pages can be added via `vite-ssg` without restructuring the rest of the app — and since the sheet detail page is now just an image + downloads, prerendering it is trivial.

### 3.2 Main Backend — Fastify (TypeScript)

**Stack**
- Node.js 22 LTS
- Fastify 5
- Prisma ORM (with `multiSchema` preview feature for cross-schema models)
- Zod for request/response validation (via `fastify-type-provider-zod`)
- `@fastify/websocket` for WS support
- `bcryptjs` for password hashing (pure-JS bcrypt; avoids a native build in the Docker image)
- `jose` for JWT signing/verification
- `pino` for structured logging

**Responsibilities**
- User authentication (email + password, JWT in httpOnly cookie)
- CRUD for sheets metadata (title, visibility, owner, tags, descriptions)
- Workspace operations (list, organize, share, delete)
- WebSocket connections to the browser; subscribes to job status from Go and pushes updates to the right client
- MDX blog: reads files from `content/blog/*.mdx` at build time, exposes a typed list endpoint and individual post endpoint
- Reverse-proxies audio uploads to Go (or hands Go a presigned local URL — see §6)
- Issues a service token for itself when calling Go

**Does NOT do**
- Run any ML or audio processing
- Track transcription job state (Go owns this)
- Write to the `jobs.*` or `transcriptions.*` schemas

### 3.3 AI Orchestrator — Go

**Stack**
- Go 1.23+
- `chi` router (HTTP)
- `sqlc` for type-safe Postgres queries + `pgx` driver
- `goose` for migrations
- `asynq` for the Redis-backed job queue (with Python workers triggered via HTTP)
- `zerolog` for structured logging
- `go-playground/validator` for input validation

**Responsibilities**
- Accept transcription jobs from TS (`POST /jobs` with audio file ref + instrument + user_id)
- Persist job rows in `jobs.transcription_jobs`
- Enqueue work in Redis via asynq
- Worker goroutines pick up jobs and orchestrate the pipeline:
  1. Read uploaded audio from filesystem
  2. POST audio to Python `/transcribe`
  3. Receive MIDI + per-stage metadata
  4. Run music21-style post-processing for instrument-specific notation (this can live in Python too — see §4.2)
  5. Write artifacts (MIDI, MusicXML, optional PDF) to filesystem
  6. Update job status in DB, mark complete
- Expose `GET /jobs/:id` for status polling
- Expose `GET /jobs/:id/stream` for SSE/long-poll progress (TS uses this internally)

**Does NOT do**
- Authenticate end users. It trusts that the calling TS service has done so.
- Run ML inference. Always delegates to Python.
- Talk to the browser directly.

### 3.4 ML Service — Python FastAPI

**Stack**
- Python 3.11
- FastAPI + Uvicorn
- TensorFlow / TF-Lite (Basic Pitch — pitch transcription)
- **librosa** (beat tracking + tempo estimation, used for rhythmic quantization)
- music21 (notation conversion, MusicXML)
- **Verovio** (server-side rendering of MusicXML → SVG; lightweight, pip-installable, no system deps)
- Pydantic v2 for request/response models
- structlog
- `pytest` for unit tests

**Single endpoint**
- `POST /transcribe` — body: `{ audio_path, instrument_hint, options }` → returns: `{ midi_b64, music_xml, svg, key, time_signature, tempo_bpm, confidence_map, stage_timings }`

**Why single service:** With Demucs and madmom both dropped from the pipeline, the remaining ML footprint is small (~500 MB for Basic Pitch + librosa + music21 + Verovio combined). A single FastAPI app loading everything at boot is the simplest viable design. If the thesis defense calls for a "scalable architecture" framing, the design plan can show per-stage decomposition as a future evolution.

**Model loading.** Models are loaded once at startup into module-level globals. The service does not hot-swap models. To upgrade a model in production, restart the service.

**GPU.** Basic Pitch will use a GPU if available, but it runs comfortably on CPU — ~0.5× realtime for a 3-minute audio file. The defense machine likely doesn't have a GPU; CPU mode is fully acceptable for the demo.

---

## 4. End-to-end Transcription Flow

This is the canonical user journey, traced through every service.

```mermaid
sequenceDiagram
    autonumber
    participant U as User (Browser)
    participant TS as TS Backend
    participant Go as Go Orchestrator
    participant Q as Redis Queue
    participant Py as Python ML
    participant DB as Postgres
    participant FS as Filesystem

    U->>TS: POST /api/sheets/upload (multipart audio)
    TS->>FS: write to /uploads/<uuid>.wav
    TS->>DB: INSERT sheets.sheets (status=pending)
    TS->>Go: POST /jobs {audio_path, sheet_id, user_id, instrument}
    Go->>DB: INSERT jobs.transcription_jobs (status=queued)
    Go->>Q: enqueue(job_id)
    Go-->>TS: 202 Accepted {job_id}
    TS-->>U: 202 {sheet_id, job_id}
    U->>TS: WS subscribe(job_id)
    TS->>Go: SSE GET /jobs/:id/stream

    Note over Go,Py: Worker picks up the job

    Go->>DB: UPDATE status=processing
    Go-->>TS: SSE event {stage: "loading", pct: 5}
    TS-->>U: WS {stage: "loading", pct: 5}

    Go->>Py: POST /transcribe {audio_path, instrument}
    Py->>Py: Basic Pitch → librosa quantize → music21 → Verovio
    Py-->>Go: 200 {midi, music_xml, svg, pdf, confidence_map, ...}

    Go->>FS: write /artifacts/<uuid>/score.musicxml
    Go->>FS: write /artifacts/<uuid>/notes.midi
    Go->>DB: INSERT transcriptions.transcriptions
    Go->>DB: UPDATE jobs.transcription_jobs (status=done)
    Go->>DB: UPDATE sheets.sheets (status=ready, transcription_id)
    Go-->>TS: SSE event {stage: "done", artifacts: [...]}
    TS-->>U: WS {stage: "done", sheet_id}

    U->>TS: GET /api/sheets/:id
    TS->>DB: SELECT joined sheets + transcription
    TS->>FS: read music_xml from /artifacts/<uuid>/
    TS-->>U: 200 {sheet, music_xml}
```

### 4.1 Failure handling

- **Python errors** (model failure, bad audio): Python returns `{ error_code, message }` with HTTP 422. Go marks the job `failed`, stores the error, and pushes a terminal SSE event. TS pushes a final WS message with the error so the UI can show a useful message.
- **Network errors** (Python unreachable): Go retries with exponential backoff up to 3 attempts, then marks the job `failed`.
- **Crash recovery:** On startup, Go scans `jobs.transcription_jobs WHERE status IN ('processing','queued')` and either re-enqueues them (if recoverable) or marks them `failed` with a `crashed` reason.

### 4.2 Stage boundaries

The pipeline has four logical stages. They run inside Python in one process, but they are *logically* separable, and the design plan should treat them as such because (a) it makes the thesis presentation cleaner and (b) it sets up a clean upgrade path.

| Stage | Input | Output | Model / library |
|---|---|---|---|
| **Transcribe** | Raw solo audio (wav/mp3) | MIDI note events with onsets in seconds + confidence | Basic Pitch |
| **Quantize** | MIDI + raw audio | MIDI snapped to a beat grid + tempo (BPM) + time signature | librosa (`beat_track`, `tempo`) |
| **Notate** | Quantized MIDI + instrument hint | MusicXML (standard staff notation) | music21 |
| **Render** | MusicXML | SVG (and PDF) | Verovio |

> **Note on input constraints:** the pipeline assumes the uploaded audio contains a **single instrument** (guitar or piano). Source separation (Demucs) was deliberately dropped from the MVP. The upload UI must clearly instruct users to upload solo recordings. If a user uploads a mixed recording, Basic Pitch will still produce *some* output, but quality will be poor — this is an accepted limitation of the MVP.

> **Note on `Quantize`:** even though there is no playback, beat tracking is essential — without rhythmic quantization, music21 produces unreadable notation (notes with bizarre fractional durations). librosa's `beat_track` provides good-enough tempo and beat-grid estimation for guitar and piano without the install pain of madmom.

For the thesis MVP, Python exposes a single `/transcribe` that runs all four stages. Each stage emits a progress message that Python streams back as an SSE response, which Go forwards to TS, which forwards to the browser. (If SSE-inside-the-internal-network feels heavy, a simpler alternative is for Python to POST progress to a Go webhook — both are valid; pick one in implementation.)

---

## 5. Repository Structure

Polyglot monorepo with three workspace mechanisms (pnpm for TS, Go modules with `go.work`, a Python package). Each service is independently buildable and runnable, but shared types, contracts, and tooling live at the root.

```
echonotes/
├── apps/
│   ├── web/                          # Vue 3 SPA
│   │   ├── src/
│   │   ├── public/
│   │   ├── index.html
│   │   ├── package.json
│   │   └── vite.config.ts
│   └── api/                          # Fastify TS backend
│       ├── src/
│       │   ├── routes/               # auth, sheets, blog, ws
│       │   ├── db/                   # Prisma Client wrapper
│       │   ├── services/             # business logic
│       │   └── server.ts
│       ├── prisma/                   # schema.prisma + migrations/
│       └── package.json
│
├── services/
│   └── ai-orchestrator/              # Go service
│       ├── cmd/server/main.go
│       ├── internal/
│       │   ├── api/                  # http handlers
│       │   ├── jobs/                 # queue + workers
│       │   ├── db/                   # sqlc-generated
│       │   └── ml/                   # python client
│       ├── migrations/               # goose .sql files
│       ├── sqlc.yaml
│       └── go.mod
│
├── ml/
│   └── transcriber/                  # Python FastAPI
│       ├── transcriber/
│       │   ├── app.py
│       │   ├── pipeline/
│       │   │   ├── separate.py
│       │   │   ├── transcribe.py
│       │   │   ├── quantize.py
│       │   │   └── notate.py
│       │   └── models.py
│       ├── tests/
│       ├── pyproject.toml
│       └── Dockerfile
│
├── packages/
│   ├── shared-types/                 # TS types shared web ↔ api
│   │   └── src/index.ts
│   └── contracts/                    # OpenAPI specs for service boundaries
│       ├── ts-go.yaml
│       └── go-python.yaml
│
├── content/
│   └── blog/                         # MDX posts, admin-authored
│       └── 2026-05-launch.mdx
│
├── infra/
│   ├── docker-compose.yml            # postgres, redis, py-ml, go, api
│   ├── docker-compose.dev.yml        # dev overrides (volumes, hot reload)
│   ├── .env.example
│   └── scripts/
│       ├── seed.ts
│       ├── reset-db.sh
│       └── healthcheck.sh
│
├── pnpm-workspace.yaml
├── go.work
├── package.json
├── tsconfig.base.json
├── .editorconfig
├── .gitignore
└── README.md
```

### 5.1 Convention notes

- **`apps/`** holds anything with a user-facing surface (web, public API).
- **`services/`** holds internal services (Go orchestrator).
- **`ml/`** holds Python ML code, kept separate because its build/runtime characteristics are fundamentally different.
- **`packages/`** holds shared code: TS types used by both `web` and `api`, and the OpenAPI specs that document the inter-service contracts.
- **`content/`** holds non-code authored content (MDX blog posts). Versioned with the code.
- **`infra/`** holds the docker-compose stack and operational scripts. No service code.

---

## 6. Database

A single PostgreSQL 16 instance, with five **Postgres schemas** acting as ownership boundaries. Each schema is owned by exactly one service. Cross-schema queries are not done at the application layer — services communicate through service APIs, not through each other's tables.

```mermaid
flowchart TB
    subgraph TS["Owned by TypeScript backend"]
        users["auth.users<br/>auth.sessions"]
        sheets["sheets.sheets<br/>sheets.tags<br/>sheets.sheet_tags"]
        blog["blog.posts<br/>(only if we move blog to DB later)"]
    end

    subgraph Go["Owned by Go orchestrator"]
        jobs["jobs.transcription_jobs<br/>jobs.job_events"]
        trans["transcriptions.transcriptions<br/>transcriptions.notes_confidence"]
    end

    sheets -. "FK: transcription_id (loose ref, no cross-schema constraint)" .-> trans
    jobs -. "stores user_id, sheet_id (loose ref)" .-> users
```

### 6.1 Schemas

| Schema | Owner | Tables (MVP) |
|---|---|---|
| `auth` | TS | `users`, `sessions` |
| `sheets` | TS | `sheets`, `tags`, `sheet_tags` |
| `blog` | TS | (none in MVP — blog is MDX in repo; reserved if we move to DB later) |
| `jobs` | Go | `transcription_jobs`, `job_events` |
| `transcriptions` | Go | `transcriptions`, `notes_confidence` |

### 6.2 Foreign keys across schemas

We **do not** declare hard FK constraints across schemas. Instead, columns like `jobs.transcription_jobs.user_id` are plain `uuid` columns with a documented soft reference to `auth.users.id`. This avoids cross-schema coupling at the DDL level — either service can be migrated, dumped, or restored independently. The discipline is: **referential integrity within a schema is enforced; across schemas it is upheld by application code.**

### 6.3 Migrations

| Service | Tool | Location |
|---|---|---|
| TS | `prisma migrate` | `apps/api/prisma/` |
| Go | `goose` | `services/ai-orchestrator/migrations/` |

Each service runs **only its own migrations**. The single shared Postgres instance accepts both. A bootstrap script in `infra/scripts/migrate.sh` runs both in order.

> **Prisma + multi-schema note:** the Prisma schema must enable the `multiSchema` preview feature, and each `model` block must declare its target Postgres schema with `@@schema("auth")`, `@@schema("sheets")`, etc. The `schemas = ["auth", "sheets", "blog"]` array goes on the `datasource db` block. Cross-schema relations between Prisma models are not used — references between the TS-owned (`auth`, `sheets`, `blog`) and Go-owned (`jobs`, `transcriptions`) schemas remain plain `uuid` columns with soft references, per §6.2.

### 6.4 Key tables (skeleton)

```sql
-- auth schema (TS-owned)
CREATE TABLE auth.users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        citext UNIQUE NOT NULL,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- sheets schema (TS-owned)
CREATE TABLE sheets.sheets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        uuid NOT NULL REFERENCES auth.users(id),
  title           text NOT NULL,
  instrument      text NOT NULL,
  visibility      text NOT NULL DEFAULT 'private',  -- private | public
  status          text NOT NULL DEFAULT 'pending',  -- pending | processing | ready | failed
  transcription_id uuid,  -- soft ref to transcriptions.transcriptions.id
  audio_path      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- jobs schema (Go-owned)
CREATE TABLE jobs.transcription_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id    uuid NOT NULL,           -- soft ref to sheets.sheets.id
  user_id     uuid NOT NULL,           -- soft ref to auth.users.id
  audio_path  text NOT NULL,
  instrument  text NOT NULL,
  status      text NOT NULL DEFAULT 'queued',  -- queued | processing | done | failed
  error_code  text,
  error_msg   text,
  started_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs.job_events (
  id         bigserial PRIMARY KEY,
  job_id     uuid NOT NULL REFERENCES jobs.transcription_jobs(id) ON DELETE CASCADE,
  stage      text NOT NULL,
  pct        smallint NOT NULL,
  message    text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- transcriptions schema (Go-owned)
CREATE TABLE transcriptions.transcriptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           uuid NOT NULL REFERENCES jobs.transcription_jobs(id),
  musicxml_path    text NOT NULL,
  svg_path         text NOT NULL,   -- rendered for browser display
  pdf_path         text NOT NULL,   -- downloadable
  midi_path        text NOT NULL,
  key_signature    text,
  time_signature   text,
  tempo_bpm        numeric(6,2),
  duration_seconds numeric(8,2),
  model_version    text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
```

---

## 7. API Contracts

### 7.1 Browser ↔ TS Backend (REST)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/auth/signup` | Email + password registration |
| `POST` | `/api/auth/login` | Sets httpOnly session cookie |
| `POST` | `/api/auth/logout` | Clears cookie |
| `GET`  | `/api/me` | Current user |
| `GET`  | `/api/sheets` | List user's sheets (paginated) |
| `POST` | `/api/sheets/upload` | Multipart audio + metadata; returns `{ sheet_id, job_id }` |
| `GET`  | `/api/sheets/:id` | Sheet details + signed MusicXML URL |
| `PATCH`| `/api/sheets/:id` | Update title, visibility, tags |
| `DELETE`| `/api/sheets/:id` | Soft delete |
| `GET`  | `/api/sheets/public/:id` | Public sheet view (no auth) |
| `GET`  | `/api/blog` | List blog posts (from MDX) |
| `GET`  | `/api/blog/:slug` | One blog post |

All request and response bodies are validated with Zod. Error responses follow:
```json
{ "error": { "code": "INVALID_INPUT", "message": "...", "details": { ... } } }
```

### 7.2 Browser ↔ TS Backend (WebSocket)

Single endpoint: `wss://<host>/api/ws` with a JWT validated on connect.

**Client → server messages**
```ts
{ type: "subscribe_job", job_id: string }
{ type: "unsubscribe_job", job_id: string }
{ type: "ping" }
```

**Server → client messages**
```ts
{ type: "job_progress", job_id, stage, pct, message }
{ type: "job_done", job_id, sheet_id }
{ type: "job_failed", job_id, error_code, message }
{ type: "pong" }
```

Sticky session is not required since job state lives in Postgres — if the WS reconnects to a different TS instance (not relevant in the MVP, but future-proofing), the new instance resumes the SSE subscription from Go using `last_event_id`.

### 7.3 TS ↔ Go (REST, internal)

Authenticated by **service-to-service shared secret** in `X-Internal-Token` header. (mTLS is a stretch goal — easier to implement after baseline works.)

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/jobs` | `{ sheet_id, user_id, audio_path, instrument }` | `202 { job_id, status }` |
| `GET`  | `/jobs/:id` | — | `{ id, status, stage, pct, error?, transcription_id? }` |
| `GET`  | `/jobs/:id/stream` | SSE | streamed `{ stage, pct, message }` events |
| `DELETE`| `/jobs/:id` | — | Cancel a running job |
| `GET`  | `/healthz` | — | `{ ok: true }` |

### 7.4 Go ↔ Python (REST, internal)

Plain HTTP on a private port. No auth — Python only listens on localhost / docker network.

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/transcribe` | `{ audio_path, instrument_hint, options }` | `{ midi_b64, music_xml, key, time_signature, tempo_bpm, confidence_map, stage_timings }` |
| `GET`  | `/healthz` | — | `{ ok: true, models_loaded: [...] }` |
| `GET`  | `/version` | — | `{ demucs, basic_pitch, madmom, music21, service }` |

Progress streaming from Python to Go is implemented as an SSE response on `/transcribe` (when `Accept: text/event-stream`), with the final `event: result` carrying the full payload. If SSE proves painful in Python, fallback is: Python POSTs progress events to a Go callback URL passed in the request body.

---

## 8. Authentication & Authorization

### 8.1 End-user auth

- **Method:** email + password. bcryptjs for hashing (cost factor 12).
- **Session:** stateless JWT (HS256) stored in `httpOnly`, `SameSite=Lax`, `Secure` cookie. Expiry 14 days, sliding refresh on activity.
- **Signup:** email verification deferred to post-MVP. The thesis demo doesn't need it.
- **Password reset:** deferred. Admin (you) can reset in DB if needed during defense.

### 8.2 Service-to-service auth (TS → Go)

- TS includes header `X-Internal-Token: <secret>` on every call to Go.
- Secret is a 32-byte random value, stored in `.env`, shared by both services.
- Go middleware rejects any request missing or with a wrong token with HTTP 401.
- For the thesis defense, this is the entire security model on the internal hop. **mTLS is documented in the design plan as the production upgrade path** but not implemented for MVP — see §14.

### 8.3 Authorization

- TS is the **single source of truth** for whether a user owns a sheet. It checks ownership before submitting jobs to Go.
- Go trusts the `user_id` passed in the job submission. Go does not authorize.
- This means: if you ever expose Go publicly, you must add real auth to it first. The design plan flags this as a deliberate trust-boundary choice.

---

## 9. File Storage

For the MVP, all files live on the local filesystem under a single root, mounted as a Docker volume.

```
/var/echonotes/
├── uploads/                     # raw user uploads
│   └── <uuid>.{wav,mp3,flac,...}
└── artifacts/                   # generated outputs
    └── <transcription_uuid>/
        ├── score.musicxml       # canonical notation
        ├── score.svg            # rendered for browser display
        ├── score.pdf            # download
        └── notes.midi           # download
```

**Path discipline.** No service constructs paths from user input. Filenames are always generated UUIDs. The original filename is preserved only as metadata in the DB.

**Serving artifacts to the browser.** TS reads the file from disk and streams it. Future evolution (when storage moves to S3/MinIO/R2): swap the `read_file` call for a presigned URL generator. The browser-side code is unchanged.

**Cleanup.** A nightly cron (a simple `cleanup.sh` in `infra/scripts/`) deletes:
- Uploads older than 7 days whose job is `done` or `failed`
- Soft-deleted sheets older than 30 days

---

## 10. Local Development

### 10.1 Docker Compose layout

```yaml
# infra/docker-compose.yml (abridged)
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: echonotes
      POSTGRES_USER: echonotes
      POSTGRES_PASSWORD: echonotes
    ports: ["5432:5432"]
    volumes: ["pg_data:/var/lib/postgresql/data"]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  ml:
    build: ../ml/transcriber
    ports: ["8001:8000"]  # internal, exposed for debugging only
    volumes:
      - echonotes_data:/var/echonotes

  ai:
    build: ../services/ai-orchestrator
    depends_on: [postgres, redis, ml]
    environment:
      DATABASE_URL: postgres://...
      REDIS_URL: redis://redis:6379
      ML_BASE_URL: http://ml:8000
      INTERNAL_TOKEN: ${INTERNAL_TOKEN}
    volumes:
      - echonotes_data:/var/echonotes

  api:
    build: ../apps/api
    depends_on: [postgres, ai]
    environment:
      DATABASE_URL: postgres://...
      AI_BASE_URL: http://ai:8080
      INTERNAL_TOKEN: ${INTERNAL_TOKEN}
      JWT_SECRET: ${JWT_SECRET}
    ports: ["3000:3000"]
    volumes:
      - echonotes_data:/var/echonotes

volumes:
  pg_data:
  echonotes_data:
```

The frontend (`apps/web`) runs **outside** Docker via `pnpm dev` for fast HMR. Vite proxies `/api` and `/ws` to `http://localhost:3000`.

### 10.2 Bootstrap sequence

```bash
# from repo root
cp infra/.env.example infra/.env       # fill in secrets
pnpm install                            # installs all TS workspaces
docker compose -f infra/docker-compose.yml up -d postgres redis
pnpm --filter @echonotes/api db:migrate # prisma migrations
go -C services/ai-orchestrator run cmd/migrate/main.go  # goose migrations
docker compose -f infra/docker-compose.yml up -d ml ai api
pnpm --filter @echonotes/web dev        # vite, http://localhost:5173
```

### 10.3 Required environment variables

```dotenv
# infra/.env
DATABASE_URL=postgres://echonotes:echonotes@postgres:5432/echonotes
REDIS_URL=redis://redis:6379
INTERNAL_TOKEN=<32-byte hex>
JWT_SECRET=<32-byte hex>
ARTIFACT_ROOT=/var/echonotes
```

---

## 11. Tech Stack Summary

| Concern | Choice |
|---|---|
| Frontend framework | Vue 3 + Vite |
| Frontend language | TypeScript |
| Frontend state | Pinia + TanStack Query for Vue |
| Frontend styling | Tailwind CSS |
| Sheet display | Static SVG (rendered server-side by Verovio) |
| Main backend | Fastify 5 + TypeScript |
| Main backend ORM | Prisma (multi-schema) |
| Main backend validation | Zod |
| AI orchestrator | Go 1.23 + chi |
| AI orchestrator queries | sqlc + pgx |
| AI orchestrator queue | asynq (Redis) |
| AI orchestrator migrations | goose |
| ML service | Python 3.11 + FastAPI |
| ML libraries | Basic Pitch (TF), librosa, music21, Verovio |
| Database | PostgreSQL 16 (single instance, 5 schemas) |
| Queue store | Redis 7 |
| Storage | Local filesystem (S3-compatible API later) |
| Logging | pino · zerolog · structlog |
| Testing | Vitest · `go test` · pytest |
| Container runtime | Docker + docker-compose |
| Repo layout | pnpm workspaces + `go.work` + Python package |

---

## 12. MVP Feature Scope

### 12.1 In scope (thesis MVP)

- Email + password auth, JWT sessions
- Personal workspace: list, organize, delete sheets
- Public profile page at `/u/:username` listing each user's public sheets
- Audio upload (wav, mp3, flac, ogg, m4a) up to 25 MB
- **Solo-instrument recordings only** — the upload UI instructs the user to upload audio with a single instrument
- Asynchronous transcription pipeline (Basic Pitch → librosa → music21 → Verovio)
- **Two supported instruments: guitar, piano**
- **Traditional staff notation** (music21 default output, no instrument-specific notation)
- **Server-side rendering** of the score to SVG (browser display) and PDF (download)
- Sheet detail page: shows the static SVG inline + download buttons (MusicXML, MIDI, PDF)
- Save/organize/delete sheets; toggle public/private; public link viewable without auth
- Admin-authored MDX blog (a handful of posts; you write them)
- WebSocket-driven progress UI during transcription

### 12.2 Out of scope (deferred to Phase 2 or beyond)

- **Source separation (Demucs)** — users must upload solo recordings in the MVP. Mixed/band recordings deferred.
- **Bass and drum transcription** (only guitar and piano in MVP)
- **Instrument-specific notation** (guitar tab, drum notation, etc.)
- **Interactive in-browser sheet viewer** (OSMD)
- **MIDI playback** synchronized with a cursor (Tone.js)
- **Tempo control, A/B loop**, or any practice features
- Community features: comments, stars, follow
- Git-style collaboration: forks, merge requests, diffs
- Confidence-driven review UI (note-level corrections feeding training data)
- Multi-track band mode
- Search (Meilisearch) — defer until there's content to search
- Real-time / streaming transcription
- Voice and lyrics recognition
- Mobile-first PWA
- Cloud deployment, autoscaling
- Payment / monetization tiers
- OAuth providers (Google, GitHub)
- Email verification, password reset

### 12.3 Thesis metric

The primary objective metric, per the academic framing, is **note-level F1** of the transcription pipeline measured on a held-out evaluation set, broken down by instrument (guitar, piano). The design plan reserves an `eval/` directory under `ml/transcriber/` for the eval harness, which is built but not exposed as a runtime feature.

---

## 13. Implementation Milestones

A ~6-month plan, written as monthly milestones with concrete acceptance criteria. Each milestone ends with something demoable.

### Month 1 — Foundation
- Monorepo scaffold, all four services build and respond to `/healthz`
- Postgres + Redis up via Docker Compose
- TS auth (signup, login, JWT cookie) end-to-end working
- Bare-bones Vue app with login + workspace pages (empty workspace)
- Acceptance: a user can sign up, log in, see an empty workspace, log out.

### Month 2 — Pipeline skeleton
- Python ML service running Basic Pitch on a sample solo audio file, returning MIDI
- Go orchestrator accepts a job, calls Python, persists artifacts to disk
- TS upload endpoint working, hands job to Go
- No UI for progress yet — frontend polls every 5s
- Acceptance: end-to-end pipeline produces a MIDI file from a 10-second solo guitar clip, visible in the workspace as a placeholder card.

### Month 3 — Notation + rendering
- librosa beat-tracking stage added (tempo + beat grid + rhythmic quantization of MIDI)
- music21 stage produces clean MusicXML for guitar and piano
- Verovio renders MusicXML → SVG inside the Python service
- PDF generation from MusicXML (Verovio also supports PDF; if quality is poor, fallback to `weasyprint` on the SVG)
- Sheet detail page in Vue shows the static SVG inline + download buttons for MusicXML, MIDI, PDF
- Acceptance: upload → transcribe → see a readable score on the sheet detail page. Downloads work.

### Month 4 — Quality + UX
- WebSocket progress updates replacing any polling
- Failure handling and user-visible error messages on the sheet detail page
- Public/private toggle on sheets; public link works without auth
- Workspace UX polish: tags, list/sort, delete confirmation
- Acceptance: end-to-end flow has live progress, clear errors, and a usable workspace.

### Month 5 — Polish + blog + evaluation
- MDX blog reading + rendering
- Workspace organization (tags, search-within-workspace)
- Eval harness running on a held-out test set, generating F1 numbers for guitar and piano
- Initial thesis writing on results
- Acceptance: clear quality metrics in hand for thesis chapter; admin blog working.

### Month 6 — Thesis defense prep
- Bug bash, polish, accessibility pass
- Demo script recorded
- Defense slides + live-demo dry run
- Acceptance: defense-ready system, reproducible from a fresh clone in under 20 minutes.

---

## 14. Risks & Open Questions

### 14.1 Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **CPU-only Python is slow for live demo** | Medium | Low | Pipeline is much lighter without Demucs/madmom; Basic Pitch on CPU runs ~0.5× realtime. Still wise to pre-process demo files in advance. |
| **Basic Pitch accuracy on polyphonic guitar is low** | Medium | High | Set realistic expectations in the thesis; report F1 with confidence intervals; piano typically performs better — lead the demo with piano. |
| **Users upload mixed/band recordings despite the UI warning** | High | Medium | Upload page shows clear "single instrument only" notice; document the limitation in the FAQ; pipeline still produces output, just lower quality — don't crash. |
| **librosa beat-tracking fails on rubato / free-tempo playing** | Medium | Medium | Document the constraint (steady tempo recommended); offer manual BPM override in a later iteration if needed. |
| **music21 produces messy notation on edge cases** | Medium | Medium | Limit MVP to common time signatures (4/4, 3/4); flag unsupported cases instead of failing. |
| **Verovio SVG quality varies on complex scores** | Medium | Low | Verovio is the standard for digital music notation rendering; tune the layout options; if quality is unacceptable on a piece, fall back to LilyPond for that piece. |
| **Disk fills up from uploads** | Medium | Low | Cleanup cron; per-user upload quota (10 sheets in MVP). |
| **WebSocket flakiness on slow networks** | Low | Low | Fall back to polling if WS fails twice. |
| **Single-service Python coupling** | Low | Low | The pipeline stages are written as independent Python modules; splitting into separate services later is a refactor, not a rewrite. |

### 14.2 Decisions explicitly deferred

- **Interactive sheet viewer + playback** (OSMD + Tone.js, cursor sync, tempo control, A/B loop) — Phase 2 practice features. Not in MVP.
- **Instrument-specific notation** (guitar tab, drum notation, etc.) — Phase 2. MVP uses music21's default traditional notation.
- **Bass and drum transcription** — Phase 2. MVP supports guitar and piano only.
- **Sheet collaboration model** (forks, merge requests, diffs) — Phase 2. Design left intentionally open; the `sheets` schema has room for a `parent_sheet_id` column if needed.
- **Search backend** — Meilisearch reserved; not provisioned in MVP.
- **mTLS between TS and Go** — production upgrade path. Shared secret is sufficient for thesis defense.
- **Object storage migration (S3 / MinIO / R2)** — storage interface in Go is already abstracted behind a small `Storage` interface; swapping is a one-file change.
- **Multi-instrument / band mode** — Phase 2. Schema reserves `transcriptions.transcriptions.parent_id` for future use.

### 14.3 Known unknowns

- Exact memory footprint of the slimmed-down ML stack (estimate: ~500 MB–1 GB; validate in Month 2).
- Whether Verovio's default layout is acceptable for typical transcribed scores or needs tuning (validate early in Month 3).
- How well librosa's `beat_track` performs on solo piano recordings with expressive timing (validate in Month 3 — this is the most likely place we'd swap to madmom if forced).

---

## 15. Document Conventions

- All times are UTC.
- All file paths are POSIX. Windows is not supported for the dev environment.
- All UUIDs are v4 (random), generated server-side — Postgres `gen_random_uuid()` for primary keys, `crypto.randomUUID()` / `uuid.New()` in application code.
- All amounts use SI units (bytes, seconds), not human-readable strings, in the DB.
- All public API responses use `snake_case` for keys; internal TS code uses `camelCase` (mapped at the API boundary).

---

*End of design plan. Implementation begins at Month 1, see §13.*
