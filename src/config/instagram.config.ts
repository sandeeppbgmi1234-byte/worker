export const GRAPH_API = {
  VERSION: process.env.INSTAGRAM_API_VERSION,
  BASE_URL: "https://graph.instagram.com",
} as const;

export const MESSAGING_CONSTRAINTS = {
  WINDOW_HOURS: 24,
  RATE_LIMIT_PER_HOUR: 100,
  BURST_LIMIT_PER_HOUR: 200,
  MESSAGE_MAX_LENGTH: 1000,
} as const;

export const RATE_LIMITS = {
  POSTS_PER_REQUEST: 25,
  COMMENTS_PER_REQUEST: 50,
  REQUEST_TIMEOUT_MS: 10000,
} as const;

export const RATE_LIMIT_THRESHOLDS = {
  SAFE_MODE_THRESHOLD: 85,
  PANIC_THRESHOLD: 90,
  MAX_WORKER_USAGE: 95,
} as const;

export const QUICK_REPLIES = {
  BYPASS: {
    TITLE: "Tap to see media 📸",
    PAYLOAD_PREFIX: "SEND_IMAGE_FOR_AUTOMATION:",
  },
  FOLLOW_CONFIRM: {
    TITLE: "I'm following ✅",
    PAYLOAD_PREFIX: "FOLLOW_CONFIRM:",
  },
  OPENING_MESSAGE: {
    PAYLOAD_PREFIX: "OPENING_MESSAGE_CLICK:",
  },
} as const;

export const ERROR_MESSAGES = {
  AUTH: {
    NO_USER: "You need to be signed in. Please login and try again.",
    NO_INSTAGRAM_ACCOUNT:
      "Instagram is not connected for your account. Please connect Instagram and try again.",
    TOKEN_EXPIRED: "Your Instagram connection has expired. Please reconnect.",
  },
  NETWORK: {
    CONNECTION_FAILED:
      "Could not connect to Instagram. Please check your network connection and try again.",
    TIMEOUT: "Request to Instagram timed out. Please try again.",
  },
  API: {
    INVALID_RESPONSE:
      "Instagram returned data in an unexpected format. Please refresh or try again later.",
    GENERIC_ERROR:
      "Instagram returned an unexpected error. Please try reconnecting your account.",
  },
  MESSAGING: {
    WINDOW_EXPIRED:
      "Cannot send message: 24-hour messaging window has expired.",
    RATE_LIMIT_EXCEEDED: "Message rate limit exceeded. Please try again later.",
    MESSAGE_TOO_LONG: "Message exceeds maximum length of 1000 characters.",
  },
} as const;
