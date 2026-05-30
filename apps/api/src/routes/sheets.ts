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

const ARTIFACT_ROOT = process.env.ARTIFACT_ROOT || "C:/var/echonotes";

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const cookie = req.cookies.session;
  if (!cookie) {
    reply.code(401);
    throw new Error("Unauthorized");
  }
  try {
    const { userId } = await verifyJwt(cookie);
    req.user = { id: userId };
  } catch {
    reply.code(401);
    throw new Error("Unauthorized");
  }
}

export async function sheetsRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<ZodTypeProvider>();

  server.get(
    "/",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const sheets = await prisma.sheet.findMany({
        where: {
          ownerId: req.user!.id,
          deletedAt: null,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
      return { sheets };
    }
  );

  server.post(
    "/upload",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const data = await req.file();
      if (!data) {
        reply.code(400);
        return { error: { code: "NO_FILE", message: "No file uploaded" } };
      }

      const titleField = data.fields.title;
      const instrumentField = data.fields.instrument;
      const visibilityField = data.fields.visibility;

      const title = (titleField && "value" in titleField) ? String(titleField.value) : "Untitled";
      const instrument = (instrumentField && "value" in instrumentField) ? String(instrumentField.value) : "piano";
      const visibility = (visibilityField && "value" in visibilityField) ? String(visibilityField.value) : "private";

      if (instrument !== "guitar" && instrument !== "piano") {
        reply.code(400);
        return { error: { code: "INVALID_INSTRUMENT", message: "Instrument must be piano or guitar" } };
      }

      if (visibility !== "private" && visibility !== "public") {
        reply.code(400);
        return { error: { code: "INVALID_VISIBILITY", message: "Visibility must be private or public" } };
      }

      const uploadsDir = path.join(ARTIFACT_ROOT, "uploads");
      await fs.promises.mkdir(uploadsDir, { recursive: true });

      const filename = data.filename;
      const ext = path.extname(filename) || ".wav";
      const uuid = crypto.randomUUID();
      const audioFilename = `${uuid}${ext}`;
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
        },
      });

      try {
        const jobRes = await orchestrator.submitJob(
          sheet.id,
          req.user!.id,
          audioPath,
          instrument
        );

        return {
          sheetId: sheet.id,
          jobId: jobRes.job_id,
        };
      } catch (err: any) {
        await prisma.sheet.update({
          where: { id: sheet.id },
          data: { status: "failed" },
        });
        reply.code(500);
        return { error: { code: "ORCHESTRATOR_ERROR", message: err.message } };
      }
    }
  );

  server.get(
    "/:id",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      const sheet = await prisma.sheet.findFirst({
        where: { id, deletedAt: null },
      });

      if (!sheet) {
        reply.code(404);
        return { error: { code: "NOT_FOUND", message: "Sheet not found" } };
      }

      if (sheet.ownerId !== req.user!.id && sheet.visibility !== "public") {
        reply.code(403);
        return { error: { code: "FORBIDDEN", message: "Access denied" } };
      }

      let musicXml = null;
      if (sheet.status === "ready" && sheet.transcriptionId) {
        const xmlPath = path.join(ARTIFACT_ROOT, "artifacts", sheet.transcriptionId, "score.musicxml");
        try {
          musicXml = await fs.promises.readFile(xmlPath, "utf-8");
        } catch {}
      }

      return { sheet, musicXml };
    }
  );

  server.patch(
    "/:id",
    {
      preHandler: [requireAuth],
      schema: {
        body: z.object({
          title: z.string().min(1).optional(),
          visibility: z.enum(["private", "public"]).optional(),
        }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { title, visibility } = req.body;

      const sheet = await prisma.sheet.findFirst({
        where: { id, deletedAt: null },
      });

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
          title: title ?? sheet.title,
          visibility: visibility ?? sheet.visibility,
        },
      });

      return { sheet: updated };
    }
  );

  server.delete(
    "/:id",
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      const sheet = await prisma.sheet.findFirst({
        where: { id, deletedAt: null },
      });

      if (!sheet) {
        reply.code(404);
        return { error: { code: "NOT_FOUND", message: "Sheet not found" } };
      }

      if (sheet.ownerId !== req.user!.id) {
        reply.code(403);
        return { error: { code: "FORBIDDEN", message: "Access denied" } };
      }

      await prisma.sheet.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      return { success: true };
    }
  );

  server.get(
    "/public/:id",
    async (req, reply) => {
      const { id } = req.params as { id: string };

      const sheet = await prisma.sheet.findFirst({
        where: { id, visibility: "public", deletedAt: null },
      });

      if (!sheet) {
        reply.code(404);
        return { error: { code: "NOT_FOUND", message: "Sheet not found" } };
      }

      let musicXml = null;
      if (sheet.status === "ready" && sheet.transcriptionId) {
        const xmlPath = path.join(ARTIFACT_ROOT, "artifacts", sheet.transcriptionId, "score.musicxml");
        try {
          musicXml = await fs.promises.readFile(xmlPath, "utf-8");
        } catch {}
      }

      return { sheet, musicXml };
    }
  );

  server.get(
    "/:id/download/:format",
    async (req, reply) => {
      const { id, format } = req.params as { id: string; format: string };

      const sheet = await prisma.sheet.findFirst({
        where: { id, deletedAt: null },
      });

      if (!sheet) {
        reply.code(404);
        return { error: { code: "NOT_FOUND", message: "Sheet not found" } };
      }

      if (sheet.visibility !== "public") {
        const cookie = req.cookies.session;
        if (!cookie) {
          reply.code(401);
          return { error: { code: "UNAUTHORIZED", message: "Unauthorized" } };
        }
        try {
          const { userId } = await verifyJwt(cookie);
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
        return { error: { code: "NOT_READY", message: "Transcription is not ready" } };
      }

      let filename = "score";
      let contentType = "application/octet-stream";

      switch (format) {
        case "musicxml":
          filename = "score.musicxml";
          contentType = "application/vnd.recordare.musicxml+xml";
          break;
        case "svg":
          filename = "score.svg";
          contentType = "image/svg+xml";
          break;
        case "pdf":
          filename = "score.pdf";
          contentType = "application/pdf";
          break;
        case "midi":
          filename = "score.mid";
          contentType = "audio/midi";
          break;
        default:
          reply.code(400);
          return { error: { code: "INVALID_FORMAT", message: "Invalid download format" } };
      }

      const filePath = path.join(ARTIFACT_ROOT, "artifacts", sheet.transcriptionId, filename);
      if (!fs.existsSync(filePath)) {
        reply.code(404);
        return { error: { code: "FILE_NOT_FOUND", message: "Requested file not found on server" } };
      }

      reply.header("Content-Type", contentType);
      reply.header("Content-Disposition", `attachment; filename="${filename}"`);
      return fs.createReadStream(filePath);
    }
  );
}
