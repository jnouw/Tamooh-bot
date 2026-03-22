import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * SuggestionStore - SQLite-based anonymous suggestion storage.
 *
 * Privacy model: user IDs are never stored. Rate limiting uses a daily hash
 * (SHA-256 of userId + YYYY-MM-DD) that cannot be reversed or correlated
 * across days.
 */
class SuggestionStore {
  constructor(dbPath = null) {
    const dataDir = join(__dirname, '../data');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    this.dbPath = dbPath || join(dataDir, 'suggestions.db');
    this.db = null;
  }

  init() {
    try {
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS suggestions (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          suggestion       TEXT    NOT NULL,
          implementation   TEXT    NOT NULL,
          submitted_at     INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS suggestion_limits (
          user_hash  TEXT NOT NULL,
          date       TEXT NOT NULL,
          PRIMARY KEY (user_hash, date)
        );

        CREATE TABLE IF NOT EXISTS welcomed_members (
          user_id      TEXT    PRIMARY KEY,
          welcomed_at  INTEGER NOT NULL
        );
      `);
      logger.info('SuggestionStore initialized', { dbPath: this.dbPath });
    } catch (error) {
      logger.error('Failed to initialize SuggestionStore', { error: error.message });
      throw error;
    }
  }

  /** Returns today's date string YYYY-MM-DD */
  _today() {
    return new Date().toISOString().slice(0, 10);
  }

  /** One-way daily hash of userId — used only for rate limiting */
  _hash(userId) {
    return createHash('sha256').update(userId + this._today()).digest('hex');
  }

  /** Returns true if this user hasn't submitted today */
  canSubmit(userId) {
    const row = this.db
      .prepare('SELECT 1 FROM suggestion_limits WHERE user_hash = ? AND date = ?')
      .get(this._hash(userId), this._today());
    return !row;
  }

  /** Saves a suggestion and records the daily rate-limit entry */
  add(userId, suggestion, implementation) {
    this.db
      .prepare('INSERT INTO suggestions (suggestion, implementation, submitted_at) VALUES (?, ?, ?)')
      .run(suggestion, implementation, Date.now());

    this.db
      .prepare('INSERT OR IGNORE INTO suggestion_limits (user_hash, date) VALUES (?, ?)')
      .run(this._hash(userId), this._today());
  }

  /** Returns true if this user has NOT been welcomed yet */
  canWelcome(userId) {
    const row = this.db
      .prepare('SELECT 1 FROM welcomed_members WHERE user_id = ?')
      .get(userId);
    return !row;
  }

  /** Marks a user as welcomed (idempotent) */
  markWelcomed(userId) {
    this.db
      .prepare('INSERT OR IGNORE INTO welcomed_members (user_id, welcomed_at) VALUES (?, ?)')
      .run(userId, Date.now());
  }

  /** Returns all suggestions newest-first */
  getAll() {
    return this.db
      .prepare('SELECT * FROM suggestions ORDER BY submitted_at DESC')
      .all();
  }

  close() {
    this.db?.close();
  }
}

export const suggestionStore = new SuggestionStore();
