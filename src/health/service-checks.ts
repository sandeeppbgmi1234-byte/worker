import { prisma } from "../db/db";
import Redis from "ioredis";
import type { Worker } from "bullmq";
import { REDIS_CONNECTION, QUEUE_CONNECTION } from "../config/redis.config";
import type { ServiceHealth } from "./types";

export async function checkDatabase(): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    await prisma.user.count();
    return {
      status: "UP",
      latency: Date.now() - start,
    };
  } catch (error) {
    return {
      status: "DOWN",
      details: {
        error: error instanceof Error ? error.message : "Unknown error",
      },
    };
  }
}

async function checkRedis(
  connection: any,
  name: string,
): Promise<ServiceHealth> {
  const start = Date.now();
  // Using a separate client instance for health checks
  const redis = new Redis({
    ...connection,
    connectTimeout: 2000,
    lazyConnect: true,
  });

  try {
    await redis.connect();
    await redis.ping();
    await redis.quit();
    return {
      status: "UP",
      latency: Date.now() - start,
    };
  } catch (error) {
    return {
      status: "DOWN",
      details: {
        error: error instanceof Error ? error.message : "Connect failed",
        serviceName: name,
      },
    };
  }
}

export async function checkUpstashRedis(): Promise<ServiceHealth> {
  return checkRedis(REDIS_CONNECTION, "Upstash (Caching)");
}

export async function checkQueueRedis(): Promise<ServiceHealth> {
  return checkRedis(QUEUE_CONNECTION, "Queue (BullMQ)");
}

export async function checkBullMQWorker(
  worker: Worker | null,
): Promise<ServiceHealth> {
  if (!worker) {
    return {
      status: "DOWN",
      details: { error: "Worker not initialized" },
    };
  }

  const isRunning = worker.isRunning();
  return {
    status: isRunning ? "UP" : "DOWN",
    details: {
      isPaused: worker.isPaused(),
      queueName: worker.name,
    },
  };
}
