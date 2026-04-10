import { FilteredEvent, EnrichedEvent } from "../types";
import { getAccessTokenR } from "../redis/operations/token";
import { getValidAccessToken } from "../instagram/token-manager";
import { Result, ok, fail } from "../helpers/result";
import { EnrichmentError } from "../errors/pipeline.errors";
import { logger } from "../logger";

export async function enrichEvents(
  filteredEvents: FilteredEvent[],
): Promise<Result<EnrichedEvent[], EnrichmentError>> {
  if (filteredEvents.length === 0) return ok([]);

  let droppedCount = 0;
  const totalCount = filteredEvents.length;

  const enrichResults = await Promise.all(
    filteredEvents.map(async (item) => {
      try {
        const accessToken = await getAccessTokenR(
          item.clerkUserId,
          item.webhookUserId,
          () => getValidAccessToken(item.accountId),
        );
        return {
          ...item,
          accessToken,
        };
      } catch (e: any) {
        droppedCount++;

        if (
          e.name === "InstagramTokenExpiredError" ||
          e.message?.includes("Missing token")
        ) {
          return null;
        }

        logger.error(
          {
            accountId: item.accountId,
            error: e.message,
            stack: e.stack,
            droppedCount,
          },
          "CRITICAL ENRICHMENT FAILURE: Unhandled error fetching access token for account.",
        );

        return null;
      }
    }),
  );

  const enriched = enrichResults.filter(
    (item): item is EnrichedEvent => item !== null,
  );

  if (totalCount > 0 && enriched.length === 0) {
    return fail(
      new EnrichmentError(
        "enrichEvents",
        `All ${totalCount} events in batch failed enrichment. Likely systemic connectivity or auth issue.`,
      ),
    );
  }

  return ok(enriched);
}
