/**
 * Structured Logging Utility
 * Provides centralized logging with different log levels and structured output
 */

export enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
}

export interface LogContext {
  [key: string]: any;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

/**
 * Gets the current log level from environment
 */
function getLogLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();

  if (envLevel === "debug") return LogLevel.DEBUG;
  if (envLevel === "info") return LogLevel.INFO;
  if (envLevel === "warn") return LogLevel.WARN;
  if (envLevel === "error") return LogLevel.ERROR;

  // Default based on environment
  return process.env.NODE_ENV === "production" ? LogLevel.INFO : LogLevel.DEBUG;
}

/**
 * Checks if a log level should be logged
 */
function shouldLog(level: LogLevel): boolean {
  const currentLevel = getLogLevel();
  const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
  const currentIndex = levels.indexOf(currentLevel);
  const messageIndex = levels.indexOf(level);

  return messageIndex >= currentIndex;
}

/**
 * Formats log entry for output
 */
function formatLogEntry(entry: LogEntry): string {
  const { timestamp, level, message, context, error } = entry;

  let output = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

  if (error) {
    output += `\n  Error: ${error.name}: ${error.message}`;
    if (error.stack && getLogLevel() === LogLevel.DEBUG) {
      output += `\n  Stack: ${error.stack}`;
    }
  }

  if (context && Object.keys(context).length > 0) {
    output += `\n  Context: ${JSON.stringify(context, null, 2)}`;
  }

  return output;
}

/**
 * Creates a structured log entry
 */
function createLogEntry(
  level: LogLevel,
  message: string,
  context?: LogContext,
  error?: Error,
): LogEntry {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };

  if (context) {
    entry.context = context;
  }

  if (error) {
    entry.error = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return entry;
}

/**
 * Outputs log entry to console (can be extended to send to external services)
 */
function outputLog(entry: LogEntry): void {
  if (!shouldLog(entry.level)) {
    return;
  }

  const formatted = formatLogEntry(entry);
  const structured = JSON.stringify(entry);

  // Outputs to console with appropriate method
  switch (entry.level) {
    case LogLevel.DEBUG:
      console.debug(formatted);
      break;
    case LogLevel.INFO:
      console.info(formatted);
      break;
    case LogLevel.WARN:
      console.warn(formatted);
      break;
    case LogLevel.ERROR:
      console.error(formatted);
      // In production, structured JSON can be sent to logging service
      if (process.env.NODE_ENV === "production") {
        // TODO: Send to external logging service (Sentry, DataDog, etc.)
        // Example: sendToLoggingService(structured);
      }
      break;
  }

  // Outputs structured JSON in development for better debugging
  if (
    process.env.NODE_ENV === "development" &&
    entry.level === LogLevel.ERROR
  ) {
    console.error("Structured:", structured);
  }
}

/**
 * Logger class providing structured logging methods
 */
class Logger {
  /**
   * Logs a debug message
   */
  debug(message: string, context?: LogContext): void {
    const entry = createLogEntry(LogLevel.DEBUG, message, context);
    outputLog(entry);
  }

  /**
   * Logs an info message
   */
  info(message: string, context?: LogContext): void {
    const entry = createLogEntry(LogLevel.INFO, message, context);
    outputLog(entry);
  }

  /**
   * Logs a warning message
   */
  warn(message: string, context?: LogContext): void {
    const entry = createLogEntry(LogLevel.WARN, message, context);
    outputLog(entry);
  }

  /**
   * Logs an error message
   */
  error(message: string, error?: Error, context?: LogContext): void {
    const entry = createLogEntry(LogLevel.ERROR, message, context, error);
    outputLog(entry);
  }

  /**
   * Logs a webhook event
   */
  logWebhook(
    eventType: string,
    source: string,
    success: boolean,
    error?: Error,
    context?: LogContext,
  ): void {
    const message = `Webhook ${eventType} from ${source} - ${success ? "success" : "failed"}`;
    const webhookContext = {
      ...context,
      eventType,
      source,
      success,
    };

    if (error || !success) {
      this.error(message, error, webhookContext);
    } else {
      this.info(message, webhookContext);
    }
  }
}

// Exports singleton logger instance
export const logger = new Logger();

// Exports logger class for custom instances if needed
export { Logger };
