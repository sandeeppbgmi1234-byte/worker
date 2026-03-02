/**
 * Automation Executor
 * Executes automation actions (DM or comment reply)
 */

import { CommentData, replaceVariables } from "./matcher";
import { sendDirectMessage } from "../instagram/messaging-api";
import { replyToComment } from "../instagram/comments-api";
import { checkRateLimits } from "../instagram/rate-limiting/redis-limiter";
import { logger } from "../utils/pino";
import { findAutomationById } from "../../server/repositories/automation.repository";
import { findInstaAccountByAutomationId } from "../../server/repositories/insta-account.repository";

export interface ExecutionResult {
  success: boolean;
  executionId?: string;
  error?: string;
}

/**
 * Executes an automation action
 */
export async function executeAutomation(
  automationId: string,
  comment: CommentData,
  accessToken: string,
): Promise<ExecutionResult> {
  try {
    // Gets the automation
    const automation = await findAutomationById(automationId);

    if (!automation) {
      logger.warn({ automationId }, "Automation not found");
      return {
        success: false,
        error: "Automation not found",
      };
    }

    // Prepares the message
    let finalMessage = automation.replyMessage;
    if (automation.useVariables) {
      finalMessage = replaceVariables(finalMessage, comment);
    }

    let instagramMessageId: string | null = null;
    let executionStatus: "SUCCESS" | "FAILED" | "PENDING" = "PENDING";
    let errorMessage: string | null = null;

    // Gets Instagram user ID for rate limiting
    const instaAccount = await findInstaAccountByAutomationId(automationId);

    if (!instaAccount) {
      return {
        success: false,
        error: "Instagram account not found",
      };
    }

    // Executes based on action type
    try {
      if (automation.actionType === "COMMENT_REPLY") {
        // Checks API-driven Rate Limits via Redis before firing
        await checkRateLimits(instaAccount.instagramUserId);

        const result = await replyToComment({
          commentId: comment.id,
          message: finalMessage,
          accessToken,
          instagramUserId: instaAccount.instagramUserId,
        });

        instagramMessageId = result.replyId || null;
        executionStatus = "SUCCESS";
      } else if (automation.actionType === "DM") {
        // Checks API-driven Rate Limits via Redis before firing
        await checkRateLimits(instaAccount.instagramUserId);

        // Sends DM
        // Note: If user hasn't messaged before, DM will go to their "Message Requests" folder
        // We use the commentId to reply privately to the comment which bypasses the 24h window for the first message
        const result = await sendDirectMessage({
          recipientId: comment.userId,
          // Only pass commentId if it's a comment reply; story replies execute as standard DMs.
          commentId:
            automation.triggerType === "STORY_REPLY" ? undefined : comment.id,
          message: finalMessage,
          accessToken,
          instagramUserId: instaAccount.instagramUserId,
        });

        instagramMessageId = result.messageId || null;
        executionStatus = "SUCCESS";

        // Replies to the comment after successfully sending DM if configured
        if (automation.commentReplyWhenDm) {
          try {
            await checkRateLimits(instaAccount.instagramUserId);

            // Prepares the comment reply message with variable replacement
            let commentReplyMessage = automation.commentReplyWhenDm;
            if (automation.useVariables) {
              commentReplyMessage = replaceVariables(
                commentReplyMessage,
                comment,
              );
            }

            await replyToComment({
              commentId: comment.id,
              message: commentReplyMessage,
              accessToken,
              instagramUserId: instaAccount.instagramUserId,
            });

            logger.info(
              {
                commentId: comment.id,
                automationId,
              },
              "Comment reply sent after DM",
            );
          } catch (commentReplyError) {
            // Logs error but doesn't fail the automation execution
            logger.error(
              {
                commentId: comment.id,
                automationId,
              },
              "Error replying to comment after DM",
              commentReplyError instanceof Error
                ? commentReplyError
                : new Error(String(commentReplyError)),
            );
          }
        }
      } else {
        throw new Error(`Unknown action type: ${automation.actionType}`);
      }
    } catch (actionError) {
      executionStatus = "FAILED";
      errorMessage =
        actionError instanceof Error
          ? actionError.message
          : "Unknown error executing action";

      logger.error(
        {
          automationId,
          actionType: automation.actionType,
          commentId: comment.id,
        },
        "Failed to execute automation action",
        actionError instanceof Error
          ? actionError
          : new Error(String(actionError)),
      );
    }

    // Records the execution and updates stats in a transaction
    // Ensures execution record and stats are updated atomically
    const { executeTransaction } =
      await import("../../server/repositories/repository-utils");
    const { prisma } = await import("../../db/db");

    const execution = await executeTransaction(
      async (tx) => {
        // Creates execution record
        const execution = await tx.automationExecution.create({
          data: {
            automationId,
            commentId: comment.id,
            commentText: comment.text,
            commentUsername: comment.username,
            commentUserId: comment.userId,
            actionType: automation.actionType,
            sentMessage: finalMessage,
            status: executionStatus,
            errorMessage,
            instagramMessageId,
            executedAt: new Date(),
          },
        });

        // Updates automation stats
        await tx.automation.update({
          where: { id: automationId },
          data: {
            timesTriggered: {
              increment: 1,
            },
            lastTriggeredAt: new Date(),
          },
        });

        return execution;
      },
      {
        operation: "executeAutomation",
        models: ["AutomationExecution", "Automation"],
      },
    );

    // Logs execution result
    if (executionStatus !== "SUCCESS") {
      logger.warn(
        {
          automationId,
          executionId: execution.id,
          actionType: automation.actionType,
          error: errorMessage,
        },
        "Automation execution failed",
      );
    }
    return {
      success: executionStatus === "SUCCESS",
      executionId: execution.id,
      error: errorMessage || undefined,
    };
  } catch (error) {
    const { isDuplicateKeyError } =
      await import("../../server/repositories/repository-utils");

    // If it's a duplicate key, another worker already processed it.
    // We treat this as a success to avoid failing the queue job.
    if (isDuplicateKeyError(error)) {
      logger.info(
        {
          automationId,
          commentId: comment.id,
        },
        "Automation execution skipped (already processed)",
      );
      return { success: true };
    }

    logger.error(
      {
        automationId,
        commentId: comment.id,
      },
      "Error in executeAutomation",
      error instanceof Error ? error : new Error(String(error)),
    );
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Batch executes multiple automations for a comment
 */
export async function batchExecuteAutomations(
  automationIds: string[],
  comment: CommentData,
  accessToken: string,
): Promise<ExecutionResult[]> {
  const results: ExecutionResult[] = [];

  for (const automationId of automationIds) {
    const result = await executeAutomation(automationId, comment, accessToken);
    results.push(result);
  }

  return results;
}
