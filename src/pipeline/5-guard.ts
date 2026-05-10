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
import { Result, ok, fail } from "../helpers/result";
import { GuardError } from "../errors/pipeline.errors";
import { getGlobalAppUsageR } from "../redis/operations/rate-limit";
import { InstagramRateLimitError } from "../errors/instagram.errors";
import { Automation } from "@prisma/client";
import {
  getCreditStateR,
  setCreditStateR,
  reserveCreditsR,
} from "../redis/operations/credits";
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
    return fail(
      new GuardError(
        "guardEvents",
        `App-Level absolute cutoff reached (${appUsage}%).`,
        { appUsage },
        new InstagramRateLimitError(
          "guardEvents",
          "Absolute cutoff reached",
          true,
          300_000,
        ),
      ),
    );
  }

  if (appUsage >= RATE_LIMIT_THRESHOLDS.PANIC_THRESHOLD) {
    logger.warn(
      { appUsage, threshold: RATE_LIMIT_THRESHOLDS.PANIC_THRESHOLD },
      "PANIC MODE: App usage high. Throttling all jobs.",
    );
    return fail(
      new GuardError(
        "guardEvents",
        `App-Level Panic Threshold reached (${appUsage}%).`,
        { appUsage },
        new InstagramRateLimitError(
          "guardEvents",
          "Panic Threshold reached",
          true,
          300_000,
        ),
      ),
    );
  }

  const eventsByOwner = enrichedEvents.reduce(
    (acc, current) => {
      const ownerId = current.userId;
      if (!acc[ownerId]) acc[ownerId] = [];
      acc[ownerId].push(current);
      return acc;
    },
    {} as Record<string, EnrichedEvent[]>,
  );

  type GuardResult =
    | { success: true; data: GuardedEvent }
    | { success: false; errorType: string; error: any; wrapper: EnrichedEvent };

  const ownerBatches = await Promise.all(
    Object.entries(eventsByOwner).map(async ([ownerId, events]) => {
      const batchResults: GuardResult[] = [];

      // 1. Resolve Billing State (Redis-first with DB fallback)
      const first = events[0];
      const { clerkUserId } = first;

      let state: {
        used: number;
        limit: number;
        status: string;
        plan: string;
      } | null = null;

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

        if (userWithSub) {
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
      }

      if (!state) {
        logger.warn(
          { ownerId, clerkUserId },
          "Billing check failed: State could not be resolved — skipping batch",
        );
        return events.map(
          (wrapper) =>
            ({
              success: false,
              errorType: "billing_missing",
              error: new Error("Billing state not found"),
              wrapper,
            }) as GuardResult,
        );
      }

      // Process each owner's events sequentially to maintain quota integrity
      for (const wrapper of events) {
        try {
          const { webhookUserId } = wrapper;

          // 2. Priority & Safe Mode Throttling
          if (
            appUsage >= RATE_LIMIT_THRESHOLDS.SAFE_MODE_THRESHOLD &&
            state.plan !== "BLACK"
          ) {
            throw new InstagramRateLimitError(
              "guardEvents",
              `App-Level Safe Mode reached (${appUsage}%).`,
              true,
              60_000,
            );
          }

          // 3. Enforce Quota (The Shield)
          if (state.status === "EXPIRED" || state.status === "SOFT_PAUSED") {
            batchResults.push({
              success: false,
              errorType: "soft_paused",
              error: new Error(`Owner is ${state.status}`),
              wrapper,
            });
            continue;
          }

          let followerId = "";
          switch (wrapper.event.type) {
            case "COMMENT":
              followerId = (wrapper.event.event as any).userId;
              break;
            case "STORY_REPLY":
            case "DM_MESSAGE":
            case "QUICK_REPLY":
              followerId = (wrapper.event.event as any).senderId;
              break;
          }

          if (!followerId) {
            batchResults.push({
              success: false,
              errorType: "missing_follower_id",
              error: new Error("Follower ID missing"),
              wrapper,
            });
            continue;
          }

          // 4. Account-Level Spam Guard
          const isAccountGuarded = await isAccountSpamGuardedR(webhookUserId);
          if (isAccountGuarded) {
            throw new InstagramRateLimitError(
              "guardEvents",
              `Account-Level Spam Guard active for ${webhookUserId}.`,
              true,
              2_000,
            );
          }

          const automationGuards = await Promise.all(
            wrapper.matchedAutomations.map(async (automation) => {
              try {
                if (wrapper.event.type === "QUICK_REPLY") {
                  const payload = wrapper.event.payload;
                  const isFollowConfirmClick = payload.startsWith(
                    QUICK_REPLIES.FOLLOW_CONFIRM.PAYLOAD_PREFIX,
                  );
                  const isOpeningMessageClick = payload.startsWith(
                    QUICK_REPLIES.OPENING_MESSAGE.PAYLOAD_PREFIX,
                  );

                  if (isFollowConfirmClick || isOpeningMessageClick) {
                    const [resolved, throttled] = await Promise.all([
                      isAskResolvedR(webhookUserId, followerId, automation.id),
                      isUserThrottledR(
                        webhookUserId,
                        followerId,
                        automation.id,
                      ),
                    ]);
                    if (resolved || throttled) return null;
                  } else {
                    const eventId =
                      (wrapper.event.event as any).messageId || "";
                    const throttled = await isEventThrottledR(
                      webhookUserId,
                      eventId,
                    );
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
                  isPendingConfirmationR(
                    webhookUserId,
                    followerId,
                    automation.id,
                  ),
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
              } catch (err) {
                logger.warn(
                  { err, automationId: automation.id },
                  "Automation guard check failed",
                );
                return null;
              }
            }),
          );

          const validAutomations = automationGuards.filter(
            (a): a is Automation => a !== null,
          );

          // 5. Atomic Admission
          const isQuickReply = wrapper.event.type === "QUICK_REPLY";
          const shouldAdmit = validAutomations.length > 0;

          if (shouldAdmit) {
            // Only reserve for events that will trigger an action
            const reservation = await reserveCreditsR(clerkUserId, ownerId, 1);
            if (!reservation.success) {
              // Trigger the Quota Full email notification asynchronously
              addNotificationJob({
                type: "QUOTA_FULL",
                userId: clerkUserId,
                usedAt: Date.now(),
              }).catch((err) => {
                logger.error({ err }, "Failed to dispatch QUOTA_FULL notification");
              });

              batchResults.push({
                success: false,
                errorType: "quota_exceeded",
                error: new Error("Quota reservation failed"),
                wrapper,
              });
              continue;
            }

            batchResults.push({
              success: true,
              data: {
                ...wrapper,
                safeAutomations: validAutomations,
                dbReserved: reservation.dbReserved,
              } as GuardedEvent,
            });
          } else {
            batchResults.push({
              success: false,
              errorType: isQuickReply ? "qr_ignored" : "no_valid_automations",
              error: new Error(
                isQuickReply
                  ? "Quick reply has no valid targets"
                  : "All matched automations filtered by guard",
              ),
              wrapper,
            });
          }
        } catch (err: any) {
          batchResults.push({
            success: false,
            errorType:
              err instanceof InstagramRateLimitError
                ? "throttle"
                : "unknown_error",
            error: err,
            wrapper,
          });
        }
      }
      return batchResults;
    }),
  );

  const flatResults = ownerBatches.flat();
  const guardedEvents = flatResults
    .filter((res) => res.success)
    .map((res) => (res as any).data as GuardedEvent);

  const guardFailures = flatResults.filter((res) => !res.success);

  if (guardFailures.length > 0) {
    logger.warn(
      {
        failureCount: guardFailures.length,
        successCount: guardedEvents.length,
        failureTypes: Array.from(
          new Set(guardFailures.map((f: any) => f.errorType)),
        ),
      },
      "Guard Stage: Some events were filtered out or failed guard checks.",
    );
  }

  const FATAL_ERROR_TYPES = ["unknown_error", "billing_missing"];
  const fatalErrors = guardFailures.filter((f: any) =>
    FATAL_ERROR_TYPES.includes(f.errorType),
  );

  if (fatalErrors.length > 0) {
    return fail(
      new GuardError(
        "guardEvents",
        "Guard stage encountered fatal batch errors",
        {
          count: fatalErrors.length,
          errors: fatalErrors.slice(0, 5).map((e: any) => e.errorType),
        },
      ),
    );
  }

  return ok(guardedEvents);
}
