/**
 * Redis Key Registry
 * Centralized registry for all Redis keys and their strict Time-To-Live (TTL) configs.
 *
 * Rules:
 * 1. EVERY key must have a TTL.
 * 2. NO raw string interpolation outside this file.
 */

// TTL configurations in seconds
export const TTL = {
  // Connections and Auth
  USER_CONNECTED: 24 * 60 * 60, // 24 hours
  ACCESS_TOKEN: 2 * 60 * 60, // 2 hours

  // Automations and Processing
  COMMENT_PROCESSED: 24 * 60 * 60, // 24 hours

  // Cool Downs and Rate Limits
  DEFAULT_COOLDOWN: 24 * 60 * 60, // 24 hours (can be overridden)
  API_USAGE: 60 * 60, // 1 hour rolling window approximation
};

// Key generation functions
export const KEYS = {
  // Domain: User
  USER_CONNECTION: (instagramUserId: string) =>
    `ig:user_connection:${instagramUserId}`,
  ACCOUNT_BY_IG: (instagramUserId: string) =>
    `ig:account_by_ig:${instagramUserId}`,

  // Domain: Tokens
  ACCESS_TOKEN: (accountId: string) => `ig:access_token:${accountId}`,

  // Domain: Comments / Idempotency
  COMMENT_PROCESSED: (commentId: string, automationId: string) =>
    `ig:processed:${commentId}:${automationId}`,

  // Domain: Cooldowns
  USER_COOLDOWN: (instagramUserId: string, automationId: string) =>
    `ig:cooldown:${instagramUserId}:${automationId}`,

  // Domain: Meta API Rate Limits
  APP_USAGE: () => `ig:rate_limit:app_usage`,
  ACCOUNT_USAGE: (instagramUserId: string) =>
    `ig:rate_limit:account:${instagramUserId}`,

  // Domain: Automations
  AUTOMATIONS_BY_POST: (userId: string, mediaId: string) =>
    `ig:automations_post:${userId}:${mediaId}`,
  AUTOMATIONS_BY_STORY: (userId: string, storyId: string) =>
    `ig:automations_story:${userId}:${storyId}`,
};
