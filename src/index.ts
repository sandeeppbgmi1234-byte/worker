import express from "express";
import { setupWorker } from "./worker";
import { prisma } from "./db/db.ts";
import Redis from "ioredis";
import type { Worker } from "bullmq";

const app = express();
const PORT = process.env.WORKER_PORT || 8080;

app.use(express.json());

// Stores worker instance
let worker: Worker | null = null;

// Health check endpoint
app.get("/health", async (req, res) => {
  const status = {
    database: "ok",
    redis: "ok",
    bullmq: "ok",
  };

  // Checks database
  try {
    await prisma.$connect();
  } catch {
    status.database = "error";
  }

  // Checks Redis
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

  // Checks BullMQ worker
  if (!worker || !worker.isRunning()) {
    status.bullmq = "error";
  }

  const allOk = status.database === "ok" && status.redis === "ok" && status.bullmq === "ok";

  res.status(allOk ? 200 : 503).json({
    status: allOk ? "ok" : "error",
    service: "worker",
    connections: status,
    timestamp: new Date().toISOString(),
  });
});

// Starts the BullMQ worker
try {
  worker = setupWorker();
} catch (error) {
  console.error("❌ Failed to start worker:", error);
  process.exit(1);
}

// Starts the Express server
app.listen(PORT, () => {
  console.log(`🚀 Worker service running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
});
