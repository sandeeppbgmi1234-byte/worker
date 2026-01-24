/**
 * Instagram Graph API Configuration
 * Centralized configuration for Instagram API with Instagram Login
 * Uses graph.instagram.com (not graph.facebook.com)
 */

// Graph API configuration - uses Instagram Graph API directly
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

// OAuth configuration - uses Instagram Login (Business Login for Instagram)
export const INSTAGRAM_OAUTH = {
  // Scopes for Instagram API with Instagram Login
  SCOPES: [
    "instagram_business_basic",
    "instagram_business_manage_messages",
    "instagram_business_manage_comments",
    "instagram_business_content_publish",
    "instagram_business_manage_insights",
  ].join(","),
  // Instagram authorization URL (not Facebook)
  AUTHORIZE_URL: "https://www.instagram.com/oauth/authorize",
  // Short-lived token exchange endpoint
  TOKEN_URL: "https://api.instagram.com/oauth/access_token",
  // Long-lived token exchange endpoint
  LONG_LIVED_TOKEN_URL: "https://graph.instagram.com/access_token",
  // Token refresh endpoint
  REFRESH_URL: "https://graph.instagram.com/refresh_access_token",
} as const;

// Messaging constraints
export const MESSAGING_CONSTRAINTS = {
  WINDOW_HOURS: 24,
  RATE_LIMIT_PER_HOUR: 100,
  MESSAGE_MAX_LENGTH: 1000,
} as const;

// Field configurations for different endpoints
export const GRAPH_API_FIELDS = {
  POSTS: [
    "id",
    "caption",
    "media_type",
    "media_url",
    "permalink",
    "timestamp",
    "like_count",
    "comments_count",
  ],
  COMMENTS: ["id", "text", "timestamp", "username", "like_count", "user"],
  USER: [
    "id",
    "username",
    "user_id",
    "account_type",
    "name",
    "profile_picture_url",
    "followers_count",
    "follows_count",
    "media_count",
    "biography",
  ],
} as const;

// Rate limiting configuration
export const RATE_LIMITS = {
  POSTS_PER_REQUEST: 25,
  COMMENTS_PER_REQUEST: 50,
  REQUEST_TIMEOUT_MS: 10000, // 10 seconds
} as const;

// Error messages
export const ERROR_MESSAGES = {
  AUTH: {
    NO_USER: "You need to be signed in. Please login and try again.",
    NO_INSTAGRAM_ACCOUNT:
      "Instagram is not connected for your account. Please connect Instagram and try again.",
    NO_ACCESS_TOKEN:
      "Instagram integration is not configured. Please contact support.",
    OAUTH_FAILED: "Failed to authorize Instagram account. Please try again.",
    OAUTH_STATE_INVALID:
      "OAuth authorization request is invalid or expired. Please try again.",
    TOKEN_EXPIRED: "Your Instagram connection has expired. Please reconnect.",
    INVALID_ACCOUNT_TYPE:
      "Please use an Instagram Business or Creator account.",
    NO_FACEBOOK_PAGE: "Please link your Instagram account to a Facebook Page.",
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
  SERVER: {
    INTERNAL_ERROR:
      "An unexpected server error occurred. Please try again later.",
  },
  VALIDATION: {
    INVALID_POST_ID: "Invalid or missing post ID",
    INVALID_USER_ID: "Invalid or missing user ID",
  },
  MESSAGING: {
    WINDOW_EXPIRED:
      "Cannot send message: 24-hour messaging window has expired.",
    RATE_LIMIT_EXCEEDED: "Message rate limit exceeded. Please try again later.",
    MESSAGE_TOO_LONG: "Message exceeds maximum length of 1000 characters.",
  },
} as const;

// Response status codes
export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
} as const;

/**
 * Builds a complete Graph API URL with version and endpoint
 */
export function buildGraphApiUrl(endpoint: string): URL {
  return new URL(`${GRAPH_API.BASE_URL}/${GRAPH_API.VERSION}/${endpoint}`);
}

/**
 * Adds query parameters to a Graph API URL
 */
export function addQueryParams(url: URL, params: Record<string, string>): URL {
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url;
}

/**
 * Gets access token from environment with validation (legacy - for migration)
 */
export function getAccessToken(): string | null {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  return token || null;
}

/**
 * Gets OAuth app credentials from environment
 * Uses Instagram App ID and Secret (from Instagram API setup, not Facebook)
 */
export function getOAuthCredentials(): {
  appId: string | null;
  appSecret: string | null;
  redirectUri: string | null;
} {
  return {
    // Instagram App ID (from Instagram > API setup with Instagram login)
    appId: process.env.INSTAGRAM_APP_ID || process.env.APP_ID || null,
    // Instagram App Secret (from Instagram > API setup with Instagram login)
    appSecret:
      process.env.INSTAGRAM_APP_SECRET ||
      process.env.FACEBOOK_APP_SECRET ||
      null,
    redirectUri:
      process.env.INSTAGRAM_REDIRECT_URI ||
      process.env.NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI ||
      null,
  };
}

/**
 * Gets OAuth state secret for signing state parameters
 * Uses dedicated OAUTH_STATE_SECRET if available, otherwise falls back to app secret
 */
export function getOAuthStateSecret(): string | null {
  return (
    process.env.OAUTH_STATE_SECRET ||
    process.env.INSTAGRAM_APP_SECRET ||
    process.env.FACEBOOK_APP_SECRET ||
    null
  );
}

/**
 * Validates instagram OAuth configuration
 */
export function validateOAuthConfig(): boolean {
  const { appId, appSecret, redirectUri } = getOAuthCredentials();
  return Boolean(appId && appSecret && redirectUri);
}

/**
 * Gets webhook related secrets like verify token and callback URL from environment
 */

export const getWebhookConfigSecrets = () => {
  const verifyToken = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
  const callbackUrl = process.env.INSTAGRAM_WEBHOOK_CALLBACK_URL;

  if (!verifyToken || !callbackUrl) {
    throw new Error(
      "Webhook verify token or callback URL not configured in environment variables"
    );
  }

  return { verifyToken, callbackUrl };
};
