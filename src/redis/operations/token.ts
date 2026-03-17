import { getRedisClient } from "../client";
import { KEYS, TTL } from "../keys";

export async function getAccessTokenR(
  accountId: string,
  dbFallback: () => Promise<string>,
): Promise<string> {
  const redis = getRedisClient();
  const key = KEYS.ACCESS_TOKEN(accountId);

  if (!redis) return dbFallback();

  try {
    const cachedToken = await redis.get(key);
    if (cachedToken) return cachedToken;

    const validToken = await dbFallback();
    redis.set(key, validToken, "EX", TTL.ACCESS_TOKEN).catch(() => {});
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
    await redis.set(
      KEYS.ACCESS_TOKEN(accountId),
      token,
      "EX",
      TTL.ACCESS_TOKEN,
    );
  } catch (error: any) {}
}
