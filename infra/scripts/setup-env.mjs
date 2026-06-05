#!/usr/bin/env node
// Copies infra/.env.example → infra/.env and fills in random 32-byte hex secrets.
// Safe to re-run: exits early if infra/.env already exists.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const src = 'infra/.env.example';
const dst = 'infra/.env';

if (existsSync(dst)) {
  console.log('infra/.env already exists — skipping (delete it to regenerate)');
  process.exit(0);
}

let content = readFileSync(src, 'utf8');
content = content.replace('change_me_to_32_byte_hex', randomBytes(32).toString('hex'));
content = content.replace('change_me_to_another_32_byte_hex', randomBytes(32).toString('hex'));
writeFileSync(dst, content, 'utf8');
console.log('Created infra/.env with auto-generated secrets');
