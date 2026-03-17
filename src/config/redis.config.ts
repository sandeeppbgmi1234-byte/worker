export const REDIS_CONNECTION = {
  host: process.env.UPSTASH_REDIS_HOST,
  port: Number(process.env.UPSTASH_REDIS_PORT),
  username: process.env.UPSTASH_REDIS_USERNAME,
  password: process.env.UPSTASH_REDIS_PASSWORD,
  tls: {},
  maxRetriesPerRequest: 1,
  enableReadyCheck: true,
} as const;

export const QUEUE_CONNECTION = {
  host: process.env.QUEUE_REDIS_HOST,
  port: Number(process.env.QUEUE_REDIS_PORT),
  username: process.env.QUEUE_REDIS_USERNAME,
  password: process.env.QUEUE_REDIS_PASSWORD,
  tls: undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
} as const;
