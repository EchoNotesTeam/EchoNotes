# EchoNotes — development workflow
#
#   First time:  make setup
#                make migrate
#
#   Every day:   make dev          ← starts all services + frontend
#                make stop         ← when done
#
#   Utilities:   make logs         ← tail all container logs
#                make health       ← check all service health endpoints
#                make seed         ← load demo user + sheets
#                make clean        ← wipe everything (destructive)

COMPOSE  := docker compose -f infra/docker-compose.yml
DB_LOCAL := postgres://echonotes:echonotes@localhost:5432/echonotes

.PHONY: help setup install db migrate seed services dev stop clean logs health

help:
	@awk 'BEGIN{FS=":.*##"} /^[a-z_-]+:.*##/{printf "  \033[36m%-12s\033[0m %s\n",$$1,$$2}' $(MAKEFILE_LIST)

# ── One-time setup ───────────────────────────────────────────────────────────

setup: ## Copy infra/.env, auto-generate secrets, install pnpm deps
	node infra/scripts/setup-env.mjs
	$(MAKE) install

install: ## Install all pnpm workspace dependencies
	pnpm install

# ── Database ─────────────────────────────────────────────────────────────────

db: ## Start postgres + redis and wait until postgres is healthy
	$(COMPOSE) up -d postgres redis
	@echo "Waiting for postgres..."
	@until $(COMPOSE) exec -T postgres pg_isready -U echonotes -d echonotes >/dev/null 2>&1; do sleep 1; done
	@echo "Postgres is ready."

migrate: db ## Run Prisma + Goose migrations (calls db first)
	DATABASE_URL=$(DB_LOCAL) ./infra/scripts/migrate.sh

seed: ## Seed demo user and sheets into the database
	pnpm --filter @echonotes/api db:seed

# ── App services ─────────────────────────────────────────────────────────────

services: ## Build and start ml + ai + api in Docker (first run is slow)
	$(COMPOSE) up -d --build ml ai api

# ── Dev loop ─────────────────────────────────────────────────────────────────

dev: db services ## Start backend services then launch the frontend (http://localhost:5173)
	pnpm dev:web

# ── Ops ──────────────────────────────────────────────────────────────────────

stop: ## Stop all Docker services (data is preserved)
	$(COMPOSE) stop

clean: ## Stop services and delete all volumes — destroys all data!
	$(COMPOSE) down -v

logs: ## Tail logs from all running containers
	$(COMPOSE) logs -f

health: ## Check health endpoints for all services
	./infra/scripts/healthcheck.sh
