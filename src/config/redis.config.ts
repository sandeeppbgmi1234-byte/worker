export const TTL = {
  USER_CONNECTED: 24 * 60 * 60,
  ACCESS_TOKEN: 2 * 60 * 60,
  COMMENT_PROCESSED: 24 * 60 * 60,
  DEFAULT_COOLDOWN: 24 * 60 * 60,
  API_USAGE: 60 * 60,
  AUTOMATION_TTL: 24 * 60 * 60,
} as const;

export const REDIS_CONNECTION = {
  host: process.env.UPSTASH_REDIS_HOST,
  port: 6379,
  username: process.env.UPSTASH_REDIS_USERNAME,
  password: process.env.UPSTASH_REDIS_PASSWORD,
  tls: {},
  maxRetriesPerRequest: 1,
  enableReadyCheck: true,
} as const;
