import { BaseError } from "./base.error";

export class PipelineError extends BaseError {
  constructor(
    operation: string,
    message: string,
    context?: Record<string, unknown>,
    originalError?: unknown,
  ) {
    super(operation, message, context, originalError);
    this.name = "PipelineError";
  }
}

export class IngestionError extends PipelineError {}
export class RefinementError extends PipelineError {}
export class FilterError extends PipelineError {}
export class EnrichmentError extends PipelineError {}
export class GuardError extends PipelineError {}
export class ExecutionError extends PipelineError {}
export class PersistenceError extends PipelineError {}

export class PipelineRetryableError extends PipelineError {
  constructor(
    operation: string,
    message: string,
    context?: Record<string, unknown>,
    originalError?: unknown,
  ) {
    super(operation, message, context, originalError);
    this.name = "PipelineRetryableError";
  }
}
