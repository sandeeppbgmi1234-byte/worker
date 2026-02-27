/**
 * Instagram API Rate Limiter
 * Manages rate limiting for Instagram API calls
 */

import { MESSAGING_CONSTRAINTS } from "../../config/instagram.config";

interface RateLimitEntry {
  count: number;
  resetTime: Date;
}

// In-memory rate limit tracking (use Redis for production)
const rateLimitMap = new Map<string, RateLimitEntry>();

/**
 * Checks if rate limit is exceeded
 */
export function isRateLimited(
  key: string,
  limit: number = MESSAGING_CONSTRAINTS.RATE_LIMIT_PER_HOUR,
): boolean {
  const entry = rateLimitMap.get(key);

  if (!entry) {
    return false;
  }

  // Resets if time window passed
  if (new Date() > entry.resetTime) {
    rateLimitMap.delete(key);
    return false;
  }

  return entry.count >= limit;
}

/**
 * Increments rate limit counter
 */
export function incrementRateLimit(key: string): void {
  const entry = rateLimitMap.get(key);
  const now = new Date();

  if (!entry || now > entry.resetTime) {
    // Creates new entry with 1-hour window
    rateLimitMap.set(key, {
      count: 1,
      resetTime: new Date(now.getTime() + 60 * 60 * 1000), // 1 hour
    });
  } else {
    entry.count++;
  }
}

/**
 * Creates a rate limit key for messaging
 */
export function createMessagingRateLimitKey(instagramUserId: string): string {
  return `messaging:${instagramUserId}`;
}

/**
 * Creates a rate limit key for comments
 */
export function createCommentsRateLimitKey(instagramUserId: string): string {
  return `comments:${instagramUserId}`;
}

/**
 * Cleans up expired rate limit entries
 */
export function cleanupRateLimits(): void {
  const now = new Date();

  for (const [key, entry] of rateLimitMap.entries()) {
    if (now > entry.resetTime) {
      rateLimitMap.delete(key);
    }
  }
}

// Cleans up rate limits every 5 minutes
setInterval(cleanupRateLimits, 5 * 60 * 1000);
