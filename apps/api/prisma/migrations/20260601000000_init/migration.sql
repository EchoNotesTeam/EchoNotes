-- EchoNotes — initial Prisma migration
-- Creates the two TS-owned schemas (auth, sheets) and their tables.
--
-- Generated for Prisma 6.x with multiSchema preview feature.
-- schema.prisma source: apps/api/prisma/schema.prisma
--
-- Design plan ref: §6.1, §6.4

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "auth";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "sheets";

-- CreateTable: auth.users
-- Owned by the TypeScript backend. Password is bcrypt-hashed (cost 12).
-- email and username both carry UNIQUE constraints enforced at DB level.
CREATE TABLE "auth"."users" (
    "id"            UUID        NOT NULL DEFAULT gen_random_uuid(),
    "email"         TEXT        NOT NULL,
    "username"      TEXT        NOT NULL,
    "password_hash" TEXT        NOT NULL,
    "display_name"  TEXT        NOT NULL,
    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable: sheets.sheets
-- transcription_id is a soft reference to transcriptions.transcriptions.id
-- (owned by the Go service). No cross-schema FK constraint — see §6.2.
CREATE TABLE "sheets"."sheets" (
    "id"               UUID        NOT NULL DEFAULT gen_random_uuid(),
    "owner_id"         UUID        NOT NULL,
    "title"            TEXT        NOT NULL,
    "instrument"       TEXT        NOT NULL,
    "visibility"       TEXT        NOT NULL DEFAULT 'private',
    "status"           TEXT        NOT NULL DEFAULT 'pending',
    "transcription_id" UUID,
    "audio_path"       TEXT        NOT NULL,
    "tags"             TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at"       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at"       TIMESTAMPTZ,

    CONSTRAINT "sheets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique email
CREATE UNIQUE INDEX "users_email_key" ON "auth"."users"("email");

-- CreateIndex: unique username
CREATE UNIQUE INDEX "users_username_key" ON "auth"."users"("username");

-- CreateIndex: sheets by owner (common query in workspace view)
CREATE INDEX "sheets_owner_id_idx" ON "sheets"."sheets"("owner_id");

-- CreateIndex: sheets by status (used by workspace status-filter tabs)
CREATE INDEX "sheets_status_idx" ON "sheets"."sheets"("status");

-- CreateIndex: public ready sheets listing (landing + profile pages)
CREATE INDEX "sheets_visibility_status_idx" ON "sheets"."sheets"("visibility", "status");

-- AddForeignKey: sheets.owner_id → auth.users.id
-- Cross-schema FK is valid in PostgreSQL within the same database instance.
-- Cascade delete: removing a user removes all their sheets automatically.
ALTER TABLE "sheets"."sheets"
    ADD CONSTRAINT "sheets_owner_id_fkey"
    FOREIGN KEY ("owner_id")
    REFERENCES "auth"."users"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
