import { prisma } from "../db/db";
import Redis from "ioredis";
import type { Worker } from "bullmq";
import { REDIS_CONNECTION, QUEUE_CONNECTION } from "../config/redis.config";
import type { ServiceHealth } from "./types";
import { getRedisClient, getQueueRedisClient } from "../redis/client";

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

async function checkRedisInstance(
  name: string,
  clientGetter: () => any,
): Promise<ServiceHealth> {
  const start = Date.now();
  const redis = clientGetter();
  if (!redis) {
    return {
      status: "DOWN",
      details: { error: "Redis client not initialized", serviceName: name },
    };
  }

  try {
    const res = await redis.ping();
    if (res !== "PONG") throw new Error("Recieved unexpected ping response");
    return {
      status: "UP",
      latency: Date.now() - start,
    };
  } catch (error) {
    return {
      status: "DOWN",
      details: {
        error: error instanceof Error ? error.message : "Ping failed",
        serviceName: name,
      },
    };
  }
}

export async function checkUpstashRedis(): Promise<ServiceHealth> {
  return checkRedisInstance("Upstash (Caching)", getRedisClient);
}

export async function checkQueueRedis(): Promise<ServiceHealth> {
  return checkRedisInstance("Queue (BullMQ)", getQueueRedisClient);
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
