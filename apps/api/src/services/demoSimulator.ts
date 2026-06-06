import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { prisma } from "../db/client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ARTIFACT_ROOT = process.env.ARTIFACT_ROOT ?? "/var/echonotes";

// The pre-built PDF shipped with the repo.
// Path is the same whether running under tsx locally or inside Docker
// (Dockerfile copies it to the same relative location).
const DEMO_PDF_SRC =
  process.env.DEMO_PDF_PATH ??
  path.resolve(__dirname, "../../../../apps/web/src/stores/To_Zanankard.pdf");

type SimConfig = { sheetId: string };

// Populated by sheets.ts before the response is sent; consumed by ws.ts
// when the frontend subscribes to the job.
export const pendingDemos = new Map<string, SimConfig>();

export type BroadcastFn = (event: object) => void;

const STAGES = [
  { stage: "transcribe", pct: 15, message: "Transcribing audio with Basic Pitch",    ms: 2200 },
  { stage: "transcribe", pct: 32, message: "Detecting pitch events",                  ms: 2800 },
  { stage: "quantize",   pct: 50, message: "Detecting tempo and quantizing rhythm",   ms: 2000 },
  { stage: "notate",     pct: 67, message: "Generating notation with music21",        ms: 2500 },
  { stage: "render",     pct: 82, message: "Rendering score with Verovio",            ms: 2000 },
  { stage: "render",     pct: 95, message: "Generating PDF",                          ms: 1800 },
] as const;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runDemoFor(jobId: string, broadcast: BroadcastFn): Promise<void> {
  const config = pendingDemos.get(jobId);
  if (!config) return; // already running or job not registered
  pendingDemos.delete(jobId); // prevent double-run (Node.js is single-threaded, safe)

  const { sheetId } = config;

  // Stream fake progress events with realistic delays.
  for (const { stage, pct, message, ms } of STAGES) {
    await sleep(ms);
    broadcast({ type: "job_progress", job_id: jobId, stage, pct, message });
  }

  // Build artifact directory and populate files.
  const transcriptionId = crypto.randomUUID();
  const dir = path.join(ARTIFACT_ROOT, "artifacts", transcriptionId);
  await fs.promises.mkdir(dir, { recursive: true });

  // PDF — the real pre-built file.
  try {
    await fs.promises.copyFile(DEMO_PDF_SRC, path.join(dir, "score.pdf"));
  } catch {
    // Source PDF not found at expected path — write a 0-byte placeholder so
    // downloads return 200 rather than crashing the server.
    await fs.promises.writeFile(path.join(dir, "score.pdf"), Buffer.alloc(0));
  }

  // Minimal SVG so the sheet detail view renders something.
  await fs.promises.writeFile(
    path.join(dir, "score.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="160">` +
      `<rect width="1200" height="160" fill="#fafafa" rx="4"/>` +
      `<text x="60" y="100" font-family="Georgia,serif" font-size="36" fill="#1a1a1a">To Zanankard</text>` +
      `</svg>`,
    "utf-8"
  );

  // Empty placeholders so all download format endpoints resolve without 404.
  await fs.promises.writeFile(path.join(dir, "score.musicxml"), "", "utf-8");
  await fs.promises.writeFile(path.join(dir, "notes.midi"), Buffer.alloc(0));

  // Mark sheet as ready.
  await prisma.sheet.update({
    where: { id: sheetId },
    data: { status: "ready", transcriptionId },
  });

  broadcast({ type: "job_done", job_id: jobId, sheet_id: sheetId });
}
