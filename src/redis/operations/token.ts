import { getRedisClient } from "../client";
import { KEYS, TTL } from "../keys";
import { encrypt, decrypt } from "../../helpers/encryption";
import { logger } from "../../logger";

export async function getAccessTokenR(
  accountId: string,
  dbFallback: () => Promise<string>,
): Promise<string> {
  const redis = getRedisClient();
  const key = KEYS.ACCESS_TOKEN(accountId);

  if (!redis) return dbFallback();

  try {
    const cachedEncrypted = await redis.get(key);
    if (cachedEncrypted) {
      try {
        return decrypt(cachedEncrypted);
      } catch (err) {
        logger.warn(
          { accountId },
          "Failed to decrypt cached token. Falling back to DB.",
        );
      }
    }

    const validToken = await dbFallback();
    redis.set(key, encrypt(validToken), "EX", TTL.ACCESS_TOKEN).catch(() => {});
    return validToken;
  } catch (error: any) {
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
