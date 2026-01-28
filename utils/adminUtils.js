import { OWNER_ID, QIMAH_TEAM_ROLE_ID } from "../services/study/config.js";

/**
 * Check if user is admin, owner, or has Qimah team role
 * Works with both message objects and interaction objects
 * @param {Object} context - Either { author, member } or { user, member }
 */
export function isAdmin(context) {
  const userId = context.author?.id || context.user?.id;
  const member = context.member;

  return (
    userId === OWNER_ID ||
    member?.permissions?.has("Administrator") ||
    member?.roles?.cache?.has(QIMAH_TEAM_ROLE_ID)
  );
}

/**
 * Create a visual progress bar
 * @param {number} current - Current value
 * @param {number} max - Maximum value
 * @param {number} length - Bar length in characters
 */
export function createProgressBar(current, max, length = 10) {
  const filledLength = Math.min(Math.round((current / max) * length), length);
  const emptyLength = length - filledLength;
  return "█".repeat(filledLength) + "░".repeat(emptyLength);
}

/**
 * Format hour number as 12-hour time string
 * @param {number|string} h - Hour (0-23)
 */
export function formatHour(h) {
  const hour = parseInt(h);
  if (hour === 0) return "12 AM";
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return "12 PM";
  return `${hour - 12} PM`;
}

/**
 * Get rank emoji and color based on ranking
 * @param {Object} ranking - User ranking object with rank and percentile
 */
export function getRankStyle(ranking) {
  let rankEmoji = "📊";
  let embedColor = 0x5865F2;

  if (ranking.rank === 1) {
    rankEmoji = "👑";
    embedColor = 0xFFD700;
  } else if (ranking.rank === 2) {
    rankEmoji = "🥈";
    embedColor = 0xC0C0C0;
  } else if (ranking.rank === 3) {
    rankEmoji = "🥉";
    embedColor = 0xCD7F32;
  } else if (ranking.percentile >= 90) {
    rankEmoji = "⭐";
    embedColor = 0x9B59B6;
  } else if (ranking.percentile >= 75) {
    rankEmoji = "🔥";
    embedColor = 0xE67E22;
  }

  return { rankEmoji, embedColor };
}

/**
 * Get competitive description based on ranking
 * @param {Object} ranking - User ranking object
 * @param {string} rankEmoji - Emoji for rank
 */
export function getCompetitiveDescription(ranking, rankEmoji) {
  let description = `${rankEmoji} **Rank #${ranking.rank}** out of ${ranking.totalUsers} (Top ${ranking.percentile}%)\n`;

  if (ranking.rank === 1) {
    description += "🏆 **You're dominating the leaderboard!**";
  } else if (ranking.percentile >= 90) {
    description += "⚡ **You're in the elite top 10%!**";
  } else if (ranking.percentile >= 75) {
    description += "💪 **Strong performance! Keep climbing!**";
  } else if (ranking.percentile >= 50) {
    description += "📈 **You're above average! Push harder!**";
  } else {
    description += "🎯 **Time to grind and climb the ranks!**";
  }

  return description;
}

/**
 * Get footer text based on user stats
 */
export function getCompetitiveFooter(ranking, winningChances, stats, hoursToNext, streak) {
  if (ranking.rank === 1) {
    return "👑 Defend your throne! Stay consistent!";
  } else if (winningChances.winChance >= 20) {
    return `🎰 ${winningChances.winChance}% chance to win! You're in a great position!`;
  } else if (ranking.rank <= 3) {
    return "🔥 So close to the top! Keep pushing!";
  } else if (ranking.percentile >= 75) {
    return "⚡ You're in the top tier! Don't stop now!";
  } else if (winningChances.winChance < 5 && stats.currentPeriodHours < 10) {
    return `📈 Study more to boost your ${winningChances.winChance}% odds!`;
  } else if (hoursToNext <= 5) {
    return `🎯 Just ${hoursToNext.toFixed(1)}h until your next milestone!`;
  } else if (streak.currentStreak >= 3) {
    return `🔥 ${streak.currentStreak}-day streak! Don't break it!`;
  }
  return "💪 Every hour counts. Start studying now!";
}

/**
 * Hour milestones for tracking progress
 */
export const HOUR_MILESTONES = [3, 10, 24, 48, 72, 96, 120, 168, 240, 336, 500, 1000];

/**
 * Get next milestone for a given hours count
 * @param {number} currentHours - Current lifetime hours
 */
export function getNextMilestone(currentHours) {
  return HOUR_MILESTONES.find(m => m > currentHours) ||
    (Math.ceil(currentHours / 100) * 100 + 100);
}
