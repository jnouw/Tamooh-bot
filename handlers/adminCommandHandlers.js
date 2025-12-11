import { studyStatsStore } from "../services/StudyStatsStore.js";
import { OWNER_ID } from "../services/study/config.js";
import Discord from "discord.js";

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
 * Handle !violations command - show AFK and gaming violation stats
 */
export async function handleViolationsCommand(message) {
  if (!isAdmin(message)) {
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

  await message.reply({ embeds: [embed] });
}

/**
 * Handle !reset_period command - reset giveaway period for soft reset
 * Usage: !reset_period
 */
export async function handleResetPeriodCommand(message) {
  if (!isAdmin(message)) {
    await message.reply("❌ This command is only available to administrators.");
    return;
  }

  // Confirm before resetting
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
      console.log(`[AdminCmd] Reaction: ${reaction.emoji.name}, User: ${user.id}, Author: ${message.author.id}`);
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
    console.log(`[AdminCmd] Collected reaction: ${reaction?.emoji.name}, Collection size: ${collected.size}`);

    if (!reaction) {
      console.log("[AdminCmd] No reaction collected");
      await message.reply("❌ Period reset cancelled (no reaction received).");
      await confirmMsg.delete().catch(() => {});
      return;
    }

    if (reaction.emoji.name === "✅") {
      console.log("[AdminCmd] Confirmed - executing reset...");

      try {
        const result = await studyStatsStore.resetGiveawayPeriod(message.guildId);
        console.log(`[AdminCmd] Reset complete: ${result.usersAffected} users affected`);

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

        await message.reply({ embeds: [embed] }).catch(async (err) => {
          console.error("[AdminCmd] Failed to reply:", err.message);
          // Try to send in the channel instead if reply fails
          await message.channel.send({ embeds: [embed] }).catch(() => {});
        });
        await confirmMsg.delete().catch(() => {});
      } catch (resetError) {
        console.error("[AdminCmd] Reset failed:", resetError);
        await message.reply(`❌ Failed to reset period: ${resetError.message}`).catch(async (err) => {
          console.error("[AdminCmd] Failed to reply with error:", err.message);
          await message.channel.send(`❌ Failed to reset period: ${resetError.message}`).catch(() => {});
        });
        await confirmMsg.delete().catch(() => {});
      }
    } else {
      console.log("[AdminCmd] User cancelled reset");
      await message.reply("❌ Period reset cancelled.").catch(async (err) => {
        console.error("[AdminCmd] Failed to reply:", err.message);
        await message.channel.send("❌ Period reset cancelled.").catch(() => {});
      });
      await confirmMsg.delete().catch(() => {});
    }
  } catch (error) {
    if (error.message?.includes('time')) {
      console.log("[AdminCmd] Reset timed out");
      await message.reply("❌ Period reset cancelled (timed out).").catch(async (err) => {
        console.error("[AdminCmd] Failed to reply:", err.message);
        await message.channel.send("❌ Period reset cancelled (timed out).").catch(() => {});
      });
    } else {
      console.error("[AdminCmd] Unexpected error:", error);
      await message.reply(`❌ An error occurred: ${error.message}`).catch(async (err) => {
        console.error("[AdminCmd] Failed to reply:", err.message);
        await message.channel.send(`❌ An error occurred: ${error.message}`).catch(() => {});
      });
    }
    await confirmMsg.delete().catch(() => {});
  }
}

/**
 * Handle !insights command - show cool server-wide insights
 * Usage: !insights
 */
export async function handleInsightsCommand(message) {
  if (!isAdmin(message)) {
    await message.reply("❌ This command is only available to administrators.");
    return;
  }

  const insights = studyStatsStore.getServerInsights(message.guildId);

  if (insights.totalSessions === 0) {
    await message.reply("📊 No study sessions recorded yet. Start studying to see insights!");
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

  await message.reply({ embeds: [embed] });
}
