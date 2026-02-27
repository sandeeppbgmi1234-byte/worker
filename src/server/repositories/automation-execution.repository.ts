/**
 * Automation Execution Repository
 * Data access layer for AutomationExecution model operations
 */

import { prisma } from "../../db/db";
import { executeWithErrorHandling } from "./repository-utils";

/**
 * Checks if a comment was already processed by an automation
 * Returns false on error to allow processing (fail-open for availability)
 */
export async function isCommentProcessed(
  commentId: string,
  automationId: string,
): Promise<boolean> {
  return executeWithErrorHandling(
    async () => {
      const existing = await prisma.automationExecution.findFirst({
        where: {
          commentId,
          automationId,
        },
      });
      return !!existing;
    },
    {
      operation: "isCommentProcessed",
      model: "AutomationExecution",
      fallback: false, // Fail-open: if we can't check, allow processing
      retries: 1,
    },
  );
}
