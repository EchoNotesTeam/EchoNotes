# EchoNotes

Audio recordings → editable sheet music, powered by Basic Pitch + music21 + Verovio.

> Thesis MVP — guitar & piano, solo recordings only, static sheet rendering.

## Stack

- **Frontend** — Vue 3 + TypeScript + Vite + Tailwind
- **Main backend** — Fastify + TypeScript + Prisma + bcrypt + Zod
- **AI orchestrator** — Go + chi + sqlc + asynq (Redis)
- **ML service** — Python + FastAPI + Basic Pitch + librosa + music21 + Verovio
- **Database** — PostgreSQL 16 (multi-schema)
- **Storage** — Local filesystem

See [`docs/EchoNotes_Design_Plan.md`](docs/EchoNotes_Design_Plan.md) for the full architecture.

## Prerequisites

- Node.js 22+
- pnpm 9+
- Go 1.23+
- Python 3.11+ (the ML service builds in Docker on a pinned base image)
- Docker & docker-compose

## Setup

```bash
git clone https://github.com/<you>/echonotes
cd echonotes

# 1. Environment
cp infra/.env.example infra/.env
openssl rand -hex 32   # paste as INTERNAL_TOKEN in infra/.env
openssl rand -hex 32   # paste as JWT_SECRET  in infra/.env

# 2. Dependencies (all TS workspaces)
pnpm install
```

## Run

The backend services run in Docker; the Vue frontend runs natively for fast HMR.

```bash
# Infra first
docker compose -f infra/docker-compose.yml up -d postgres redis

# Create the DB schemas — Prisma (auth, sheets) then goose (jobs, transcriptions).
# Run from the host, so point DATABASE_URL at localhost (not the docker hostname).
DATABASE_URL=postgres://echonotes:echonotes@localhost:5432/echonotes \
  ./infra/scripts/migrate.sh

# Optional: seed a demo user + a couple of sheets
pnpm --filter @echonotes/api db:seed

# Build and start the three app services (ml → ai → api, gated by healthchecks).
# The first ml build is slow — it pulls the Basic Pitch / TensorFlow wheels.
docker compose -f infra/docker-compose.yml up -d --build ml ai api

# Frontend (hot reload) → http://localhost:5173
pnpm dev:web
```

Verify everything is up:

```bash
./infra/scripts/healthcheck.sh
```

| Service | URL / port |
|---|---|
| Web (Vite) | http://localhost:5173 |
| Main backend (Fastify) | http://localhost:3000 |
| AI orchestrator (Go) | http://localhost:8080 |
| ML service (Python) | http://localhost:8001 |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

Common operations:

```bash
docker compose -f infra/docker-compose.yml logs -f ai    # tail a service
docker compose -f infra/docker-compose.yml down          # stop (keeps volumes)
./infra/scripts/reset-db.sh --force                      # wipe + re-migrate the DB
```

## Test

The TS and Go unit tests are pure (no live DB required) — run them after `pnpm install`,
without bringing the stack up.

```bash
# Full quality gate (what CI / "Ready for PR" runs)
pnpm -r build        # TS build across web + api + shared-types
pnpm -r lint         # ESLint across web + api
pnpm -r test         # Vitest: apps/api + apps/web suites

# Go orchestrator
go -C services/ai-orchestrator vet ./...
go -C services/ai-orchestrator test ./...

# Python ML (heavy deps; optional — prefer the Docker ml service or a 3.11 venv)
pip install -e "ml/transcriber[dev]"
pytest ml/transcriber

# Inter-service contracts
npx @redocly/cli lint packages/contracts/*.yaml
```

Run a single workspace:

```bash
pnpm --filter @echonotes/api test
pnpm --filter @echonotes/web test
```

CI wires these same steps together in
[`.github/actions/run-checks/action.yaml`](.github/actions/run-checks/action.yaml).

## Project structure

See the design plan, §5.

## License

[TBD]
