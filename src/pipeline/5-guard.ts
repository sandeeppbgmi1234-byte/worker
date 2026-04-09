import { EnrichedEvent, GuardedEvent } from "../types";
import {
  isUserOnCooldownR,
  isUserThrottledR,
  isPendingConfirmationR,
  isEventThrottledR,
  isAskResolvedR,
  isAccountSpamGuardedR,
} from "../redis/operations/cooldown";
import {
  QUICK_REPLIES,
  RATE_LIMIT_THRESHOLDS,
} from "../config/instagram.config";
import { Result, ok } from "../helpers/result";
import { GuardError } from "../errors/pipeline.errors";
import { getGlobalAppUsageR } from "../redis/operations/rate-limit";
import { InstagramRateLimitError } from "../errors/instagram.errors";
import { Automation } from "@prisma/client";
import { getCreditStateR, setCreditStateR } from "../redis/operations/credits";
import { addNotificationJob } from "../queue/notifications";
import { prisma } from "../db/db";
import { logger } from "../logger";

export async function guardEvents(
  enrichedEvents: EnrichedEvent[],
): Promise<Result<GuardedEvent[], GuardError>> {
  // 0. App-Level Global Safety (Panic Check)
  const appUsage = await getGlobalAppUsageR();

  if (appUsage >= RATE_LIMIT_THRESHOLDS.MAX_WORKER_USAGE) {
    logger.error(
      { appUsage, threshold: RATE_LIMIT_THRESHOLDS.MAX_WORKER_USAGE },
      "GLOBAL SAFETY: App-Level absolute cutoff reached. Halting worker.",
    );
    throw new InstagramRateLimitError(
      "guardEvents",
      `App-Level absolute cutoff reached (${appUsage}%). Halting all worker operations.`,
      true,
      300_000, // 5 minutes
    );
  }

  if (appUsage >= RATE_LIMIT_THRESHOLDS.PANIC_THRESHOLD) {
    logger.warn(
      { appUsage, threshold: RATE_LIMIT_THRESHOLDS.PANIC_THRESHOLD },
      "PANIC MODE: App usage high. Throttling all jobs.",
    );
    throw new InstagramRateLimitError(
      "guardEvents",
      `App-Level Panic Threshold reached (${appUsage}%). Delaying everyone.`,
      true,
      300_000, // 5 minutes
    );
  }

  // Cache for multi-event batches sharing the same owner.
  const ownerStateCache = new Map<
    string,
    { used: number; limit: number; status: string; plan: string }
  >();

  const guardResults = await Promise.all(
    enrichedEvents.map(async (wrapper) => {
      const { clerkUserId, userId: ownerId, webhookUserId } = wrapper;

      // 1. Resolve Billing State (Redis-first with DB fallback)
      let state = ownerStateCache.get(ownerId);
      if (!state) {
        const cached = await getCreditStateR(clerkUserId);
        if (
          cached.creditsUsed !== null &&
          cached.creditLimit !== null &&
          cached.subStatus !== null &&
          cached.plan !== null
        ) {
          state = {
            used: cached.creditsUsed,
            limit: cached.creditLimit,
            status: cached.subStatus,
            plan: cached.plan,
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
            limit: userWithSub.creditLedger?.creditLimit ?? 1000,
            status: userWithSub.subscription?.status ?? "ACTIVE",
            plan: userWithSub.subscription?.plan ?? "FREE",
          };

          // Restore Redis
          await setCreditStateR(
            clerkUserId,
            state.used,
            state.limit,
            state.status,
            state.plan,
          );
        }
        ownerStateCache.set(ownerId, state);
      }

      // 2. Priority & Safe Mode Throttling
      if (
        appUsage >= RATE_LIMIT_THRESHOLDS.SAFE_MODE_THRESHOLD &&
        state.plan !== "BLACK"
      ) {
        logger.info(
          {
            appUsage,
            threshold: RATE_LIMIT_THRESHOLDS.SAFE_MODE_THRESHOLD,
            ownerId,
            plan: state.plan,
          },
          "SAFE MODE: Throttling non-BLACK tier user.",
        );
        throw new InstagramRateLimitError(
          "guardEvents",
          `App-Level Safe Mode reached (${appUsage}%). Delaying non-BLACK tier users.`,
          true,
          60_000, // 1 minute
        );
      }

      // 3. Enforce Quota (The Shield)
      if (state.status === "EXPIRED" || state.status === "SOFT_PAUSED")
        return null;

      if (state.limit !== -1 && state.used >= state.limit) {
        // Drop jobs for exhausted credits (and trigger notification once)
        if (state.status === "ACTIVE") {
          await addNotificationJob({
            type: "QUOTA_FULL",
            userId: clerkUserId,
            usedAt: Date.now(),
          });
          // Optimistically update status to prevent multiple notifications
          state.status = "SOFT_PAUSED";
          ownerStateCache.set(ownerId, state);
          // Note: In a real app, you'd update DB/Redis status here too
        }
        return null;
      }

      // Local reservation for batch processing
      state.used += 1;

      let followerId = "";
      switch (wrapper.event.type) {
        case "COMMENT":
          followerId = wrapper.event.event.userId;
          break;
        case "STORY_REPLY":
        case "DM_MESSAGE":
        case "QUICK_REPLY":
          followerId = wrapper.event.event.senderId;
          break;
        default:
          break;
      }

      if (!followerId) return null;

      // 4. Account-Level Spam Guard (Cooldown across all webhooks for this account)
      const isAccountGuarded = await isAccountSpamGuardedR(webhookUserId);
      if (isAccountGuarded) {
        throw new InstagramRateLimitError(
          "guardEvents",
          `Account-Level Spam Guard active for ${webhookUserId}. Delaying 2s.`,
          true,
          2_000, // 2 seconds
        );
      }

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
              const resolved = await isAskResolvedR(
                webhookUserId,
                followerId,
                automation.id,
              );
              if (resolved) return null;

              const throttled = await isUserThrottledR(
                webhookUserId,
                followerId,
                automation.id,
              );
              if (throttled) return null;
            } else {
              const eventId = (wrapper.event.event as any).messageId || "";
              const throttled = await isEventThrottledR(webhookUserId, eventId);
              if (throttled) return null;
            }
          } else {
            const throttled = await isUserThrottledR(
              webhookUserId,
              followerId,
              automation.id,
            );
            if (throttled) return null;
          }

          const [onCooldown, pending] = await Promise.all([
            isUserOnCooldownR(webhookUserId, followerId, automation.id),
            isPendingConfirmationR(webhookUserId, followerId, automation.id),
          ]);

          if (onCooldown) return null;

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
