/**
 * Instagram Webhook Event Handler
 * Processes incoming webhook events from Instagram
 */

import {
  validateCommentData,
  findMatchingAutomations,
  isCommentProcessed,
} from "../../automation/matcher";
import { executeAutomation } from "../../automation/executor";
import { getValidAccessToken } from "../token-manager";
import { logger } from "../../utils/logger";
import { prisma } from "../../../db/db";

export interface WebhookEntry {
  id: string;
  time: number;
  changes?: Array<{
    field: string;
    value: any;
  }>;
  messaging?: Array<{
    sender: { id: string };
    recipient: { id: string };
    timestamp: number;
    message?: {
      mid: string;
      text: string;
    };
  }>;
}

export interface InstagramWebhookPayload {
  object: string;
  entry: WebhookEntry[];
}

/**
 * Processes a webhook event
 */
export async function processWebhookEvent(
  payload: InstagramWebhookPayload,
): Promise<void> {
  const webhookId = payload.entry?.[0]?.id || "unknown";
  const entryCount = payload.entry?.length || 0;

  // Logs only essential fields to avoid logging large payload objects
  // and prevent issues with object references being mutated later
  logger.info("processWebhookEvent", {
    object: payload.object,
    webhookId,
    entryCount,
  });

  try {
    for (const entry of payload.entry) {
      // Processes changes (comments, etc.)
      if (entry.changes) {
        for (const change of entry.changes) {
          await processChange(entry.id, change);
        }
      }

      // Processes messaging events (DMs)
      if (entry.messaging) {
        for (const messagingEvent of entry.messaging) {
          await processMessagingEvent(entry.id, messagingEvent);
        }
      }
    }
  } catch (error) {
    logger.error(
      "Critical error processing webhook event",
      error instanceof Error ? error : new Error(String(error)),
      {
        webhookId,
        object: payload.object,
        entryCount,
      },
    );
    throw error; // Re-throws to be caught by webhook service
  }
}

/**
 * Processes a change event (comment, etc.)
 */
async function processChange(
  instagramUserId: string,
  change: { field: string; value: any },
): Promise<void> {
  const { field, value } = change;

  // Processes event with timeout
  Promise.race([
    (async () => {
      switch (field) {
        case "comments":
          await handleCommentEvent(instagramUserId, value);
          break;
        case "messages":
          await handleMessageEvent(instagramUserId, value);
          break;
        default:
          logger.warn("Unknown webhook field", { field });
      }
    })(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Handler timeout")), 4000),
    ),
  ]).catch((error) => {
    logger.error("processChange - Webhook processing failed", error, {
      field,
      instagramUserId,
    });
  });

  // Returns immediately - don't await the Promise.race
}

/**
 * Processes a messaging event (DM)
 */
async function processMessagingEvent(
  instagramUserId: string,
  messagingEvent: any,
): Promise<void> {
  // Processes the message
  if (messagingEvent.message) {
    if (messagingEvent.message.reply_to?.story) {
      await handleStoryReplyEvent(instagramUserId, messagingEvent);
    } else {
      await handleIncomingMessage(instagramUserId, messagingEvent);
    }
  }
}

/**
 * Handles a story reply event
 */
async function handleStoryReplyEvent(
  instagramUserId: string,
  messagingEvent: any,
): Promise<void> {
  try {
    const senderId = messagingEvent.sender.id;
    const storyId = messagingEvent.message.reply_to.story.id;
    const text = messagingEvent.message.text;

    if (!text || !storyId) {
      return;
    }

    // Resolves access token
    const instaAccount = await prisma.instaAccount.findFirst({
      where: { instagramUserId },
    });

    if (!instaAccount) {
      return;
    }

    let accessToken: string;
    try {
      accessToken = await getValidAccessToken(instaAccount.id);
    } catch (error) {
      logger.error("Failed to get token for story reply", error as Error, {
        instagramUserId,
        storyId,
      });
      return;
    }

    // TODO: Story reply automation matching logic (Phase 2/3)
    logger.info("Story reply received", {
      instagramUserId,
      senderId,
      storyId,
      textPreview: text.substring(0, 50),
    });
  } catch (error) {
    logger.error("Error processing story reply", error as Error);
  }
}

/**
 * Handles a comment event
 */
