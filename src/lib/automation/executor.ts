/**
 * Automation Executor
 * Executes automation actions (DM or comment reply)
 */

import { CommentData, replaceVariables } from "./matcher";
import { sendDirectMessage } from "../instagram/messaging-api";
import { replyToComment } from "../instagram/comments-api";
import { checkRateLimits } from "../instagram/rate-limiting/redis-limiter";
import { logger } from "../utils/pino";
import { Automation } from "@prisma/client";

export interface ExecutionResult {
  success: boolean;
  executionId?: string;
  error?: string;
}

/**
 * Executes an automation action
 */
export async function executeAutomation(
  automation: Automation,
  comment: CommentData,
  accessToken: string,
  instagramUserId: string,
): Promise<ExecutionResult> {
  const automationId = automation.id;

  // Prepares the message
  let finalMessage = automation.replyMessage;
  if (automation.useVariables) {
    finalMessage = replaceVariables(finalMessage, comment);
  }

  logger.info(
    {
      automationId,
      actionType: automation.actionType,
      triggerType: automation.triggerType,
    },
    "[Executor] Beginning execution flow",
  );

  let instagramMessageId: string | null = null;
  let executionStatus: "SUCCESS" | "FAILED" = "FAILED"; // Defaults to failed if we throw before success
  let errorMessage: string | null = null;

  try {
    if (automation.actionType === "COMMENT_REPLY") {
      // Checks API-driven Rate Limits via Redis before firing
      await checkRateLimits(instagramUserId);

      const result = await replyToComment({
        commentId: comment.id,
        message: finalMessage,
        accessToken,
        instagramUserId,
      });

      instagramMessageId = result.replyId || null;
      executionStatus = "SUCCESS";
      logger.info(
        { automationId, replyId: instagramMessageId },
        "[Executor] Native COMMENT_REPLY successfully dispatched via Graph API",
      );
    } else if (automation.actionType === "DM") {
      // Checks API-driven Rate Limits via Redis before firing
      await checkRateLimits(instagramUserId);

      // Sends DM
      const result = await sendDirectMessage({
        recipientId: comment.userId,
        commentId:
          automation.triggerType === "STORY_REPLY" ? undefined : comment.id,
        message: finalMessage,
        accessToken,
        instagramUserId,
      });

      instagramMessageId = result.messageId || null;
      executionStatus = "SUCCESS";
      logger.info(
        { automationId, messageId: instagramMessageId },
        "[Executor] Native DM successfully dispatched via Graph API",
      );

      // Replies to the comment after successfully sending DM if configured
      if (automation.commentReplyWhenDm) {
        try {
          await checkRateLimits(instagramUserId);

          // Prepares the comment reply message
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
            instagramUserId,
          });

          logger.info(
            {
              commentId: comment.id,
              automationId,
            },
            "[Executor] Secondary comment reply sent successfully after DM",
          );
        } catch (commentReplyError) {
          // Swallows the secondary action error gracefully so we don't retry the job and double DM
          logger.error(
            {
              commentId: comment.id,
              automationId,
              error:
                commentReplyError instanceof Error
                  ? commentReplyError.message
                  : String(commentReplyError),
            },
            "Error replying to comment after DM (Non-fatal)",
          );
        }
      }
    } else {
      throw new Error(`Unknown action type: ${automation.actionType}`);
    }
  } catch (error) {
    // If we catch here, we know the API action failed. We format the error message to save in db
    // and re-throw so the central worker error handler knows the job failed
    errorMessage = error instanceof Error ? error.message : String(error);
    executionStatus = "FAILED";
    logger.error(
      {
        automationId,
        actionType: automation.actionType,
        commentId: comment.id,
        error: errorMessage,
      },
      "[Executor] Failed to execute automation action natively",
    );
    // Before throwing, intentionally let the code fall-through so we can log the "FAILED" execution to db
  }

  // Records the execution status (SUCCESS or FAILED) and increments counts
  try {
    const { executeTransaction } =
      await import("../../server/repositories/repository-utils");

    // We update stats atomically.
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

        if (executionStatus === "SUCCESS") {
          await tx.automation.update({
            where: { id: automationId },
            data: {
              timesTriggered: {
                increment: 1,
              },
              lastTriggeredAt: new Date(),
            },
          });
        }

        logger.info(
          { executionId: execution.id, status: executionStatus },
          "[Executor] Postgres stats seamlessly updated",
        );

        return execution;
      },
      {
        operation: "executeAutomation",
        models: ["AutomationExecution", "Automation"],
      },
    );

    // If the API call originally failed, we bubbled it to Postgres (above), now we must bubble it to Worker.ts
    if (executionStatus === "FAILED" && errorMessage) {
      throw new Error(errorMessage);
    }

    return {
      success: true,
      executionId: execution.id,
    };
  } catch (dbError: any) {
    const { isDuplicateKeyError } =
      await import("../../server/repositories/repository-utils");

    // Concurrency Trap: Another worker managed to persist the result first
    if (isDuplicateKeyError(dbError) || dbError?.code === "P2002") {
      logger.info(
        { automationId, commentId: comment.id },
        "Automation execution skipped (duplicate unique constraint hit)",
      );
      return { success: true };
    }

    // Unhandled db crash. Propagate.
    throw dbError;
  }
}

/**
 * Batch executes multiple automations for a comment
 */
export async function batchExecuteAutomations(
  automations: Automation[],
  comment: CommentData,
  accessToken: string,
  instagramUserId: string,
): Promise<ExecutionResult[]> {
  const results: ExecutionResult[] = [];

  for (const automation of automations) {
    const result = await executeAutomation(
      automation,
      comment,
      accessToken,
      instagramUserId,
    );
    results.push(result);
  }

  return results;
}
