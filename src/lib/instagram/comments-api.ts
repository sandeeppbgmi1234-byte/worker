/**
 * Instagram Comments API
 * Handles comment replies via Instagram
 */

import {
  GRAPH_API,
  ERROR_MESSAGES,
  buildGraphApiUrl,
} from "../../config/instagram.config";
import { fetchWithTimeout } from "../utils/fetch-with-timeout";

export interface ReplyToCommentOptions {
  commentId: string;
  message: string;
  accessToken: string;
}

export interface ReplyToCommentResult {
  success: boolean;
  replyId?: string;
  error?: string;
}

/**
 * Replies to a comment on Instagram
 */
export async function replyToComment(
  options: ReplyToCommentOptions
): Promise<ReplyToCommentResult> {
  try {
    const url = buildGraphApiUrl(
      GRAPH_API.ENDPOINTS.REPLY_COMMENT(options.commentId)
    );

    const result = await fetchWithTimeout<any>(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: options.message,
        access_token: options.accessToken,
      }),
      timeout: 20000, // 20 seconds for comment reply
      retries: 2,
    });

    return {
      success: true,
      replyId: result.data.id,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : ERROR_MESSAGES.SERVER.INTERNAL_ERROR,
    };
  }
}

/**
 * Replies to a comment with retry logic
 */
export async function replyToCommentWithRetry(
  options: ReplyToCommentOptions,
  maxRetries: number = 3
): Promise<ReplyToCommentResult> {
  let lastError: string = "";

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await replyToComment(options);

    if (result.success) {
      return result;
    }

    lastError = result.error || "Unknown error";

    // Don't retry for certain errors
    if (
      lastError.includes("permission") ||
      lastError.includes("not found") ||
      lastError.includes("deleted")
    ) {
      return result;
    }

    // Waits before retrying (exponential backoff)
    if (attempt < maxRetries) {
      const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return {
    success: false,
    error: `Failed after ${maxRetries} attempts: ${lastError}`,
  };
}

/**
 * Deletes a comment or reply
 */
export async function deleteComment(
  commentId: string,
  accessToken: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const url = buildGraphApiUrl(commentId);
    url.searchParams.set("access_token", accessToken);

    await fetchWithTimeout(url.toString(), {
      method: "DELETE",
      timeout: 15000,
      retries: 1,
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : ERROR_MESSAGES.SERVER.INTERNAL_ERROR,
    };
  }
}

/**
 * Hides a comment
 */
export async function hideComment(
  commentId: string,
  accessToken: string,
  hide: boolean = true
): Promise<{ success: boolean; error?: string }> {
  try {
    const url = buildGraphApiUrl(commentId);

    await fetchWithTimeout(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        hide,
        access_token: accessToken,
      }),
      timeout: 15000,
      retries: 1,
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : ERROR_MESSAGES.SERVER.INTERNAL_ERROR,
    };
  }
}
