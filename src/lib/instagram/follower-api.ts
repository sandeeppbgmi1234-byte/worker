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
  // Endpoint: GET /{owner-ig-user-id}/followers?user_id={commenter-ig-user-id}
  const url = buildGraphApiUrl(GRAPH_API.ENDPOINTS.USER_INFO(ownerIgUserId));
  url.searchParams.set("fields", "followers");
  url.searchParams.set("user_id", commenterIgUserId);
  url.searchParams.set("access_token", accessToken);

  logger.info(
    { ownerIgUserId, commenterIgUserId },
    "[FollowerAPI] Checking follower status",
  );

  try {
    const result = await fetchFromInstagram<any>(url.toString(), {
      method: "GET",
      instagramUserId: ownerIgUserId,
    });

    // If the data array is non-empty, the commenter is in the owner's followers list
    const isFollowing =
      Array.isArray(result?.followers?.data) &&
      result.followers.data.length > 0;

    logger.info(
      { ownerIgUserId, commenterIgUserId, isFollowing },
      "[FollowerAPI] Follower check complete",
    );

    return { isFollowing };
  } catch (error: any) {
    logger.error(
      { ownerIgUserId, commenterIgUserId, error: error.message },
      "[FollowerAPI] Follower check failed — defaulting to non-follower",
    );
    // Fail-safe: treat as non-follower on API error to avoid sending DM without consent
    return { isFollowing: false };
  }
}
