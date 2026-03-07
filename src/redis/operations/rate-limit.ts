import { getRedisClient } from "../client";
import { KEYS } from "../keys";
import { TTL } from "../../config/redis.config";
import { logger } from "../../logger";
import { RATE_LIMIT_THRESHOLDS } from "../../config/instagram.config";
import { InstagramRateLimitError } from "../../errors/instagram.errors";

export async function updateRateLimitsFromHeadersR(
  instagramUserId: string,
  appUsage: Record<string, any> | null,
  businessUsage: Record<string, any> | null,
) {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    const pipeline = redis.pipeline();

    if (appUsage && typeof appUsage.call_count === "number") {
      pipeline.set(KEYS.APP_USAGE(), appUsage.call_count, "EX", TTL.API_USAGE);
    }

    if (businessUsage) {
      let maxAccountUsage = 0;
      for (const key of Object.keys(businessUsage)) {
        const metrics = businessUsage[key];
        if (Array.isArray(metrics) && metrics.length > 0) {
          const count = metrics[0].call_count;
          if (typeof count === "number" && count > maxAccountUsage)
            maxAccountUsage = count;
        }
      }
      if (maxAccountUsage > 0)
        pipeline.set(
          KEYS.ACCOUNT_USAGE(instagramUserId),
          maxAccountUsage,
          "EX",
          TTL.API_USAGE,
        );
    }

    await pipeline.exec();
  } catch (error: any) {}
}

export async function checkRateLimits(instagramUserId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  const [appUsageStr, accountUsageStr] = await redis.mget(
    KEYS.APP_USAGE(),
    KEYS.ACCOUNT_USAGE(instagramUserId),
  );
  const appUsage = appUsageStr ? parseInt(appUsageStr, 10) : 0;
  const accountUsage = accountUsageStr ? parseInt(accountUsageStr, 10) : 0;

  if (appUsage >= RATE_LIMIT_THRESHOLDS.APP_USAGE_STOP_PERCENT) {
    throw new InstagramRateLimitError(
      "checkRateLimits",
      `App-Level Rate Limit at ${appUsage}%`,
      true,
    );
  }

  if (accountUsage >= RATE_LIMIT_THRESHOLDS.ACCOUNT_USAGE_STOP_PERCENT) {
    throw new InstagramRateLimitError(
      "checkRateLimits",
      `Account-Level Rate Limit at ${accountUsage}%`,
      false,
    );
  }
}

export async function incrementApiUsage(
  instagramUserId: string,
  count: number = 1,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  const key = `ig:rate_limit:predicted_count:${instagramUserId}`;
  try {
    await redis.incrby(key, count);
    await redis.expire(key, 3600);
  } catch (error: any) {}
}
