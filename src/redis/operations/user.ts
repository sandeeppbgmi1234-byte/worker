import { getRedisClient } from "../client";
import { KEYS, TTL } from "../keys";

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

export async function isUserConnectedR(
  instagramUserId: string,
  dbFallback: () => Promise<boolean>,
): Promise<boolean> {
  const redis = getRedisClient();
  const key = KEYS.USER_CONNECTION(instagramUserId);

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

export async function setUserConnectedR(
  instagramUserId: string,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  const key = KEYS.USER_CONNECTION(instagramUserId);
  try {
    await redis.set(key, "1", "EX", TTL.USER_CONNECTED);
  } catch (error: any) {}
}
