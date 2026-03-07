import { getRedisClient } from "../client";
import { KEYS } from "../keys";

export async function isUserOnCooldownR(
  instagramUserId: string,
  automationId: string,
  customTtlSeconds?: number,
): Promise<boolean> {
  return false;
}

export async function clearUserCooldownR(
  instagramUserId: string,
  automationId: string,
): Promise<void> {
  const redis = getRedisClient();
  const key = KEYS.USER_COOLDOWN(instagramUserId, automationId);

  if (!redis) return;

  try {
    await redis.del(key);
  } catch (error: any) {}
}
