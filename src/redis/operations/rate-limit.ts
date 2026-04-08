import { getRedisClient } from "../client";
import { KEYS, TTL } from "../keys";
import { logger } from "../../logger";
import { RATE_LIMIT_THRESHOLDS } from "../../config/instagram.config";
import { InstagramRateLimitError } from "../../errors/instagram.errors";

/**
 * Updates Meta API rate limits from response headers.
 */
export async function updateRateLimitsFromHeadersR(
  webhookUserId: string,
  appUsage: Record<string, any> | null,
  businessUsage: Record<string, any> | null,
  adAccountUsage?: Record<string, any> | null,
) {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    const pipeline = redis.pipeline();

    // 1. App-Level Usage
    if (appUsage) {
      const usage = Math.max(
        appUsage.call_count || 0,
        appUsage.total_time || 0,
        appUsage.total_cputime || 0,
      );
      if (usage > 0) {
        pipeline.set(KEYS.APP_USAGE(), usage.toString(), "EX", TTL.API_USAGE);
      }
    }

    // 2. Business Usage (Account-Level)
    if (businessUsage) {
      let maxAccountUsage = 0;
      for (const key of Object.keys(businessUsage)) {
        const metrics = businessUsage[key];
        if (Array.isArray(metrics) && metrics.length > 0) {
          const m = metrics[0];
          const usage = Math.max(
            m.call_count || 0,
            m.total_time || 0,
            m.total_cputime || 0,
          );
          if (usage > maxAccountUsage) maxAccountUsage = usage;
        }
      }
      if (maxAccountUsage > 0)
        pipeline.set(
          KEYS.ACCOUNT_USAGE(webhookUserId),
          maxAccountUsage.toString(),
          "EX",
          TTL.API_USAGE,
        );
    }

    // 3. Ad Account Usage (Fallback)
    if (adAccountUsage && adAccountUsage.acc_id_util_pct) {
      const usage = Math.round(adAccountUsage.acc_id_util_pct);
      pipeline.set(
        KEYS.ACCOUNT_USAGE(webhookUserId),
        usage.toString(),
        "EX",
        TTL.API_USAGE,
      );
    }

    await pipeline.exec();
  } catch (error: any) {
    logger.debug(
      { error: error.message },
      "Failed to update rate limit headers in Redis",
    );
  }
}

/**
 * Checks if current usage is below safety thresholds.
 */
export async function checkRateLimits(webhookUserId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  const [appUsageStr, accountUsageStr] = await redis.mget(
    KEYS.APP_USAGE(),
    KEYS.ACCOUNT_USAGE(webhookUserId),
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

/**
 * Increments predicted usage for short-term throttling.
 */
export async function incrementApiUsage(
  webhookUserId: string,
  count: number = 1,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  const key = KEYS.PREDICTED_USAGE(webhookUserId);
  try {
    const pipeline = redis.pipeline();
    pipeline.incrby(key, count);
    pipeline.expire(key, TTL.API_USAGE);
    await pipeline.exec();
  } catch (error: any) {
    logger.debug(
      { error: error.message },
      "Failed to increment predicted API usage",
    );
  }
}
