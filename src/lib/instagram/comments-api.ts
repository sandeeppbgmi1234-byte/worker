/**
 * Instagram Comments API
 * Handles comment replies via Instagram
 */

import { GRAPH_API, buildGraphApiUrl } from "../../config/instagram.config";
import { fetchFromInstagram } from "./api/client";

export interface ReplyToCommentOptions {
  commentId: string;
  message: string;
  accessToken: string;
  instagramUserId?: string; // used for rate limiting keys
}

/**
 * Replies to a comment on Instagram
 * Errors (Rate Limits, Spam, Invalid Tokens) will bubble up from fetchFromInstagram
 * to be caught by the central worker processor.
 */
export async function replyToComment(
  options: ReplyToCommentOptions,
): Promise<{ replyId: string }> {
  const url = buildGraphApiUrl(
    GRAPH_API.ENDPOINTS.REPLY_COMMENT(options.commentId),
  );

  const result = await fetchFromInstagram<any>(url.toString(), {
    method: "POST",
    body: {
      message: options.message,
      access_token: options.accessToken,
    },
    timeoutMs: 20000, // 20 seconds for comment reply
    retries: 2,
    instagramUserId: options.instagramUserId,
  });

  return {
    replyId: result.id,
  };
}
