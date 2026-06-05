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
- GNU make (included with Git for Windows, WSL, or `choco install make`)

## Setup

Clone and run the one-time setup — it copies `infra/.env`, auto-generates the
required secrets, and installs all dependencies:

```bash
git clone https://github.com/<you>/echonotes
cd echonotes
make setup
```

Then apply the database migrations (starts postgres automatically if it isn't running):

```bash
make migrate
```

Optionally seed a demo user and a couple of sheets:

```bash
make seed
```

## Run

```bash
make dev      # starts all backend services in Docker + the frontend at http://localhost:5173
make stop     # stop when done (data is preserved)
```

The first `make dev` after cloning is slow — Docker pulls the Basic Pitch / TensorFlow
wheels for the ML service. Subsequent starts are fast.

Verify everything is up:

```bash
make health
```

| Service | URL / port |
|---|---|
| Web (Vite) | http://localhost:5173 |
| Main backend (Fastify) | http://localhost:3000 |
| AI orchestrator (Go) | http://localhost:8080 |
| ML service (Python) | http://localhost:8001 |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

Other useful commands:

```bash
make logs                          # tail logs from all containers
make seed                          # load demo user + sheets
make clean                         # stop + wipe all volumes (full reset)
./infra/scripts/reset-db.sh --force   # wipe + re-migrate the DB only
```

Run `make` with no arguments to see all available targets.

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
