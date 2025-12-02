import { readFile, writeFile, mkdir, readdir, unlink, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { CONFIG } from '../config.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class ScoreStore {
  constructor(fileName = 'results.json') {
    this.dir = join(__dirname, '../data');
    this.file = join(this.dir, fileName);
    this.backupDir = join(this.dir, 'backups');
    this.data = { results: [] };
    this.saveQueue = Promise.resolve();
    this.pendingSave = false;
    this.initializing = true;

    this.ready = this.init()
      .catch(error => {
        logger.error('ScoreStore failed to initialize', { error: error.message });
      })
      .finally(() => {
        this.initializing = false;
      });
  }

  /**
   * Initialize store - load data and setup directories
   */
  async init() {
    try {
      await mkdir(this.dir, { recursive: true });
      if (CONFIG.BACKUP_SCORES) {
        await mkdir(this.backupDir, { recursive: true });
      }
      await this.load();
    } catch (error) {
      logger.error('Failed to initialize ScoreStore', { error: error.message });
    }
  }

  /**
   * Load data from file
   */
  async load() {
    try {
      if (existsSync(this.file)) {
        const raw = await readFile(this.file, 'utf8');
        this.data = JSON.parse(raw);
        logger.info('Scores loaded', { count: this.data.results.length });
      }
    } catch (error) {
      logger.error('Failed to load scores', { error: error.message });
      // Try to load from backup
      if (CONFIG.BACKUP_SCORES) {
        await this.restoreFromBackup();
      }
    }
  }

  /**
   * Save data to file with backup
   */
  async save() {
    if (!this.initializing) {
      await this.ready;
    }

    // Queue saves to prevent concurrent writes
    this.saveQueue = this.saveQueue.then(async () => {
      try {
        // Create backup before saving if enabled
        if (CONFIG.BACKUP_SCORES && existsSync(this.file)) {
          await this.createBackup();
        }

        // Write to file
        const data = JSON.stringify(this.data, null, 2);
        await writeFile(this.file, data, 'utf8');

        // Clean old backups
        if (CONFIG.BACKUP_SCORES) {
          await this.cleanOldBackups();
        }
      } catch (error) {
        logger.error('Failed to save scores', { error: error.message });
      } finally {
        this.pendingSave = false;
      }
    });

    return this.saveQueue;
  }

  /**
   * Save with debouncing
   */
  async saveDebounced() {
    if (!this.initializing) {
      await this.ready;
    }

    if (this.pendingSave) return;

    this.pendingSave = true;
    setTimeout(async () => {
      try {
        await this.save();
      } catch (error) {
        logger.error('Debounced save failed', { error: error.message });
      } finally {
        this.pendingSave = false;
      }
    }, 5000); // Save after 5 seconds of inactivity
  }

  /**
   * Create backup of current scores
   */
  async createBackup() {
    try {
      const timestamp = Date.now();
      const backupFile = join(this.backupDir, `results.${timestamp}.json`);
      await copyFile(this.file, backupFile);
      logger.info('Backup created', { file: backupFile });
    } catch (error) {
      logger.warn('Failed to create backup', { error: error.message });
    }
  }

  /**
   * Clean old backup files
   */
  async cleanOldBackups() {
    try {
      const files = await readdir(this.backupDir);
      const backups = files
        .filter(f => f.startsWith('results.') && f.endsWith('.json'))
        .map(f => ({
          name: f,
          path: join(this.backupDir, f),
          time: parseInt(f.match(/results\.(\d+)\.json/)?.[1] || '0')
        }))
        .sort((a, b) => b.time - a.time);

      // Keep only the most recent backups
      const toDelete = backups.slice(CONFIG.MAX_BACKUP_FILES);
      
      for (const backup of toDelete) {
        try {
          await unlink(backup.path);
          logger.info('Old backup deleted', { file: backup.name });
        } catch (error) {
          logger.warn('Failed to delete old backup', { file: backup.name });
        }
      }
    } catch (error) {
      logger.warn('Failed to clean old backups', { error: error.message });
    }
  }

  /**
   * Restore from most recent backup
   */
  async restoreFromBackup() {
    try {
      const files = await readdir(this.backupDir);
      const backups = files
        .filter(f => f.startsWith('results.') && f.endsWith('.json'))
        .map(f => ({
          name: f,
          path: join(this.backupDir, f),
          time: parseInt(f.match(/results\.(\d+)\.json/)?.[1] || '0')
        }))
        .sort((a, b) => b.time - a.time);

      if (backups.length > 0) {
        const latest = backups[0];
        const raw = await readFile(latest.path, 'utf8');
        this.data = JSON.parse(raw);
        logger.info('Restored from backup', { file: latest.name, count: this.data.results.length });
        
        // Save the restored data
        await this.save();
      }
    } catch (error) {
      logger.error('Failed to restore from backup', { error: error.message });
    }
  }

  /**
   * Record a quiz result
   */
  async record({ guildId, userId, mode, score, total, chapter = null, createdAt = Date.now() }) {
    await this.ready;

    const percent = Math.round((score / total) * 100);
    this.data.results.push({
      guildId,
      userId, 
      mode, 
      score, 
      total, 
      percent, 
      chapter, 
      createdAt 
    });
    
    // Auto-save every 10 results or use debounced save
    if (this.data.results.length % 10 === 0) {
      this.save(); // Immediate save
    } else {
      this.saveDebounced(); // Debounced save
    }
  }

  /**
   * Get top scores
   */
  top({ guildId, mode = 'all', sinceMs = 0, minAttempts = 1, limit = 10 }) {
    const filtered = this.data.results.filter(r =>
      r.guildId === guildId &&
      (mode === 'all' || r.mode === mode) &&
      r.createdAt >= sinceMs
    );

    const agg = new Map();
    for (const r of filtered) {
      const s = agg.get(r.userId) || { attempts: 0, points: 0, max: 0 };
      s.attempts += 1;
      s.points += r.score;
      s.max += r.total;
      agg.set(r.userId, s);
    }

    return [...agg.entries()]
      .map(([userId, s]) => ({
        userId,
        attempts: s.attempts,
        points: s.points,
        max: s.max,
        percent: s.max > 0 ? Math.round((s.points / s.max) * 100) : 0
      }))
      .filter(r => r.attempts >= minAttempts)
      .sort((a, b) => b.percent - a.percent || b.points - a.points)
      .slice(0, limit);
  }

  /**
   * Get user statistics
   */
  userStats({ guildId, userId, sinceMs = 0 }) {
    const arr = this.data.results.filter(r =>
      r.guildId === guildId && r.userId === userId && r.createdAt >= sinceMs
    );
    
    if (arr.length === 0) {
      return { attempts: 0, points: 0, max: 0, percent: 0 };
    }
    
    const points = arr.reduce((s, r) => s + r.score, 0);
    const max = arr.reduce((s, r) => s + r.total, 0);
    
    return { 
      attempts: arr.length, 
      points, 
      max, 
      percent: max ? Math.round((points / max) * 100) : 0 
    };
  }

  /**
   * Get total statistics
   */
  getStats() {
    return {
      totalResults: this.data.results.length,
      uniqueUsers: new Set(this.data.results.map(r => r.userId)).size,
      uniqueGuilds: new Set(this.data.results.map(r => r.guildId)).size,
    };
  }
}