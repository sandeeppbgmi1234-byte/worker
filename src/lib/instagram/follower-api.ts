/**
 * Instagram Follower API
 * Checks if a given user follows the automation owner's Instagram account
 */

import { buildGraphApiUrl, GRAPH_API } from "../../config/instagram.config";
import { fetchFromInstagram } from "./api/client";
import { logger } from "../utils/pino";

interface FollowerCheckResult {
  isFollowing: boolean;
}

/**
 * Checks whether `commenterIgUserId` follows `ownerIgUserId`.
 * Uses the Graph API followers field on the owner account scoped to the commenter.
 * Counts as 1 API call toward the 200/hr budget — caller must increment rate limit.
 */
export async function checkIfUserFollows(
  ownerIgUserId: string,
  commenterIgUserId: string,
  accessToken: string,
): Promise<FollowerCheckResult> {
  // Use graph.instagram.com via centralized helper (Correct for Instagram-scoped tokens)
  const url = buildGraphApiUrl(commenterIgUserId);
  url.searchParams.set("fields", "is_user_follow_business");
  url.searchParams.set("access_token", accessToken);

  logger.info(
    { ownerIgUserId, commenterIgUserId },
    "[FollowerAPI] Checking follower status via is_user_follow_business",
  );

  try {
    const result = await fetchFromInstagram<any>(url.toString(), {
      method: "GET",
      instagramUserId: ownerIgUserId,
    });

    // Detailed debug logging to see what Meta actually returns
    logger.info(
      { ownerIgUserId, commenterIgUserId, result },
      "[FollowerAPI] Instagram Follower Check Response",
    );

    // If is_user_follow_business is missing from the response, it usually means the field isn't available
    // or the app doesn't have the necessary permissions (instagram_business_basic).
    if (
      result === undefined ||
      result === null ||
      !("is_user_follow_business" in result)
    ) {
      logger.warn(
        { ownerIgUserId, commenterIgUserId, result },
        "[FollowerAPI] 'is_user_follow_business' field missing or null in Meta response. Check App Permissions.",
      );
      return { isFollowing: false };
    }

    const isFollowing = result.is_user_follow_business === true;

    logger.info(
      { ownerIgUserId, commenterIgUserId, isFollowing },
      "[FollowerAPI] Result determined",
    );

    return { isFollowing };
  } catch (error: any) {
    logger.error(
      {
        ownerIgUserId,
        commenterIgUserId,
        error: error.message,
        status: error.status,
        subcode: error.subcode,
      },
      "[FollowerAPI] Follower check failed (API Error)",
    );
    // Fail-safe: treat as non-follower on API error
    return { isFollowing: false };
  }
}
