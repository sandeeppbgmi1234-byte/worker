import { getRedisClient } from "../client";
import { KEYS, TTL } from "../keys";
import { logger } from "../../logger";

/**
 * Fetches InstaAccount data from Redis with DB fallback.
 */
export async function getAccountByInstagramIdR<T>(
  instagramUserId: string,
  dbFallback: () => Promise<T | null>,
): Promise<T | null> {
  const redis = getRedisClient();
  const key = KEYS.ACCOUNT_BY_IG(instagramUserId);

  if (!redis) return dbFallback();

  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached);

    const account = await dbFallback();
    if (account)
      redis
        .set(key, JSON.stringify(account), "EX", TTL.AUTOMATION_TTL)
        .catch(() => {});
    return account;
  } catch (error: any) {
    return dbFallback();
  }
}

/**
 * Checks if a user connection is active in Redis.
 */
export async function isUserConnectedR(
  webhookUserId: string,
  dbFallback: () => Promise<boolean>,
): Promise<boolean> {
  const redis = getRedisClient();
  const key = KEYS.USER_CONNECTION(webhookUserId);

  if (!redis) {
    return dbFallback();
  }

  try {
    const cached = await redis.get(key);
    if (cached) return cached === "1";

    const isConnected = await dbFallback();
    redis
      .set(key, isConnected ? "1" : "0", "EX", TTL.USER_CONNECTED)
      .catch(() => {});
    return isConnected;
  } catch (error: any) {
    return dbFallback();
  }
}

/**
 * Sets user connection status in Redis.
 */
export async function setUserConnectedR(webhookUserId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  const key = KEYS.USER_CONNECTION(webhookUserId);
  try {
    await redis.set(key, "1", "EX", TTL.USER_CONNECTED);
  } catch (error: any) {}
}

/**
 * Invalidates ALL cache keys related to a specific Instagram account.
 * This is used when a token is revoked or an account is deactivated.
 */
export async function invalidateUserCacheR(
  clerkId: string,
  webhookUserId: string,
  instagramUserId?: string,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    const pipeline = redis.pipeline();

    // 1. Delete direct lookup keys
    pipeline.del(KEYS.USER_CONNECTION(webhookUserId));
    if (instagramUserId) {
      pipeline.del(KEYS.ACCOUNT_BY_IG(instagramUserId));
    } else {
      pipeline.del(KEYS.ACCOUNT_BY_IG(webhookUserId));
    }
    pipeline.del(KEYS.ACCESS_TOKEN(clerkId, webhookUserId));
    pipeline.del(KEYS.TOKEN_REFRESH_LOCK(webhookUserId));
    pipeline.del(KEYS.ACCOUNT_USAGE(webhookUserId));
    pipeline.del(KEYS.INSTAGRAM_POSTS(webhookUserId));
    pipeline.del(KEYS.INSTAGRAM_STORIES(webhookUserId));
    pipeline.del(KEYS.AUTOMATIONS_FOR_ACCOUNT_DM(webhookUserId));

    // 2. SCAN and delete dynamic automation keys (Post/Story specific)
    // Format: ig:automation:post:<webhookUserId>:*
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        `ig:automation:*:${webhookUserId}:*`,
        "COUNT",
        100,
      );

      cursor = nextCursor;
      if (keys.length > 0) pipeline.del(...keys);
    } while (cursor !== "0");

    await pipeline.exec();

    logger.info(
      { clerkId, webhookUserId, instagramUserId },
      "Purged all Redis cache keys for account due to deactivation/refresh.",
    );
  } catch (error: any) {
    logger.error(
      { clerkId, webhookUserId, instagramUserId, error: error.message },
      "Failed to purge user cache keys.",
    );
  }
}
