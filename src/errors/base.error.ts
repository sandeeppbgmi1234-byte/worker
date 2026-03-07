export class BaseError extends Error {
  public operation: string;
  public context: Record<string, unknown>;
  public originalError: unknown;

  constructor(
    operation: string,
    message: string,
    context: Record<string, unknown> = {},
    originalError: unknown = null,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.operation = operation;
    this.context = context;
    this.originalError = originalError;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}
