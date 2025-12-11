import { studyStatsStore } from "../services/StudyStatsStore.js";
import Discord from "discord.js";
import { OWNER_ID, STUDY_ROLE_ID, TAMOOH_ROLE_ID } from "../services/study/config.js";

const { EmbedBuilder } = Discord;

const QIMAH_TEAM_ROLE_ID = "1345211405556514906";

/**
 * Check if user is admin, owner, or has Qimah team role
 */
function isAdmin(message) {
  return (
    message.author.id === OWNER_ID ||
    message.member?.permissions.has("Administrator") ||
    message.member?.roles.cache.has(QIMAH_TEAM_ROLE_ID)
  );
}

/**
 * Slash command wrapper for /tamooh mystats
 */
export async function handleTamoohMyStatsCommand(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  const guildId = interaction.guild.id;

  // Get all stats (using same logic as "My Stats" button)
  const stats = studyStatsStore.getUserStats(userId, guildId);
  const winStats = studyStatsStore.getUserWinStats(userId, guildId);
  const ranking = studyStatsStore.getUserRanking(userId, guildId);
  const guildStats = studyStatsStore.getGuildStats(guildId);
  const streak = studyStatsStore.getStudyStreak(userId, guildId);
  const tickets = studyStatsStore.calculateTickets(stats.lifetimeHours, stats.currentPeriodHours);
  const insights = studyStatsStore.getUserSmartInsights(userId, guildId);

  // Calculate ACTUAL total tickets (matching giveaway logic)
  await interaction.guild.members.fetch();
  const allMembers = interaction.guild.members.cache;
  let totalTickets = 0;

  // Check if current user is eligible for giveaways
  const currentMember = interaction.member;
  const userHasStudyRole = currentMember.roles.cache.has(STUDY_ROLE_ID);
  const userHasTamoohRole = currentMember.roles.cache.has(TAMOOH_ROLE_ID);
  const isEligible = userHasStudyRole && userHasTamoohRole;

  for (const [memberId, member] of allMembers) {
    if (member.user.bot) continue;

    const hasStudyRole = member.roles.cache.has(STUDY_ROLE_ID);
    const hasTamoohRole = member.roles.cache.has(TAMOOH_ROLE_ID);

    if (!hasStudyRole || !hasTamoohRole) continue;

    const memberStats = studyStatsStore.getUserStats(memberId, guildId);
    const memberTickets = studyStatsStore.calculateTickets(memberStats.lifetimeHours, memberStats.currentPeriodHours);

    totalTickets += memberTickets;
  }

  // Calculate accurate win chance
  const winChance = isEligible && totalTickets > 0 ? (tickets / totalTickets) * 100 : 0;
  const winningChances = {
    userTickets: isEligible ? tickets : 0,
    totalTickets: totalTickets,
    winChance: Math.round(winChance * 100) / 100
  };

  const allSessions = studyStatsStore.data.sessions.filter(
    (s) => s.userId === userId && s.guildId === guildId
  );
  const totalAttempts = allSessions.length;
  const validationRate =
    totalAttempts > 0 ? ((stats.totalSessions / totalAttempts) * 100).toFixed(1) + "%" : "N/A";

  const avgSessionLength =
    stats.totalSessions > 0 ? (stats.lifetimeHours / stats.totalSessions).toFixed(1) : 0;

  // Create progress bar
  const createProgressBar = (current, max, length = 10) => {
    const filledLength = Math.min(Math.round((current / max) * length), length);
    const emptyLength = length - filledLength;
    return "█".repeat(filledLength) + "░".repeat(emptyLength);
  };

  // Determine rank emoji and color
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

  // Competitive description
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

  // Determine next milestone
  const hourMilestones = [3, 10, 24, 48, 72, 96, 120, 168, 240, 336, 500, 1000];
  const nextMilestone = hourMilestones.find(m => m > stats.lifetimeHours) || (Math.ceil(stats.lifetimeHours / 100) * 100 + 100);
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
  if (stats.totalSessions > 0) {
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
  let footerText = "";
  if (ranking.rank === 1) {
    footerText = "👑 Defend your throne! Stay consistent!";
  } else if (winningChances.winChance >= 20) {
    footerText = `🎰 ${winningChances.winChance}% chance to win! You're in a great position!`;
  } else if (ranking.rank <= 3) {
    footerText = "🔥 So close to the top! Keep pushing!";
  } else if (ranking.percentile >= 75) {
    footerText = "⚡ You're in the top tier! Don't stop now!";
  } else if (winningChances.winChance < 5 && stats.currentPeriodHours < 10) {
    footerText = `📈 Study more to boost your ${winningChances.winChance}% odds!`;
  } else if (hoursToNext <= 5) {
    footerText = `🎯 Just ${hoursToNext.toFixed(1)}h until your next milestone!`;
  } else if (streak.currentStreak >= 3) {
    footerText = `🔥 ${streak.currentStreak}-day streak! Don't break it!`;
  } else {
    footerText = "💪 Every hour counts. Start studying now!";
  }

  embed.setFooter({ text: footerText }).setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

/**
 * Slash command wrapper for /tamooh insights
 */
export async function handleTamoohInsightsCommand(interaction) {
  if (!isAdmin({ author: interaction.user, member: interaction.member })) {
    await interaction.reply({ content: "❌ This command is only available to administrators.", ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const insights = studyStatsStore.getServerInsights(interaction.guildId);

  if (insights.totalSessions === 0) {
    await interaction.editReply("📊 No study sessions recorded yet. Start studying to see insights!");
    return;
  }

  // Format peak hour
  const formatHour = (h) => {
    const hour = parseInt(h);
    if (hour === 0) return "12 AM";
    if (hour < 12) return `${hour} AM`;
    if (hour === 12) return "12 PM";
    return `${hour - 12} PM`;
  };

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

  await interaction.editReply({ embeds: [embed] });
}

/**
 * Slash command wrapper for /tamooh violations
 */
export async function handleTamoohViolationsCommand(interaction) {
  if (!isAdmin({ author: interaction.user, member: interaction.member })) {
    await interaction.reply({ content: "❌ This command is only available to administrators.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const violationStats = studyStatsStore.getViolationStats(interaction.guildId);

  if (violationStats.length === 0) {
    await interaction.editReply(
      "✅ No violations found! All users have passed their AFK checks and avoided gaming during study sessions."
    );
    return;
  }

  // Create detailed violation report
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

  const embed = new EmbedBuilder()
    .setTitle("⚠️ Study Session Violations Report")
    .setDescription(lines.join("\n\n"))
    .setColor(0xed4245)
    .setFooter({ text: `Total users with violations: ${violationStats.length}` });

  await interaction.editReply({ embeds: [embed] });
}

/**
 * Slash command wrapper for /tamooh reset-period
 */
export async function handleTamoohResetPeriodCommand(interaction) {
  if (!isAdmin({ author: interaction.user, member: interaction.member })) {
    await interaction.reply({ content: "❌ This command is only available to administrators.", ephemeral: true });
    return;
  }

  await interaction.deferReply();

  // Send confirmation message
  const confirmEmbed = new EmbedBuilder()
    .setTitle("⚠️ Confirm Giveaway Period Reset")
    .setDescription(
      "This will:\n" +
      "• Reset current period hours to 0 for all users\n" +
      "• Keep lifetime hours forever (never deleted)\n" +
      "• Start a fresh competition for the new giveaway\n\n" +
      "React with ✅ to confirm, or ❌ to cancel. (30 seconds)"
    )
    .setColor(0xffa500);

  const confirmMsg = await interaction.editReply({ embeds: [confirmEmbed] });

  try {
    await confirmMsg.react("✅");
    await confirmMsg.react("❌");
  } catch (error) {
    console.error("[AdminCmd] Failed to add reactions:", error);
    await interaction.followUp({ content: "❌ Failed to add reactions. Check bot permissions (Add Reactions).", ephemeral: true });
    return;
  }

  try {
    const filter = (reaction, user) => {
      return (reaction.emoji.name === "✅" || reaction.emoji.name === "❌") &&
        user.id === interaction.user.id;
    };

    const collected = await confirmMsg.awaitReactions({
      filter,
      max: 1,
      time: 30000,
      errors: ["time"],
    });

    const reaction = collected.first();

    if (!reaction || reaction.emoji.name === "❌") {
      await interaction.followUp({ content: "❌ Period reset cancelled.", ephemeral: true });
      return;
    }

    if (reaction.emoji.name === "✅") {
      try {
        const result = await studyStatsStore.resetGiveawayPeriod(interaction.guildId);

        const embed = new EmbedBuilder()
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

        await interaction.followUp({ embeds: [embed] });
      } catch (resetError) {
        console.error("[AdminCmd] Reset failed:", resetError);
        await interaction.followUp({ content: `❌ Failed to reset period: ${resetError.message}`, ephemeral: true });
      }
    }
  } catch (error) {
    if (error.message?.includes('time')) {
      await interaction.followUp({ content: "❌ Period reset cancelled (timed out).", ephemeral: true });
    } else {
      console.error("[AdminCmd] Unexpected error:", error);
      await interaction.followUp({ content: `❌ An error occurred: ${error.message}`, ephemeral: true });
    }
  }
}
