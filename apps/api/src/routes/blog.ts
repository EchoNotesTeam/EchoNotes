import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";

const BLOG_DIR = path.resolve(process.cwd(), "../../content/blog");

export async function blogRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (req, reply) => {
    try {
      if (!fs.existsSync(BLOG_DIR)) {
        return { posts: [] };
      }

      const files = await fs.promises.readdir(BLOG_DIR);
      const posts = [];

      for (const file of files) {
        if (file.endsWith(".mdx") || file.endsWith(".md")) {
          const slug = file.replace(/\.(mdx|md)$/, "");
          const content = await fs.promises.readFile(path.join(BLOG_DIR, file), "utf-8");
          posts.push({ slug, content });
        }
      }

      return { posts };
    } catch {
      return { posts: [] };
    }
  });

  fastify.get("/:slug", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    try {
      const files = [
        path.join(BLOG_DIR, `${slug}.mdx`),
        path.join(BLOG_DIR, `${slug}.md`),
      ];

      for (const filePath of files) {
        if (fs.existsSync(filePath)) {
          const content = await fs.promises.readFile(filePath, "utf-8");
          return { slug, content };
        }
      }

      reply.code(404);
      return { error: { code: "NOT_FOUND", message: "Blog post not found" } };
    } catch {
      reply.code(404);
      return { error: { code: "NOT_FOUND", message: "Blog post not found" } };
    }
  });
}
