import { Collection } from 'discord.js';
import { CONFIG } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Manages quiz sessions with automatic cleanup
 */
export class SessionManager {
  constructor() {
    this.sessions = new Collection();
    this.userIndex = new Map(); // userId -> Set of session IDs for O(1) lookup
    this.cleanupInterval = null;
    this.startCleanupTimer();
  }

  /**
   * Create a new session
   */
  createSession({ mode, items, userId, guildId, channelId, chapter = null }) {
    const sid = this.generateSessionId(userId);
    
    const session = {
      sid,
      mode,
      items,
      index: 0,
      userId,
      guildId,
      channelId,
      chapter,
      score: 0,
      answers: [],
      finished: false,
      timers: new Map(),
      createdAt: Date.now(),
      lastActivity: Date.now()
    };

    this.sessions.set(sid, session);
    
    // Update user index
    if (!this.userIndex.has(userId)) {
      this.userIndex.set(userId, new Set());
    }
    this.userIndex.get(userId).add(sid);
    
    logger.info('Session created', { sid, userId, mode, questionCount: items.length });
    
    return session;
  }

  /**
   * Get a session by ID
   */
  getSession(sid) {
    const session = this.sessions.get(sid);
    if (session) {
      session.lastActivity = Date.now();
    }
    return session;
  }

  /**
   * Get user's active session
   */
  getUserSession(userId, guildId) {
    const userSessions = this.userIndex.get(userId);
    if (!userSessions) return null;

    for (const sid of userSessions) {
      const session = this.sessions.get(sid);
      if (session && session.guildId === guildId && !session.finished) {
        return session;
      }
    }
    return null;
  }

  /**
   * Check if user has an active session (optimized with index)
   */
  hasActiveSession(userId, guildId) {
    return this.getUserSession(userId, guildId) !== null;
  }

  /**
   * Start a timer for a question
   */
  startTimer(sid, questionIndex, seconds, onExpire) {
    const session = this.sessions.get(sid);
    if (!session) return;

    this.clearTimer(sid, questionIndex);
    
    const timer = setTimeout(() => {
      // Critical: Check session still exists and isn't finished
      const currentSession = this.sessions.get(sid);
      if (currentSession && !currentSession.finished) {
        try {
          onExpire();
        } catch (error) {
          logger.error('Timer callback error', { sid, questionIndex, error: error.message });
        }
      }
    }, seconds * 1000);

    session.timers.set(String(questionIndex), timer);
  }

  /**
   * Clear a specific question timer
   */
  clearTimer(sid, questionIndex) {
    const session = this.sessions.get(sid);
    if (!session) return;

    const key = String(questionIndex);
    const timer = session.timers.get(key);
    
    if (timer) {
      clearTimeout(timer);
      session.timers.delete(key);
    }
  }

  /**
   * Clear all timers for a session
   */
  clearAllTimers(sid) {
    const session = this.sessions.get(sid);
    if (!session) return;

    session.timers.forEach(timer => clearTimeout(timer));
    session.timers.clear();
  }

  /**
   * Mark session as finished and clean up
   */
  finishSession(sid) {
    const session = this.sessions.get(sid);
    if (!session) return;

    session.finished = true;
    this.clearAllTimers(sid);
    
    // Remove session after a short delay to allow summary to display
    const cleanupTimer = setTimeout(() => {
      this._removeSessionInternal(sid);
    }, 30000); // 30 seconds

    // Store cleanup timer to clear it on shutdown
    session.cleanupTimer = cleanupTimer;
  }

  /**
   * Internal method to remove session and update index
   */
  _removeSessionInternal(sid) {
    const session = this.sessions.get(sid);
    if (!session) return;

    // Clear cleanup timer if it exists
    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer);
    }

    this.clearAllTimers(sid);
    this.sessions.delete(sid);

    // Update user index
    const userSessions = this.userIndex.get(session.userId);
    if (userSessions) {
      userSessions.delete(sid);
      if (userSessions.size === 0) {
        this.userIndex.delete(session.userId);
      }
    }
    
    logger.info('Session removed', { sid });
  }

  /**
   * Remove a session immediately
   */
  removeSession(sid) {
    this._removeSessionInternal(sid);
    logger.info('Session removed immediately', { sid });
  }

  /**
   * Start automatic cleanup of expired sessions
   */
  startCleanupTimer() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, CONFIG.SESSION_CLEANUP_INTERVAL_MS);
  }

  /**
   * Clean up expired sessions
   */
  cleanupExpiredSessions() {
    const now = Date.now();
    const expiredSessions = [];

    this.sessions.forEach((session, sid) => {
      const age = now - session.createdAt;
      const inactive = now - session.lastActivity;

      // Remove if session is too old or inactive
      if (age > CONFIG.SESSION_TTL_MS || inactive > CONFIG.SESSION_TTL_MS) {
        expiredSessions.push(sid);
      }
    });

    expiredSessions.forEach(sid => {
      this._removeSessionInternal(sid);
      logger.info('Session expired and removed', { sid });
    });

    if (expiredSessions.length > 0) {
      logger.info('Cleanup completed', { removed: expiredSessions.length });
    }
  }

  /**
   * Generate a unique session ID
   */
  generateSessionId(userId) {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    const userPart = userId.slice(-4);
    return `${userPart}-${timestamp}-${random}`;
  }

  /**
   * Get session statistics
   */
  getStats() {
    return {
      totalSessions: this.sessions.size,
      activeSessions: this.sessions.filter(s => !s.finished).size,
      finishedSessions: this.sessions.filter(s => s.finished).size,
      indexSize: this.userIndex.size
    };
  }

  /**
   * Clean up all sessions (for shutdown)
   */
  cleanup() {
    logger.info('Cleaning up all sessions', { count: this.sessions.size });
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.sessions.forEach((session, sid) => {
      if (session.cleanupTimer) {
        clearTimeout(session.cleanupTimer);
      }
      this.clearAllTimers(sid);
    });

    this.sessions.clear();
    this.userIndex.clear();
  }
}