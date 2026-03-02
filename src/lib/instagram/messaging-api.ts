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
import { fetchFromInstagram } from "./api/client";

export interface SendMessageOptions {
  recipientId: string;
  commentId?: string;
  message: string;
  accessToken: string;
  messagingType?: "RESPONSE" | "UPDATE" | "MESSAGE_TAG";
  tag?: string;
  instagramUserId?: string; // used for rate limiting keys
}

/**
 * Sends a direct message on Instagram
 * Errors (Rate Limits, Spam, Invalid Tokens) will bubble up from fetchFromInstagram
 * to be caught by the central worker processor.
 */
export async function sendDirectMessage(
  options: SendMessageOptions,
): Promise<{ messageId: string }> {
  // Validates message length
  if (options.message.length > MESSAGING_CONSTRAINTS.MESSAGE_MAX_LENGTH) {
    throw new Error(ERROR_MESSAGES.MESSAGING.MESSAGE_TOO_LONG);
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

  const result = await fetchFromInstagram<any>(url.toString(), {
    method: "POST",
    body: requestBody,
    timeoutMs: 20000, // 20 seconds for message sending
    retries: 2,
    instagramUserId: options.instagramUserId,
  });

  return {
    messageId: result.message_id,
  };
}
