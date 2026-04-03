import { getAccountByInstagramIdR } from "../redis/operations/user";
import {
  getAutomationsByPostR,
  getAutomationsByStoryR,
  getAutomationByIdR,
  getAutomationsForAccountDMR,
} from "../redis/operations/automation";
import { findInstaAccountByInstagramUserId } from "../repositories/insta-account.repository";
import {
  findActiveAutomationsByPost,
  findActiveAutomationsByStory,
  findActiveAutomationsForAccountDM,
  findAutomationById,
} from "../repositories/automation.repository";
import { RefinedEvent, FilteredEvent } from "../types";
import { Automation } from "@prisma/client";
import { Result, ok } from "../helpers/result";
import { FilterError } from "../errors/pipeline.errors";

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
            const res = await findInstaAccountByInstagramUserId(igUserId);
            return res.ok ? res.value : null;
          },
        );

        if (!accountResult || !accountResult.isActive) return null;

        let automations: Automation[] = [];

        switch (eventWrapper.type) {
          case "COMMENT": {
            const mediaId = eventWrapper.event.mediaId;
            automations = await getAutomationsByPostR(
              accountResult.id,
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
              accountResult.id,
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
              accountResult.id,
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
            const automationId = parts[1] || "";
            const originEventId = parts[2] || "";

            eventWrapper.originEventId = originEventId;

            if (automationId) {
              const automation = await getAutomationByIdR(
                automationId,
                async () => {
                  const res = await findAutomationById(automationId);
                  return res.ok ? res.value : null;
                },
              );

              if (automation) {
                return {
                  event: eventWrapper,
                  accountId: accountResult.id,
                  instagramUsername: accountResult.username,
                  matchedAutomations: [automation],
                } as FilteredEvent;
              }
            }

            // If no automation is found for a QUICK_REPLY, it's a "ghost" interaction (deleted automation) — drop the event.
            return null;
          }

          default:
            return null;
        }

        if (automations.length === 0) return null;

        const textTarget =
          eventWrapper.type === "COMMENT"
            ? eventWrapper.event.text
            : (eventWrapper.event as any).text;

        const matches: Automation[] = [];
        const specificAutomations = automations.filter(
          (a) => a.triggers && a.triggers.length > 0,
        );
        const anyKeywordAutomations = automations.filter(
          (a) => !a.triggers || a.triggers.length === 0,
        );

        for (const automation of specificAutomations) {
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
          if (matches.length > 0) break;
        }

        if (matches.length === 0 && anyKeywordAutomations.length > 0) {
          matches.push(anyKeywordAutomations[0]);
        }

        if (matches.length > 0) {
          return {
            event: eventWrapper,
            accountId: accountResult.id,
            instagramUsername: accountResult.username,
            matchedAutomations: matches,
          } as FilteredEvent;
        }
        return null;
      } catch (err) {
        // Isolate failure to this specific event
        return null;
      }
    }),
  );

  const filtered = filterResults.filter(
    (item): item is FilteredEvent => item !== null,
  );
  return ok(filtered);
}
