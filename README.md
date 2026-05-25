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
- Python 3.11+
- Docker & docker-compose

## Setup

\`\`\`bash
git clone https://github.com/<you>/echonotes
cd echonotes
cp infra/.env.example infra/.env       # fill in INTERNAL_TOKEN and JWT_SECRET
pnpm install
docker compose -f infra/docker-compose.yml up -d postgres redis
pnpm --filter @echonotes/api db:migrate
go -C services/ai-orchestrator run cmd/migrate/main.go
docker compose -f infra/docker-compose.yml up -d ml ai api
pnpm dev:web                            # http://localhost:5173
\`\`\`

## Project structure

See the design plan, §5.

## License

[TBD]
