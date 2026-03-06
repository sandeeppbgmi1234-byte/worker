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
import { logger } from "../utils/pino";

export interface QuickReply {
  title: string;
  payload: string;
}

export interface SendMessageOptions {
  recipientId: string;
  commentId?: string;
  message?: string;
  attachmentUrl?: string; // New field for images
  quickReplies?: QuickReply[]; // Interactive buttons
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
  // Validates message length if text is provided
  if (
    options.message &&
    options.message.length > MESSAGING_CONSTRAINTS.MESSAGE_MAX_LENGTH
  ) {
    throw new Error(ERROR_MESSAGES.MESSAGING.MESSAGE_TOO_LONG);
  }

  // Build the URL using either the provided instagramUserId or "me"
  const igId = options.instagramUserId || "me";
  const url = buildGraphApiUrl(`${igId}/messages`);

  // Prepare message content (either text only or attachments only)
  let messageContent: any = {};
  if (options.attachmentUrl) {
    messageContent = {
      attachments: [
        {
          type: "image",
          payload: {
            url: options.attachmentUrl,
          },
        },
      ],
    };
  } else if (options.message) {
    messageContent = { text: options.message };
    if (options.quickReplies && options.quickReplies.length > 0) {
      messageContent.quick_replies = options.quickReplies.map((qr) => ({
        content_type: "text",
        title: qr.title,
        payload: qr.payload,
      }));
    }
  } else {
    throw new Error("Either message or attachmentUrl must be provided");
  }

  const requestBody: any = {
    recipient: options.commentId
      ? { comment_id: options.commentId }
      : { id: options.recipientId },
    message: messageContent,
    messaging_type: options.messagingType || "RESPONSE",
    access_token: options.accessToken,
  };

  // Adds tag if using MESSAGE_TAG
  if (options.messagingType === "MESSAGE_TAG" && options.tag) {
    requestBody.tag = options.tag;
  }

  logger.info(
    {
      igId,
      recipientId: options.recipientId,
      hasAttachment: !!options.attachmentUrl,
      payload: { ...requestBody, access_token: "REDACTED" },
    },
    "[Messaging API] Sending request to Instagram",
  );

  try {
    const result = await fetchFromInstagram<any>(url.toString(), {
      method: "POST",
      body: requestBody,
      timeoutMs: 20000,
      retries: 2,
      instagramUserId: options.instagramUserId,
    });

    logger.info(
      { igId, messageId: result.message_id },
      "[Messaging API] Instagram response success",
    );

    return {
      messageId: result.message_id,
    };
  } catch (apiError: any) {
    logger.error(
      {
        igId,
        error: apiError.message,
        status: apiError.status,
        recipientId: options.recipientId,
      },
      "[Messaging API] Instagram request failed",
    );
    throw apiError;
  }
}
