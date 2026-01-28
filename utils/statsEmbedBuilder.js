import Discord from "discord.js";
import {
  createProgressBar,
  formatHour,
  getRankStyle,
  getCompetitiveDescription,
  getCompetitiveFooter,
  getNextMilestone
} from "./adminUtils.js";

const { EmbedBuilder } = Discord;

/**
 * Build the user stats embed (Competitive Study Profile)
 * @param {Object} data - All the data needed for the embed
 */
export function buildUserStatsEmbed(data) {
  const {
    stats,
    ranking,
    guildStats,
    streak,
    tickets,
    insights,
    winningChances,
    validationRate,
    avgSessionLength
  } = data;

  const { rankEmoji, embedColor } = getRankStyle(ranking);
  const description = getCompetitiveDescription(ranking, rankEmoji);

  // Calculate gap to leader
  const gapToLeader = guildStats.topHours - stats.lifetimeHours;
  const gapText = gapToLeader > 0
    ? `${gapToLeader.toFixed(1)}h behind #1`
    : "You're #1! 🎉";

  // Calculate comparison to average
  const vsAverage = stats.lifetimeHours - guildStats.averageHours;
  const vsAverageText = vsAverage >= 0
    ? `+${vsAverage.toFixed(1)}h above average`
    : `${Math.abs(vsAverage).toFixed(1)}h below average`;

  // Determine next milestone
  const nextMilestone = getNextMilestone(stats.lifetimeHours);
  const hoursToNext = nextMilestone - stats.lifetimeHours;
  const milestoneBar = createProgressBar(stats.lifetimeHours, nextMilestone, 12);

  // Build embed
  const embed = new EmbedBuilder()
    .setTitle("💎 Your Competitive Study Profile")
    .setColor(embedColor)
    .setDescription(description)
    .addFields(
      { name: "🏅 Server Standing", value: `Rank: **#${ranking.rank}** / ${ranking.totalUsers} (Top ${ranking.percentile}%)\n${gapText}`, inline: false },
      { name: "📚 Study Performance", value: `Lifetime: **${stats.lifetimeHours}h** (${vsAverageText})\nSessions: ${stats.totalSessions} | Avg: ${avgSessionLength}h`, inline: true },
      { name: "⚔️ Current Competition", value: `Period Hours: **${stats.currentPeriodHours}h**\nTickets: 🎫 **${tickets}** | Success: ${validationRate}`, inline: true },
      { name: "🎰 Next Giveaway Odds", value: `Win Chance: **${winningChances.winChance}%**\nYour Share: ${tickets}/${winningChances.totalTickets} tickets`, inline: false },
      { name: "🎯 Next Milestone", value: `Goal: **${nextMilestone}h**\n${milestoneBar} ${hoursToNext.toFixed(1)}h to go!`, inline: false }
    );

  // Add streak section if user has any sessions
  if (stats.totalSessions > 0) {
    const streakEmoji = streak.currentStreak >= 7 ? "🔥" : streak.currentStreak >= 3 ? "⚡" : "📅";
    let streakText = `Current: **${streak.currentStreak} days** ${streakEmoji} | Best: **${streak.longestStreak} days**\n`;
    streakText += `Last Study: ${streak.lastStudyDate || "N/A"}`;
    if (streak.currentStreak === 0 && streak.longestStreak > 0) {
      streakText += "\n💔 Streak lost! Start a new one today!";
    }

    embed.addFields({
      name: "🔥 Study Streak",
      value: streakText,
      inline: false
    });
  }

  // Smart Insights (only if user has sessions)
  if (stats.totalSessions > 0 && insights) {
    const insightsText =
      `💡 You study best on ${insights.bestDay}!\n` +
      `💡 Most productive: ${insights.mostProductiveTime}\n` +
      `💡 Avg ${insights.avgSessionLength}h sessions\n` +
      `💡 Longest session: ${insights.longestSession}hrs`;

    embed.addFields({
      name: "💡 Smart Insights",
      value: insightsText,
      inline: false
    });
  }

  // Competitive footer message
  const footerText = getCompetitiveFooter(ranking, winningChances, stats, hoursToNext, streak);
  embed.setFooter({ text: footerText }).setTimestamp();

  return embed;
}

/**
 * Build the server insights embed
 * @param {Object} insights - Server insights data from studyStatsStore.getServerInsights()
 */
