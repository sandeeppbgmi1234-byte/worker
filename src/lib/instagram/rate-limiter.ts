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
export function isRateLimited(key: string, limit: number = MESSAGING_CONSTRAINTS.RATE_LIMIT_PER_HOUR): boolean {
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
 * Gets remaining requests for a key
 */
export function getRemainingRequests(key: string, limit: number = MESSAGING_CONSTRAINTS.RATE_LIMIT_PER_HOUR): number {
  const entry = rateLimitMap.get(key);

  if (!entry) {
    return limit;
  }

  // Resets if time window passed
  if (new Date() > entry.resetTime) {
    rateLimitMap.delete(key);
    return limit;
  }

  return Math.max(0, limit - entry.count);
}

/**
 * Gets time until rate limit resets
 */
export function getResetTime(key: string): Date | null {
  const entry = rateLimitMap.get(key);

  if (!entry) {
    return null;
  }

  if (new Date() > entry.resetTime) {
    rateLimitMap.delete(key);
    return null;
  }

  return entry.resetTime;
}

/**
 * Clears rate limit for a key
 */
export function clearRateLimit(key: string): void {
  rateLimitMap.delete(key);
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
 * Waits until rate limit resets
 */
export async function waitForRateLimit(key: string): Promise<void> {
  const resetTime = getResetTime(key);

  if (!resetTime) {
    return;
  }

  const waitTime = resetTime.getTime() - Date.now();

  if (waitTime > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }
}

/**
 * Executes a function with rate limiting
 */
export async function withRateLimit<T>(
  key: string,
  fn: () => Promise<T>,
  limit?: number
): Promise<T> {
  // Checks rate limit
  if (isRateLimited(key, limit)) {
    throw new Error("Rate limit exceeded. Please try again later.");
  }

  // Increments counter
  incrementRateLimit(key);

  // Executes function
  return await fn();
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
