/**
 * Instagram Graph API Configuration
 * Centralized configuration for Instagram API with Instagram Login
 * Uses graph.instagram.com (not graph.facebook.com)
 */

// Graph API configuration
export const GRAPH_API = {
  VERSION: "v21.0",
  BASE_URL: "https://graph.instagram.com",
  ENDPOINTS: {
    USER_MEDIA: (userId: string) => `${userId}/media`,
    POST_COMMENTS: (postId: string) => `${postId}/comments`,
    USER_INFO: (userId: string) => `${userId}`,
    SEND_MESSAGE: (igUserId: string) => `${igUserId}/messages`,
    REPLY_COMMENT: (commentId: string) => `${commentId}/replies`,
  },
} as const;

// Messaging constraints
export const MESSAGING_CONSTRAINTS = {
  WINDOW_HOURS: 24,
  RATE_LIMIT_PER_HOUR: 100,
  MESSAGE_MAX_LENGTH: 1000,
} as const;

// Rate limiting configuration
export const RATE_LIMITS = {
  POSTS_PER_REQUEST: 25,
  COMMENTS_PER_REQUEST: 50,
  REQUEST_TIMEOUT_MS: 10000, // 10 seconds
} as const;

// Meta Graph API Usage Thresholds
// We stop processing if the percentage exceeds the STOP threshold.
export const RATE_LIMIT_THRESHOLDS = {
  APP_USAGE_STOP_PERCENT: 85,
  ACCOUNT_USAGE_STOP_PERCENT: 90,
} as const;

/**
 * Builds a complete Graph API URL with version and endpoint
 */
export function buildGraphApiUrl(endpoint: string): URL {
  return new URL(`${GRAPH_API.BASE_URL}/${GRAPH_API.VERSION}/${endpoint}`);
}

// Error messages (Used by Worker)
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
