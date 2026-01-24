/**
 * Instagram Messaging API
 * Handles direct message sending via Instagram Graph API
 */

import {
  MESSAGING_CONSTRAINTS,
  ERROR_MESSAGES,
  buildGraphApiUrl,
  GRAPH_API,
} from "../../config/instagram.config";
import { fetchWithTimeout } from "../utils/fetch-with-timeout";

export interface SendMessageOptions {
  recipientId: string;
  commentId?: string;
  message: string;
  accessToken: string;
  messagingType?: "RESPONSE" | "UPDATE" | "MESSAGE_TAG";
  tag?: string;
}

export interface SendMessageResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Sends a direct message on Instagram
 */
export async function sendDirectMessage(
  options: SendMessageOptions
): Promise<SendMessageResult> {
  try {
    // Validates message length
    if (options.message.length > MESSAGING_CONSTRAINTS.MESSAGE_MAX_LENGTH) {
      return {
        success: false,
        error: ERROR_MESSAGES.MESSAGING.MESSAGE_TOO_LONG,
      };
    }

    const url = buildGraphApiUrl("me/messages");

    const requestBody: any = {
      recipient: options.commentId
        ? { comment_id: options.commentId }
        : { id: options.recipientId },
      message: { text: options.message },
      messaging_type: options.messagingType || "RESPONSE",
      access_token: options.accessToken,
    };

    // Adds tag if using MESSAGE_TAG
    if (options.messagingType === "MESSAGE_TAG" && options.tag) {
      requestBody.tag = options.tag;
    }
    // Converts URL object to string for fetch compatibility
    try {
      const result = await fetchWithTimeout<any>(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        timeout: 20000, // 20 seconds for message sending
        retries: 2,
      });

      return {
        success: true,
        messageId: result.data.message_id,
      };
    } catch (error) {
      // Handles timeout and other errors
      const errorMessage =
        error instanceof Error
          ? error.message
          : ERROR_MESSAGES.API.GENERIC_ERROR;

      // Checks for 24-hour window error in error message
      if (errorMessage.includes("window") || errorMessage.includes("24-hour")) {
        return {
          success: false,
          error: ERROR_MESSAGES.MESSAGING.WINDOW_EXPIRED,
        };
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
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
 * Checks if messaging is allowed (within 24-hour window)
 */
export async function checkMessagingWindow(
  recipientId: string,
  accessToken: string
): Promise<boolean> {
  try {
    // Gets conversation info from Instagram Graph API
    const url = buildGraphApiUrl(recipientId);
    url.searchParams.set("fields", "last_message_time");
    url.searchParams.set("access_token", accessToken);

    const result = await fetchWithTimeout<any>(url.toString(), {
      method: "GET",
      timeout: 10000,
      retries: 1,
    });

    const data = result.data;

    if (!data.last_message_time) {
      return false;
    }

    // Checks if within 24 hours
    const lastMessageTime = new Date(data.last_message_time);
    const now = new Date();
    const hoursDiff =
      (now.getTime() - lastMessageTime.getTime()) / (1000 * 60 * 60);

    return hoursDiff <= MESSAGING_CONSTRAINTS.WINDOW_HOURS;
  } catch (error) {
    return false;
  }
}

/**
 * Sends a message with retry logic
 */
export async function sendDirectMessageWithRetry(
  options: SendMessageOptions,
  maxRetries: number = 3
): Promise<SendMessageResult> {
  let lastError: string = "";

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await sendDirectMessage(options);

    if (result.success) {
      return result;
    }

    lastError = result.error || "Unknown error";

    // Don't retry for certain errors
    if (
      lastError.includes("24-hour") ||
      lastError.includes("window") ||
      lastError.includes("permission")
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
