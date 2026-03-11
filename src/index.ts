import { setupWorker } from "./queue/worker";
import { prisma } from "./db/db";
import Redis from "ioredis";
import type { Worker } from "bullmq";
import { logger } from "./logger";
import { REDIS_CONNECTION, QUEUE_CONNECTION } from "./config/redis.config";
import { WORKER_CONFIG } from "./config/worker.config";

const PORT = WORKER_CONFIG.PORT;
let worker: Worker | null = null;

try {
  worker = setupWorker();
} catch (error) {
  logger.error(error, "Failed to start worker:");
  process.exit(1);
}

process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully...");
  if (worker) {
    await worker.close();
    logger.info("Worker closed");
  }
  process.exit(0);
});

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      const status = {
        database: "ok",
        redis: "ok",
        queue_redis: "ok",
        bullmq: "ok",
      };

      try {
        await prisma.$connect();
      } catch {
        status.database = "error";
      }

      try {
        const redis = new Redis({
          ...REDIS_CONNECTION,
          connectTimeout: 3000,
        });
        await redis.ping();
        await redis.quit();
      } catch {
        status.redis = "error";
      }

      try {
        const qRedis = new Redis({
          ...QUEUE_CONNECTION,
          connectTimeout: 3000,
        });
        await qRedis.ping();
        await qRedis.quit();
      } catch {
        status.queue_redis = "error";
      }

      if (!worker || !worker.isRunning()) {
        status.bullmq = "error";
      }

      const allOk =
        status.database === "ok" &&
        status.redis === "ok" &&
        status.queue_redis === "ok" &&
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

    return new Response("Not Found", { status: 404 });
  },
});

logger.info(`Worker service running on port ${PORT}`);
logger.info(`Health check: http://localhost:${PORT}/health`);
