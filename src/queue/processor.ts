import { Job, DelayedError } from "bullmq";
import { InstagramWebhookPayload } from "../types/pipeline.types";
import { logger } from "../logger";
import {
  InstagramTokenExpiredError,
  InstagramSpamPolicyError,
  InstagramRateLimitError,
} from "../errors/instagram.errors";
import {
  ingestWebhook,
  refineEntries,
  dedupeEvents,
  filterEvents,
  enrichEvents,
  guardEvents,
  executeEvents,
  persistOutcomes,
} from "../pipeline";
import { WORKER_CONFIG } from "../config/worker.config";

export async function processWebhookJob(
  job: Job,
  token?: string,
): Promise<void> {
  const payload = job.data as InstagramWebhookPayload;
  const jobLogger = logger.child({
    jobId: job.id,
    attempt: job.attemptsMade + 1,
  });
  jobLogger.info({ payload: job.data }, `Processing job ${job.id}`);

  try {
    // Pipeline Orchestration
    const ingestRes = ingestWebhook(payload);
    if (!ingestRes.ok) throw ingestRes.error;

    const refineRes = refineEntries(ingestRes.value);
    if (!refineRes.ok) throw refineRes.error;

    const dedupeRes = await dedupeEvents(refineRes.value);
    if (!dedupeRes.ok) throw dedupeRes.error;

    const filterRes = await filterEvents(dedupeRes.value);
    if (!filterRes.ok) throw filterRes.error;

    const enrichRes = await enrichEvents(filterRes.value);
    if (!enrichRes.ok) throw enrichRes.error;

    const guardRes = await guardEvents(enrichRes.value);
    if (!guardRes.ok) throw guardRes.error;

    const executeRes = await executeEvents(guardRes.value);
    if (!executeRes.ok) throw executeRes.error;

    const persistRes = await persistOutcomes(executeRes.value);
    if (!persistRes.ok) throw persistRes.error;
  } catch (err: any) {
    if (err instanceof InstagramTokenExpiredError) {
      jobLogger.warn("Instagram Token Expired permanently. Failing job.");
      throw err;
    }
    if (err instanceof InstagramSpamPolicyError) {
      jobLogger.warn(
        "Action restricted by Instagram Spam Policy. Failing job.",
      );
      throw err;
    }
    if (err instanceof InstagramRateLimitError) {
      jobLogger.warn(`Instagram Rate Limit hit. Delaying job.`);
      const delayMs = err.isAppLevel ? 5 * 60_000 : 10 * 60_000;
      await job.moveToDelayed(Date.now() + delayMs, token);
      throw new DelayedError();
    }

    const isTerminalError =
      err instanceof InstagramTokenExpiredError ||
      err instanceof InstagramSpamPolicyError;

    if (!isTerminalError && job.attemptsStarted < WORKER_CONFIG.MAX_RETRIES) {
      const delayMs = Math.pow(2, job.attemptsStarted) * 2000; // 2s, 4s, 8s backoff
      jobLogger.warn(
        { error: err.message, attempt: job.attemptsStarted, delayMs },
        "Retriable error occurred. Moving job to delayed queue for backoff.",
      );
      await job.moveToDelayed(Date.now() + delayMs, token);
      throw new DelayedError();
    }

    jobLogger.error(
      { type: err?.name || typeof err, message: err?.message || String(err) },
      "Job failed ultimately after max retries or terminal error",
    );
    throw err;
  }
}
