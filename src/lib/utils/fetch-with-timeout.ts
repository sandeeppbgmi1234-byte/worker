/**
 * Fetch with Timeout Utility
 * Provides fetch wrapper with timeout, retry logic, and error handling
 */

import { logger } from "./logger";

/**
 * Default timeout for API requests (in milliseconds)
 */
export const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds

/**
 * Maximum number of retries for failed requests
 */
export const MAX_RETRIES = 3;

/**
 * Retryable HTTP status codes
 */
const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

/**
 * Checks if an error is retryable
 */
function isRetryableError(error: unknown, statusCode?: number): boolean {
  // Retries on network errors
  if (error instanceof TypeError && error.message.includes("fetch")) {
    return true;
  }

  // Retries on specific HTTP status codes
  if (statusCode && RETRYABLE_STATUS_CODES.includes(statusCode)) {
    return true;
  }

  return false;
}

/**
 * Calculates delay for exponential backoff
 */
function calculateBackoffDelay(
  attempt: number,
  baseDelay: number = 1000,
): number {
  return Math.min(baseDelay * Math.pow(2, attempt), 10000); // Max 10 seconds
}

export interface FetchWithTimeoutOptions extends RequestInit {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

export interface FetchResult<T = any> {
  data: T;
  status: number;
  statusText: string;
}

/**
 * Fetches a resource with timeout and retry logic
 */
export async function fetchWithTimeout<T = any>(
  url: string,
  options: FetchWithTimeoutOptions = {},
): Promise<FetchResult<T>> {
  const {
    timeout = DEFAULT_TIMEOUT_MS,
    retries = MAX_RETRIES,
    retryDelay = 1000,
    ...fetchOptions
  } = options;

  let lastError: unknown;
  let lastStatusCode: number | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Creates AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, timeout);

      // Merges abort signal with existing signal if present
      const signal = fetchOptions.signal
        ? AbortSignal.any([controller.signal, fetchOptions.signal])
        : controller.signal;

      const startTime = Date.now();

      try {
        // Makes the fetch request
        const response = await fetch(url, {
          ...fetchOptions,
          signal,
        });

        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;

        // Logs request if it took longer than expected
        if (duration > timeout * 0.8) {
          logger.warn("Slow API request detected", {
            url,
            duration: `${duration}ms`,
            timeout: `${timeout}ms`,
            status: response.status,
          });
        }

        // Handles non-OK responses
        if (!response.ok) {
          lastStatusCode = response.status;

          // Retries if status code is retryable
          if (isRetryableError(null, response.status) && attempt < retries) {
            const delay = calculateBackoffDelay(attempt, retryDelay);
            logger.warn(`API request failed, retrying: ${url}`, {
              status: response.status,
              attempt: attempt + 1,
              maxRetries: retries,
              delay: `${delay}ms`,
            });
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }

          // Tries to parse error response
          let errorData: any;
          try {
            errorData = await response.json();
          } catch {
            errorData = { message: response.statusText };
          }

          throw new Error(
            errorData.error?.message ||
              errorData.message ||
              `HTTP ${response.status}: ${response.statusText}`,
          );
        }

        // Parses response
        const data = await response.json();

        return {
          data: data as T,
          status: response.status,
          statusText: response.statusText,
        };
      } catch (fetchError) {
        clearTimeout(timeoutId);

        // Handles abort (timeout)
        if (fetchError instanceof Error && fetchError.name === "AbortError") {
          throw new Error(`Request timeout after ${timeout}ms`);
        }

        throw fetchError;
      }
    } catch (error) {
      lastError = error;

      // Logs the error
      logger.error(
        `API request failed: ${url}`,
        error instanceof Error ? error : new Error(String(error)),
        {
          url,
          attempt: attempt + 1,
          maxRetries: retries,
          timeout: `${timeout}ms`,
        },
      );

      // Retries if error is retryable and attempts remain
      if (isRetryableError(error, lastStatusCode) && attempt < retries) {
        const delay = calculateBackoffDelay(attempt, retryDelay);
        logger.warn(`Retrying API request: ${url}`, {
          attempt: attempt + 1,
          maxRetries: retries,
          delay: `${delay}ms`,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // Re-throws error if not retryable or out of retries
      throw error;
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError || new Error("Request failed after all retries");
}
