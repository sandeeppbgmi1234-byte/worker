/**
 * Redis Module Export Barrel
 *
 * Rules:
 * - NO OTHER FILE IN THE WORKER may import from `ioredis` directly.
 * - ALL Redis interactions MUST flow through these typed domain operations.
 */

// Connection
export { getRedisClient } from "./client";
export { RedisError } from "./errors";

// User Connections
export {
  isUserConnected,
  setUserConnected,
  invalidateUser,
} from "./operations/user";

// Tokens
export { getAccessToken, cacheAccessToken } from "./operations/token";

// Idempotency Locks
export { isCommentProcessed } from "./operations/comment";

// User Cooldowns
export { isUserOnCooldown, clearUserCooldown } from "./operations/cooldown";

// Meta API Rate Limits
export {
  updateRateLimitsFromHeaders,
  checkRateLimits,
  incrementApiUsage,
} from "./operations/rate-limit";
// Automations and DB Account Caching
export {
  getAccountByInstagramId,
  getAutomationsByPost,
  getAutomationsByStory,
} from "./operations/automation";
