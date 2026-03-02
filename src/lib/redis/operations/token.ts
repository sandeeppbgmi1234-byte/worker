import { getRedisClient } from "../client";
import { KEYS, TTL } from "../keys";
import { RedisError } from "../errors";
import { logger } from "../../utils/pino";

/**
 * Domain: Tokens
 * Long-Lived Instagram Access Tokens. They are updated frequently natively
 * by the worker whenever handling story replies and valid for several hours contextually.
 */

/**
 * Fetches the user Access Token securely. Needs MongoDB fallback.
 *
 * @param accountId Intenal Instagram Account DB ID
 * @param dbFallback Database fallback query returning a guaranteed valid token
 */
export async function getAccessToken(
  accountId: string,
  dbFallback: () => Promise<string>,
): Promise<string> {
  const redis = getRedisClient();
  const key = KEYS.ACCESS_TOKEN(accountId);

  if (!redis) {
    logger.info({ accountId }, "[Redis:Token] Client down, falling back");
    return dbFallback();
  }

  try {
    const cachedToken = await redis.get(key);

    // Cache Hit
    if (cachedToken) {
      logger.info({ accountId, hit: true }, "[Redis:Token] Token retrieved");
      return cachedToken;
    }

    // Cache Miss -> Fallback -> Repopulate
    logger.info(
      { accountId, hit: false },
      "[Redis:Token] Token missing, fetching via fallback",
    );
    const validToken = await dbFallback();

    redis.set(key, validToken, "EX", TTL.ACCESS_TOKEN).catch((e) => {
      logger.warn(
        { accountId, error: e.message },
        "[Redis:Token] Failed to cache token after fallback",
      );
    });

    return validToken;
  } catch (error: any) {
    logger.error(
      { accountId, error: error.message },
      "[Redis:Token] Cache fetch failed, fetching natively via DB fallback",
    );
    return dbFallback();
  }
}

/**
 * Forces a token into Redis cache (typically right after the backend refreshes and stores it)
 */
export async function cacheAccessToken(
  accountId: string,
  token: string,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    await redis.set(
      KEYS.ACCESS_TOKEN(accountId),
      token,
      "EX",
      TTL.ACCESS_TOKEN,
    );
    logger.info(
      { accountId },
      "[Redis:Token] Token forcibly refreshed in cache",
    );
  } catch (error: any) {
    // Fire and forget
    logger.error(
      { accountId, error: error.message },
      "[Redis:Token] Failed to manually cache token",
    );
  }
}
