import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";

import { authRoutes } from "./routes/auth.js";
import { sheetsRoutes } from "./routes/sheets.js";
import { blogRoutes } from "./routes/blog.js";
import { wsRoutes } from "./routes/ws.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: { id: string };
  }
}

const fastify = Fastify({ logger: true });

fastify.setValidatorCompiler(validatorCompiler);
fastify.setSerializerCompiler(serializerCompiler);

await fastify.register(cookie);
await fastify.register(multipart, {
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});
await fastify.register(websocket);

await fastify.register(authRoutes, { prefix: "/api" });
await fastify.register(sheetsRoutes, { prefix: "/api/sheets" });
await fastify.register(blogRoutes, { prefix: "/api/blog" });
await fastify.register(wsRoutes, { prefix: "/api/ws" });

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
