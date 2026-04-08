import { getRedisClient } from "../client";
import { KEYS } from "../keys";

/**
 * Increments the creditsUsed counter in Redis by 1 for a specific user (Clerk ID).
 * Called after a successful automation execution.
 */
export async function incrementCreditUsedR(
  clerkId: string,
): Promise<number | null> {
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    const SIX_MONTHS = 180 * 24 * 60 * 60;
    const key = KEYS.CREDIT_USED(clerkId);

    const multi = redis.multi();
    multi.incr(key);
    multi.ttl(key);

    const results = await multi.exec();
    if (!results) return null;

    // results is [[error, result], [error, result]]
    const count = (results[0][1] as number) || 0;
    const ttl = (results[1][1] as number) || -1;

    // If key is new (TTL -1), set expiry
    if (ttl === -1) {
      await redis.expire(key, SIX_MONTHS);
    }

    return count;
  } catch (error) {
    return null;
  }
}
