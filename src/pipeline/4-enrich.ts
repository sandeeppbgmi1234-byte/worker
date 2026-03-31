import { FilteredEvent, EnrichedEvent } from "../types";
import { getAccessTokenR } from "../redis/operations/token";
import { getValidAccessToken } from "../instagram/token-manager";
import { Result, ok } from "../helpers/result";
import { EnrichmentError } from "../errors/pipeline.errors";

export async function enrichEvents(
  filteredEvents: FilteredEvent[],
): Promise<Result<EnrichedEvent[], EnrichmentError>> {
  const enrichResults = await Promise.all(
    filteredEvents.map(async (item) => {
      try {
        const accessToken = await getAccessTokenR(item.accountId, () =>
          getValidAccessToken(item.accountId),
        );
        return {
          ...item,
          accessToken,
        };
      } catch (e) {
        // Missing token prevents this event from proceeding
        return null;
      }
    }),
  );

  const enriched = enrichResults.filter(
    (item): item is EnrichedEvent => item !== null,
  );
  return ok(enriched);
}
