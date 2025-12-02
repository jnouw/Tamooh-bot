import Discord from "discord.js";

const { ActivityType } = Discord;

/**
 * Activity tracker for monitoring user presence during study sessions
 * Tracks gaming time (ActivityType.Playing = 0) for each user
 */
class ActivityTracker {
  constructor() {
    // Map of voiceChannelId -> Map of userId -> { gamingStartTime, totalGamingMs }
    this.sessionActivities = new Map();

    // Map of voiceChannelId -> session start time
    this.sessionStartTimes = new Map();
  }

  /**
   * Start tracking activities for a session
   * @param {string} voiceChannelId - Voice channel ID
   * @param {Array<string>} userIds - User IDs to track
   */
  startTracking(voiceChannelId, userIds) {
    const userActivityMap = new Map();

    for (const userId of userIds) {
      userActivityMap.set(userId, {
        gamingStartTime: null,
        totalGamingMs: 0
      });
    }

    this.sessionActivities.set(voiceChannelId, userActivityMap);
    this.sessionStartTimes.set(voiceChannelId, Date.now());

    console.log(`[ActivityTracker] Started tracking ${userIds.length} users in VC ${voiceChannelId}`);
  }

  /**
   * Update user activity based on their Discord presence
   * @param {string} voiceChannelId - Voice channel ID
   * @param {string} userId - User ID
   * @param {Discord.GuildMember} member - Guild member object (for checking presence)
   */
  updateActivity(voiceChannelId, userId, member) {
    const sessionData = this.sessionActivities.get(voiceChannelId);
    if (!sessionData) return;

    const userData = sessionData.get(userId);
    if (!userData) return;

    // Check if user is currently playing a game (ActivityType.Playing = 0)
    const isGaming = member.presence?.activities.some(
      activity => activity.type === ActivityType.Playing
    ) || false;

    const now = Date.now();

    if (isGaming && userData.gamingStartTime === null) {
      // User just started gaming
      userData.gamingStartTime = now;
      console.log(`[ActivityTracker] ${member.user.username} started gaming in VC ${voiceChannelId}`);
    } else if (!isGaming && userData.gamingStartTime !== null) {
      // User stopped gaming, add to total
      const gamingDuration = now - userData.gamingStartTime;
      userData.totalGamingMs += gamingDuration;
      userData.gamingStartTime = null;
      console.log(`[ActivityTracker] ${member.user.username} stopped gaming (session total: ${Math.round(userData.totalGamingMs / 60000)} min)`);
    }
  }

  /**
   * Finalize tracking and get gaming time for all users
   * @param {string} voiceChannelId - Voice channel ID
   * @returns {Map<string, number>} Map of userId -> gaming minutes
   */
  finalizeTracking(voiceChannelId) {
    const sessionData = this.sessionActivities.get(voiceChannelId);
    if (!sessionData) return new Map();

    const now = Date.now();
    const gamingTimes = new Map();

    for (const [userId, userData] of sessionData.entries()) {
      // If user is still gaming, finalize that time
      if (userData.gamingStartTime !== null) {
        const gamingDuration = now - userData.gamingStartTime;
        userData.totalGamingMs += gamingDuration;
        userData.gamingStartTime = null;
      }

      // Convert to minutes
      const gamingMinutes = Math.round(userData.totalGamingMs / 60000);
      gamingTimes.set(userId, gamingMinutes);

      if (gamingMinutes > 0) {
        console.log(`[ActivityTracker] User ${userId} gamed for ${gamingMinutes} minutes in VC ${voiceChannelId}`);
      }
    }

    // Clean up
    this.sessionActivities.delete(voiceChannelId);
    this.sessionStartTimes.delete(voiceChannelId);

    return gamingTimes;
  }

  /**
   * Check all users in a voice channel and update their activities
   * @param {Discord.Client} client - Discord client
   * @param {string} voiceChannelId - Voice channel ID
   * @param {string} guildId - Guild ID
   */
  async checkAllUsers(client, voiceChannelId, guildId) {
    const sessionData = this.sessionActivities.get(voiceChannelId);
    if (!sessionData) return;

    try {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return;

      const vc = guild.channels.cache.get(voiceChannelId);
      if (!vc) return;

      for (const [userId, member] of vc.members) {
        if (!member.user.bot) {
          this.updateActivity(voiceChannelId, userId, member);
        }
      }
    } catch (error) {
      console.error(`[ActivityTracker] Error checking users in VC ${voiceChannelId}:`, error.message);
    }
  }

  /**
   * Stop tracking for a session (cleanup)
   * @param {string} voiceChannelId - Voice channel ID
   */
  stopTracking(voiceChannelId) {
    this.sessionActivities.delete(voiceChannelId);
    this.sessionStartTimes.delete(voiceChannelId);
    console.log(`[ActivityTracker] Stopped tracking VC ${voiceChannelId}`);
  }
}

// Export singleton instance
export const activityTracker = new ActivityTracker();
