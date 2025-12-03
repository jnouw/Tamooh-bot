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
 * Giveaway Periods: Map of "guildId" -> period start timestamp
 * Giveaway Wins: Array of { userId, guildId, timestamp, prizeName }
 */
export class StudyStatsStore {
  constructor(fileName = 'study_stats.json') {
    this.dir = join(__dirname, '../data');
    this.file = join(this.dir, fileName);
    this.data = {
      sessions: [],
      giveawayPeriods: {}, // { "guildId": timestamp }
      giveawayWins: [] // [{ userId, guildId, timestamp, prizeName }]
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

        // Backward compatibility: ensure giveawayPeriods and giveawayWins exist
        if (!this.data.giveawayPeriods) {
          this.data.giveawayPeriods = {};
        }
        if (!this.data.giveawayWins) {
          this.data.giveawayWins = [];
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
      this.data = { sessions: [], giveawayPeriods: {}, giveawayWins: [] };
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
      ? this.checkMilestone(oldStats.lifetimeHours, newStats.lifetimeHours, oldStats.totalSessions)
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
        milestone = this.checkMilestone(oldStats.lifetimeHours, newStats.lifetimeHours, oldStats.totalSessions);
      }

      await this.save();
      return { session, milestone };
    }
    return { session: null, milestone: null };
  }

  /**
   * Get user stats with lifetime and current period hours
   * @param {string} userId - Discord user ID
   * @param {string} guildId - Discord guild ID
   * @returns {{ totalSessions: number, totalMinutes: number, lifetimeHours: number, currentPeriodHours: number }}
   */
  getUserStats(userId, guildId) {
    const periodStart = this.data.giveawayPeriods[guildId] || 0;

    const userSessions = this.data.sessions.filter(
      s => s.userId === userId && s.guildId === guildId && s.valid === true
    );

    const totalSessions = userSessions.length;
    const totalMinutes = userSessions.reduce((sum, s) => sum + s.minutes, 0);
    const lifetimeHours = Math.round(totalMinutes / 60 * 10) / 10; // One decimal

    // Current period: sessions after the period start timestamp
    const currentPeriodMinutes = userSessions
      .filter(s => s.timestamp >= periodStart)
      .reduce((sum, s) => sum + s.minutes, 0);
    const currentPeriodHours = Math.round(currentPeriodMinutes / 60 * 10) / 10;

    return { totalSessions, totalMinutes, lifetimeHours, currentPeriodHours };
  }

  /**
   * Get leaderboard with lifetime and current period hours
   * @param {string} guildId - Discord guild ID
   * @param {number} limit - Max number of users to return (default 10)
   * @returns {Array<{userId: string, totalMinutes: number, lifetimeHours: number, currentPeriodHours: number, totalSessions: number}>}
   */
  getLeaderboard(guildId, limit = 10) {
    const periodStart = this.data.giveawayPeriods[guildId] || 0;

    // Group by userId (only valid sessions)
    const userMap = new Map();

    this.data.sessions
      .filter(s => s.guildId === guildId && s.valid === true)
      .forEach(s => {
        const current = userMap.get(s.userId) || {
          totalMinutes: 0,
          currentPeriodMinutes: 0,
          totalSessions: 0
        };
        current.totalMinutes += s.minutes;
        current.totalSessions += 1;

        // Add to current period if session is after period start
        if (s.timestamp >= periodStart) {
          current.currentPeriodMinutes += s.minutes;
        }

        userMap.set(s.userId, current);
      });

    // Convert to array and sort by CURRENT PERIOD first, then LIFETIME as tiebreaker
    const leaderboard = Array.from(userMap.entries())
      .map(([userId, stats]) => ({
        userId,
        totalMinutes: stats.totalMinutes,
        lifetimeHours: Math.round(stats.totalMinutes / 60 * 10) / 10,
        currentPeriodHours: Math.round(stats.currentPeriodMinutes / 60 * 10) / 10,
        totalSessions: stats.totalSessions
      }))
      .sort((a, b) => {
        // Primary sort: current period hours (descending)
        if (b.currentPeriodHours !== a.currentPeriodHours) {
          return b.currentPeriodHours - a.currentPeriodHours;
        }
        // Secondary sort: lifetime hours (descending)
        return b.lifetimeHours - a.lifetimeHours;
      })
      .slice(0, limit);

    return leaderboard;
  }

