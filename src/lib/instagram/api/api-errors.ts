/**
 * Instagram API Domain Errors
 * Structured errors for clean centralized catching in the worker
 */

export class InstagramApiError extends Error {
  public statusCode: number;
  public retryable: boolean;

  constructor(
    message: string,
    statusCode: number = 500,
    retryable: boolean = true,
  ) {
    super(message);
    this.name = "InstagramApiError";
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

export class InstagramRateLimitError extends InstagramApiError {
  public isAppLevel: boolean;

  constructor(message: string, isAppLevel: boolean) {
    super(message, 429, true);
    this.name = "InstagramRateLimitError";
    this.isAppLevel = isAppLevel;
  }
}

export class InstagramTokenExpiredError extends InstagramApiError {
  constructor(message: string = "Instagram access token expired or invalid") {
    super(message, 401, false);
    this.name = "InstagramTokenExpiredError";
  }
}

export class InstagramSpamPolicyError extends InstagramApiError {
  constructor(message: string = "Content restricted by Instagram spam policy") {
    super(message, 400, false);
    this.name = "InstagramSpamPolicyError";
  }
}
