export const TTL = {
  USER_CONNECTED: 24 * 60 * 60,
  ACCESS_TOKEN: 2 * 60 * 60,
  COMMENT_PROCESSED: 24 * 60 * 60,
  DEFAULT_COOLDOWN: 24 * 60 * 60,
  API_USAGE: 60 * 60,
  AUTOMATION_TTL: 24 * 60 * 60,
} as const;

const isUpstash = (host?: string) => host?.includes("upstash");

export const REDIS_CONNECTION = {
  host: process.env.UPSTASH_REDIS_HOST,
  port: Number(process.env.UPSTASH_REDIS_PORT) || 6379,
  username: process.env.UPSTASH_REDIS_USERNAME || "default",
  password: process.env.UPSTASH_REDIS_PASSWORD,
  tls: isUpstash(process.env.UPSTASH_REDIS_HOST) ? {} : undefined,
  maxRetriesPerRequest: 1,
  enableReadyCheck: true,
} as const;

const qHost = process.env.QUEUE_REDIS_HOST || process.env.UPSTASH_REDIS_HOST;
const qUser =
  process.env.QUEUE_REDIS_USERNAME ||
  process.env.UPSTASH_REDIS_USERNAME ||
  "default";

export const QUEUE_CONNECTION = {
  host: qHost,
  port:
    Number(process.env.QUEUE_REDIS_PORT) ||
    Number(process.env.UPSTASH_REDIS_PORT) ||
    6379,
  username: qUser,
  password:
    process.env.QUEUE_REDIS_PASSWORD || process.env.UPSTASH_REDIS_PASSWORD,
  tls: isUpstash(qHost) ? {} : undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
} as const;
