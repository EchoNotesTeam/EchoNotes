import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "../db/client.js";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "fallback-secret-at-least-32-chars-long"
);
const COOKIE_NAME = "session";

export async function signJwt(payload: { userId: string }): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("14d")
    .sign(JWT_SECRET);
}

export async function verifyJwt(token: string): Promise<{ userId: string }> {
  const { payload } = await jwtVerify(token, JWT_SECRET);
  return payload as { userId: string };
}

function userPayload(user: { id: string; email: string; username: string; displayName: string }) {
  return { id: user.id, email: user.email, username: user.username, displayName: user.displayName };
}

export async function authRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<ZodTypeProvider>();

  server.post(
    "/auth/signup",
    {
      schema: {
        body: z.object({
          email: z.string().email(),
          username: z
            .string()
            .min(3)
            .max(30)
            .regex(/^[a-z0-9_]+$/, "Username may only contain lowercase letters, digits, and underscores"),
          password: z.string().min(6),
          displayName: z.string().min(1).max(60),
        }),
      },
    },
    async (req, reply) => {
      const { email, username, password, displayName } = req.body;

      const existing = await prisma.user.findFirst({
        where: { OR: [{ email }, { username }] },
      });
      if (existing) {
        reply.code(400);
        return {
          error: {
            code: existing.email === email ? "EMAIL_EXISTS" : "USERNAME_TAKEN",
            message: existing.email === email ? "Email already registered" : "Username already taken",
          },
        };
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const user = await prisma.user.create({
        data: { email, username, passwordHash, displayName },
      });

      const token = await signJwt({ userId: user.id });
      reply.setCookie(COOKIE_NAME, token, {
        path: "/",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 14 * 24 * 60 * 60,
      });

      return { user: userPayload(user) };
    }
  );

  server.post(
    "/auth/login",
    {
      schema: {
        body: z.object({
          email: z.string().email(),
          password: z.string(),
        }),
      },
    },
    async (req, reply) => {
      const { email, password } = req.body;

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        reply.code(401);
        return { error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" } };
      }

      const token = await signJwt({ userId: user.id });
      reply.setCookie(COOKIE_NAME, token, {
        path: "/",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 14 * 24 * 60 * 60,
      });

      return { user: userPayload(user) };
    }
  );

  server.post("/auth/logout", async (_, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return { success: true };
  });

  server.get("/me", async (req, reply) => {
    const token = req.cookies[COOKIE_NAME];
    if (!token) {
      reply.code(401);
      return { error: { code: "UNAUTHORIZED", message: "Unauthorized" } };
    }

    try {
      const { userId } = await verifyJwt(token);
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        reply.code(401);
        return { error: { code: "UNAUTHORIZED", message: "Unauthorized" } };
      }
      return { user: userPayload(user) };
    } catch {
      reply.code(401);
      return { error: { code: "UNAUTHORIZED", message: "Unauthorized" } };
    }
  });
}
