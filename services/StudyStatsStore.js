import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Simple store for tracking study sessions
 * Schema: { userId, guildId, minutes, timestamp }
 */
export class StudyStatsStore {
  constructor(fileName = 'study_stats.json') {
    this.dir = join(__dirname, '../data');
    this.file = join(this.dir, fileName);
    this.data = { sessions: [] };
    this.saveQueue = Promise.resolve();
    this.pendingSave = false;

    this.init();
  }

  async init() {
    try {
      await mkdir(this.dir, { recursive: true });
      await this.load();
    } catch (error) {
      console.error('[StudyStats] Failed to initialize:', error.message);
    }
  }

  async load() {
    try {
      if (existsSync(this.file)) {
        const raw = await readFile(this.file, 'utf8');
        this.data = JSON.parse(raw);
        console.log(`[StudyStats] Loaded ${this.data.sessions.length} sessions`);
      }
    } catch (error) {
      console.error('[StudyStats] Failed to load:', error.message);
      this.data = { sessions: [] };
    }
  }

  async save() {
    this.saveQueue = this.saveQueue.then(async () => {
      try {
        const data = JSON.stringify(this.data, null, 2);
        await writeFile(this.file, data, 'utf8');
        this.pendingSave = false;
      } catch (error) {
        console.error('[StudyStats] Failed to save:', error.message);
      }
    });
    return this.saveQueue;
  }

  /**
   * Record a completed study session
   * @param {string} userId - Discord user ID
   * @param {string} guildId - Discord guild ID
   * @param {number} minutes - Duration in minutes (typically 25)
   */
  async recordSession(userId, guildId, minutes) {
    this.data.sessions.push({
      userId,
      guildId,
      minutes,
      timestamp: Date.now()
    });
    await this.save();
  }

  /**
   * Get user stats (total sessions, total minutes)
   * @param {string} userId - Discord user ID
   * @param {string} guildId - Discord guild ID
   * @returns {{ totalSessions: number, totalMinutes: number, totalHours: number }}
   */
  getUserStats(userId, guildId) {
    const userSessions = this.data.sessions.filter(
      s => s.userId === userId && s.guildId === guildId
    );

    const totalSessions = userSessions.length;
    const totalMinutes = userSessions.reduce((sum, s) => sum + s.minutes, 0);
    const totalHours = Math.round(totalMinutes / 60 * 10) / 10; // One decimal

    return { totalSessions, totalMinutes, totalHours };
  }

  /**
   * Get leaderboard (top users by total minutes)
   * @param {string} guildId - Discord guild ID
   * @param {number} limit - Max number of users to return (default 10)
   * @returns {Array<{userId: string, totalMinutes: number, totalHours: number, totalSessions: number}>}
   */
  getLeaderboard(guildId, limit = 10) {
    // Group by userId
    const userMap = new Map();

    this.data.sessions
      .filter(s => s.guildId === guildId)
      .forEach(s => {
        const current = userMap.get(s.userId) || { totalMinutes: 0, totalSessions: 0 };
        current.totalMinutes += s.minutes;
        current.totalSessions += 1;
        userMap.set(s.userId, current);
      });

    // Convert to array and sort
    const leaderboard = Array.from(userMap.entries())
      .map(([userId, stats]) => ({
        userId,
        totalMinutes: stats.totalMinutes,
        totalHours: Math.round(stats.totalMinutes / 60 * 10) / 10,
        totalSessions: stats.totalSessions
      }))
      .sort((a, b) => b.totalMinutes - a.totalMinutes)
      .slice(0, limit);

    return leaderboard;
  }
}

// Export singleton instance
export const studyStatsStore = new StudyStatsStore();
