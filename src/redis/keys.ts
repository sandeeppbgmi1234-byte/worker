/**
 * Redis Key Registry
 * Single source of truth for ALL Redis keys and TTL configs.
 * This file is kept byte-for-byte identical to dmbro-main/src/server/redis/keys.ts.
 * Any change here MUST be mirrored in the main app.
 */

// TTL configurations in seconds
export const TTL = {
  USER_CONNECTED: 24 * 60 * 60, // 24 hours
  ACCESS_TOKEN: 2 * 60 * 60, // 2 hours
  COMMENT_PROCESSED: 24 * 60 * 60, // 24 hours
  DEFAULT_COOLDOWN: 24 * 60 * 60, // 24 hours
  API_USAGE: 60 * 60, // 1 hour
  INSTAGRAM_DATA: 15 * 60, // 15 minutes
  AUTOMATION_TTL: 24 * 60 * 60, // 24 hours
  PENDING_CONFIRMATION: 5 * 60, // 5 minutes
  ASK_RESOLVED: 24 * 60 * 60, // 24 hours
  FOLLOW_WARNING: 60 * 60, // 1 hour
  EVENT_LOCK: 10 * 60, // 10 minutes
} as const;

// Key generation functions — all IG-scoped keys use instaAccountId, not userId
export const KEYS = {
  // Domain: User (keyed by webhookUserId 178...)
  USER_CONNECTION: (webhookUserId: string) =>
    `ig:user_connection:${webhookUserId}`,
  ACCOUNT_BY_IG: (instagramUserId: string) =>
    `ig:account_by_ig:${instagramUserId}`,

  // Domain: Tokens (keyed by clerkId + webhookUserId)
  ACCESS_TOKEN: (clerkId: string, webhookUserId: string) =>
    `ig:access_token:${clerkId}:${webhookUserId}`,
  TOKEN_REFRESH_LOCK: (webhookUserId: string) =>
    `ig:lock:refresh:token:${webhookUserId}`,

  // Domain: Comments / Idempotency (Worker) — scoped by owner
  COMMENT_PROCESSED: (
    webhookUserId: string,
    commentId: string,
    automationId: string,
  ) => `ig:processed:${webhookUserId}:${commentId}:${automationId}`,
  GLOBAL_EVENT_PROCESSED: (webhookUserId: string, eventId: string) =>
    `ig:global_processed:${webhookUserId}:${eventId}`,
  EVENT_LOCK: (webhookUserId: string, eventId: string) =>
    `ig:lock:event:${webhookUserId}:${eventId}`,

  // Domain: Throttling / Cooldowns (Worker) — scoped by owner + follower + automation
  USER_THROTTLE: (
    webhookUserId: string,
    followerId: string,
    automationId: string,
  ) => `ig:throttle:${webhookUserId}:${followerId}:${automationId}`,
  EVENT_THROTTLE: (webhookUserId: string, eventId: string) =>
    `ig:throttle:event:${webhookUserId}:${eventId}`,
  USER_COOLDOWN: (
    webhookUserId: string,
    followerId: string,
    automationId: string,
  ) => `ig:cooldown:${webhookUserId}:${followerId}:${automationId}`,
  PENDING_CONFIRMATION: (
    webhookUserId: string,
    followerId: string,
    automationId: string,
  ) => `ig:pending:${webhookUserId}:${followerId}:${automationId}`,
  ASK_RESOLVED: (
    webhookUserId: string,
    followerId: string,
    automationId: string,
  ) => `ig:ask_resolved:${webhookUserId}:${followerId}:${automationId}`,
  FOLLOW_WARNING: (
    webhookUserId: string,
    followerId: string,
    automationId: string,
  ) => `ig:warn:follow:${webhookUserId}:${followerId}:${automationId}`,

  // Domain: Meta API Rate Limits
  APP_USAGE: () => `ig:rate_limit:app_usage`,
  ACCOUNT_USAGE: (webhookUserId: string) =>
    `ig:rate_limit:account:${webhookUserId}`,
  ACCOUNT_SPAM_GUARD: (webhookUserId: string) =>
    `ig:spam_guard:account:${webhookUserId}`,

  // Domain: Automations — ALL scoped to webhookUserId (178...)
  AUTOMATION_BY_ID: (webhookUserId: string, automationId: string) =>
    `ig:automation:${webhookUserId}:${automationId}`,
  AUTOMATIONS_BY_POST: (webhookUserId: string, mediaId: string) =>
    `ig:automation:post:${webhookUserId}:${mediaId}`,
  AUTOMATIONS_BY_STORY: (webhookUserId: string, storyId: string) =>
    `ig:automation:story:${webhookUserId}:${storyId}`,
  AUTOMATIONS_FOR_ACCOUNT_DM: (webhookUserId: string) =>
    `ig:automation:account_dm:${webhookUserId}`,

  // Domain: Instagram Data (keyed by webhookUserId (178...))
  INSTAGRAM_POSTS: (webhookUserId: string) => `ig:posts:${webhookUserId}`,
  INSTAGRAM_STORIES: (webhookUserId: string) => `ig:stories:${webhookUserId}`,

  // Domain: Buffers (Async Persistence)
  PENDING_OUTCOMES: "pending:outcomes:buffer",

  // Domain: Billing / Credits (keyed by clerkId with user_ prefix)
  CREDIT_USED: (clerkId: string) =>
    `billing:credits:used:${normalizeClerkId(clerkId)}`,
  CREDIT_LIMIT: (clerkId: string) =>
    `billing:credits:limit:${normalizeClerkId(clerkId)}`,
  SUB_STATUS: (clerkId: string) =>
    `billing:sub:status:${normalizeClerkId(clerkId)}`,
  PLAN: (clerkId: string) => `billing:plan:${normalizeClerkId(clerkId)}`,
  // Domain: Notifications (BullMQ)
  NOTIFICATIONS_QUEUE: "notifications",

  // Domain: Execution Locks
  EXECUTION_LOCK: (accountId: string, userId: string) =>
    `ig:lock:execute:account:${accountId}:user:${userId}`,
} as const;

function normalizeClerkId(clerkId: string): string {
  return clerkId.startsWith("user_") ? clerkId : `user_${clerkId}`;
}
