import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";

import { authRoutes } from "./routes/auth.js";
import { sheetsRoutes } from "./routes/sheets.js";
import { blogRoutes } from "./routes/blog.js";
import { wsRoutes } from "./routes/ws.js";
import { profileRoutes } from "./routes/profile.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: { id: string };
  }
}

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info",
  },
});

fastify.setValidatorCompiler(validatorCompiler);
fastify.setSerializerCompiler(serializerCompiler);

await fastify.register(cors, {
  origin: process.env.CORS_ORIGIN || "http://localhost:5173",
  credentials: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
});

await fastify.register(cookie);

await fastify.register(multipart, {
  limits: {
    fileSize: 25 * 1024 * 1024, // 25 MB
    files: 1,
  },
});

await fastify.register(websocket);

fastify.get("/healthz", async () => ({ ok: true }));

await fastify.register(authRoutes, { prefix: "/api" });
await fastify.register(sheetsRoutes, { prefix: "/api/sheets" });
await fastify.register(blogRoutes, { prefix: "/api/blog" });
await fastify.register(wsRoutes, { prefix: "/api/ws" });
await fastify.register(profileRoutes, { prefix: "/api/u" });

const start = async () => {
  try {
    const port = Number(process.env.PORT || 3000);
    const host = process.env.HOST || "127.0.0.1";
    await fastify.listen({ port, host });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
export default fastify;
export { fastify };
