import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';
import { logger } from '../utils/logger.js';
import { CONFIG } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * SessionStore - SQLite-based persistence for quiz sessions
 * Allows session recovery after bot restarts
 */
class SessionStore {
  constructor(dbPath = null) {
    const dataDir = join(__dirname, '../data');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    this.dbPath = dbPath || join(dataDir, 'sessions.db');
    this.db = null;
  }

  /**
   * Initialize database and create tables
   */
  init() {
    try {
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');

      this._createTables();
      this._cleanupExpired();

      logger.info('SessionStore initialized', { dbPath: this.dbPath });
    } catch (error) {
      logger.error('Failed to initialize SessionStore', { error: error.message });
      throw error;
    }
  }

  /**
   * Create database tables with indexes
   */
  _createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS quiz_sessions (
        sid TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        items TEXT NOT NULL,
        current_index INTEGER NOT NULL DEFAULT 0,
        score INTEGER NOT NULL DEFAULT 0,
        answers TEXT NOT NULL DEFAULT '[]',
        chapter TEXT,
        finished INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_activity INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_user_guild
        ON quiz_sessions(user_id, guild_id, finished);

      CREATE INDEX IF NOT EXISTS idx_sessions_expires
        ON quiz_sessions(expires_at);

      CREATE INDEX IF NOT EXISTS idx_sessions_finished
        ON quiz_sessions(finished, expires_at);
    `);
  }

  /**
   * Save a new session to database
   */
  saveSession(session) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO quiz_sessions (
        sid, user_id, guild_id, channel_id, mode, items,
        current_index, score, answers, chapter, finished,
        created_at, last_activity, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const expiresAt = session.createdAt + (CONFIG.SESSION_TTL_MS || 86400000); // Default 24h

    stmt.run(
      session.sid,
      session.userId,
      session.guildId,
      session.channelId,
      session.mode,
      JSON.stringify(session.items),
      session.index,
      session.score,
      JSON.stringify(session.answers),
      session.chapter || null,
      session.finished ? 1 : 0,
      session.createdAt,
      session.lastActivity,
      expiresAt
    );

    logger.debug('Session saved to DB', { sid: session.sid });
  }

  /**
   * Update session progress
   */
  updateSession(sid, updates) {
    const fields = [];
    const values = [];

    if (updates.index !== undefined) {
      fields.push('current_index = ?');
      values.push(updates.index);
    }
    if (updates.score !== undefined) {
      fields.push('score = ?');
      values.push(updates.score);
    }
    if (updates.answers !== undefined) {
      fields.push('answers = ?');
      values.push(JSON.stringify(updates.answers));
    }
    if (updates.finished !== undefined) {
      fields.push('finished = ?');
      values.push(updates.finished ? 1 : 0);
    }

    fields.push('last_activity = ?');
    values.push(Date.now());
    values.push(sid);

    const stmt = this.db.prepare(`
      UPDATE quiz_sessions SET ${fields.join(', ')} WHERE sid = ?
    `);

    stmt.run(...values);
  }

  /**
   * Delete a session from database
   */
  deleteSession(sid) {
    const stmt = this.db.prepare('DELETE FROM quiz_sessions WHERE sid = ?');
    stmt.run(sid);
    logger.debug('Session deleted from DB', { sid });
  }

  /**
   * Load all active (non-finished, non-expired) sessions
   */
  loadActiveSessions() {
    const now = Date.now();
    const stmt = this.db.prepare(`
      SELECT * FROM quiz_sessions
      WHERE finished = 0 AND expires_at > ?
      ORDER BY created_at ASC
    `);

    const rows = stmt.all(now);

    return rows.map(row => ({
      sid: row.sid,
      userId: row.user_id,
      guildId: row.guild_id,
      channelId: row.channel_id,
      mode: row.mode,
      items: JSON.parse(row.items),
      index: row.current_index,
      score: row.score,
      answers: JSON.parse(row.answers),
      chapter: row.chapter,
      finished: row.finished === 1,
      createdAt: row.created_at,
      lastActivity: row.last_activity
    }));
  }

  /**
   * Get a session by ID
   */
  getSession(sid) {
    const stmt = this.db.prepare('SELECT * FROM quiz_sessions WHERE sid = ?');
    const row = stmt.get(sid);

    if (!row) return null;

    return {
      sid: row.sid,
      userId: row.user_id,
      guildId: row.guild_id,
      channelId: row.channel_id,
      mode: row.mode,
      items: JSON.parse(row.items),
      index: row.current_index,
      score: row.score,
      answers: JSON.parse(row.answers),
      chapter: row.chapter,
      finished: row.finished === 1,
      createdAt: row.created_at,
      lastActivity: row.last_activity
    };
  }

  /**
   * Clean up expired sessions
   */
  _cleanupExpired() {
    const now = Date.now();
    const stmt = this.db.prepare('DELETE FROM quiz_sessions WHERE expires_at < ?');
    const result = stmt.run(now);

    if (result.changes > 0) {
      logger.info('Cleaned up expired sessions from DB', { count: result.changes });
    }
  }

  /**
   * Clean up finished sessions older than threshold
   */
  cleanupFinished(thresholdMs = 300000) { // 5 minutes default
    const cutoff = Date.now() - thresholdMs;
    const stmt = this.db.prepare(`
      DELETE FROM quiz_sessions
      WHERE finished = 1 AND last_activity < ?
    `);
    const result = stmt.run(cutoff);

    if (result.changes > 0) {
      logger.info('Cleaned up finished sessions from DB', { count: result.changes });
    }
  }

  /**
   * Get session statistics
   */
  getStats() {
    const now = Date.now();

    const total = this.db.prepare('SELECT COUNT(*) as count FROM quiz_sessions').get();
    const active = this.db.prepare(
      'SELECT COUNT(*) as count FROM quiz_sessions WHERE finished = 0 AND expires_at > ?'
    ).get(now);
    const finished = this.db.prepare(
      'SELECT COUNT(*) as count FROM quiz_sessions WHERE finished = 1'
    ).get();

    return {
      total: total.count,
      active: active.count,
      finished: finished.count
    };
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      logger.info('SessionStore closed');
    }
  }
}

// Export singleton instance
export const sessionStore = new SessionStore();
