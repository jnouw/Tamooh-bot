import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';
import { randomInt } from 'crypto';
import { logger } from '../utils/logger.js';
import { CONFIG } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * VerificationStore - SQLite-based storage for email verification
 * Tables: pending_verifications, verified_users, rate_limits
 */
class VerificationStore {
  constructor(dbPath = null) {
    const dataDir = join(__dirname, '../data');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    this.dbPath = dbPath || join(dataDir, 'verification.db');
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

      logger.info('VerificationStore initialized', { dbPath: this.dbPath });
    } catch (error) {
      logger.error('Failed to initialize VerificationStore', { error: error.message });
      throw error;
    }
  }

  /**
   * Create database tables
   */
  _createTables() {
    // Pending verifications table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pending_verifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id TEXT NOT NULL,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        expires_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_pending_discord
        ON pending_verifications(discord_id);

      CREATE INDEX IF NOT EXISTS idx_pending_email
        ON pending_verifications(email);

      CREATE INDEX IF NOT EXISTS idx_pending_expiry
        ON pending_verifications(expires_at);
    `);

    // Verified users table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS verified_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id TEXT NOT NULL UNIQUE,
        email TEXT,
        name TEXT,
        verification_method TEXT NOT NULL,
        verified_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_verified_discord
        ON verified_users(discord_id);

      CREATE INDEX IF NOT EXISTS idx_verified_email
        ON verified_users(email);
    `);

    // Rate limits table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        discord_id TEXT PRIMARY KEY,
        attempts INTEGER NOT NULL DEFAULT 0,
        window_start INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      );
    `);
  }

  // ==================== CODE GENERATION ====================

  /**
   * Generate a 6-digit verification code
   */
  generateCode() {
    return String(randomInt(100000, 999999));
  }

  // ==================== EMAIL VALIDATION ====================

  /**
   * Check if an email domain is allowed
   */
  isEmailAllowed(email) {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) return false;

    return CONFIG.VERIFY.ALLOWED_EMAIL_DOMAINS.some(
      allowed => domain === allowed.toLowerCase() || domain.endsWith('.' + allowed.toLowerCase())
    );
  }

  /**
   * Check if an email is already used by another verified user
   */
  isEmailUsed(email, excludeDiscordId = null) {
    let sql = 'SELECT discord_id FROM verified_users WHERE email = ?';
    const params = [email.toLowerCase()];

    if (excludeDiscordId) {
      sql += ' AND discord_id != ?';
      params.push(excludeDiscordId);
    }

    const result = this.db.prepare(sql).get(...params);
    return result !== undefined;
  }

  // ==================== RATE LIMITING ====================

  /**
   * Check if a user has exceeded the rate limit
   * Returns { allowed: boolean, remaining: number, resetAt: number }
   */
  checkRateLimit(discordId) {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    const maxAttempts = CONFIG.VERIFY.MAX_ATTEMPTS_PER_HOUR;

    const record = this.db.prepare('SELECT * FROM rate_limits WHERE discord_id = ?').get(discordId);

    if (!record) {
      return { allowed: true, remaining: maxAttempts, resetAt: now + oneHour };
    }

    // Check if window has expired
    if (now - record.window_start >= oneHour) {
      // Reset the window
      this.db.prepare('UPDATE rate_limits SET attempts = 0, window_start = ? WHERE discord_id = ?')
        .run(now, discordId);
      return { allowed: true, remaining: maxAttempts, resetAt: now + oneHour };
    }

    // Check if under limit
    const remaining = maxAttempts - record.attempts;
    const resetAt = record.window_start + oneHour;

    return {
      allowed: remaining > 0,
      remaining: Math.max(0, remaining),
      resetAt,
    };
  }

  /**
   * Increment rate limit counter
   */
  incrementRateLimit(discordId) {
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO rate_limits (discord_id, attempts, window_start)
      VALUES (?, 1, ?)
      ON CONFLICT(discord_id) DO UPDATE SET
        attempts = attempts + 1
    `).run(discordId, now);
  }

  // ==================== PENDING VERIFICATIONS ====================

  /**
   * Create a pending verification
   * Returns the verification code
   */
  createPendingVerification(discordId, email, name) {
    const code = this.generateCode();
    const now = Date.now();
    const expiresAt = now + (CONFIG.VERIFY.CODE_EXPIRY_MINUTES * 60 * 1000);

    // Delete any existing pending verifications for this user
    this.db.prepare('DELETE FROM pending_verifications WHERE discord_id = ?').run(discordId);

    this.db.prepare(`
      INSERT INTO pending_verifications (discord_id, email, name, code, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(discordId, email.toLowerCase(), name, code, now, expiresAt);

    // Increment rate limit
    this.incrementRateLimit(discordId);

    logger.info('Created pending verification', { discordId, email: email.toLowerCase() });

    return code;
  }

  /**
   * Get pending verification for a user
   */
  getPendingVerification(discordId) {
    const now = Date.now();

    const pending = this.db.prepare(`
      SELECT * FROM pending_verifications
      WHERE discord_id = ? AND expires_at > ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(discordId, now);

    return pending || null;
  }

  /**
   * Verify a code
   * Returns { success: boolean, error?: string, email?: string, name?: string }
   */
  verifyCode(discordId, inputCode) {
    const pending = this.getPendingVerification(discordId);

    if (!pending) {
      return { success: false, error: 'No pending verification found or code has expired.' };
    }

    // Increment attempts
    this.db.prepare(`
      UPDATE pending_verifications SET attempts = attempts + 1 WHERE id = ?
    `).run(pending.id);

    // Check attempts (max 5)
    if (pending.attempts >= 5) {
      this.db.prepare('DELETE FROM pending_verifications WHERE id = ?').run(pending.id);
      return { success: false, error: 'Too many incorrect attempts. Please request a new code.' };
    }

    // Check code
    if (pending.code !== inputCode) {
      return { success: false, error: `Incorrect code. ${4 - pending.attempts} attempts remaining.` };
    }

    // Success - delete pending and create verified record
    this.db.prepare('DELETE FROM pending_verifications WHERE id = ?').run(pending.id);

    return {
      success: true,
      email: pending.email,
      name: pending.name,
    };
  }

  // ==================== VERIFIED USERS ====================

  /**
   * Mark a user as verified
   */
  markVerified(discordId, email, name, method = 'email') {
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO verified_users (discord_id, email, name, verification_method, verified_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(discord_id) DO UPDATE SET
        email = excluded.email,
        name = excluded.name,
        verification_method = excluded.verification_method,
        verified_at = excluded.verified_at
    `).run(discordId, email?.toLowerCase() || null, name, method, now);

    logger.info('User verified', { discordId, email, method });
  }

  /**
   * Check if a user is verified in the database
   */
  isVerified(discordId) {
    const result = this.db.prepare('SELECT id FROM verified_users WHERE discord_id = ?').get(discordId);
    return result !== undefined;
  }

  /**
   * Get verification info for a user
   */
  getVerificationInfo(discordId) {
    return this.db.prepare('SELECT * FROM verified_users WHERE discord_id = ?').get(discordId);
  }

  // ==================== CLEANUP ====================

  /**
   * Clean up expired pending verifications
   */
  cleanupExpired() {
    const now = Date.now();
    const result = this.db.prepare('DELETE FROM pending_verifications WHERE expires_at < ?').run(now);

    if (result.changes > 0) {
      logger.info('Cleaned up expired pending verifications', { count: result.changes });
    }

    return result.changes;
  }

  /**
   * Close the database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      logger.info('VerificationStore closed');
    }
  }
}

// Singleton instance
export const verificationStore = new VerificationStore();
