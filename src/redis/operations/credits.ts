import { getRedisClient } from "../client";
import { KEYS } from "../keys";
import { logger } from "../../logger";

/**
 * Returns current credit state from Redis.
 */
export async function getCreditStateR(clerkUserId: string): Promise<{
  creditsUsed: number | null;
  creditLimit: number | null;
  subStatus: string | null;
}> {
  const redis = getRedisClient();
  if (!redis) return { creditsUsed: null, creditLimit: null, subStatus: null };

  try {
    const [used, limit, status] = await redis.mget(
      KEYS.CREDIT_USED(clerkUserId),
      KEYS.CREDIT_LIMIT(clerkUserId),
      KEYS.SUB_STATUS(clerkUserId),
    );

    return {
      creditsUsed: used !== null ? parseInt(used, 10) : null,
      creditLimit: limit !== null ? parseInt(limit, 10) : null,
      subStatus: status,
    };
  } catch (error: any) {
    logger.warn({ error, clerkUserId }, "getCreditStateR failed");
    return { creditsUsed: null, creditLimit: null, subStatus: null };
  }
}

/**
 * Persists credit state back into Redis (Self-Healing).
 */
export async function setCreditStateR(
  clerkUserId: string,
  creditsUsed: number,
  creditLimit: number,
  subStatus: string,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    const pipeline = redis.pipeline();
    pipeline.set(KEYS.CREDIT_USED(clerkUserId), creditsUsed.toString());
    pipeline.set(KEYS.CREDIT_LIMIT(clerkUserId), creditLimit.toString());
    pipeline.set(KEYS.SUB_STATUS(clerkUserId), subStatus);
    await pipeline.exec();
  } catch (error: any) {
    logger.warn({ error, clerkUserId }, "setCreditStateR failed");
  }
}

/**
 * Atomically increments credit usage.
 */
export async function incrementCreditUsedR(clerkUserId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    await redis.incr(KEYS.CREDIT_USED(clerkUserId));
  } catch (error: any) {
    logger.warn({ error, clerkUserId }, "incrementCreditUsedR failed");
  }
}
