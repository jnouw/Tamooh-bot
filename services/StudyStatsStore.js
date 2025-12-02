import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Simple store for tracking study sessions
 * Schema: {
 *   userId,
 *   guildId,
 *   minutes,
 *   timestamp,
 *   valid (boolean) - whether session passed all checks,
 *   gamingMinutes (number) - time spent gaming during session,
 *   afkCheckPassed (boolean) - whether user responded to DM
 * }
 * Ticket Overrides: Map of "guildId:userId" -> ticket count
 */
export class StudyStatsStore {
  constructor(fileName = 'study_stats.json') {
    this.dir = join(__dirname, '../data');
    this.file = join(this.dir, fileName);
    this.data = {
      sessions: [],
      ticketOverrides: {} // { "guildId:userId": ticketCount }
    };
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

        // Backward compatibility: ensure ticketOverrides exists
        if (!this.data.ticketOverrides) {
          this.data.ticketOverrides = {};
        }

        // Migrate legacy sessions: set valid=true for sessions without the field
        let migratedCount = 0;
        for (const session of this.data.sessions) {
          if (session.valid === undefined) {
            session.valid = true;
            session.gamingMinutes = session.gamingMinutes || 0;
            session.afkCheckPassed = session.afkCheckPassed !== undefined ? session.afkCheckPassed : true;
            migratedCount++;
          }
        }

        if (migratedCount > 0) {
          console.log(`[StudyStats] Migrated ${migratedCount} legacy sessions to new format`);
          await this.save();
        }

        console.log(`[StudyStats] Loaded ${this.data.sessions.length} sessions`);
      }
    } catch (error) {
      console.error('[StudyStats] Failed to load:', error.message);
      this.data = { sessions: [], ticketOverrides: {} };
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
   * Check if a milestone was reached
   * Milestones: first session, 3h, 10h, 24h, 48h, 72h, 96h, etc.
   * @param {number} oldHours - Hours before this session
   * @param {number} newHours - Hours after this session
   * @param {number} oldSessions - Sessions before this session
   * @returns {{ type: string, value: number } | null} - Milestone info or null
   */
  checkMilestone(oldHours, newHours, oldSessions) {
    // First session milestone
    if (oldSessions === 0) {
      return { type: 'first_session', value: 1 };
    }

    // Hour milestones: 3, 10, 24, 48, 72, 96, etc. (every 24h after 24h)
    const hourMilestones = [3, 10, 24];

    // Add 24-hour increments starting from 48
    for (let h = 48; h <= Math.ceil(newHours); h += 24) {
      hourMilestones.push(h);
    }

    for (const milestone of hourMilestones) {
      if (oldHours < milestone && newHours >= milestone) {
        return { type: 'hours', value: milestone };
      }
    }

    return null;
  }

  /**
   * Record a completed study session
   * @param {string} userId - Discord user ID
   * @param {string} guildId - Discord guild ID
   * @param {number} minutes - Duration in minutes (typically 25)
   * @param {Object} options - Additional session data
   * @param {boolean} options.valid - Whether session is valid (default: false, set after validation)
   * @param {number} options.gamingMinutes - Minutes spent gaming (default: 0)
   * @param {boolean} options.afkCheckPassed - Whether user responded to DM (default: false)
   * @returns {Promise<{ milestone: { type: string, value: number } | null, sessionId: number }>}
   */
  async recordSession(userId, guildId, minutes, options = {}) {
    const {
      valid = false,
      gamingMinutes = 0,
      afkCheckPassed = false
    } = options;

    // Get old stats
    const oldStats = this.getUserStats(userId, guildId);

    // Record session
    const session = {
      userId,
      guildId,
      minutes,
      timestamp: Date.now(),
      valid,
      gamingMinutes,
      afkCheckPassed
    };

    this.data.sessions.push(session);
    const sessionId = this.data.sessions.length - 1;

    // Get new stats (only counts valid sessions)
    const newStats = this.getUserStats(userId, guildId);

    // Check for milestone (only if session is valid)
    const milestone = valid
      ? this.checkMilestone(oldStats.totalHours, newStats.totalHours, oldStats.totalSessions)
      : null;

    await this.save();

    return { milestone, sessionId };
  }

  /**
   * Update session validity after AFK check
   * @param {number} sessionId - Session index in array
   * @param {boolean} afkCheckPassed - Whether user responded to DM
   * @returns {Promise<{ session: object | null, milestone: { type: string, value: number } | null }>}
   */
  async updateSessionValidity(sessionId, afkCheckPassed) {
    if (sessionId >= 0 && sessionId < this.data.sessions.length) {
      const session = this.data.sessions[sessionId];

      // Get stats before validation
      const oldStats = this.getUserStats(session.userId, session.guildId);

      session.afkCheckPassed = afkCheckPassed;

      // Session is valid only if:
      // 1. AFK check passed (user responded to DM)
      // 2. No gaming detected (gamingMinutes === 0)
      const wasValid = session.valid;
      session.valid = afkCheckPassed && session.gamingMinutes === 0;

      // Check for milestone only if session just became valid
      let milestone = null;
      if (!wasValid && session.valid) {
        const newStats = this.getUserStats(session.userId, session.guildId);
        milestone = this.checkMilestone(oldStats.totalHours, newStats.totalHours, oldStats.totalSessions);
      }

      await this.save();
      return { session, milestone };
    }
    return { session: null, milestone: null };
  }

  /**
   * Get user stats (total sessions, total minutes) - only counts VALID sessions
   * @param {string} userId - Discord user ID
   * @param {string} guildId - Discord guild ID
   * @returns {{ totalSessions: number, totalMinutes: number, totalHours: number }}
   */
  getUserStats(userId, guildId) {
    const userSessions = this.data.sessions.filter(
      s => s.userId === userId && s.guildId === guildId && s.valid === true
    );

    const totalSessions = userSessions.length;
    const totalMinutes = userSessions.reduce((sum, s) => sum + s.minutes, 0);
    const totalHours = Math.round(totalMinutes / 60 * 10) / 10; // One decimal

    return { totalSessions, totalMinutes, totalHours };
  }

  /**
   * Get leaderboard (top users by total minutes) - only counts VALID sessions
   * @param {string} guildId - Discord guild ID
   * @param {number} limit - Max number of users to return (default 10)
   * @returns {Array<{userId: string, totalMinutes: number, totalHours: number, totalSessions: number}>}
   */
  getLeaderboard(guildId, limit = 10) {
    // Group by userId (only valid sessions)
    const userMap = new Map();

    this.data.sessions
      .filter(s => s.guildId === guildId && s.valid === true)
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

  /**
   * Set ticket override for a user (bypasses hour-based calculation)
   * @param {string} userId - Discord user ID
   * @param {string} guildId - Discord guild ID
   * @param {number} tickets - Number of tickets (0 to remove override)
   */
  async setTicketOverride(userId, guildId, tickets) {
    const key = `${guildId}:${userId}`;

    if (tickets === 0) {
      delete this.data.ticketOverrides[key];
    } else {
      this.data.ticketOverrides[key] = tickets;
    }

    await this.save();
  }

  /**
   * Get ticket override for a user (returns null if no override)
   * @param {string} userId - Discord user ID
   * @param {string} guildId - Discord guild ID
   * @returns {number|null} - Ticket count or null if using hour-based calculation
   */
  getTicketOverride(userId, guildId) {
    const key = `${guildId}:${userId}`;
    return this.data.ticketOverrides[key] !== undefined ? this.data.ticketOverrides[key] : null;
  }

  /**
   * Get all ticket overrides for a guild
   * @param {string} guildId - Discord guild ID
   * @returns {Map<string, number>} - Map of userId -> ticket count
   */
  getGuildTicketOverrides(guildId) {
    const overrides = new Map();

    for (const [key, tickets] of Object.entries(this.data.ticketOverrides)) {
      const [keyGuildId, userId] = key.split(':');
      if (keyGuildId === guildId) {
        overrides.set(userId, tickets);
      }
    }

    return overrides;
  }
}

// Export singleton instance
export const studyStatsStore = new StudyStatsStore();
