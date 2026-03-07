import { InstagramWebhookPayload, WebhookEntry } from "../types";
import { Result, ok, fail } from "../helpers/result";
import { IngestionError } from "../errors/pipeline.errors";

export function ingestWebhook(
  payload: InstagramWebhookPayload,
): Result<WebhookEntry[], IngestionError> {
  if (payload.object !== "instagram" && payload.object !== "page") {
    return fail(
      new IngestionError(
        "ingestWebhook",
        `Unsupported webhook object type: ${payload.object}`,
      ),
    );
  }

  if (!payload.entry || !Array.isArray(payload.entry)) {
    return fail(
      new IngestionError(
        "ingestWebhook",
        "Malformed payload: Missing or invalid 'entry' array",
      ),
    );
  }

  return ok(payload.entry);
}
