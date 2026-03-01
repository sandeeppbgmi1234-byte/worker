import { setupWorker } from "./worker";
import { prisma } from "./db/db.ts";
import Redis from "ioredis";
import type { Worker } from "bullmq";
import { logger } from "./lib/utils/pino.ts";

const PORT = process.env.WORKER_PORT || 8080;

// Stores worker instance
let worker: Worker | null = null;

// Starts the BullMQ worker
try {
  worker = setupWorker();
} catch (error) {
  logger.error(error, "❌ Failed to start worker:");
  process.exit(1);
}

// Graceful shutdown on SIGTERM
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully...");
  if (worker) {
    await worker.close();
    logger.info("Worker closed");
  }
  process.exit(0);
});

// Lightweight HTTP server for health checks using Bun
Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // Health check endpoint
    if (url.pathname === "/health") {
      const status = {
        database: "ok",
        redis: "ok",
        bullmq: "ok",
      };

      // Check database connection
      try {
        await prisma.$connect();
      } catch {
        status.database = "error";
      }

      // Check Redis connection
      try {
        const redis = new Redis({
          host: process.env.UPSTASH_REDIS_HOST,
          port: 6379,
          username: process.env.UPSTASH_REDIS_USERNAME,
          password: process.env.UPSTASH_REDIS_PASSWORD,
          tls: {},
          connectTimeout: 3000,
        });
        await redis.ping();
        await redis.quit();
      } catch {
        status.redis = "error";
      }

      // Check BullMQ worker status
      if (!worker || !worker.isRunning()) {
        status.bullmq = "error";
      }

      const allOk =
        status.database === "ok" &&
        status.redis === "ok" &&
        status.bullmq === "ok";

      return Response.json(
        {
          status: allOk ? "ok" : "error",
          service: "worker",
          connections: status,
          timestamp: new Date().toISOString(),
        },
        { status: allOk ? 200 : 503 },
      );
    }

    // Default 404 for other routes
    return new Response("Not Found", { status: 404 });
  },
});

logger.info(`🚀 Worker service running on port ${PORT}`);
logger.info(`📍 Health check: http://localhost:${PORT}/health`);
