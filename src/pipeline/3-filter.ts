import { getAccountByInstagramIdR } from "../redis/operations/user";
import {
  getAutomationsByPostR,
  getAutomationsByStoryR,
} from "../redis/operations/automation";
import { findInstaAccountByInstagramUserId } from "../repositories/insta-account.repository";
import {
  findActiveAutomationsByPost,
  findActiveAutomationsByStory,
  findAutomationById,
} from "../repositories/automation.repository";
import { RefinedEvent, FilteredEvent } from "../types";
import { Automation } from "@prisma/client";
import { safeRegexMatch } from "../helpers/safe-regex";
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

    if (eventWrapper.type === "COMMENT") {
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
    } else if (eventWrapper.type === "STORY_REPLY") {
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
    } else if (eventWrapper.type === "QUICK_REPLY") {
      const payload = eventWrapper.payload;
      const parts = payload.split(":");
      const automationId = parts[parts.length - 1];

      if (automationId) {
        const automationRes = await findAutomationById(automationId);
        if (automationRes.ok && automationRes.value) {
          filtered.push({
            event: eventWrapper,
            accountId: accountResult.id,
            instagramUsername: accountResult.username,
            matchedAutomations: [automationRes.value],
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

    if (automations.length === 0) continue;

    // Matching
    const textTarget =
      eventWrapper.type === "COMMENT"
        ? eventWrapper.event.text
        : (eventWrapper.event as any).text;
    const matches: Automation[] = [];

    for (const automation of automations) {
      if (!automation.triggers) continue;

      const commentText = textTarget.toLowerCase().trim();
      let isMatch = false;

      for (const trigger of automation.triggers) {
        const triggerLower = trigger.toLowerCase().trim();

        if (automation.matchType === "CONTAINS")
          isMatch = commentText.includes(triggerLower);
        else if (automation.matchType === "EXACT")
          isMatch = commentText === triggerLower;
        else if (automation.matchType === "REGEX")
          isMatch = await safeRegexMatch(trigger, textTarget, "i");
        else isMatch = commentText.includes(triggerLower);

        if (isMatch) {
          matches.push(automation);
          break;
        }
      }
      if (matches.length > 0) break; // Dedup: Only one automation per trigger for atomicity
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