export function buildServerInsightsEmbed(insights) {
  // Format total hours as days + hours
  const days = Math.floor(insights.totalHours / 24);
  const hours = Math.round((insights.totalHours % 24) * 10) / 10;

  // Build the embed
  const embed = new EmbedBuilder()
    .setTitle("🌟 Server Study Insights")
    .setColor(0x5865F2)
    .setDescription(
      `**📊 Overall Statistics**\n` +
      `Total Study Time: **${insights.totalHours}h** (${days}d ${hours}h)\n` +
      `Total Sessions: **${insights.totalSessions}** sessions\n` +
      `Active Students: **${insights.totalUsers}** users\n` +
      `Average Session: **${insights.avgSessionLength}h**`
    )
    .addFields(
      {
        name: "📅 Activity Patterns",
        value:
          `Most Active Day: **${insights.mostActiveDay}**\n` +
          `Peak Hour: **${formatHour(insights.peakHour)}**\n` +
          `Last 7 Days: **${insights.recentSessions}** sessions (**${insights.recentHours}h**)`,
        inline: true
      },
      {
        name: "🏆 Top Performers",
        value: insights.topPerformer
          ? `#1: <@${insights.topPerformer.userId}>\n` +
            `Study Time: **${insights.topPerformer.lifetimeHours}h**\n` +
            `Sessions: **${insights.topPerformer.totalSessions}**`
          : "No data yet",
        inline: true
      }
    );

  // Add consistency champion if available
  if (insights.mostConsistentUser) {
    embed.addFields({
      name: "🔥 Consistency Champion",
      value:
        `<@${insights.mostConsistentUser}>\n` +
        `Longest Streak: **${insights.highestStreak} days**`,
      inline: true
    });
  }

  // Add giveaway stats if there have been giveaways
  if (insights.totalGiveaways > 0) {
    embed.addFields({
      name: "🎁 Giveaway Stats",
      value:
        `Total Giveaways: **${insights.totalGiveaways}**\n` +
        `Unique Winners: **${insights.uniqueWinners}**\n` +
        `Win Distribution: **${((insights.uniqueWinners / insights.totalUsers) * 100).toFixed(1)}%** of active users`,
      inline: false
    });
  }

  // Add fun facts
  const funFacts = [];

  if (insights.totalHours >= 1000) {
    funFacts.push("🎉 Over 1,000 hours studied!");
  }
  if (insights.totalSessions >= 5000) {
    funFacts.push("💪 Over 5,000 sessions completed!");
  }
  if (insights.totalUsers >= 50) {
    funFacts.push("🌍 Over 50 active students!");
  }
  if (insights.highestStreak >= 30) {
    funFacts.push(`🔥 Someone studied for ${insights.highestStreak} days straight!`);
  }
  if (insights.recentHours > insights.totalHours * 0.2) {
    funFacts.push("📈 Server activity is trending up!");
  }

  if (funFacts.length > 0) {
    embed.addFields({
      name: "✨ Fun Facts",
      value: funFacts.join("\n"),
      inline: false
    });
  }

  embed.setFooter({
    text: `Keep studying to improve these stats! | Total: ${insights.totalHours}h across ${insights.totalUsers} users`
  }).setTimestamp();

  return embed;
}

/**
 * Build the violations report embed
 * @param {Array} violationStats - Array of users with violations
 */
export function buildViolationsEmbed(violationStats) {
  const lines = violationStats.map((user, i) => {
    const violations = [];
    if (user.afkViolations > 0) {
      violations.push(`❌ ${user.afkViolations} AFK (no DM response)`);
    }
    if (user.gamingViolations > 0) {
      violations.push(`🎮 ${user.gamingViolations} Gaming detected`);
    }

    const validRate = ((user.validSessions / user.totalSessions) * 100).toFixed(1);

    return (
      `**${i + 1}.** <@${user.userId}>\n` +
      `   📊 Sessions: ${user.validSessions} valid / ${user.totalSessions} total (${validRate}%)\n` +
      `   ⚠️ Violations: ${violations.join(", ")}`
    );
  });

  return new EmbedBuilder()
    .setTitle("⚠️ Study Session Violations Report")
    .setDescription(lines.join("\n\n"))
    .setColor(0xed4245)
    .setFooter({ text: `Total users with violations: ${violationStats.length}` });
}

/**
 * Build the reset confirmation embed
 */
export function buildResetConfirmEmbed() {
  return new EmbedBuilder()
    .setTitle("⚠️ Confirm Giveaway Period Reset")
    .setDescription(
      "This will:\n" +
      "• Reset current period hours to 0 for all users\n" +
      "• Keep lifetime hours forever (never deleted)\n" +
      "• Start a fresh competition for the new giveaway\n\n" +
      "React with ✅ to confirm, or ❌ to cancel. (30 seconds)"
    )
    .setColor(0xffa500);
}

/**
 * Build the reset complete embed
 * @param {Object} result - Result from resetGiveawayPeriod()
 */
export function buildResetCompleteEmbed(result) {
  return new EmbedBuilder()
    .setTitle("✅ Giveaway Period Reset Complete")
    .setDescription(
      `**Current period has been reset!**\n\n` +
      `📊 Users affected: ${result.usersAffected}\n` +
      `📅 New period started: ${new Date(result.periodStartDate).toLocaleString()}\n\n` +
      `**What changed:**\n` +
      `• ✅ Lifetime hours preserved forever\n` +
      `• 🔄 Current period hours reset to 0\n` +
      `• 🎫 Tickets will recalculate: 30 + √lifetime×5 + current×3\n\n` +
      `Newcomers and active studiers now compete fairly!`
    )
    .setColor(0x57f287)
    .setTimestamp();
}
