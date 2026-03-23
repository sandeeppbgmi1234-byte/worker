/**
 * Redis Key Registry
 * Centralized registry for all Redis keys and their strict Time-To-Live (TTL) configs.
 * Sync with main Next.js app to ensure cache consistency.
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
} as const;

// Key generation functions
export const KEYS = {
  // Domain: User
  USER_CONNECTION: (instagramUserId: string) =>
    `ig:user_connection:${instagramUserId}`,
  ACCOUNT_BY_IG: (instagramUserId: string) =>
    `ig:account_by_ig:${instagramUserId}`,

  // Domain: Tokens
  ACCESS_TOKEN: (accountId: string) => `ig:access_token:${accountId}`,

  // Domain: Comments / Idempotency (Worker)
  COMMENT_PROCESSED: (commentId: string, automationId: string) =>
    `ig:processed:${commentId}:${automationId}`,
  GLOBAL_EVENT_PROCESSED: (eventId: string) => `ig:global_processed:${eventId}`,

  // Domain: Throttling / Cooldowns (Worker)
  USER_THROTTLE: (instagramUserId: string, automationId: string) =>
    `ig:throttle:${instagramUserId}:${automationId}`,
  EVENT_THROTTLE: (eventId: string) => `ig:throttle:event:${eventId}`,
  USER_COOLDOWN: (instagramUserId: string, automationId: string) =>
    `ig:cooldown:${instagramUserId}:${automationId}`,
  PENDING_CONFIRMATION: (instagramUserId: string, automationId: string) =>
    `ig:pending:${instagramUserId}:${automationId}`,

  // Domain: Meta API Rate Limits
  APP_USAGE: () => `ig:rate_limit:app_usage`,
  ACCOUNT_USAGE: (instagramUserId: string) =>
    `ig:rate_limit:account:${instagramUserId}`,

  // Domain: Automations
  AUTOMATION_BY_ID: (automationId: string) => `ig:automation:${automationId}`,
  AUTOMATIONS_BY_POST: (userId: string, mediaId: string) =>
    `ig:automation:post:${userId}:${mediaId}`,
  AUTOMATIONS_BY_STORY: (userId: string, storyId: string) =>
    `ig:automation:story:${userId}:${storyId}`,

  // Domain: Instagram Data
  INSTAGRAM_POSTS: (instagramUserId: string) => `ig:posts:${instagramUserId}`,
  INSTAGRAM_STORIES: (instagramUserId: string) =>
    `ig:stories:${instagramUserId}`,
} as const;
