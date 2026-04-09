export { getRedisClient } from "./client";
export { RedisError } from "./errors";

export {
  isUserConnectedR,
  setUserConnectedR,
  getAccountByInstagramIdR,
  invalidateUserCacheR,
} from "./operations/user";

export { getAccessTokenR, cacheAccessTokenR } from "./operations/token";

export { isCommentProcessedR } from "./operations/comment";

export {
  isUserOnCooldownR,
  clearUserCooldownR,
  isFollowWarningSentR,
  setFollowWarningSentR,
  isPendingConfirmationR,
  setPendingConfirmationR,
  clearPendingConfirmationR,
  isUserThrottledR,
  isEventThrottledR,
  isAskResolvedR,
  setAskResolvedR,
  clearAskResolvedR,
} from "./operations/cooldown";

export {
  updateRateLimitsFromHeadersR,
  checkRateLimits,
} from "./operations/rate-limit";

export {
  getAutomationsByPostR,
  getAutomationsByStoryR,
  getAutomationByIdR,
  getAutomationsForAccountDMR,
} from "./operations/automation";

export {
  getCreditStateR,
  setCreditStateR,
  incrementCreditUsedR,
} from "./operations/credits";
