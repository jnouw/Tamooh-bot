import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Stores how much time each user has spent in study voice channels.
 * Data shape: {
 *   time: { "guildId": { "userId": { weeklyMinutes, lifetimeMinutes } } },
 *   periodStart: { "guildId": timestamp }
 * }
 */
export class VoiceTimeStore {
  constructor(fileName = 'voice_time.json') {
    this.dir = join(__dirname, '../data');
    this.file = join(this.dir, fileName);
    this.data = { time: {}, periodStart: {} };
    this.saveQueue = Promise.resolve();
    this.init();
  }

  async init() {
    try {
      await mkdir(this.dir, { recursive: true });
      await this.load();
    } catch (error) {
      console.error('[VoiceTime] Failed to initialize:', error.message);
    }
  }

  async load() {
    try {
      if (existsSync(this.file)) {
        const raw = await readFile(this.file, 'utf8');
        this.data = JSON.parse(raw);
        if (!this.data.time) this.data.time = {};
        if (!this.data.periodStart) this.data.periodStart = {};
        console.log('[VoiceTime] Loaded voice time data');
      }
    } catch (error) {
      console.error('[VoiceTime] Failed to load:', error.message);
      this.data = { time: {}, periodStart: {} };
    }
  }

  async save() {
    this.saveQueue = this.saveQueue.then(async () => {
      try {
        await writeFile(this.file, JSON.stringify(this.data, null, 2), 'utf8');
      } catch (error) {
        console.error('[VoiceTime] Failed to save:', error.message);
      }
    });
    return this.saveQueue;
  }

  /**
   * Add voice time for a user (called when they leave a study channel)
   * @param {string} userId
   * @param {string} guildId
   * @param {number} minutes
   */
  addTime(userId, guildId, minutes) {
    if (minutes <= 0) return;
    if (!this.data.time[guildId]) this.data.time[guildId] = {};
    if (!this.data.time[guildId][userId]) {
      this.data.time[guildId][userId] = { weeklyMinutes: 0, lifetimeMinutes: 0 };
    }
    this.data.time[guildId][userId].weeklyMinutes += minutes;
    this.data.time[guildId][userId].lifetimeMinutes += minutes;
    this.save();
  }

  /**
   * Get a single user's time
   */
  getUserTime(userId, guildId) {
    const entry = this.data.time[guildId]?.[userId];
    if (!entry) return { weeklyMinutes: 0, lifetimeMinutes: 0, weeklyHours: 0, lifetimeHours: 0 };
    return {
      weeklyMinutes: entry.weeklyMinutes,
      lifetimeMinutes: entry.lifetimeMinutes,
      weeklyHours: Math.round(entry.weeklyMinutes / 60 * 10) / 10,
      lifetimeHours: Math.round(entry.lifetimeMinutes / 60 * 10) / 10,
    };
  }

  /**
   * Get top users sorted by weekly minutes
   */
  getLeaderboard(guildId, limit = 10) {
    const guildData = this.data.time[guildId] || {};
    return Object.entries(guildData)
      .map(([userId, entry]) => ({
        userId,
        weeklyMinutes: entry.weeklyMinutes,
        lifetimeMinutes: entry.lifetimeMinutes,
        weeklyHours: Math.round(entry.weeklyMinutes / 60 * 10) / 10,
        lifetimeHours: Math.round(entry.lifetimeMinutes / 60 * 10) / 10,
      }))
      .filter(u => u.weeklyMinutes > 0)
      .sort((a, b) => b.weeklyMinutes - a.weeklyMinutes)
      .slice(0, limit);
  }

  /**
   * Get the top user this week (used for winner announcement)
   */
  getWinner(guildId) {
    return this.getLeaderboard(guildId, 1)[0] || null;
  }

  /**
   * Reset weekly minutes for all users in a guild
   */
  async resetPeriod(guildId) {
    const guildData = this.data.time[guildId];
    if (guildData) {
      for (const userId of Object.keys(guildData)) {
        guildData[userId].weeklyMinutes = 0;
      }
    }
    this.data.periodStart[guildId] = Date.now();
    await this.save();
  }

  getPeriodStart(guildId) {
    return this.data.periodStart[guildId] || 0;
  }
}
