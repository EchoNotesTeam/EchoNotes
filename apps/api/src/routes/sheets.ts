import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { prisma } from "../db/client.js";
import { verifyJwt } from "./auth.js";
import { orchestrator } from "../services/orchestrator.js";
import { ALLOWED_EXTENSIONS, ALLOWED_MIMES } from "../utils/audioValidation.js";

const ARTIFACT_ROOT = process.env.ARTIFACT_ROOT || "/var/echonotes";

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies.session;
  if (!token) {
    reply.code(401);
    throw new Error("Unauthorized");
  }
  try {
    const { userId } = await verifyJwt(token);
    req.user = { id: userId };
  } catch {
    reply.code(401);
    throw new Error("Unauthorized");
  }
}

function artifactDir(transcriptionId: string) {
  return path.join(ARTIFACT_ROOT, "artifacts", transcriptionId);
}

async function readArtifact(transcriptionId: string, filename: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(path.join(artifactDir(transcriptionId), filename), "utf-8");
  } catch {
    return null;
  }
}

export async function sheetsRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<ZodTypeProvider>();

  // GET /api/sheets — list the authenticated user's sheets (paginated).
  server.get(
    "/",
    {
      preHandler: [requireAuth],
      schema: {
        querystring: z.object({
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(20),
          status: z.enum(["pending", "processing", "ready", "failed"]).optional(),
        }),
      },
    },
    async (req) => {
      const { page, limit, status } = req.query;
      const skip = (page - 1) * limit;

      const [sheets, total] = await prisma.$transaction([
        prisma.sheet.findMany({
          where: { ownerId: req.user!.id, deletedAt: null, ...(status ? { status } : {}) },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.sheet.count({
          where: { ownerId: req.user!.id, deletedAt: null, ...(status ? { status } : {}) },
        }),
      ]);

      return { sheets, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
    }
  );

  // POST /api/sheets/upload — accept a multipart audio file + metadata.
  server.post(
    "/upload",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const data = await req.file();
      if (!data) {
        reply.code(400);
        return { error: { code: "NO_FILE", message: "No file uploaded" } };
      }

      const field = (name: string) => {
        const f = data.fields[name];
        return f && "value" in f ? String(f.value) : undefined;
      };

      const title = field("title") ?? "Untitled";
      const instrument = field("instrument") ?? "piano";
      const visibility = field("visibility") ?? "private";
      const tagsRaw = field("tags");
      const tags = tagsRaw
        ? tagsRaw
            .split(",")
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean)
            .slice(0, 10)
        : [];

      if (instrument !== "guitar" && instrument !== "piano") {
        reply.code(400);
        return { error: { code: "INVALID_INSTRUMENT", message: "Instrument must be guitar or piano" } };
      }

      if (visibility !== "private" && visibility !== "public") {
        reply.code(400);
        return { error: { code: "INVALID_VISIBILITY", message: "Visibility must be private or public" } };
      }

      // Validate by extension; MIME is also checked but browsers send inconsistent types.
      const ext = path.extname(data.filename).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        reply.code(400);
        return {
          error: {
            code: "INVALID_FILE_TYPE",
            message: `Unsupported file type. Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`,
          },
        };
      }

      if (data.mimetype && !ALLOWED_MIMES.has(data.mimetype)) {
        reply.code(400);
        return { error: { code: "INVALID_MIME_TYPE", message: "Unsupported audio format" } };
      }

      const uploadsDir = path.join(ARTIFACT_ROOT, "uploads");
      await fs.promises.mkdir(uploadsDir, { recursive: true });

      const audioFilename = `${crypto.randomUUID()}${ext}`;
      const audioPath = path.join(uploadsDir, audioFilename).replace(/\\/g, "/");

      const writeStream = fs.createWriteStream(audioPath);
      await pipeline(data.file, writeStream);

      const sheet = await prisma.sheet.create({
        data: {
          ownerId: req.user!.id,
          title,
          instrument,
          visibility,
          status: "pending",
          audioPath,
          tags,
        },
      });

      try {
        const jobRes = await orchestrator.submitJob(sheet.id, req.user!.id, audioPath, instrument);
        return { sheetId: sheet.id, jobId: jobRes.job_id };
      } catch (err: unknown) {
        await prisma.sheet.update({ where: { id: sheet.id }, data: { status: "failed" } });
        reply.code(500);
        return {
          error: {
            code: "ORCHESTRATOR_ERROR",
            message: err instanceof Error ? err.message : "Failed to submit transcription job",
          },
        };
      }
    }
  );

  // GET /api/sheets/public — listing of all public sheets (no auth required).
  server.get("/public", async (req: FastifyRequest, _reply) => {
    const query = req.query as { page?: string; limit?: string };
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const [sheets, total] = await prisma.$transaction([
      prisma.sheet.findMany({
        where: { visibility: "public", status: "ready", deletedAt: null },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: { owner: { select: { username: true, displayName: true } } },
      }),
      prisma.sheet.count({ where: { visibility: "public", status: "ready", deletedAt: null } }),
    ]);

    return { sheets, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  });

  // GET /api/sheets/public/:id — public sheet detail without auth.
  server.get("/public/:id", async (req: FastifyRequest, reply) => {
    const { id } = req.params as { id: string };

    const sheet = await prisma.sheet.findFirst({
      where: { id, visibility: "public", deletedAt: null },
      include: { owner: { select: { username: true, displayName: true } } },
    });

    if (!sheet) {
      reply.code(404);
      return { error: { code: "NOT_FOUND", message: "Sheet not found" } };
    }

    let svg: string | null = null;
    if (sheet.status === "ready" && sheet.transcriptionId) {
      svg = await readArtifact(sheet.transcriptionId, "score.svg");
    }

    return { sheet, svg };
  });

  // GET /api/sheets/:id — sheet detail for the owner or any user if public.
  server.get("/:id", { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const sheet = await prisma.sheet.findFirst({
      where: { id, deletedAt: null },
      include: { owner: { select: { username: true, displayName: true } } },
    });

    if (!sheet) {
      reply.code(404);
      return { error: { code: "NOT_FOUND", message: "Sheet not found" } };
    }

    if (sheet.ownerId !== req.user!.id && sheet.visibility !== "public") {
      reply.code(403);
      return { error: { code: "FORBIDDEN", message: "Access denied" } };
    }

    let svg: string | null = null;
    if (sheet.status === "ready" && sheet.transcriptionId) {
      svg = await readArtifact(sheet.transcriptionId, "score.svg");
    }

    return { sheet, svg };
  });

  // PATCH /api/sheets/:id — update title, visibility, or tags.
  server.patch(
    "/:id",
    {
      preHandler: [requireAuth],
      schema: {
        body: z.object({
          title: z.string().min(1).max(200).optional(),
          visibility: z.enum(["private", "public"]).optional(),
          tags: z.array(z.string().min(1).max(30)).max(10).optional(),
        }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { title, visibility, tags } = req.body;

      const sheet = await prisma.sheet.findFirst({ where: { id, deletedAt: null } });

      if (!sheet) {
        reply.code(404);
        return { error: { code: "NOT_FOUND", message: "Sheet not found" } };
      }

      if (sheet.ownerId !== req.user!.id) {
        reply.code(403);
        return { error: { code: "FORBIDDEN", message: "Access denied" } };
      }

      const updated = await prisma.sheet.update({
        where: { id },
        data: {
          ...(title !== undefined ? { title } : {}),
          ...(visibility !== undefined ? { visibility } : {}),
          ...(tags !== undefined ? { tags } : {}),
        },
      });

      return { sheet: updated };
    }
  );

  // DELETE /api/sheets/:id — soft delete.
  server.delete("/:id", { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const sheet = await prisma.sheet.findFirst({ where: { id, deletedAt: null } });

    if (!sheet) {
      reply.code(404);
      return { error: { code: "NOT_FOUND", message: "Sheet not found" } };
    }

    if (sheet.ownerId !== req.user!.id) {
      reply.code(403);
      return { error: { code: "FORBIDDEN", message: "Access denied" } };
    }

    await prisma.sheet.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true };
  });

  // GET /api/sheets/:id/download/:format — file download (attachment).
  server.get("/:id/download/:format", async (req: FastifyRequest, reply) => {
    const { id, format } = req.params as { id: string; format: string };

    const sheet = await prisma.sheet.findFirst({ where: { id, deletedAt: null } });
    if (!sheet) {
      reply.code(404);
      return { error: { code: "NOT_FOUND", message: "Sheet not found" } };
    }

    // Private sheets require auth.
    if (sheet.visibility !== "public") {
      const token = req.cookies.session;
      if (!token) {
        reply.code(401);
        return { error: { code: "UNAUTHORIZED", message: "Unauthorized" } };
      }
      try {
        const { userId } = await verifyJwt(token);
        if (sheet.ownerId !== userId) {
          reply.code(403);
          return { error: { code: "FORBIDDEN", message: "Access denied" } };
        }
      } catch {
        reply.code(401);
        return { error: { code: "UNAUTHORIZED", message: "Unauthorized" } };
      }
    }

    if (sheet.status !== "ready" || !sheet.transcriptionId) {
      reply.code(400);
      return { error: { code: "NOT_READY", message: "Transcription is not ready yet" } };
    }

    type FormatInfo = { filename: string; contentType: string };
    const formats: Record<string, FormatInfo> = {
      musicxml: { filename: "score.musicxml", contentType: "application/vnd.recordare.musicxml+xml" },
      svg:      { filename: "score.svg",      contentType: "image/svg+xml" },
      pdf:      { filename: "score.pdf",      contentType: "application/pdf" },
      midi:     { filename: "notes.midi",     contentType: "audio/midi" },
    };

    const info = formats[format];
    if (!info) {
      reply.code(400);
      return { error: { code: "INVALID_FORMAT", message: "Valid formats: musicxml, svg, pdf, midi" } };
    }

    const filePath = path.join(artifactDir(sheet.transcriptionId), info.filename);
    if (!fs.existsSync(filePath)) {
      reply.code(404);
      return { error: { code: "FILE_NOT_FOUND", message: "Artifact not found on server" } };
    }

    reply.header("Content-Type", info.contentType);
    reply.header("Content-Disposition", `attachment; filename="${info.filename}"`);
    return fs.createReadStream(filePath);
  });
}
