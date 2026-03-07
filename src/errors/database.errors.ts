import { BaseError } from "./base.error";

export enum DatabaseErrorType {
  CONNECTION = "CONNECTION",
  VALIDATION = "VALIDATION",
  NOT_FOUND = "NOT_FOUND",
  UNIQUE_CONSTRAINT = "UNIQUE_CONSTRAINT",
  FOREIGN_KEY = "FOREIGN_KEY",
  UNKNOWN = "UNKNOWN",
}

export class DatabaseError extends BaseError {
  public errorType: DatabaseErrorType;

  constructor(
    operation: string,
    message: string,
    errorType: DatabaseErrorType,
    context?: Record<string, unknown>,
    originalError?: unknown,
  ) {
    super(operation, message, context, originalError);
    this.name = "DatabaseError";
    this.errorType = errorType;
  }
}
