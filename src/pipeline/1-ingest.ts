import { InstagramWebhookPayload, WebhookEntry } from "../types";
import { Result, ok, fail } from "../helpers/result";
import { IngestionError } from "../errors/pipeline.errors";

import { logger } from "../logger";

export function ingestWebhook(
  payload: InstagramWebhookPayload,
): Result<WebhookEntry[], IngestionError> {
  const op = "ingestWebhook";

  // Root level validation
  if (!payload || typeof payload !== "object") {
    return fail(new IngestionError(op, "Payload must be a non-null object"));
  }

  if (payload.object !== "instagram" && payload.object !== "page") {
    return fail(
      new IngestionError(
        op,
        `Unsupported webhook object type: ${payload.object}`,
      ),
    );
  }

  if (!payload.entry || !Array.isArray(payload.entry)) {
    return fail(
      new IngestionError(
        op,
        "Malformed payload: Missing or invalid 'entry' array",
      ),
    );
  }

  // Deep entry validation
  const validEntries: WebhookEntry[] = [];

  for (const entry of payload.entry) {
    if (!entry || typeof entry !== "object") {
      logger.warn(
        { isNull: entry === null, type: typeof entry },
        "Discarding entry: Not a valid object",
      );
      continue;
    }

    if (!entry.id || typeof entry.id !== "string") {
      logger.warn(
        {
          id: entry?.id,
          recipientId:
            (entry as any)?.recipient?.id || (entry as any)?.recipient,
          timestamp: (entry as any)?.time,
          type: (entry as any)?.type,
        },
        "Discarding entry: Missing or invalid 'id' (recipient IG ID)",
      );
      continue;
    }

    const hasChanges = Array.isArray(entry.changes) && entry.changes.length > 0;
    const hasMessaging =
      Array.isArray(entry.messaging) && entry.messaging.length > 0;

    if (!hasChanges && !hasMessaging) {
      logger.debug(
        { entryId: entry.id },
        "Discarding entry: No 'changes' or 'messaging' data found",
      );
      continue;
    }

    validEntries.push(entry);
  }

  return ok(validEntries);
}
