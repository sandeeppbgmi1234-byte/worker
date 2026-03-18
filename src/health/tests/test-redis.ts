import { checkUpstashRedis, checkQueueRedis } from "../service-checks";
import { logger } from "../../logger";

async function runTest() {
  logger.info("Testing Redis Connections...");

  const [upstash, queue] = await Promise.all([
    checkUpstashRedis(),
    checkQueueRedis(),
  ]);

  if (upstash.status === "UP") {
    logger.info(`✅ Upstash Redis connected! Latency: ${upstash.latency}ms`);
  } else {
    logger.error(`❌ Upstash Redis failed: ${upstash.details?.error}`);
  }

  if (queue.status === "UP") {
    logger.info(`✅ Queue Redis connected! Latency: ${queue.latency}ms`);
  } else {
    logger.error(`❌ Queue Redis failed: ${queue.details?.error}`);
  }

  if (upstash.status === "DOWN" || queue.status === "DOWN") {
    process.exit(1);
  }
}

runTest().catch(console.error);
