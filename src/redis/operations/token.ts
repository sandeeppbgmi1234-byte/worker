import { getRedisClient } from "../client";
import { KEYS, TTL } from "../keys";
import { encrypt, decrypt } from "../../helpers/encryption";
import { logger } from "../../logger";

/**
 * Fetches access token with a distributed lock mechanism to prevent "Thundering Herd" refreshes.
 */
export async function getAccessTokenR(
  clerkId: string,
  webhookUserId: string,
  dbFallback: () => Promise<string>,
): Promise<string> {
  const redis = getRedisClient();
  const tokenKey = KEYS.ACCESS_TOKEN(clerkId, webhookUserId);
  const lockKey = KEYS.TOKEN_REFRESH_LOCK(webhookUserId);

  if (!redis) return dbFallback();

  try {
    // 1. First-pass: Fast cache check
    const cachedEncrypted = await redis.get(tokenKey);
    if (cachedEncrypted) {
      try {
        return decrypt(cachedEncrypted);
      } catch (err) {
        logger.warn(
          { webhookUserId },
          "Failed to decrypt cached token. Proceeding to refresh.",
        );
      }
    }

    // 2. Distributed Lock: Only one worker should handle the refresh/DB-fetch
    const acquiredLock = await redis.set(lockKey, "1", "EX", 30, "NX");

    if (acquiredLock === "OK") {
      try {
        // We won the race! Fetch fresh token from DB/API
        const validToken = await dbFallback();
        // Encrypt and Cache it
        await redis.set(tokenKey, encrypt(validToken), "EX", TTL.ACCESS_TOKEN);
        return validToken;
      } finally {
        await redis.del(lockKey);
      }
    } else {
      // 3. Waiting Room: Someone else is already refreshing the token.
      let waitRetries = 0;
      const maxRetries = 25; // 5 seconds total

      while (waitRetries < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 200));

        const freshCached = await redis.get(tokenKey);
        if (freshCached) {
          try {
            return decrypt(freshCached);
          } catch (e) {
            break;
          }
        }

        const lockSTillExists = await redis.exists(lockKey);
        if (!lockSTillExists) break;

        waitRetries++;
      }

      return dbFallback();
    }
  } catch (error: any) {
    logger.error(
      { webhookUserId, error: error.message },
      "Error in getAccessTokenR",
    );
    return dbFallback();
  }
}

/**
 * Manually cache or update an access token.
 */
export async function cacheAccessTokenR(
  clerkId: string,
  webhookUserId: string,
  token: string,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    const encrypted = encrypt(token);
    await redis.set(
      KEYS.ACCESS_TOKEN(clerkId, webhookUserId),
      encrypted,
      "EX",
      TTL.ACCESS_TOKEN,
    );
  } catch (error: any) {
    logger.warn(
      { error: error.message },
      "Failed to cache access token manually",
    );
  }
}
