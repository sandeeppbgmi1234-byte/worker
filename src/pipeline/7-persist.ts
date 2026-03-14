import { ExecutionOutcome } from "../types";
import { executeTransaction } from "../repositories/repository-utils";
import { Result, ok, fail } from "../helpers/result";
import { PersistenceError } from "../errors/pipeline.errors";

export async function persistOutcomes(
  outcomes: ExecutionOutcome[],
): Promise<Result<void, PersistenceError>> {
  for (const outcome of outcomes) {
    try {
      await executeTransaction(
        async (tx) => {
          await tx.automationExecution.create({
            data: {
              automationId: outcome.automationId,
              commentId: outcome.eventId || "unknown_event",
              commentText: outcome.commentData.text || "Interaction",
              commentUsername:
                outcome.commentData.username ||
                outcome.commentData.senderId ||
                "unknown",
              commentUserId:
                outcome.commentData.userId ||
                outcome.commentData.senderId ||
                "unknown",
              actionType: outcome.actionType,
              sentMessage: outcome.sentMessage || "",
              status: outcome.status,
              errorMessage: outcome.errorMessage || "",
              instagramMessageId: outcome.instagramMessageId || "",
              executedAt: new Date(),
            },
          });

          if (outcome.status === "SUCCESS") {
            await tx.automation.update({
              where: { id: outcome.automationId },
              data: {
                timesTriggered: { increment: 1 },
                lastTriggeredAt: new Date(),
              },
            });
          }
        },
        {
          operation: "persistPipelineOutcome",
          models: ["AutomationExecution", "Automation"],
        },
      );
    } catch (dbError) {
      continue; // Move on if constraint error
    }
  }

  return ok(undefined);
}
