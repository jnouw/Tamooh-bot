import { studyStatsStore } from "../services/StudyStatsStore.js";
import { STUDY_ROLE_ID, TAMOOH_ROLE_ID } from "../services/study/config.js";
import { isAdmin } from "../utils/adminUtils.js";
import {
  buildUserStatsEmbed,
  buildServerInsightsEmbed,
  buildViolationsEmbed,
  buildResetCompleteEmbed
} from "../utils/statsEmbedBuilder.js";

/**
 * Handle !violations command - show AFK and gaming violation stats
 */
export async function handleViolationsCommand(message) {
  if (!isAdmin({ author: message.author, member: message.member })) {
    await message.reply("❌ This command is only available to administrators.");
    return;
  }

  const violationStats = studyStatsStore.getViolationStats(message.guildId);

  if (violationStats.length === 0) {
    await message.reply(
      "✅ No violations found! All users have passed their AFK checks and avoided gaming during study sessions."
    );
    return;
  }

  const embed = buildViolationsEmbed(violationStats);
  await message.reply({ embeds: [embed] });
}

/**
 * Handle !reset_period command - reset giveaway period for soft reset
 */
export async function handleResetPeriodCommand(message) {
  if (!isAdmin({ author: message.author, member: message.member })) {
    await message.reply("❌ This command is only available to administrators.");
    return;
  }

  const confirmMsg = await message.reply(
    "⚠️ **Confirm Giveaway Period Reset**\n\n" +
    "This will:\n" +
    "• Reset current period hours to 0 for all users\n" +
    "• Keep lifetime hours forever (never deleted)\n" +
    "• Start a fresh competition for the new giveaway\n\n" +
    "React with ✅ to confirm, or ❌ to cancel. (30 seconds)"
  );

  try {
    await confirmMsg.react("✅");
    await confirmMsg.react("❌");
  } catch (error) {
    console.error("[AdminCmd] Failed to add reactions:", error);
    await message.reply("❌ Failed to add reactions. Check bot permissions (Add Reactions).");
    return;
  }

  try {
    const filter = (reaction, user) => {
      return (reaction.emoji.name === "✅" || reaction.emoji.name === "❌") &&
        user.id === message.author.id;
    };

    const collected = await confirmMsg.awaitReactions({
      filter,
      max: 1,
      time: 30000,
      errors: ["time"],
    });

    const reaction = collected.first();

    if (!reaction) {
      await message.reply("❌ Period reset cancelled (no reaction received).");
      await confirmMsg.delete().catch(() => {});
      return;
    }

    if (reaction.emoji.name === "✅") {
      try {
        const result = await studyStatsStore.resetGiveawayPeriod(message.guildId);
        const embed = buildResetCompleteEmbed(result);

        await message.reply({ embeds: [embed] }).catch(async (err) => {
          console.error("[AdminCmd] Failed to reply:", err.message);
          await message.channel.send({ embeds: [embed] }).catch(() => {});
        });
        await confirmMsg.delete().catch(() => {});
      } catch (resetError) {
        console.error("[AdminCmd] Reset failed:", resetError);
        await message.reply(`❌ Failed to reset period: ${resetError.message}`).catch(async () => {
          await message.channel.send(`❌ Failed to reset period: ${resetError.message}`).catch(() => {});
        });
        await confirmMsg.delete().catch(() => {});
      }
    } else {
      await message.reply("❌ Period reset cancelled.").catch(async () => {
        await message.channel.send("❌ Period reset cancelled.").catch(() => {});
      });
      await confirmMsg.delete().catch(() => {});
    }
  } catch (error) {
    if (error.message?.includes('time')) {
      await message.reply("❌ Period reset cancelled (timed out).").catch(async () => {
        await message.channel.send("❌ Period reset cancelled (timed out).").catch(() => {});
      });
    } else {
      console.error("[AdminCmd] Unexpected error:", error);
      await message.reply(`❌ An error occurred: ${error.message}`).catch(async () => {
        await message.channel.send(`❌ An error occurred: ${error.message}`).catch(() => {});
      });
    }
    await confirmMsg.delete().catch(() => {});
  }
}

/**
 * Collect user stats data for embed building
 * Shared between message commands and slash commands
 */
export async function collectUserStatsData(userId, guildId, guild, member) {
  const stats = studyStatsStore.getUserStats(userId, guildId);
  const winStats = studyStatsStore.getUserWinStats(userId, guildId);
  const ranking = studyStatsStore.getUserRanking(userId, guildId);
  const guildStats = studyStatsStore.getGuildStats(guildId);
  const streak = studyStatsStore.getStudyStreak(userId, guildId);
  const tickets = studyStatsStore.calculateTickets(stats.lifetimeHours, stats.currentPeriodHours);
  const insights = studyStatsStore.getUserSmartInsights(userId, guildId);

  // Calculate total tickets across all eligible members
  await guild.members.fetch();
  const allMembers = guild.members.cache;
  let totalTickets = 0;

  const userHasStudyRole = member.roles.cache.has(STUDY_ROLE_ID);
  const userHasTamoohRole = member.roles.cache.has(TAMOOH_ROLE_ID);
  const isEligible = userHasStudyRole && userHasTamoohRole;

  for (const [memberId, m] of allMembers) {
    if (m.user.bot) continue;
    if (!m.roles.cache.has(STUDY_ROLE_ID) || !m.roles.cache.has(TAMOOH_ROLE_ID)) continue;

    const memberStats = studyStatsStore.getUserStats(memberId, guildId);
    const memberTickets = studyStatsStore.calculateTickets(memberStats.lifetimeHours, memberStats.currentPeriodHours);
    totalTickets += memberTickets;
  }

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

  return {
    stats,
    winStats,
    ranking,
    guildStats,
    streak,
    tickets,
    insights,
    winningChances,
    validationRate,
    avgSessionLength
  };
}

/**
 * Show personal stats for a user (called from !insights my)
 */
async function showUserStats(message) {
  const data = await collectUserStatsData(
    message.author.id,
    message.guild.id,
    message.guild,
    message.member
  );

  const embed = buildUserStatsEmbed(data);
  await message.reply({ embeds: [embed] });
}

/**
 * Handle !insights command - show cool server-wide insights
 * Usage: !insights [my|me|stats|mystats]
 */
export async function handleInsightsCommand(message) {
  const args = message.content.trim().split(/\s+/);
  const subcommand = args[1]?.toLowerCase();

  // Handle user stats subcommand (!insights my|me|stats|mystats)
  if (subcommand === "my" || subcommand === "me" || subcommand === "stats" || subcommand === "mystats") {
    await showUserStats(message);
    return;
  }

  // Server-wide insights (admin only)
  if (!isAdmin({ author: message.author, member: message.member })) {
    await message.reply("❌ Server insights are only available to administrators.\n\nTip: Use `!insights my` to see your personal stats!");
    return;
  }

  const insights = studyStatsStore.getServerInsights(message.guildId);

  if (insights.totalSessions === 0) {
    await message.reply("📊 No study sessions recorded yet. Start studying to see insights!");
    return;
  }

  const embed = buildServerInsightsEmbed(insights);
  await message.reply({ embeds: [embed] });
}
