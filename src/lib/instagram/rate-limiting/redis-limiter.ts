/**
 * Redis-Backed Instagram Rate Limiter
 * Tracks and enforces Meta Graph API Rate Limits globally across workers.
 */

import { Redis } from "ioredis";
import { RATE_LIMIT_THRESHOLDS } from "../../../config/instagram.config";
import { InstagramRateLimitError } from "../api/api-errors";
import { logger } from "../../utils/pino";

// Since BullMQ requires Redis, we reuse the Upstash connection logic
const redis = new Redis({
  host: process.env.UPSTASH_REDIS_HOST,
  port: 6379,
  username: process.env.UPSTASH_REDIS_USERNAME,
  password: process.env.UPSTASH_REDIS_PASSWORD,
  tls: {},
  maxRetriesPerRequest: null,
});

const KEYS = {
  APP_USAGE: "instagram:rate_limit:app_usage",
  ACCOUNT_USAGE: (accountId: string) =>
    `instagram:rate_limit:account:${accountId}`,
};

/**
 * Updates Redis with new usage percentages extracted from headers
 */
export async function updateRateLimitsFromHeaders(
  instagramUserId: string,
  appUsage: Record<string, any> | null,
  businessUsage: Record<string, any> | null,
) {
  const pipeline = redis.pipeline();

  if (appUsage && typeof appUsage.call_count === "number") {
    // App usage metric: 1 hour rolling window from Meta usually, but the header is live.
    // We store it with a 5-minute expire so if it goes stale we don't lock forever.
    pipeline.set(KEYS.APP_USAGE, appUsage.call_count, "EX", 300);
  }

  if (businessUsage) {
    // Find the highest call_count across business usage types
    let maxAccountUsage = 0;
    for (const key of Object.keys(businessUsage)) {
      const metrics = businessUsage[key];
      if (Array.isArray(metrics) && metrics.length > 0) {
        const count = metrics[0].call_count;
        if (typeof count === "number" && count > maxAccountUsage) {
          maxAccountUsage = count;
        }
      }
    }

    if (maxAccountUsage > 0) {
      pipeline.set(
        KEYS.ACCOUNT_USAGE(instagramUserId),
        maxAccountUsage,
        "EX",
        300,
      );
    }
  }

  await pipeline.exec();
}

/**
 * Verifies if it is safe to make an Instagram API call based on Redis limits
 * Throws InstagramRateLimitError if unsafe.
 */
export async function checkRateLimits(instagramUserId: string): Promise<void> {
  const [appUsageStr, accountUsageStr] = await redis.mget(
    KEYS.APP_USAGE,
    KEYS.ACCOUNT_USAGE(instagramUserId),
  );

  const appUsage = appUsageStr ? parseInt(appUsageStr, 10) : 0;
  const accountUsage = accountUsageStr ? parseInt(accountUsageStr, 10) : 0;

  if (appUsage >= RATE_LIMIT_THRESHOLDS.APP_USAGE_STOP_PERCENT) {
    logger.warn(
      { appUsage, threshold: RATE_LIMIT_THRESHOLDS.APP_USAGE_STOP_PERCENT },
      "App-Level Rate Limit Threshold Exceeded",
    );
    throw new InstagramRateLimitError(
      `App-Level Rate Limit at ${appUsage}%`,
      true,
    );
  }

  if (accountUsage >= RATE_LIMIT_THRESHOLDS.ACCOUNT_USAGE_STOP_PERCENT) {
    logger.warn(
      {
        instagramUserId,
        accountUsage,
        threshold: RATE_LIMIT_THRESHOLDS.ACCOUNT_USAGE_STOP_PERCENT,
      },
      "Account-Level Rate Limit Threshold Exceeded",
    );
    throw new InstagramRateLimitError(
      `Account-Level Rate Limit at ${accountUsage}%`,
      false,
    );
  }
}

/**
 * Utility to get current usage stats for debugging
 */
export async function getRateLimitStats(instagramUserId: string) {
  const [appUsage, accountUsage] = await redis.mget(
    KEYS.APP_USAGE,
    KEYS.ACCOUNT_USAGE(instagramUserId),
  );
  return {
    appUsagePercent: appUsage ? parseInt(appUsage, 10) : 0,
    accountUsagePercent: accountUsage ? parseInt(accountUsage, 10) : 0,
  };
}