  /**
   * Reset giveaway period for a guild (soft reset for fair competition)
   * This resets current period hours to 0 but keeps lifetime hours forever
   * @param {string} guildId - Discord guild ID
   * @returns {Promise<{ usersAffected: number, periodStartDate: string }>}
   */
  async resetGiveawayPeriod(guildId) {
    const now = Date.now();
    this.data.giveawayPeriods[guildId] = now;

    // Count unique users who had sessions
    const usersAffected = new Set(
      this.data.sessions
        .filter(s => s.guildId === guildId && s.valid === true)
        .map(s => s.userId)
    ).size;

    await this.save();

    return {
      usersAffected,
      periodStartDate: new Date(now).toISOString()
    };
  }

  /**
   * Get current giveaway period start time
   * @param {string} guildId - Discord guild ID
   * @returns {number} - Timestamp of period start (0 if never reset)
   */
  getGiveawayPeriodStart(guildId) {
    return this.data.giveawayPeriods[guildId] || 0;
  }

  /**
   * Calculate tickets using period-based formula
   * Formula: 30 + Math.round(√lifetimeHours × 5) + Math.round(currentPeriodHours × 3)
   * @param {number} lifetimeHours - Total lifetime study hours
   * @param {number} currentPeriodHours - Hours studied in current giveaway period
   * @returns {number} - Calculated ticket count
   */
  calculateTickets(lifetimeHours, currentPeriodHours) {
    const baseline = 30;
    const lifetimeBonus = Math.round(Math.sqrt(lifetimeHours) * 5);
    const currentPeriodBonus = Math.round(currentPeriodHours * 3);

    return baseline + lifetimeBonus + currentPeriodBonus;
  }

  /**
   * Get violation statistics for users (AFK and gaming)
   * @param {string} guildId - Discord guild ID
   * @returns {Array<{userId: string, totalSessions: number, invalidSessions: number, afkViolations: number, gamingViolations: number, validSessions: number}>}
   */
  getViolationStats(guildId) {
    // Group by userId
    const userMap = new Map();

    this.data.sessions
      .filter(s => s.guildId === guildId)
      .forEach(s => {
        const current = userMap.get(s.userId) || {
          totalSessions: 0,
          validSessions: 0,
          invalidSessions: 0,
          afkViolations: 0,
          gamingViolations: 0
        };

        current.totalSessions += 1;

        if (s.valid) {
          current.validSessions += 1;
        } else {
          current.invalidSessions += 1;

          // Count violation types
          if (!s.afkCheckPassed) {
            current.afkViolations += 1;
          }
          if (s.gamingMinutes > 0) {
            current.gamingViolations += 1;
          }
        }

        userMap.set(s.userId, current);
      });

    // Convert to array and filter users with violations
    return Array.from(userMap.entries())
      .map(([userId, stats]) => ({
        userId,
        ...stats
      }))
      .filter(u => u.invalidSessions > 0)
      .sort((a, b) => b.invalidSessions - a.invalidSessions);
  }

  /**
   * Record a giveaway win
   * @param {string} userId - Discord user ID
   * @param {string} guildId - Discord guild ID
   * @param {string} prizeName - Name of the prize won
   * @returns {Promise<void>}
   */
  async recordWin(userId, guildId, prizeName) {
    this.data.giveawayWins.push({
      userId,
      guildId,
      timestamp: Date.now(),
      prizeName
    });
    await this.save();
  }

  /**
   * Get user's giveaway win statistics
   * @param {string} userId - Discord user ID
   * @param {string} guildId - Discord guild ID
   * @returns {{ totalWins: number, recentWins: Array, winRate: number, totalGiveaways: number }}
   */
  getUserWinStats(userId, guildId) {
    const userWins = this.data.giveawayWins.filter(
      w => w.userId === userId && w.guildId === guildId
    );

    // Get total number of unique giveaways in this guild
    const totalGiveaways = new Set(
      this.data.giveawayWins
        .filter(w => w.guildId === guildId)
        .map(w => w.timestamp)
    ).size;

    // Calculate win rate: if user has tickets (lifetime hours > 0), they participate
    // Win rate = (wins / total giveaways) × 100
    // Show 0 if no giveaways yet, otherwise show real percentage
    const winRate = totalGiveaways > 0 ? (userWins.length / totalGiveaways) * 100 : 0;

    return {
      totalWins: userWins.length,
      recentWins: userWins.slice(-5).reverse(), // Last 5 wins, most recent first
      winRate: Math.round(winRate * 100) / 100, // Two decimal places
      totalGiveaways
    };
  }

