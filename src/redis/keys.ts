export const TTL = {
  USER_CONNECTED: 24 * 60 * 60,
  ACCESS_TOKEN: 2 * 60 * 60,
  COMMENT_PROCESSED: 24 * 60 * 60,
  DEFAULT_COOLDOWN: 24 * 60 * 60,
  API_USAGE: 60 * 60,
  AUTOMATION_TTL: 24 * 60 * 60,
} as const;

export const KEYS = {
  USER_CONNECTION: (instagramUserId: string) =>
    `ig:user_connection:${instagramUserId}`,
  ACCOUNT_BY_IG: (instagramUserId: string) =>
    `ig:account_by_ig:${instagramUserId}`,
  ACCESS_TOKEN: (accountId: string) => `ig:access_token:${accountId}`,
  COMMENT_PROCESSED: (commentId: string, automationId: string) =>
    `ig:processed:${commentId}:${automationId}`,
  USER_COOLDOWN: (instagramUserId: string, automationId: string) =>
    `ig:cooldown:${instagramUserId}:${automationId}`,
  APP_USAGE: () => `ig:rate_limit:app_usage`,
  ACCOUNT_USAGE: (instagramUserId: string) =>
    `ig:rate_limit:account:${instagramUserId}`,
  AUTOMATIONS_BY_POST: (userId: string, mediaId: string) =>
    `ig:automations_post:${userId}:${mediaId}`,
  AUTOMATIONS_BY_STORY: (userId: string, storyId: string) =>
    `ig:automations_story:${userId}:${storyId}`,
};
