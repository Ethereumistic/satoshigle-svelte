/**
 * Structured logging utility
 * Provides consistent logging with levels, timestamps, and context
 */
import { env } from '../config/environment.js';

// Log levels with numeric values for comparison
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4,
}

// Current log level from environment or default
const currentLogLevel: LogLevel = env.NODE_ENV === 'production' 
  ? LogLevel.INFO 
  : LogLevel.DEBUG;

// Convert LogLevel to string representation
function logLevelToString(level: LogLevel): string {
  switch (level) {
    case LogLevel.DEBUG: return 'DEBUG';
    case LogLevel.INFO: return 'INFO';
    case LogLevel.WARN: return 'WARN';
    case LogLevel.ERROR: return 'ERROR';
    case LogLevel.FATAL: return 'FATAL';
    default: return 'UNKNOWN';
  }
}

// Add emoji for visual distinction in logs
function getLogEmoji(level: LogLevel): string {
  switch (level) {
    case LogLevel.DEBUG: return '🔍';
    case LogLevel.INFO: return '📝';
    case LogLevel.WARN: return '⚠️';
    case LogLevel.ERROR: return '❌';
    case LogLevel.FATAL: return '💀';
    default: return '❓';
  }
}

// Format the log entry with timestamp, level, and message
function formatLogEntry(level: LogLevel, message: string, context?: Record<string, any>): string {
  const timestamp = new Date().toISOString();
  const levelStr = logLevelToString(level);
  const emoji = getLogEmoji(level);
  
  // Format as JSON for structured logging
  const logEntry = {
    timestamp,
    level: levelStr,
    message,
    ...context,
  };
  
  // In development, format for better readability
  if (env.NODE_ENV === 'development') {
    return `${emoji} [${timestamp}] [${levelStr}] ${message} ${context ? JSON.stringify(context, null, 2) : ''}`;
  }
  
  // In production, use JSON for machine parsing
  return JSON.stringify(logEntry);
}

/**
 * Log a message if the current log level allows it
 * @param level Log level of the message
 * @param message The message to log
 * @param context Optional context data
 */
function log(level: LogLevel, message: string, context?: Record<string, any>): void {
  // Only log if level is high enough
  if (level >= currentLogLevel) {
    const formattedMessage = formatLogEntry(level, message, context);
    
    // Use appropriate console method based on level
    switch (level) {
      case LogLevel.DEBUG:
        console.debug(formattedMessage);
        break;
      case LogLevel.INFO:
        console.info(formattedMessage);
        break;
      case LogLevel.WARN:
        console.warn(formattedMessage);
        break;
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        console.error(formattedMessage);
        break;
    }
  }
}

// Export convenience methods for each log level
export const logger = {
  debug: (message: string, context?: Record<string, any>) => log(LogLevel.DEBUG, message, context),
  info: (message: string, context?: Record<string, any>) => log(LogLevel.INFO, message, context),
  warn: (message: string, context?: Record<string, any>) => log(LogLevel.WARN, message, context),
  error: (message: string, context?: Record<string, any>) => log(LogLevel.ERROR, message, context),
  fatal: (message: string, context?: Record<string, any>) => log(LogLevel.FATAL, message, context),
};

export default logger; 