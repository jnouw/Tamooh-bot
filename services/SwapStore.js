import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';
import { logger } from '../utils/logger.js';
import { CONFIG } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * SwapStore - SQLite-based storage for section swap matchmaking
 * Tables: swap_requests, swap_matches, swap_match_participants
 */
class SwapStore {
  constructor(dbPath = null) {
    const dataDir = join(__dirname, '../data');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    this.dbPath = dbPath || join(dataDir, 'swaps.db');
    this.db = null;
    this.settings = new Map(); // guildId -> { allow_three_way, confirm_timeout_minutes, request_expiry_days }
  }

  /**
   * Initialize database and create tables
   */
  init() {
    try {
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');

      this._createTables();
      this._loadSettings();

      logger.info('SwapStore initialized', { dbPath: this.dbPath });
    } catch (error) {
      logger.error('Failed to initialize SwapStore', { error: error.message });
      throw error;
    }
  }

  /**
   * Create database tables with indexes
   */
  _createTables() {
    // Swap requests table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS swap_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        campus TEXT NOT NULL,
        course TEXT NOT NULL,
        user_id TEXT NOT NULL,
        have_section TEXT NOT NULL,
        want_section TEXT NOT NULL,
        note TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE INDEX IF NOT EXISTS idx_requests_matching
        ON swap_requests(guild_id, campus, course, status, have_section, want_section, created_at);

      CREATE INDEX IF NOT EXISTS idx_requests_user
        ON swap_requests(user_id, status);

      CREATE INDEX IF NOT EXISTS idx_requests_expiry
        ON swap_requests(status, created_at);
    `);

    // Swap matches table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS swap_matches (
        match_id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        campus TEXT NOT NULL,
        course TEXT NOT NULL,
        match_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending_confirm',
        thread_id TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        expires_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_matches_status
        ON swap_matches(status, expires_at);

      CREATE INDEX IF NOT EXISTS idx_matches_thread
        ON swap_matches(thread_id);
    `);

