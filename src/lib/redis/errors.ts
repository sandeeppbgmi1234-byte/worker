/**
 * Typed Redis Errors
 * Ensures that anywhere we fail while hitting Redis, we throw a recognizable error
 * so that the caller can safely catch it and fall back to MongoDB.
 */

export class RedisError extends Error {
  public readonly isRedisError = true;
  public readonly operation: string;
  public readonly key: string;

  constructor(message: string, operation: string, key: string, cause?: Error) {
    super(message);
    this.name = "RedisError";
    this.operation = operation;
    this.key = key;

    // Maintain V8 stack trace natively
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RedisError);
    }

    // Attach original error cause if available
    if (cause) {
      this.cause = cause;
    }
  }
}