async function handleCommentEvent(
  instagramUserId: string,
  commentData: any,
): Promise<void> {
  try {
    // Validates comment
    const comment = validateCommentData(commentData);
    if (!comment) {
      logger.warn("Invalid comment data in webhook", {
        instagramUserId,
        commentData: JSON.stringify(commentData).slice(0, 200),
      });
      return;
    }

    // Extracts postId
    const postId = commentData.media?.id || commentData.media_id;
    if (!postId) {
      logger.warn("Missing postId in comment event", {
        instagramUserId,
        commentId: comment.id,
      });
      return;
    }

    // Account gating (Direct DB)
    const { findInstaAccountByInstagramUserId } =
      await import("../../../server/repositories/insta-account.repository");

    const dbAccount = await findInstaAccountByInstagramUserId(
      String(instagramUserId),
    );

    if (!dbAccount || !dbAccount.isActive) {
      return;
    }

    const instaAccount = {
      id: dbAccount.id,
      userId: dbAccount.userId,
      clerkId: dbAccount.user?.clerkId || "",
    };

    // Fetches active automations directly from DB
    const { findActiveAutomationsByPost } =
      await import("../../../server/repositories/automation.repository");

    const automations = await findActiveAutomationsByPost(
      instaAccount.userId,
      postId,
    );

    if (automations.length === 0) {
      return;
    }

    // Matches automations

    const matches = await findMatchingAutomations(comment, automations);
    if (matches.length === 0) {
      return;
    }

    // Resolves access token (DB authority)

    let accessToken: string;
    try {
      accessToken = await getValidAccessToken(instaAccount.id);
    } catch (error) {
      logger.error(
        "Failed to get valid access token for webhook processing",
        error instanceof Error ? error : new Error(String(error)),
        {
          instagramUserId,
          instaAccountId: instaAccount.id,
        },
      );
      return;
    }

    // Executes automations (idempotent)
    // Checks all automations in parallel to filter out already-processed ones
    const processedChecks = await Promise.all(
      matches.map((match) =>
        isCommentProcessed(comment.id, match.automation.id).then(
          (processed) => ({ match, processed }),
        ),
      ),
    );

    // Filters out already-processed automations
    const unprocessedMatches = processedChecks.filter(
      ({ processed }) => !processed,
    );

    // Logs skipped automations
    processedChecks
      .filter(({ processed }) => processed)
      .forEach(({ match }) => {
        logger.debug("Comment already processed", {
          commentId: comment.id,
          automationId: match.automation.id,
        });
      });

    if (unprocessedMatches.length === 0) {
      return;
    }

    // Executes remaining automations in parallel
    const executionResults = await Promise.allSettled(
      unprocessedMatches.map(({ match }) =>
        executeAutomation(match.automation.id, comment, accessToken),
      ),
    );

    // Logs results
    executionResults.forEach((result, index) => {
      const { match } = unprocessedMatches[index];

      if (result.status === "fulfilled") {
        logger.info("Automation executed successfully", {
          commentId: comment.id,
          automationId: match.automation.id,
          actionType: match.automation.actionType,
        });
      } else {
        logger.error(
          "Failed to execute automation for comment",
          result.reason instanceof Error
            ? result.reason
            : new Error(String(result.reason)),
          {
            commentId: comment.id,
            automationId: match.automation.id,
            actionType: match.automation.actionType,
          },
        );
      }
    });
  } catch (error) {
    logger.error(
      "Error handling comment event",
      error instanceof Error ? error : new Error(String(error)),
      {
        instagramUserId,
        commentId: commentData?.id,
        postId: commentData?.media?.id || commentData?.media_id,
      },
    );
    throw error;
  }
}

/**
 * Handles an incoming message (DM)
 */
async function handleIncomingMessage(
  instagramUserId: string,
  messagingEvent: any,
): Promise<void> {
  // TODO: Phase 4 will implement message handling
  // For now, we just log that we received the event

  logger.info("handleIncomingMessage", {
    instagramUserId,
    messagingEvent,
  });
}

/**
 * Handles a message event from comments field
 */
async function handleMessageEvent(
  instagramUserId: string,
  messageData: any,
): Promise<void> {
  // TODO: Implements message event handling

  logger.info("handleMessageEvent", {
    instagramUserId,
    messageData,
  });
}
