/**
 * Simple logger utility
 * For production, consider using winston or pino
 */
class Logger {
  constructor() {
    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3
    };
    this.currentLevel = this.levels.info;
  }

  format(level, message, metadata = {}) {
    const timestamp = new Date().toISOString();
    const meta = Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : '';
    return `[${timestamp}] ${level.toUpperCase()}: ${message} ${meta}`;
  }

  error(message, metadata) {
    if (this.currentLevel >= this.levels.error) {
      console.error(this.format('error', message, metadata));
    }
  }

  warn(message, metadata) {
    if (this.currentLevel >= this.levels.warn) {
      console.warn(this.format('warn', message, metadata));
    }
  }

  info(message, metadata) {
    if (this.currentLevel >= this.levels.info) {
      console.log(this.format('info', message, metadata));
    }
  }

  debug(message, metadata) {
    if (this.currentLevel >= this.levels.debug) {
      console.log(this.format('debug', message, metadata));
    }
  }
}

export const logger = new Logger();