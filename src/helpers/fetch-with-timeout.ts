import { logger } from "@/logger";
import { WORKER_CONFIG } from "../config/worker.config";
import { FetchWithTimeoutOptions, FetchResult } from "../types";

const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

function isRetryableError(error: unknown, statusCode?: number): boolean {
  if (error instanceof TypeError && error.message.includes("fetch")) {
    return true;
  }
  if (statusCode && RETRYABLE_STATUS_CODES.includes(statusCode)) {
    return true;
  }
  return false;
}

function calculateBackoffDelay(
  attempt: number,
  baseDelay: number = 1000,
): number {
  return Math.min(baseDelay * Math.pow(2, attempt), 10000);
}

export async function fetchWithTimeout<T = any>(
  url: string,
  options: FetchWithTimeoutOptions = {},
): Promise<FetchResult<T>> {
  const {
    timeout = 30000,
    retries = WORKER_CONFIG.MAX_RETRIES,
    retryDelay = 1000,
    ...fetchOptions
  } = options;

  let lastError: unknown;
  let lastStatusCode: number | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      const signal = fetchOptions.signal
        ? AbortSignal.any([controller.signal, fetchOptions.signal])
        : controller.signal;

      const startTime = Date.now();

      try {
        const response = await fetch(url, { ...fetchOptions, signal });
        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;

        if (duration > timeout * 0.8) {
          logger.warn(
            { url, duration: `${duration}ms`, status: response.status },
            "Slow API request detected",
          );
        }

        if (!response.ok) {
          lastStatusCode = response.status;
          if (isRetryableError(null, response.status) && attempt < retries) {
            const delay = calculateBackoffDelay(attempt, retryDelay);
            logger.warn(
              { status: response.status, attempt: attempt + 1 },
              `API failed, retrying: ${url}`,
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
          let errorData: any;
          try {
            errorData = await response.json();
          } catch {
            errorData = { message: response.statusText };
          }
          throw new Error(
            errorData.error?.message ||
              errorData.message ||
              `HTTP ${response.status}`,
          );
        }

        const data = await response.json();
        return {
          data: data as T,
          status: response.status,
          statusText: response.statusText,
        };
      } catch (fetchError) {
        clearTimeout(timeoutId);
        if (fetchError instanceof Error && fetchError.name === "AbortError") {
          throw new Error(`Request timeout after ${timeout}ms`);
        }
        throw fetchError;
      }
    } catch (err) {
      lastError = err;
      logger.error({ url, attempt: attempt + 1 }, `API request failed: ${url}`);
      if (isRetryableError(err, lastStatusCode) && attempt < retries) {
        const delay = calculateBackoffDelay(attempt, retryDelay);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastError || new Error("Request failed after all retries");
}
