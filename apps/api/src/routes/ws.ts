import type { FastifyInstance } from "fastify";
import { WsRegistry } from "../services/wsRegistry.js";
import { orchestrator } from "../services/orchestrator.js";
import { verifyJwt } from "./auth.js";

const activeStreams = new Map<string, AbortController>();

export const wsRegistry = new WsRegistry(
  (jobId) => {
    const controller = orchestrator.streamJobProgress(
      jobId,
      (event) => {
        if (event.status === "done" || event.stage === "done") {
          wsRegistry.broadcast(jobId, {
            type: "job_done",
            job_id: jobId,
            sheet_id: event.sheet_id,
          });
          cleanupStream(jobId);
        } else if (event.status === "failed" || event.error_code) {
          wsRegistry.broadcast(jobId, {
            type: "job_failed",
            job_id: jobId,
            error_code: event.error_code || "UNKNOWN_ERROR",
            message: event.error_msg || event.message || "An error occurred",
          });
          cleanupStream(jobId);
        } else {
          wsRegistry.broadcast(jobId, {
            type: "job_progress",
            job_id: jobId,
            stage: event.stage,
            pct: event.pct,
            message: event.message,
          });
        }
      },
      (err) => {
        wsRegistry.broadcast(jobId, {
          type: "job_failed",
          job_id: jobId,
          error_code: "CONNECTION_ERROR",
          message: err.message,
        });
        cleanupStream(jobId);
      }
    );
    activeStreams.set(jobId, controller);
  },
  (jobId) => {
    cleanupStream(jobId);
  }
);

function cleanupStream(jobId: string) {
  const controller = activeStreams.get(jobId);
  if (controller) {
    controller.abort();
    activeStreams.delete(jobId);
  }
}

export async function wsRoutes(fastify: FastifyInstance) {
  fastify.get("/", { websocket: true }, async (connection, req) => {
    const cookie = req.cookies.session;
    const token = req.query ? (req.query as any).token : undefined;
    const jwt = cookie || token;

    if (!jwt) {
      connection.close(4001, "Unauthorized");
      return;
    }

    try {
      await verifyJwt(jwt);
    } catch {
      connection.close(4001, "Unauthorized");
      return;
    }

    connection.on("message", (messageStr: string) => {
      try {
        const msg = JSON.parse(messageStr);
        if (msg.type === "subscribe_job") {
          wsRegistry.subscribe(msg.job_id, connection);
        } else if (msg.type === "unsubscribe_job") {
          wsRegistry.unsubscribe(msg.job_id, connection);
        } else if (msg.type === "ping") {
          connection.send(JSON.stringify({ type: "pong" }));
        }
      } catch {}
    });

    connection.on("close", () => {
      wsRegistry.unsubscribeAll(connection);
    });
  });
}
