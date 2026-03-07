import { BaseError } from "../errors/base.error";

export class RedisError extends BaseError {
  public readonly isRedisError = true;
  public readonly key: string;

  constructor(
    operation: string,
    message: string,
    key: string,
    cause?: unknown,
  ) {
    super(operation, message, { key }, cause);
    this.name = "RedisError";
    this.key = key;
  }
}
