import type { FastifyInstance } from "fastify";
import { prisma } from "../db/client.js";

export async function profileRoutes(fastify: FastifyInstance) {
  // GET /api/u/:username — public profile with the user's public ready sheets.
  fastify.get("/:username", async (req, reply) => {
    const { username } = req.params as { username: string };

    if (username.includes("..") || username.includes("/")) {
      reply.code(400);
      return { error: { code: "INVALID_USERNAME", message: "Invalid username" } };
    }

    const user = await prisma.user.findUnique({
      where: { username },
      select: { id: true, username: true, displayName: true, createdAt: true },
    });

    if (!user) {
      reply.code(404);
      return { error: { code: "NOT_FOUND", message: "User not found" } };
    }

    const sheets = await prisma.sheet.findMany({
      where: { ownerId: user.id, visibility: "public", status: "ready", deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, instrument: true, tags: true, createdAt: true },
    });

    return { user, sheets };
  });
}
