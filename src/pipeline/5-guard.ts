import { EnrichedEvent, GuardedEvent } from "../types";
import { isCommentProcessedR } from "../redis/operations/comment";
import {
  isUserOnCooldownR,
  isUserThrottledR,
  isPendingConfirmationR,
  isEventThrottledR,
  isAskResolvedR,
} from "../redis/operations/cooldown";
import { QUICK_REPLIES } from "../config/instagram.config";
import { Result, ok } from "../helpers/result";
import { GuardError } from "../errors/pipeline.errors";
import { Automation } from "@prisma/client";
import { getCreditStateR, setCreditStateR } from "../redis/operations/credits";
import { addNotificationJob } from "../queues/notifications";
import { prisma } from "../db/db";
import { logger } from "../logger";

export async function guardEvents(
  enrichedEvents: EnrichedEvent[],
): Promise<Result<GuardedEvent[], GuardError>> {
  // Cache for multi-event batches sharing the same owner.
  // Note: We use Eventual Consistency for billing. Redis credits are incremented by the
  // Persistence Flusher ONLY after a successful DB commit to prevent drift.
  // TOCTOU Mitigation: 'ownerStateCache' allows batch-level local reservations to catch bursts.
  const ownerStateCache = new Map<
    string,
    { used: number; limit: number; status: string }
  >();

  const guardResults = await Promise.all(
    enrichedEvents.map(async (wrapper) => {
      const { clerkUserId, userId: ownerId } = wrapper;

      // 1. Resolve Billing State (Redis-first with DB fallback)
      let state = ownerStateCache.get(ownerId);
      if (!state) {
        const cached = await getCreditStateR(clerkUserId);
        if (
          cached.creditsUsed !== null &&
          cached.creditLimit !== null &&
          cached.subStatus !== null
        ) {
          state = {
            used: cached.creditsUsed,
            limit: cached.creditLimit,
            status: cached.subStatus,
          };
        } else {
          // Self-healing: Read from DB
          const userWithSub = await prisma.user.findUnique({
            where: { id: ownerId },
            include: {
              subscription: true,
              creditLedger: true,
            },
          });

          if (!userWithSub) {
            logger.warn(
              { ownerId, clerkUserId, event: wrapper.event.type },
              "Billing check failed: User record not found for ownerId — skipping event",
            );
            return null;
          }

          state = {
            used: userWithSub.creditLedger?.creditsUsed ?? 0,
            limit: userWithSub.creditLedger?.creditLimit ?? 1000, // Default to FREE limit
            status: userWithSub.subscription?.status ?? "ACTIVE", // Default to ACTIVE
          };

          // Restore Redis
          await setCreditStateR(
            clerkUserId,
            state.used,
            state.limit,
            state.status,
          );
        }
        ownerStateCache.set(ownerId, state);
      }

      // 2. Enforce Status & Quota
      // EXPIRED: Block everything
      if (state.status === "EXPIRED") return null;

      // QUOTA: Block if used >= limit (limit -1 means unlimited)
      if (state.limit !== -1 && state.used >= state.limit) {
        // Trigger notification (throttled by BullMQ jobId)
        await addNotificationJob({
          type: "QUOTA_FULL",
          userId: clerkUserId,
          usedAt: Date.now(),
        });
        return null;
      }

      // 3. Batch-level TOCTOU mitigation: Perform local reservation
      state.used += 1;

      const safeAutomations = [];
      let userId = "";

      switch (wrapper.event.type) {
        case "COMMENT":
          userId = wrapper.event.event.userId;
          break;
        case "STORY_REPLY":
        case "DM_MESSAGE":
        case "QUICK_REPLY":
          userId = wrapper.event.event.senderId;
          break;
        default:
          break;
      }

      if (!userId) return null;

      const automationGuards = await Promise.all(
        wrapper.matchedAutomations.map(async (automation) => {
          // --- ATOMICITY & SPAM PROTECTION ---
          if (wrapper.event.type === "QUICK_REPLY") {
            const payload = wrapper.event.payload;
            const isFollowConfirmClick = payload.startsWith(
              QUICK_REPLIES.FOLLOW_CONFIRM.PAYLOAD_PREFIX,
            );
            const isOpeningMessageClick = payload.startsWith(
              QUICK_REPLIES.OPENING_MESSAGE.PAYLOAD_PREFIX,
            );

            if (isFollowConfirmClick || isOpeningMessageClick) {
              const resolved = await isAskResolvedR(userId, automation.id);
              if (resolved) return null;

              const throttled = await isUserThrottledR(userId, automation.id);
              if (throttled) return null;
            } else {
              const eventId = (wrapper.event.event as any).messageId || "";
              const throttled = await isEventThrottledR(eventId);
              if (throttled) return null;
            }
          } else {
            const throttled = await isUserThrottledR(userId, automation.id);
            if (throttled) return null;
          }

          // Combined check for cooldown and pending states
          const [onCooldown, pending] = await Promise.all([
            isUserOnCooldownR(userId, automation.id),
            isPendingConfirmationR(userId, automation.id),
          ]);

          if (onCooldown) return null;

          // SELF-HEALING: Block new triggers while a user has a pending interaction (e.g., Follow Gate).
          // We let QUICK_REPLY through so the user can resolve the state.
          if (
            pending &&
            (wrapper.event.type === "COMMENT" ||
              wrapper.event.type === "STORY_REPLY")
          ) {
            return null;
          }

          return automation;
        }),
      );

      const validAutomations = automationGuards.filter(
        (a): a is Automation => a !== null,
      );

      if (validAutomations.length > 0 || wrapper.event.type === "QUICK_REPLY") {
        return {
          ...wrapper,
          safeAutomations: validAutomations,
        } as GuardedEvent;
      }
      return null;
    }),
  );

  const guardedEvents = guardResults.filter(
    (item): item is GuardedEvent => item !== null,
  );
  return ok(guardedEvents);
}
