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
  // Billing: no TTL — these persist for the lifetime of the subscription
} as const;

// Key generation functions — all IG-scoped keys use instaAccountId, not userId
export const KEYS = {
  // Domain: User (keyed by webhookUserId / instagramUserId)
  USER_CONNECTION: (instagramUserId: string) =>
    `ig:user_connection:${instagramUserId}`,
  ACCOUNT_BY_IG: (instagramUserId: string) =>
    `ig:account_by_ig:${instagramUserId}`,

  // Domain: Tokens (keyed by instaAccountId)
  ACCESS_TOKEN: (instaAccountId: string) => `ig:access_token:${instaAccountId}`,
  TOKEN_REFRESH_LOCK: (instaAccountId: string) =>
    `lock:refresh:token:${instaAccountId}`,

  // Domain: Comments / Idempotency (Worker)
  COMMENT_PROCESSED: (commentId: string, automationId: string) =>
    `ig:processed:${commentId}:${automationId}`,
  GLOBAL_EVENT_PROCESSED: (eventId: string) => `ig:global_processed:${eventId}`,

  // Domain: Throttling / Cooldowns (Worker) — keyed by commenter's IG id + automationId
  USER_THROTTLE: (instagramUserId: string, automationId: string) =>
    `ig:throttle:${instagramUserId}:${automationId}`,
  EVENT_THROTTLE: (eventId: string) => `ig:throttle:event:${eventId}`,
  USER_COOLDOWN: (instagramUserId: string, automationId: string) =>
    `ig:cooldown:${instagramUserId}:${automationId}`,
  PENDING_CONFIRMATION: (instagramUserId: string, automationId: string) =>
    `ig:pending:${instagramUserId}:${automationId}`,
  ASK_RESOLVED: (instagramUserId: string, automationId: string) =>
    `ig:ask_resolved:${instagramUserId}:${automationId}`,
  FOLLOW_WARNING: (
    commenterId: string,
    automationId: string,
    originEventId: string,
  ) => `ig:warn:follow:${commenterId}:${automationId}:${originEventId}`,

  // Domain: Meta API Rate Limits
  APP_USAGE: () => `ig:rate_limit:app_usage`,
  ACCOUNT_USAGE: (instagramUserId: string) =>
    `ig:rate_limit:account:${instagramUserId}`,

  // Domain: Automations — ALL scoped to instaAccountId for strict isolation
  AUTOMATION_BY_ID: (automationId: string) => `ig:automation:${automationId}`,
  AUTOMATIONS_BY_POST: (instaAccountId: string, mediaId: string) =>
    `ig:automation:post:${instaAccountId}:${mediaId}`,
  AUTOMATIONS_BY_STORY: (instaAccountId: string, storyId: string) =>
    `ig:automation:story:${instaAccountId}:${storyId}`,
  AUTOMATIONS_FOR_ACCOUNT_DM: (instaAccountId: string) =>
    `ig:automation:account_dm:${instaAccountId}`,

  // Domain: Instagram Data (keyed by instagramUserId)
  INSTAGRAM_POSTS: (instagramUserId: string) => `ig:posts:${instagramUserId}`,
  INSTAGRAM_STORIES: (instagramUserId: string) =>
    `ig:stories:${instagramUserId}`,

  // Domain: Predicted API Metrics
  PREDICTED_USAGE: (instagramUserId: string) =>
    `ig:rate_limit:predicted:${instagramUserId}`,

  // Domain: Buffers (Async Persistence)
  PENDING_OUTCOMES: "pending:outcomes:buffer",

  // Domain: Billing / Credits (keyed by main app userId)
  // Worker reads/writes these; Main App sets them on plan changes.
  CREDIT_USED: (userId: string) => `billing:credits:used:${userId}`,
  CREDIT_LIMIT: (userId: string) => `billing:credits:limit:${userId}`,
  SUB_STATUS: (userId: string) => `billing:sub:status:${userId}`,
  // Domain: Notifications (BullMQ)
  NOTIFICATIONS_QUEUE: "notifications",
} as const;
