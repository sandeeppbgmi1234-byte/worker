import type { Worker } from "bullmq";
import {
  checkDatabase,
  checkUpstashRedis,
  checkQueueRedis,
  checkBullMQWorker,
} from "./service-checks";
import { getSystemMetrics } from "./system-metrics";
import type { HealthStatus } from "./types";

export interface HealthResponse {
  status: HealthStatus;
  service: "worker-service";
  timestamp: string;
  uptime: number;
  system: ReturnType<typeof getSystemMetrics>;
  connections: {
    database: Awaited<ReturnType<typeof checkDatabase>>;
    redis: Awaited<ReturnType<typeof checkUpstashRedis>>;
    queueRedis: Awaited<ReturnType<typeof checkQueueRedis>>;
    bullmqWorker: Awaited<ReturnType<typeof checkBullMQWorker>>;
  };
}

export async function aggregateHealthStatus(
  worker: Worker | null,
): Promise<HealthResponse> {
  // Parallelize health checks for efficiency
  const [db, redis, qRedis, bmq] = await Promise.all([
    checkDatabase(),
    checkUpstashRedis(),
    checkQueueRedis(),
    checkBullMQWorker(worker),
  ]);

  const allOk =
    db.status === "UP" &&
    redis.status === "UP" &&
    qRedis.status === "UP" &&
    bmq.status === "UP";

  const systemMetrics = getSystemMetrics();

  return {
    status: allOk ? "UP" : "DOWN",
    service: "worker-service",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    system: systemMetrics,
    connections: {
      database: db,
      redis,
      queueRedis: qRedis,
      bullmqWorker: bmq,
    },
  };
}
