import { getAccountByInstagramIdR } from "../redis/operations/user";
import {
  getAutomationsByPostR,
  getAutomationsByStoryR,
  getAutomationByIdR,
} from "../redis/operations/automation";
import { findInstaAccountByInstagramUserId } from "../repositories/insta-account.repository";
import {
  findActiveAutomationsByPost,
  findActiveAutomationsByStory,
  findAutomationById,
} from "../repositories/automation.repository";
import { RefinedEvent, FilteredEvent } from "../types";
import { Automation } from "@prisma/client";
import { Result, ok } from "../helpers/result";
import { FilterError } from "../errors/pipeline.errors";

export async function filterEvents(
  events: RefinedEvent[],
): Promise<Result<FilteredEvent[], FilterError>> {
  const filtered: FilteredEvent[] = [];

  for (const eventWrapper of events) {
    const igUserId = eventWrapper.instagramUserId;

    // Quick fetches through Redis or DB
    const accountResult = await getAccountByInstagramIdR(igUserId, async () => {
      const res = await findInstaAccountByInstagramUserId(igUserId);
      return res.ok ? res.value : null;
    });

    if (!accountResult || !accountResult.isActive) continue;

    let automations: Automation[] = [];

    switch (eventWrapper.type) {
      case "COMMENT": {
        const mediaId = eventWrapper.event.mediaId;
        automations = await getAutomationsByPostR(
          accountResult.userId,
          mediaId,
          async () => {
            const res = await findActiveAutomationsByPost(
              accountResult.userId,
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
          accountResult.userId,
          storyId,
          async () => {
            const res = await findActiveAutomationsByStory(
              accountResult.userId,
              storyId,
            );
            return res.ok ? res.value : [];
          },
        );
        break;
      }

      case "QUICK_REPLY": {
        const payload = eventWrapper.payload;
        const parts = payload.split(":");
        // Payload format: PREFIX:automationId:originEventId
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
            filtered.push({
              event: eventWrapper,
              accountId: accountResult.id,
              instagramUsername: accountResult.username,
              matchedAutomations: [automation],
            });
            continue;
          }
        }

        // Fallback if no specific automation found for other QRs
        filtered.push({
          event: eventWrapper,
          accountId: accountResult.id,
          instagramUsername: accountResult.username,
          matchedAutomations: [],
        });
        continue;
      }

      default:
        break;
    }

    if (automations.length === 0) continue;

    // Matching
    // Matching
    const textTarget =
      eventWrapper.type === "COMMENT"
        ? eventWrapper.event.text
        : (eventWrapper.event as any).text;
    const matches: Automation[] = [];

    // Prioritize specific keyword matches over "Any Keyword" catch-alls
    const specificAutomations = automations.filter(
      (a) => a.triggers && a.triggers.length > 0,
    );
    const anyKeywordAutomations = automations.filter(
      (a) => !a.triggers || a.triggers.length === 0,
    );

    // 1. Try specific keyword matches first
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
      // If we found a specific match, we stop searching for others
      if (matches.length > 0) break;
    }

    // 2. If no specific match found, fallback to the first "Any Keyword" automation
    if (matches.length === 0 && anyKeywordAutomations.length > 0) {
      matches.push(anyKeywordAutomations[0]);
    }

    if (matches.length > 0) {
      filtered.push({
        event: eventWrapper,
        accountId: accountResult.id,
        instagramUsername: accountResult.username,
        matchedAutomations: matches,
      });
    }
  }

  return ok(filtered);
}
