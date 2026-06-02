import type { FastifyInstance } from "fastify";
import type { BlogPostMeta, BlogPostFull } from "@echonotes/shared-types";
import fs from "node:fs";
import path from "node:path";

import { parseFrontmatter } from "../utils/frontmatter.js";

const BLOG_DIR = path.resolve(process.cwd(), "../../content/blog");

async function loadPost(file: string): Promise<BlogPostFull> {
  const slug = file.replace(/\.(mdx?|md)$/, "");
  const raw = await fs.promises.readFile(path.join(BLOG_DIR, file), "utf-8");
  const { meta, content } = parseFrontmatter(raw);

  return {
    slug,
    title: meta["title"] ?? slug,
    date: meta["date"] ?? null,
    excerpt: meta["excerpt"] ?? null,
    author: meta["author"] ?? null,
    content,
  };
}

export async function blogRoutes(fastify: FastifyInstance) {
  // GET /api/blog — list all posts with metadata only (no body).
  fastify.get("/", async (_req, reply) => {
    if (!fs.existsSync(BLOG_DIR)) {
      return { posts: [] as BlogPostMeta[] };
    }

    try {
      const files = (await fs.promises.readdir(BLOG_DIR)).filter(
        (f) => f.endsWith(".mdx") || f.endsWith(".md")
      );

      const posts: BlogPostMeta[] = await Promise.all(
        files.map(async (file) => {
          const post = await loadPost(file);
          const { content: _, ...meta } = post;
          void _;
          return meta;
        })
      );

      // Sort newest first by date string (ISO format sorts lexicographically).
      posts.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

      return { posts };
    } catch {
      reply.code(500);
      return { error: { code: "BLOG_READ_ERROR", message: "Failed to read blog posts" } };
    }
  });

  // GET /api/blog/:slug — single post with full content.
  fastify.get("/:slug", async (req, reply) => {
    const { slug } = req.params as { slug: string };

    // Prevent path traversal.
    if (slug.includes("..") || slug.includes("/") || slug.includes("\\")) {
      reply.code(400);
      return { error: { code: "INVALID_SLUG", message: "Invalid slug" } };
    }

    const candidates = [`${slug}.mdx`, `${slug}.md`];

    for (const file of candidates) {
      const full = path.join(BLOG_DIR, file);
      if (fs.existsSync(full)) {
        try {
          return { post: await loadPost(file) };
        } catch {
          break;
        }
      }
    }

    reply.code(404);
    return { error: { code: "NOT_FOUND", message: "Blog post not found" } };
  });
}
