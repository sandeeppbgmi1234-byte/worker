import type { Worker } from "bullmq";
import { logger } from "./logger";
import { WORKER_CONFIG } from "./config/worker.config";
import { aggregateHealthStatus } from "./health";
import { setupWorker } from "./queue/worker";

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
      const healthStatus = await aggregateHealthStatus(worker);

      return Response.json(healthStatus, {
        status: healthStatus.status === "UP" ? 200 : 503,
      });
    }

    return new Response("Not Found", { status: 404 });
  },
});

logger.info(`Worker service running on port ${PORT}`);
logger.info(`Health check: http://localhost:${PORT}/health`);
