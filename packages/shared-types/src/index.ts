/**
 * @echonotes/shared-types
 *
 * Single source of truth for all domain types shared between:
 *   - apps/web   (Vue 3 SPA)
 *   - apps/api   (Fastify backend)
 *
 * Keep this file free of any runtime code — types only.
 */

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface User {
  id: string
  email: string
  username: string
  displayName: string
}

// ─── Sheets ───────────────────────────────────────────────────────────────────

export type SheetStatus = 'pending' | 'processing' | 'ready' | 'failed'
export type Instrument = 'guitar' | 'piano'
export type Visibility = 'private' | 'public'

export interface SheetOwner {
  username: string
  displayName: string
}

export interface Sheet {
  id: string
  ownerId: string
  title: string
  instrument: Instrument
  visibility: Visibility
  status: SheetStatus
  transcriptionId: string | null
  audioPath: string
  tags: string[]
  createdAt: string
  deletedAt: string | null
  owner?: SheetOwner
}

export interface Pagination {
  page: number
  limit: number
  total: number
  pages: number
}

// ─── Blog ─────────────────────────────────────────────────────────────────────

export interface BlogPostMeta {
  slug: string
  title: string
  date: string | null
  excerpt: string | null
  author: string | null
}

export interface BlogPostFull extends BlogPostMeta {
  content: string
}

// ─── Profile ─────────────────────────────────────────────────────────────────

export interface ProfileUser {
  id: string
  username: string
  displayName: string
  createdAt: string
}

// ─── WebSocket messages (Browser ↔ TS backend) ───────────────────────────────
// These must stay in sync with apps/api/src/routes/ws.ts

export type WsJobEvent =
  | { type: 'job_progress'; job_id: string; stage: string; pct: number; message?: string }
  | { type: 'job_done'; job_id: string; sheet_id: string }
  | { type: 'job_failed'; job_id: string; error_code: string; message: string }
  | { type: 'pong' }
