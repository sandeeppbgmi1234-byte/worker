import { getRedisClient } from "../client";
import { KEYS, TTL } from "../keys";
import { RedisError } from "../errors";
import { logger } from "../../utils/pino";

/**
 * Domain: User Connections
 * Tracks whether a user's Instagram account is actively connected.
 * This is used to short-circuit processing for disconnected users without hitting MongoDB.
 */

/**
 * Checks if a user is actively connected.
 *
 * @param instagramUserId User ID from Instagram
 * @param dbFallback The fallback function to query MongoDB if Redis misses
 * @returns true if connected, false if disconnected
 */
export async function isUserConnected(
  instagramUserId: string,
  dbFallback: () => Promise<boolean>,
): Promise<boolean> {
  const redis = getRedisClient();
  const key = KEYS.USER_CONNECTION(instagramUserId);

  if (!redis) {
    logger.info(
      { instagramUserId },
      "[Redis:User] Client unavailable, falling back to MongoDB",
    );
    return dbFallback();
  }

  try {
    const cached = await redis.get(key);

    // Cache Hit
    if (cached) {
      logger.info(
        { instagramUserId, hit: true },
        "[Redis:User] Status retrieved",
      );
      return cached === "1";
    }

    // Cache Miss -> DB Fallback -> Repopulate
    logger.info(
      { instagramUserId, hit: false },
      "[Redis:User] Status missing, falling back to MongoDB",
    );
    const isConnected = await dbFallback();

    // Repopulate Cache (Fire and Forget to avoid blocking)
    redis
      .set(key, isConnected ? "1" : "0", "EX", TTL.USER_CONNECTED)
      .catch((e) => {
        logger.warn(
          { instagramUserId, error: e.message },
          "[Redis:User] Failed to repopulate cache",
        );
      });

    return isConnected;
  } catch (error: any) {
    logger.error(
      { instagramUserId, error: error.message },
      "[Redis:User] Operation failed, falling back to MongoDB",
    );
    // Fallback on error
    return dbFallback();
  }
}

/**
 * Explicitly sets a user as connected in Redis.
 * Used when a user successfully connects their Instagram account.
 */
export async function setUserConnected(instagramUserId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  const key = KEYS.USER_CONNECTION(instagramUserId);
  try {
    await redis.set(key, "1", "EX", TTL.USER_CONNECTED);
    logger.info({ instagramUserId }, "[Redis:User] Status marked as connected");
  } catch (error: any) {
    // We log but don't throw, as Next.js app / Worker shouldn't crash over cache update failures
    logger.error(
      { instagramUserId, error: error.message },
      "[Redis:User] Failed to set connected status",
    );
  }
}

/**
 * Atomically clears all cache keys associated with a user when they disconnect.
 * Requires `accountId` to find associated tokens.
 */
export async function invalidateUser(
  instagramUserId: string,
  clerkId: string,
  accountId?: string,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    const pipeline = redis.pipeline();
    pipeline.del(KEYS.USER_CONNECTION(instagramUserId));

    if (accountId) {
      pipeline.del(KEYS.ACCESS_TOKEN(accountId));
    }

    // Delete all automations for this user matching the pattern ig:automation:clerkId:*
    // Requires a safe SCAN operation
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        `ig:automation:${clerkId}:*`,
        "COUNT",
        100,
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        pipeline.del(...keys);
      }
    } while (cursor !== "0");

    await pipeline.exec();
    logger.info(
      { instagramUserId, clerkId, accountId },
      "[Redis:User] All user cache invalidated",
    );
  } catch (error: any) {
    logger.error(
      { instagramUserId, clerkId, error: error.message },
      "[Redis:User] Failed to invalidate cache",
    );
  }
}
