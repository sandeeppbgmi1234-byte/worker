/**
 * API Client Tunnel
 * Centralized, declarative fetcher for all Instagram Graph API requests.
 */

import {
  buildGraphApiUrl,
  RATE_LIMITS,
} from "../../../config/instagram.config";
import {
  InstagramApiError,
  InstagramSpamPolicyError,
  InstagramTokenExpiredError,
  InstagramRateLimitError,
} from "./api-errors";
import { logger } from "../../utils/pino";
import { updateRateLimitsFromHeaders } from "../rate-limiting/redis-limiter.ts";

export interface FetchOptions extends Omit<RequestInit, "body"> {
  body?: any; // Automatically JSON stringified
  timeoutMs?: number;
  retries?: number;
  instagramUserId?: string; // Used for logging context and redis keys
}

/**
 * Extracts and parses the Meta usage headers
 */
function extractUsageHeaders(response: Response) {
  const appUsageStr = response.headers.get("x-app-usage");
  const businessUsageStr = response.headers.get("x-business-use-case-usage");

  let appUsage: Record<string, any> | null = null;
  let businessUsage: Record<string, any> | null = null;

  try {
    if (appUsageStr) appUsage = JSON.parse(appUsageStr);
    if (businessUsageStr) businessUsage = JSON.parse(businessUsageStr);
  } catch (e) {
    logger.warn(
      { appUsageStr, businessUsageStr },
      "Failed to parse usage headers",
    );
  }

  return { appUsage, businessUsage };
}

/**
 * Processes Instagram error responses to throw structured errors
 */
function handleInstagramError(errorData: any, status: number) {
  const message =
    errorData?.error?.message || errorData?.message || `HTTP ${status}`;
  const code = errorData?.error?.code;
  const subcode = errorData?.error?.error_subcode;

  // Rate Limits
  if (status === 429 || code === 4 || code === 17 || code === 32) {
    throw new InstagramRateLimitError(message, true); // True defaults to App Level severity
  }

  // Token Expired or Invalid (Fatal)
  if (status === 400 || status === 401) {
    if (
      code === 190 ||
      message.toLowerCase().includes("session") ||
      message.toLowerCase().includes("password") ||
      message.toLowerCase().includes("token")
    ) {
      throw new InstagramTokenExpiredError(message);
    }
  }

  // Spam Policy (Permanent failure for this specific specific action)
  if (status === 400 && message.toLowerCase().includes("spam")) {
    throw new InstagramSpamPolicyError(message);
  }

  // Generic 5xx (Retryable)
  if (status >= 500) {
    throw new InstagramApiError(message, status, true);
  }

  // Other 4xx client errors (Non-retryable usually)
  throw new InstagramApiError(message, status, false);
}

/**
 * The unified tunnel for calling Instagram Graph API
 */
export async function fetchFromInstagram<T = any>(
  endpoint: string,
  options: FetchOptions = {},
): Promise<T> {
  const {
    timeoutMs = RATE_LIMITS.REQUEST_TIMEOUT_MS,
    retries = 2,
    instagramUserId,
    ...init
  } = options;

  const url = endpoint.startsWith("http")
    ? endpoint
    : buildGraphApiUrl(endpoint).toString();

  // Base headers
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  // If using body-based auth, extract it to headers if present
  if (init.body?.access_token) {
    headers.set("Authorization", `Bearer ${init.body.access_token}`);
  }

  const reqOptions: RequestInit = {
    ...init,
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  };

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= retries) {
    attempt++;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...reqOptions,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const isJson = response.headers
        .get("content-type")
        ?.includes("application/json");
      const data = isJson ? await response.json() : await response.text();

      // Extract and update headers
      const { appUsage, businessUsage } = extractUsageHeaders(response);
      if (instagramUserId && (appUsage || businessUsage)) {
        await updateRateLimitsFromHeaders(
          instagramUserId,
          appUsage,
          businessUsage,
        );
      }

      if (!response.ok) {
        handleInstagramError(data, response.status);
      }

      return data as T;
    } catch (err: any) {
      clearTimeout(timeoutId);
      lastError = err;

      // Timeout or generic network failure
      if (err.name === "AbortError") {
        lastError = new InstagramApiError(
          `Request timed out after ${timeoutMs}ms`,
          408,
          true,
        );
      } else if (err.name === "TypeError" && err.message.includes("fetch")) {
        lastError = new InstagramApiError(
          `Network failure: ${err.message}`,
          503,
          true,
        );
      }

      // If it's a domain error, check if it's retryable
      if (
        lastError instanceof InstagramApiError &&
        lastError.retryable &&
        attempt <= retries
      ) {
        const backoff = Math.pow(2, attempt) * 1000;
        logger.warn(
          { attempt, retries, backoff, endpoint, igUserId: instagramUserId },
          `Retrying Instagram API request after failure: ${lastError.message}`,
        );
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }

      // Not retryable, bubble up
      throw lastError;
    }
  }

  throw lastError;
}
