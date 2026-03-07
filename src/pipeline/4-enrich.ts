import { FilteredEvent, EnrichedEvent } from "../types";
import { getAccessTokenR } from "../redis/operations/token";
import { getValidAccessToken } from "../instagram/token-manager";
import { Result, ok } from "../helpers/result";
import { EnrichmentError } from "../errors/pipeline.errors";

export async function enrichEvents(
  filteredEvents: FilteredEvent[],
): Promise<Result<EnrichedEvent[], EnrichmentError>> {
  const enriched: EnrichedEvent[] = [];

  for (const item of filteredEvents) {
    try {
      const accessToken = await getAccessTokenR(item.accountId, () =>
        getValidAccessToken(item.accountId),
      );
      enriched.push({
        ...item,
        accessToken,
      });
    } catch (e) {
      // Missing token prevents this event from proceeding but other events can proceed
      continue;
    }
  }

  return ok(enriched);
}
