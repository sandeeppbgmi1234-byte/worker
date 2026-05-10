import { getAccountByInstagramIdR } from "../redis/operations/user";
import {
  getAutomationsByPostR,
  getAutomationsByStoryR,
  getAutomationByIdR,
  getAutomationsForAccountDMR,
} from "../redis/operations/automation";
import {
  findInstaAccountByPlatformId,
  deactivateInstaAccount,
} from "../repositories/insta-account.repository";
import {
  findActiveAutomationsByPost,
  findActiveAutomationsByStory,
  findActiveAutomationsForAccountDM,
  findAutomationById,
  pauseAutomation,
} from "../repositories/automation.repository";
import { RefinedEvent, FilteredEvent } from "../types";
import { Automation } from "@prisma/client";
import { Result, ok, fail } from "../helpers/result";
import { FilterError, PipelineRetryableError } from "../errors/pipeline.errors";
import { logger } from "../logger";
import { addNotificationJob } from "../queue/notifications";

function getTextFromEvent(refined: RefinedEvent): string {
  switch (refined.type) {
    case "COMMENT":
      return refined.event.text;
    case "STORY_REPLY":
      return refined.event.text;
    case "DM_MESSAGE":
      return refined.event.text;
    default:
      return "";
  }
}

export async function filterEvents(
  events: RefinedEvent[],
): Promise<Result<FilteredEvent[], FilterError>> {
  const filterResults = await Promise.all(
    events.map(async (eventWrapper) => {
      try {
        const igUserId = eventWrapper.instagramUserId;

        // Quick fetches through Redis or DB
        const accountResult = await getAccountByInstagramIdR(
          igUserId,
          async () => {
            const res = await findInstaAccountByPlatformId(igUserId);
            return res.ok ? res.value : null;
          },
        );

        if (
          !accountResult ||
          !accountResult.isActive ||
          !accountResult.webhookUserId
        )
          return ok(null);

        // --- HARD-STOP: Token Expiration Check ---
        const now = new Date();
        if (
          accountResult.tokenExpiresAt &&
          new Date(accountResult.tokenExpiresAt) < now
        ) {
          logger.warn(
            {
              accountId: accountResult.id,
              username: accountResult.username,
              expiredAt: accountResult.tokenExpiresAt,
            },
            "Dropping webhook event: Instagram Token has Expired.",
          );

          // 1. Trigger notification job (idempotency handled by BullMQ jobId)
          await addNotificationJob({
            type: "TOKEN_EXPIRED",
            userId: accountResult.user.clerkId,
            accountId: accountResult.id,
            expiredAt: new Date(accountResult.tokenExpiresAt).getTime(),
          });

          // 2. Persistence cleanup: Deactivate account
          await deactivateInstaAccount(accountResult.id);

          return ok(null);
        }

        let automations: Automation[] = [];

        switch (eventWrapper.type) {
          case "COMMENT": {
            const mediaId = eventWrapper.event.mediaId;
            automations = await getAutomationsByPostR(
              accountResult.webhookUserId,
              mediaId,
              async () => {
                const res = await findActiveAutomationsByPost(
                  accountResult.id,
                  mediaId,
                );
                return res.ok ? res.value : [];
              },
            );
            break;
          }

          case "STORY_REPLY": {
            const storyId = eventWrapper.event.storyId;
            automations = await getAutomationsByStoryR(
              accountResult.webhookUserId,
              storyId,
              async () => {
                const res = await findActiveAutomationsByStory(
                  accountResult.id,
                  storyId,
                );
                return res.ok ? res.value : [];
              },
            );
            break;
          }
          case "DM_MESSAGE": {
            automations = await getAutomationsForAccountDMR(
              accountResult.webhookUserId,
              async () => {
                const res = await findActiveAutomationsForAccountDM(
                  accountResult.id,
                );
                return res.ok ? res.value : [];
              },
            );
            break;
          }

          case "QUICK_REPLY": {
            const payload = eventWrapper.payload;
            const parts = payload.split(":");
            // QR Format: ACTION:AUTOMATION_ID:ORIGIN_EVENT_ID
            const automationId = parts[1] || "";
            const originEventId = parts[2] || "";

            if (automationId) {
              const automation = await getAutomationByIdR(
                accountResult.webhookUserId,
                automationId,
                async () => {
                  const res = await findAutomationById(automationId);
                  return res.ok ? res.value : null;
                },
              );

              // SECURITY: Ensure the automation belongs to this account
              if (
                automation &&
                automation.instaAccountId === accountResult.id &&
                automation.status === "ACTIVE"
              ) {
                return ok({
                  event: { ...eventWrapper, originEventId },
                  accountId: accountResult.id,
                  clerkUserId: accountResult.user.clerkId,
                  userId: accountResult.userId,
                  webhookUserId: accountResult.webhookUserId,
                  instagramUsername: accountResult.username,
                  matchedAutomations: [automation],
                } as FilteredEvent);
              }
            }
            return ok(null);
          }

          default:
            return ok(null);
        }

        if (automations.length === 0) return ok(null);

        const textTarget = getTextFromEvent(eventWrapper);

        if (typeof textTarget !== "string" || !textTarget) return ok(null);

        const matches: Automation[] = [];
        const specificAutomations = automations.filter(
          (a) => a.triggers && a.triggers.length > 0,
        );
        const anyKeywordAutomations = automations.filter(
          (a) => !a.triggers || a.triggers.length === 0,
        );

        for (const automation of specificAutomations) {
          if (automation.matchType === "REGEX") {
            logger.warn(
              { automationId: automation.id },
              "Deactivating automation with unsupported REGEX matchType",
            );
            // Explicit user-facing handling: Pause the automation and notify
            await pauseAutomation(automation.id, automation.instaAccountId);
            await addNotificationJob({
              type: "REGEX_UNSUPPORTED",
              userId: accountResult.userId,
              automationId: automation.id,
            });
            continue;
          }
          const commentText = textTarget.toLowerCase().trim();
          let isMatch = false;

          for (const trigger of automation.triggers) {
            const triggerLower = trigger.toLowerCase().trim();

            if (automation.matchType === "CONTAINS")
              isMatch = commentText.includes(triggerLower);
            else if (automation.matchType === "EXACT")
              isMatch = commentText === triggerLower;
            else isMatch = commentText.includes(triggerLower);

            if (isMatch) {
              matches.push(automation);
              break;
            }
          }
          // Multiple automations per event are allowed - scanning all specific matches
        }

        if (matches.length === 0 && anyKeywordAutomations.length > 0) {
          matches.push(anyKeywordAutomations[0]);
        }

        return ok(
          matches.length > 0
            ? ({
                event: eventWrapper,
                accountId: accountResult.id,
                clerkUserId: accountResult.user.clerkId,
                userId: accountResult.userId,
                webhookUserId: accountResult.webhookUserId,
                instagramUsername: accountResult.username,
                matchedAutomations: matches,
              } as FilteredEvent)
            : null,
        );
      } catch (err: any) {
        logger.error(
          {
            err,
            eventType: eventWrapper.type,
            instagramUserId: eventWrapper.instagramUserId,
          },
          "Error filtering individual event",
        );
        return fail(
          new FilterError(
            "filterEvents",
            "Transient failure during event filtering",
            { eventType: eventWrapper.type },
            err,
          ),
        );
      }
    }),
  );

  const filtered: FilteredEvent[] = [];
  const failures: any[] = [];
  let skipCount = 0;

  for (const res of filterResults) {
    if (res.ok) {
      if (res.value) {
        filtered.push(res.value);
      } else {
        skipCount++;
      }
    } else {
      failures.push(res.error);
    }
  }

  if (failures.length > 0) {
    logger.warn(
      { failureCount: failures.length, successCount: filtered.length },
      "Filter Stage: Some events failed filtering and will be dropped/logged.",
    );
  }

  if (skipCount > 0) {
    logger.info(
      { skipCount, successCount: filtered.length },
      "Filter Stage orchestration completed with skips",
    );
  }

  return ok(filtered);
}
