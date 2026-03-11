import { buildGraphApiUrl } from "./endpoints";
import { RATE_LIMITS } from "../config/instagram.config";
import { logger } from "../logger";
import { extractUsageHeaders } from "./rate-limit/header-parser";
import { updateRateLimitsFromHeadersR } from "../redis/operations/rate-limit";
import {
  InstagramError,
  InstagramRateLimitError,
  InstagramTokenExpiredError,
  InstagramSpamPolicyError,
} from "../errors/instagram.errors";
import { Result, ok, fail } from "../helpers/result";
import { InstagramFetchOptions } from "../types";

export function handleInstagramError(errorData: any, status: number) {
  const message =
    errorData?.error?.message || errorData?.message || `HTTP ${status}`;
  const code = errorData?.error?.code;
  const subcode = errorData?.error?.error_subcode;

  if (status === 429 || code === 4 || code === 17 || code === 32) {
    throw new InstagramRateLimitError("fetchFromInstagram", message, true);
  }
  if (status === 400 || status === 401) {
    if (
      code === 190 ||
      message.toLowerCase().includes("session") ||
      message.toLowerCase().includes("password") ||
      message.toLowerCase().includes("token")
    ) {
      throw new InstagramTokenExpiredError("fetchFromInstagram", message);
    }
  }
  if (status === 400 && message.toLowerCase().includes("spam")) {
    throw new InstagramSpamPolicyError("fetchFromInstagram", message);
  }
  if (status >= 500) {
    throw new InstagramError("fetchFromInstagram", message, status, true);
  }
  throw new InstagramError("fetchFromInstagram", message, status, false);
}

export async function fetchFromInstagram<T = any>(
  endpoint: string,
  options: InstagramFetchOptions = {},
): Promise<Result<T, InstagramError>> {
  const {
    timeoutMs = RATE_LIMITS.REQUEST_TIMEOUT_MS,
    retries = 2,
    instagramUserId,
    ...init
  } = options;
  const url = endpoint.startsWith("http")
    ? endpoint
    : buildGraphApiUrl(endpoint).toString();

  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  if (init.body?.access_token)
    headers.set("Authorization", `Bearer ${init.body.access_token}`);

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

      const { appUsage, businessUsage, adUsage } =
        extractUsageHeaders(response);
      if (instagramUserId && (appUsage || businessUsage || adUsage)) {
        await updateRateLimitsFromHeadersR(
          instagramUserId,
          appUsage,
          businessUsage,
          adUsage,
        );
      }

      if (!response.ok) {
        // Log detailed error information for Meta Rate Limits
        const errorBody = data as any;
        const code = errorBody?.error?.code;
        if (
          response.status === 429 ||
          code === 4 ||
          code === 17 ||
          code === 32 ||
          code === 613
        ) {
          logger.warn(
            {
              instagramUserId,
              errorCode: code,
              errorSubcode: errorBody?.error?.error_subcode,
              message: errorBody?.error?.message,
              throttled: errorBody?.error?.throttled,
              backend_qps: errorBody?.error?.backend_qps,
              complexity_score: errorBody?.error?.complexity_score,
            },
            "Instagram Rate Limit/Throttling detected in worker",
          );
        }
        handleInstagramError(data, response.status);
      }

      return ok(data as T);
    } catch (err: any) {
      clearTimeout(timeoutId);

      let errorInstance: InstagramError;

      if (err.name === "AbortError") {
        errorInstance = new InstagramError(
          "fetchFromInstagram",
          `Request timed out after ${timeoutMs}ms`,
          408,
          true,
          { endpoint, attempt },
        );
      } else if (err.name === "TypeError" && err.message.includes("fetch")) {
        errorInstance = new InstagramError(
          "fetchFromInstagram",
          `Network failure: ${err.message}`,
          503,
          true,
          { endpoint, attempt },
        );
      } else if (err instanceof InstagramError) {
        errorInstance = err;
      } else {
        errorInstance = new InstagramError(
          "fetchFromInstagram",
          `Unknown failure: ${err?.message}`,
          500,
          false,
          { endpoint, attempt },
        );
      }

      lastError = errorInstance;

      if (errorInstance.retryable && attempt <= retries) {
        const backoff = Math.pow(2, attempt) * 1000;
        logger.warn(
          { attempt, retries, backoff, endpoint, igUserId: instagramUserId },
          `Retrying Instagram API request`,
        );
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      } else {
        return fail(errorInstance);
      }
    }
  }

  return fail(lastError as InstagramError);
}
