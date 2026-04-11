import { BaseError } from "./base.error";

export class InstagramError extends BaseError {
  public statusCode: number;
  public retryable: boolean;

  constructor(
    operation: string,
    message: string,
    statusCode: number = 500,
    retryable: boolean = true,
    context?: Record<string, unknown>,
    originalError?: unknown,
  ) {
    super(operation, message, context, originalError);
    this.name = "InstagramError";
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

export class InstagramRateLimitError extends InstagramError {
  public isAppLevel: boolean;
  public retryAfterMs?: number;

  constructor(
    operation: string,
    message: string,
    isAppLevel: boolean,
    retryAfterMs?: number,
    context?: Record<string, unknown>,
    originalError?: unknown,
  ) {
    super(operation, message, 429, true, context, originalError);
    this.name = "InstagramRateLimitError";
    this.isAppLevel = isAppLevel;
    this.retryAfterMs = retryAfterMs;
  }
}

export class InstagramTokenExpiredError extends InstagramError {
  constructor(
    operation: string,
    message: string = "Instagram access token expired or invalid",
    context?: Record<string, unknown>,
    originalError?: unknown,
  ) {
    super(operation, message, 401, false, context, originalError);
    this.name = "InstagramTokenExpiredError";
  }
}

export class InstagramSpamPolicyError extends InstagramError {
  constructor(
    operation: string,
    message: string = "Content restricted by Instagram spam policy",
    context?: Record<string, unknown>,
    originalError?: unknown,
  ) {
    super(operation, message, 400, false, context, originalError);
    this.name = "InstagramSpamPolicyError";
  }
}
