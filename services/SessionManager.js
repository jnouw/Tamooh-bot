import { Collection } from 'discord.js';
import { CONFIG } from '../config.js';
import { logger } from '../utils/logger.js';
import { sessionStore } from './SessionStore.js';

/**
 * Manages quiz sessions with automatic cleanup and SQLite persistence
 * Uses in-memory cache for performance, SQLite for durability
 */
export class SessionManager {
  constructor() {
    this.sessions = new Collection();
    this.userIndex = new Map(); // userId -> Set of session IDs for O(1) lookup
    this.cleanupInterval = null;
    this.persistenceEnabled = false;
  }

  /**
   * Initialize persistence layer and recover sessions
   */
  async init() {
    try {
      sessionStore.init();
      this.persistenceEnabled = true;
      logger.info('SessionManager persistence enabled');
    } catch (error) {
      logger.warn('SessionManager persistence disabled, using memory only', { error: error.message });
      this.persistenceEnabled = false;
    }

    this.startCleanupTimer();
  }

  /**
   * Load active sessions from database (call on startup)
   * Returns sessions that need to be resumed
   * Handles expired timers by marking questions as timed out
   */
  loadPersistedSessions() {
    if (!this.persistenceEnabled) {
      return [];
    }

    try {
      const persistedSessions = sessionStore.loadActiveSessions();
      const now = Date.now();

      for (const sessionData of persistedSessions) {
        // Reconstruct session with timers Map
        const session = {
          ...sessionData,
          timers: new Map(),
          cleanupTimer: null
        };

        // Handle expired timers: if a timer was running and has expired,
        // mark the question as timed out and advance to next question
        if (session.questionStartTime && session.questionTimerSecs) {
          const elapsedMs = now - session.questionStartTime;
          const timerMs = session.questionTimerSecs * 1000;

          if (elapsedMs >= timerMs) {
            // Timer expired during downtime - mark question as timed out
            const idx = session.index;
            const mode = session.mode;

            session.answers[idx] = {
              kind: mode,
              chosen: null,
              correct: false,
              timeout: true,
              expiredDuringRestart: true
            };

            // Advance to next question
            session.index += 1;

            // Clear timer state
            session.questionStartTime = null;
            session.questionTimerSecs = null;

            logger.info('Question timed out during restart', {
              sid: session.sid,
              questionIndex: idx,
              elapsedMs,
              timerMs
            });

            // Check if quiz is now finished
            if (session.index >= session.items.length) {
              session.finished = true;
            }

            // Persist the updated state
            sessionStore.updateSession(session.sid, {
              index: session.index,
              answers: session.answers,
              finished: session.finished,
              questionStartTime: null,
              questionTimerSecs: null
            });
          } else {
            // Timer still has time left - calculate remaining seconds
            session.remainingTimerSecs = Math.ceil((timerMs - elapsedMs) / 1000);
            logger.info('Session has remaining timer', {
              sid: session.sid,
              remainingTimerSecs: session.remainingTimerSecs
            });
          }
        }

        this.sessions.set(session.sid, session);

        // Update user index
        if (!this.userIndex.has(session.userId)) {
          this.userIndex.set(session.userId, new Set());
        }
        this.userIndex.get(session.userId).add(session.sid);
      }

      logger.info('Loaded persisted sessions', { count: persistedSessions.length });
      return persistedSessions;
    } catch (error) {
      logger.error('Failed to load persisted sessions', { error: error.message });
      return [];
    }
  }

  /**
   * Get remaining timer seconds for a session (used by resume handler)
   * Always recalculates from persisted state to ensure accuracy
   */
  getRemainingTimerSecs(sid) {
    const session = this.sessions.get(sid);
    if (!session) return null;

    // Clean up cached value from load (we'll recalculate instead)
    delete session.remainingTimerSecs;

    // Calculate from persisted timer state
    if (session.questionStartTime && session.questionTimerSecs) {
      const elapsedMs = Date.now() - session.questionStartTime;
      const timerMs = session.questionTimerSecs * 1000;
      const remainingMs = timerMs - elapsedMs;
      if (remainingMs > 0) {
        return Math.ceil(remainingMs / 1000);
      }
      // Timer expired while user was deciding to resume - will be handled as timeout
      return null;
    }

    return null;
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

    // Persist to database
    if (this.persistenceEnabled) {
      try {
        sessionStore.saveSession(session);
      } catch (error) {
        logger.error('Failed to persist session', { sid, error: error.message });
      }
    }

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
   * Update session in database (for progress tracking)
   */
  persistSessionUpdate(session) {
    if (!this.persistenceEnabled) return;

    try {
      sessionStore.updateSession(session.sid, {
        index: session.index,
        score: session.score,
        answers: session.answers,
        finished: session.finished
      });
    } catch (error) {
      logger.error('Failed to persist session update', { sid: session.sid, error: error.message });
    }
  }

  /**
   * Start a timer for a question
   */
  startTimer(sid, questionIndex, seconds, onExpire) {
    const session = this.sessions.get(sid);
    if (!session) return;

    this.clearTimer(sid, questionIndex);

    // Persist timer metadata for recovery
    session.questionStartTime = Date.now();
    session.questionTimerSecs = seconds;
    this._persistTimerState(session);

    const timer = setTimeout(async () => {
      // Critical: Check session still exists and isn't finished
      const currentSession = this.sessions.get(sid);
      if (currentSession && !currentSession.finished) {
        // Clear timer state since timer fired
        currentSession.questionStartTime = null;
        currentSession.questionTimerSecs = null;
        this._persistTimerState(currentSession);

        try {
          await onExpire();
        } catch (error) {
          logger.error('Timer callback error', { sid, questionIndex, error: error.message });
        }
      }
    }, seconds * 1000);

    session.timers.set(String(questionIndex), timer);
  }

  /**
   * Persist timer state to database
   */
  _persistTimerState(session) {
    if (!this.persistenceEnabled) return;

    try {
      sessionStore.updateSession(session.sid, {
        questionStartTime: session.questionStartTime,
        questionTimerSecs: session.questionTimerSecs
      });
    } catch (error) {
      logger.error('Failed to persist timer state', { sid: session.sid, error: error.message });
    }
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

      // Clear persisted timer state
      session.questionStartTime = null;
      session.questionTimerSecs = null;
      this._persistTimerState(session);
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

    // Update in database
    this.persistSessionUpdate(session);

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

    // Delete from database
    if (this.persistenceEnabled) {
      try {
        sessionStore.deleteSession(sid);
      } catch (error) {
        logger.error('Failed to delete session from DB', { sid, error: error.message });
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

    // Also cleanup finished sessions in database
    if (this.persistenceEnabled) {
      sessionStore.cleanupFinished();
    }

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
    const memoryStats = {
      totalSessions: this.sessions.size,
      activeSessions: this.sessions.filter(s => !s.finished).size,
      finishedSessions: this.sessions.filter(s => s.finished).size,
      indexSize: this.userIndex.size
    };

    if (this.persistenceEnabled) {
      const dbStats = sessionStore.getStats();
      return {
        ...memoryStats,
        database: dbStats
      };
    }

    return memoryStats;
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

    // Close database connection
    if (this.persistenceEnabled) {
      sessionStore.close();
    }
  }
}