  /**
   * Get user's ranking in the guild
   * @param {string} userId - Discord user ID
   * @param {string} guildId - Discord guild ID
   * @returns {{ rank: number, totalUsers: number, percentile: number }}
   */
  getUserRanking(userId, guildId) {
    const leaderboard = this.getLeaderboard(guildId, 9999); // Get all users
    const userIndex = leaderboard.findIndex(u => u.userId === userId);

    const rank = userIndex === -1 ? leaderboard.length + 1 : userIndex + 1;
    const totalUsers = leaderboard.length || 1;
    const percentile = Math.round(((totalUsers - rank + 1) / totalUsers) * 100);

    return {
      rank,
      totalUsers,
      percentile
    };
  }

  /**
   * Get guild-wide statistics
   * @param {string} guildId - Discord guild ID
   * @returns {{ averageHours: number, averagePeriodHours: number, totalUsers: number, topHours: number }}
   */
  getGuildStats(guildId) {
    const leaderboard = this.getLeaderboard(guildId, 9999); // Get all users

    if (leaderboard.length === 0) {
      return { averageHours: 0, averagePeriodHours: 0, totalUsers: 0, topHours: 0 };
    }

    const totalLifetimeHours = leaderboard.reduce((sum, u) => sum + u.lifetimeHours, 0);
    const totalPeriodHours = leaderboard.reduce((sum, u) => sum + u.currentPeriodHours, 0);
    const averageHours = Math.round((totalLifetimeHours / leaderboard.length) * 10) / 10;
    const averagePeriodHours = Math.round((totalPeriodHours / leaderboard.length) * 10) / 10;
    const topHours = leaderboard[0]?.lifetimeHours || 0;

    return {
      averageHours,
      averagePeriodHours,
      totalUsers: leaderboard.length,
      topHours
    };
  }

  /**
   * Get study streak (consecutive days with valid sessions)
   * @param {string} userId - Discord user ID
   * @param {string} guildId - Discord guild ID
   * @returns {{ currentStreak: number, longestStreak: number, lastStudyDate: string | null }}
   */
  getStudyStreak(userId, guildId) {
    const userSessions = this.data.sessions
      .filter(s => s.userId === userId && s.guildId === guildId && s.valid === true)
      .sort((a, b) => a.timestamp - b.timestamp);

    if (userSessions.length === 0) {
      return { currentStreak: 0, longestStreak: 0, lastStudyDate: null };
    }

    // Get unique days with sessions
    const sessionDays = userSessions.map(s => {
      const date = new Date(s.timestamp);
      return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    });
    const uniqueDays = [...new Set(sessionDays)].sort((a, b) => a - b);

    if (uniqueDays.length === 0) {
      return { currentStreak: 0, longestStreak: 0, lastStudyDate: null };
    }

    // Calculate current streak (working backwards from today)
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const oneDayMs = 24 * 60 * 60 * 1000;

    let currentStreak = 0;
    let checkDate = todayStart;

    for (let i = uniqueDays.length - 1; i >= 0; i--) {
      if (uniqueDays[i] === checkDate) {
        currentStreak++;
        checkDate -= oneDayMs;
      } else if (uniqueDays[i] < checkDate - oneDayMs) {
        // Gap found, stop counting current streak
        break;
      }
    }

    // Calculate longest streak
    let longestStreak = 1;
    let tempStreak = 1;

    for (let i = 1; i < uniqueDays.length; i++) {
      if (uniqueDays[i] - uniqueDays[i - 1] === oneDayMs) {
        tempStreak++;
        longestStreak = Math.max(longestStreak, tempStreak);
      } else {
        tempStreak = 1;
      }
    }

    const lastStudyDate = new Date(uniqueDays[uniqueDays.length - 1]).toLocaleDateString();

    return {
      currentStreak,
      longestStreak,
      lastStudyDate
    };
  }
}

// Export singleton instance
export const studyStatsStore = new StudyStatsStore();