    // Swap match participants table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS swap_match_participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match_id INTEGER NOT NULL,
        request_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        confirmed_at INTEGER,
        FOREIGN KEY (match_id) REFERENCES swap_matches(match_id) ON DELETE CASCADE,
        FOREIGN KEY (request_id) REFERENCES swap_requests(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_participants_match
        ON swap_match_participants(match_id);

      CREATE INDEX IF NOT EXISTS idx_participants_user
        ON swap_match_participants(user_id, match_id);
    `);

    // Guild settings table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS swap_settings (
        guild_id TEXT PRIMARY KEY,
        allow_three_way INTEGER NOT NULL DEFAULT 0,
        confirm_timeout_minutes INTEGER NOT NULL DEFAULT 120,
        request_expiry_days INTEGER NOT NULL DEFAULT 7,
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      );
    `);
  }

  /**
   * Load guild settings into memory
   */
  _loadSettings() {
    const rows = this.db.prepare('SELECT * FROM swap_settings').all();
    for (const row of rows) {
      this.settings.set(row.guild_id, {
        allow_three_way: Boolean(row.allow_three_way),
        confirm_timeout_minutes: row.confirm_timeout_minutes,
        request_expiry_days: row.request_expiry_days,
      });
    }
  }

  /**
   * Get settings for a guild (with defaults)
   */
  getSettings(guildId) {
    if (this.settings.has(guildId)) {
      return this.settings.get(guildId);
    }
    return {
      allow_three_way: CONFIG.SWAP.ALLOW_THREE_WAY,
      confirm_timeout_minutes: CONFIG.SWAP.CONFIRM_TIMEOUT_MINUTES,
      request_expiry_days: CONFIG.SWAP.REQUEST_EXPIRY_DAYS,
    };
  }

  /**
   * Update settings for a guild
   */
  updateSettings(guildId, updates) {
    const current = this.getSettings(guildId);
    const newSettings = { ...current, ...updates };

    const stmt = this.db.prepare(`
      INSERT INTO swap_settings (guild_id, allow_three_way, confirm_timeout_minutes, request_expiry_days, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        allow_three_way = excluded.allow_three_way,
        confirm_timeout_minutes = excluded.confirm_timeout_minutes,
        request_expiry_days = excluded.request_expiry_days,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      guildId,
      newSettings.allow_three_way ? 1 : 0,
      newSettings.confirm_timeout_minutes,
      newSettings.request_expiry_days,
      Date.now()
    );

    this.settings.set(guildId, newSettings);
    logger.info('Swap settings updated', { guildId, ...newSettings });

    return newSettings;
  }

  // ==================== REQUEST OPERATIONS ====================

  /**
   * Create a new swap request
   */
  createRequest({ guildId, campus, course, userId, haveSection, wantSection, note }) {
    const stmt = this.db.prepare(`
      INSERT INTO swap_requests (guild_id, campus, course, user_id, have_section, want_section, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = Date.now();
    const result = stmt.run(guildId, campus, course, userId, haveSection, wantSection, note || null, now, now);

    logger.info('Swap request created', { requestId: result.lastInsertRowid, guildId, campus, course, userId, haveSection, wantSection });

    return this.getRequestById(result.lastInsertRowid);
  }

  /**
   * Get a request by ID
   */
  getRequestById(id) {
    return this.db.prepare('SELECT * FROM swap_requests WHERE id = ?').get(id);
  }

  /**
   * Get open requests for a user in a specific guild/campus/course
   */
  getUserOpenRequests(userId, guildId, campus = null, course = null) {
    let sql = 'SELECT * FROM swap_requests WHERE user_id = ? AND guild_id = ? AND status = ?';
    const params = [userId, guildId, 'open'];

    if (campus) {
      sql += ' AND campus = ?';
      params.push(campus);
    }
    if (course) {
      sql += ' AND course = ?';
      params.push(course);
    }

    sql += ' ORDER BY created_at DESC';
    return this.db.prepare(sql).all(...params);
  }

  /**
   * Get all open requests for a user across all guilds
   */
  getAllUserOpenRequests(userId, guildId) {
    return this.db.prepare(`
      SELECT * FROM swap_requests
      WHERE user_id = ? AND guild_id = ? AND status = 'open'
      ORDER BY created_at DESC
    `).all(userId, guildId);
  }

  /**
   * Check for duplicate request
   */
  hasDuplicateRequest(userId, guildId, campus, course, haveSection, wantSection) {
    const result = this.db.prepare(`
      SELECT COUNT(*) as count FROM swap_requests
      WHERE user_id = ? AND guild_id = ? AND campus = ? AND course = ?
        AND have_section = ? AND want_section = ? AND status = 'open'
    `).get(userId, guildId, campus, course, haveSection, wantSection);

    return result.count > 0;
  }

  /**
   * Count open requests for user in a campus/course
   */
  countUserOpenRequests(userId, guildId, campus, course) {
    const result = this.db.prepare(`
      SELECT COUNT(*) as count FROM swap_requests
      WHERE user_id = ? AND guild_id = ? AND campus = ? AND course = ? AND status = 'open'
    `).get(userId, guildId, campus, course);

    return result.count;
  }

  /**
   * Update request status
   */
  updateRequestStatus(id, status) {
    const stmt = this.db.prepare(`
      UPDATE swap_requests SET status = ?, updated_at = ? WHERE id = ?
    `);
    stmt.run(status, Date.now(), id);
    logger.info('Request status updated', { requestId: id, status });
  }

  /**
   * Cancel a request (allowed for both 'open' and 'pending' status)
   */
  cancelRequest(id, userId) {
    const request = this.getRequestById(id);
    if (!request) {
      return { success: false, error: 'Request not found' };
    }
    if (request.user_id !== userId) {
      return { success: false, error: 'You can only cancel your own requests' };
    }
    if (request.status !== 'open' && request.status !== 'pending') {
      return { success: false, error: 'Only open or pending requests can be cancelled' };
    }

    // Check if this request is part of a pending match
    const matchParticipant = this.db.prepare(`
      SELECT match_id FROM swap_match_participants WHERE request_id = ?
    `).get(id);

    this.updateRequestStatus(id, 'cancelled');
    return { success: true, request, matchId: matchParticipant?.match_id || null };
  }

  /**
   * Find a 2-way match for a new request
   */
  findTwoWayMatch(newRequest) {
    // Find oldest open request where:
    // - same guild, campus, course
    // - R.have_section == new.want_section
    // - R.want_section == new.have_section
    // - different user
    const match = this.db.prepare(`
      SELECT * FROM swap_requests
      WHERE guild_id = ? AND campus = ? AND course = ? AND status = 'open'
        AND have_section = ? AND want_section = ?
        AND user_id != ?
      ORDER BY created_at ASC
      LIMIT 1
    `).get(
      newRequest.guild_id,
      newRequest.campus,
      newRequest.course,
      newRequest.want_section,
      newRequest.have_section,
      newRequest.user_id
    );

    return match || null;
  }

  /**
   * Find a 3-way cycle match for a new request
   * new = (have=A, want=B)
   * Find X: (have=B, want=C) where C != A
   * Find Y: (have=C, want=A)
   */
  findThreeWayCycle(newRequest) {
    const { guild_id, campus, course, user_id, have_section: A, want_section: B } = newRequest;

    // Find all potential X requests: have=B, want=C (where C != A)
    const potentialXs = this.db.prepare(`
      SELECT * FROM swap_requests
      WHERE guild_id = ? AND campus = ? AND course = ? AND status = 'open'
        AND have_section = ? AND want_section != ?
        AND user_id != ?
      ORDER BY created_at ASC
    `).all(guild_id, campus, course, B, A, user_id);

    for (const X of potentialXs) {
      const C = X.want_section;

      // Find Y: (have=C, want=A), different user from new and X
      const Y = this.db.prepare(`
        SELECT * FROM swap_requests
        WHERE guild_id = ? AND campus = ? AND course = ? AND status = 'open'
          AND have_section = ? AND want_section = ?
          AND user_id != ? AND user_id != ?
        ORDER BY created_at ASC
        LIMIT 1
      `).get(guild_id, campus, course, C, A, user_id, X.user_id);

      if (Y) {
        logger.info('Found 3-way cycle', {
          newId: newRequest.id,
          xId: X.id,
          yId: Y.id,
          sections: `${A} -> ${B} -> ${C} -> ${A}`,
        });
        return { X, Y };
      }
    }

    return null;
  }

  /**
   * Expire old open requests for a specific guild
   */
  expireOldRequests(guildId, expiryDays) {
    const cutoff = Date.now() - (expiryDays * 24 * 60 * 60 * 1000);
    const result = this.db.prepare(`
      UPDATE swap_requests
      SET status = 'expired', updated_at = ?
      WHERE guild_id = ? AND status = 'open' AND created_at < ?
    `).run(Date.now(), guildId, cutoff);

    if (result.changes > 0) {
      logger.info('Expired old requests', { guildId, count: result.changes, expiryDays });
    }

    return result.changes;
  }

  // ==================== MATCH OPERATIONS ====================

  /**
   * Create a new match with participants
   */
  createMatch({ guildId, campus, course, matchType, requestIds, timeoutMinutes }) {
    const now = Date.now();
    const expiresAt = now + (timeoutMinutes * 60 * 1000);

    const insertMatch = this.db.prepare(`
      INSERT INTO swap_matches (guild_id, campus, course, match_type, status, created_at, expires_at)
      VALUES (?, ?, ?, ?, 'pending_confirm', ?, ?)
    `);

    const insertParticipant = this.db.prepare(`
      INSERT INTO swap_match_participants (match_id, request_id, user_id)
      SELECT ?, id, user_id FROM swap_requests WHERE id = ?
    `);

    const updateRequestStatus = this.db.prepare(`
      UPDATE swap_requests SET status = 'pending', updated_at = ? WHERE id = ?
    `);

    const transaction = this.db.transaction(() => {
      const result = insertMatch.run(guildId, campus, course, matchType, now, expiresAt);
      const matchId = result.lastInsertRowid;

      for (const requestId of requestIds) {
        insertParticipant.run(matchId, requestId);
        updateRequestStatus.run(now, requestId);
      }

      return matchId;
    });

    const matchId = transaction();
    logger.info('Match created', { matchId, guildId, campus, course, matchType, requestIds });

    return this.getMatchById(matchId);
  }

  /**
   * Get a match by ID with participants and requests
   */
  getMatchById(matchId) {
    const match = this.db.prepare('SELECT * FROM swap_matches WHERE match_id = ?').get(matchId);
    if (!match) return null;

    const participants = this.db.prepare(`
      SELECT p.*, r.have_section, r.want_section, r.note
      FROM swap_match_participants p
      JOIN swap_requests r ON p.request_id = r.id
      WHERE p.match_id = ?
    `).all(matchId);

    return { ...match, participants };
  }

  /**
   * Get a match by thread ID
   */
  getMatchByThreadId(threadId) {
    const match = this.db.prepare('SELECT * FROM swap_matches WHERE thread_id = ?').get(threadId);
    if (!match) return null;

    return this.getMatchById(match.match_id);
  }

  /**
   * Set thread ID for a match
   */
  setMatchThreadId(matchId, threadId) {
    this.db.prepare('UPDATE swap_matches SET thread_id = ? WHERE match_id = ?').run(threadId, matchId);
  }

  /**
   * Confirm a participant
   */
  confirmParticipant(matchId, userId) {
    const participant = this.db.prepare(`
      SELECT * FROM swap_match_participants
      WHERE match_id = ? AND user_id = ?
    `).get(matchId, userId);

    if (!participant) {
      return { success: false, error: 'Not a participant' };
    }
    if (participant.confirmed_at) {
      return { success: false, error: 'Already confirmed' };
    }

    const now = Date.now();
    this.db.prepare(`
      UPDATE swap_match_participants SET confirmed_at = ? WHERE match_id = ? AND user_id = ?
    `).run(now, matchId, userId);

    // Check if all confirmed
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN confirmed_at IS NOT NULL THEN 1 ELSE 0 END) as confirmed
      FROM swap_match_participants WHERE match_id = ?
    `).get(matchId);

    const allConfirmed = stats.confirmed === stats.total;

    if (allConfirmed) {
      this._finalizeMatch(matchId);
    }

    logger.info('Participant confirmed', { matchId, userId, confirmed: stats.confirmed, total: stats.total });

    return {
      success: true,
      confirmed: stats.confirmed,
      total: stats.total,
      allConfirmed,
    };
  }

  /**
   * Finalize a fully confirmed match
   */
  _finalizeMatch(matchId) {
    const now = Date.now();

    // Update match status
    this.db.prepare(`
      UPDATE swap_matches SET status = 'confirmed' WHERE match_id = ?
    `).run(matchId);

    // Update all related requests to matched
    this.db.prepare(`
      UPDATE swap_requests SET status = 'matched', updated_at = ?
      WHERE id IN (SELECT request_id FROM swap_match_participants WHERE match_id = ?)
    `).run(now, matchId);

    logger.info('Match finalized', { matchId });
  }

  /**
   * Get pending matches that have expired
   */
  getExpiredMatches() {
    const now = Date.now();
    return this.db.prepare(`
      SELECT * FROM swap_matches
      WHERE status = 'pending_confirm' AND expires_at < ?
    `).all(now);
  }

  /**
   * Expire a match and reopen non-cancelled requests
   */
  expireMatch(matchId) {
    const now = Date.now();

    const transaction = this.db.transaction(() => {
      // Get the match and participants
      const participants = this.db.prepare(`
        SELECT p.request_id, r.status as request_status
        FROM swap_match_participants p
        JOIN swap_requests r ON p.request_id = r.id
        WHERE p.match_id = ?
      `).all(matchId);

      // Update match status
      this.db.prepare(`
        UPDATE swap_matches SET status = 'expired' WHERE match_id = ?
      `).run(matchId);

      // Reopen requests that weren't cancelled
      for (const p of participants) {
        if (p.request_status !== 'cancelled') {
          this.db.prepare(`
            UPDATE swap_requests SET status = 'open', updated_at = ? WHERE id = ?
          `).run(now, p.request_id);
        }
      }

      return participants.length;
    });

    const count = transaction();
    logger.info('Match expired', { matchId, reopenedCount: count });

    return count;
  }

  /**
   * Cancel a match (e.g., if a user cancels their request mid-confirmation)
   */
  cancelMatch(matchId) {
    const now = Date.now();

    const transaction = this.db.transaction(() => {
      const participants = this.db.prepare(`
        SELECT p.request_id, r.status as request_status
        FROM swap_match_participants p
        JOIN swap_requests r ON p.request_id = r.id
        WHERE p.match_id = ?
      `).all(matchId);

      this.db.prepare(`
        UPDATE swap_matches SET status = 'cancelled' WHERE match_id = ?
      `).run(matchId);

      // Reopen requests that weren't cancelled by the user
      for (const p of participants) {
        if (p.request_status !== 'cancelled') {
          this.db.prepare(`
            UPDATE swap_requests SET status = 'open', updated_at = ? WHERE id = ?
          `).run(now, p.request_id);
        }
      }

      return participants.length;
    });

    const count = transaction();
    logger.info('Match cancelled', { matchId, reopenedCount: count });

    return count;
  }

  // ==================== STATS OPERATIONS ====================

  /**
   * Get swap statistics for a guild
   */
  getStats(guildId, campus = null, course = null) {
    let whereClause = 'WHERE guild_id = ?';
    const params = [guildId];

    if (campus) {
      whereClause += ' AND campus = ?';
      params.push(campus);
    }
    if (course) {
      whereClause += ' AND course = ?';
      params.push(course);
    }

    const requestStats = this.db.prepare(`
      SELECT
        status,
        COUNT(*) as count
      FROM swap_requests ${whereClause}
      GROUP BY status
    `).all(...params);

    const matchStats = this.db.prepare(`
      SELECT
        match_type,
        status,
        COUNT(*) as count
      FROM swap_matches ${whereClause}
      GROUP BY match_type, status
    `).all(...params);

    const topCourses = this.db.prepare(`
      SELECT
        campus,
        course,
        COUNT(*) as total_requests,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_requests
      FROM swap_requests ${whereClause}
      GROUP BY campus, course
      ORDER BY total_requests DESC
      LIMIT 10
    `).all(...params);

    return {
      requests: requestStats,
      matches: matchStats,
      topCourses,
    };
  }

  /**
   * Purge expired requests (admin cleanup)
   */
  purgeExpired(guildId) {
    const settings = this.getSettings(guildId);

    // Expire old requests for this guild only
    const requestCount = this.expireOldRequests(guildId, settings.request_expiry_days);

    // Expire timed-out matches
    const expiredMatches = this.getExpiredMatches();
    for (const match of expiredMatches) {
      if (match.guild_id === guildId) {
        this.expireMatch(match.match_id);
      }
    }

    return {
      expiredRequests: requestCount,
      expiredMatches: expiredMatches.filter(m => m.guild_id === guildId).length,
    };
  }

  /**
   * Close the database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      logger.info('SwapStore closed');
    }
  }
}

// Singleton instance
export const swapStore = new SwapStore();
