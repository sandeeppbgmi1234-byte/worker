import { getRedisClient } from "../client";
import { KEYS, TTL } from "../keys";
import { encrypt, decrypt } from "../../helpers/encryption";
import { logger } from "../../logger";

export async function getAccessTokenR(
  accountId: string,
  dbFallback: () => Promise<string>,
): Promise<string> {
  const redis = getRedisClient();
  const tokenKey = KEYS.ACCESS_TOKEN(accountId);
  const lockKey = KEYS.TOKEN_REFRESH_LOCK(accountId);

  if (!redis) return dbFallback();

  try {
    // 1. First-pass: Fast cache check
    const cachedEncrypted = await redis.get(tokenKey);
    if (cachedEncrypted) {
      try {
        return decrypt(cachedEncrypted);
      } catch (err) {
        logger.warn(
          { accountId },
          "Failed to decrypt cached token. Proceeding to refresh.",
        );
      }
    }

    // 2. Distributed Lock: Only one worker should handle the refresh/DB-fetch
    // We try to set the lock key for 30 seconds (longer than any refresh should take)
    const acquiredLock = await redis.set(lockKey, "1", "EX", 30, "NX");

    if (acquiredLock === "OK") {
      try {
        // We won the race! Fetch fresh token from DB/API
        const validToken = await dbFallback();
        // Encrypt and Cache it
        await redis.set(tokenKey, encrypt(validToken), "EX", TTL.ACCESS_TOKEN);
        return validToken;
      } finally {
        // Always release the lock
        await redis.del(lockKey);
      }
    } else {
      // 3. Waiting Room: Someone else is already refreshing the token.
      // We wait and re-check the cache every 200ms for up to 5 seconds.
      let waitRetries = 0;
      const maxRetries = 25; // 5 seconds total

      while (waitRetries < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 200));

        const freshCached = await redis.get(tokenKey);
        if (freshCached) {
          try {
            return decrypt(freshCached);
          } catch (e) {
            // If decryption fails, something is wrong with the cache; break and fallback
            break;
          }
        }

        // If the lock is gone but no token is in cache, it means the other worker failed.
        // We break the loop and try to acquire the lock ourselves in the fallback below.
        const lockSTillExists = await redis.exists(lockKey);
        if (!lockSTillExists) break;

        waitRetries++;
      }

      // Final fallback: If waiting failed or timed out, just hit the DB directly
      return dbFallback();
    }
  } catch (error: any) {
    logger.error(
      { accountId, error: error.message },
      "Error in getAccessTokenR",
    );
    return dbFallback();
  }
}

export async function cacheAccessTokenR(
  accountId: string,
  token: string,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    const encrypted = encrypt(token);
    await redis.set(
      KEYS.ACCESS_TOKEN(accountId),
      encrypted,
      "EX",
      TTL.ACCESS_TOKEN,
    );
  } catch (error: any) {}
}
