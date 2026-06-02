#!/usr/bin/env tsx
/**
 * EchoNotes — database seed script.
 *
 * Inserts a demo user and a couple of placeholder sheets so a fresh clone
 * has something to show in the workspace view without uploading a real file.
 *
 * Usage (from repo root):
 *   pnpm --filter @echonotes/api db:seed
 *
 * Environment:
 *   DATABASE_URL — must be set (see infra/.env.example).
 *
 * Idempotent: uses upsert, so running it twice is safe.
 */

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient({
  log: ['warn', 'error'],
})

async function main() {
  console.log('==> Seeding EchoNotes database…')

  // ── Demo user ────────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash('demo1234', 12)

  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@echonotes.test' },
    create: {
      email: 'demo@echonotes.test',
      username: 'demo',
      passwordHash,
      displayName: 'Demo User',
    },
    update: {
      // Re-hash password on every seed run in case the cost factor changed.
      passwordHash,
    },
  })
  console.log(`    User: demo@echonotes.test (username: demo, id: ${demoUser.id})`)

  // ── Demo sheets (placeholder — status "ready" with a fake transcription) ─
  // These give the workspace view something to render before any real upload.
  const sheets = [
    {
      title: 'Greensleeves (demo)',
      instrument: 'guitar',
      visibility: 'public',
      status: 'ready',
      audioPath: '/var/echonotes/uploads/demo-greensleeves.wav',
      tags: ['demo', 'folk', 'guitar'],
      transcriptionId: '00000000-0000-0000-0000-000000000001',
    },
    {
      title: 'Für Elise — excerpt (demo)',
      instrument: 'piano',
      visibility: 'private',
      status: 'ready',
      audioPath: '/var/echonotes/uploads/demo-fur-elise.wav',
      tags: ['demo', 'classical', 'piano'],
      transcriptionId: '00000000-0000-0000-0000-000000000002',
    },
    {
      title: 'Uploading… (pending example)',
      instrument: 'piano',
      visibility: 'private',
      status: 'pending',
      audioPath: '/var/echonotes/uploads/demo-pending.wav',
      tags: ['demo'],
      transcriptionId: null,
    },
  ]

  for (const s of sheets) {
    const sheet = await prisma.sheet.upsert({
      where: {
        // Upsert on title+ownerId so re-seeding keeps the same rows.
        // (Prisma requires a unique field for upsert — we use id with a
        //  deterministic suffix based on position.)
        id: `00000000-0000-0000-0001-${String(sheets.indexOf(s) + 1).padStart(12, '0')}`,
      },
      create: {
        id: `00000000-0000-0000-0001-${String(sheets.indexOf(s) + 1).padStart(12, '0')}`,
        ownerId: demoUser.id,
        ...s,
      },
      update: { title: s.title, status: s.status },
    })
    console.log(`    Sheet: "${sheet.title}" (${sheet.status}, ${sheet.visibility})`)
  }

  console.log('==> Seed complete.')
  console.log('')
  console.log('  Demo credentials:')
  console.log('    Email:    demo@echonotes.test')
  console.log('    Password: demo1234')
}

main()
  .catch((err) => {
    console.error('Seed failed:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
