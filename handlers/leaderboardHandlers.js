import Discord from "discord.js";
import { STUDY_ROLE_ID, TAMOOH_ROLE_ID, OWNER_ID } from "../services/study/config.js";

const { EmbedBuilder } = Discord;

const WEEKLY_SUMMARY_CHANNEL_ID = process.env.LEADERBOARD_CHANNEL_ID;

/**
 * Format milliseconds into a human-readable "Xd Yh Zm" string
 */
function formatTimeRemaining(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

/**
 * Parse time range string to milliseconds
 */
function parseRange(range) {
  if (range === "7d") return Date.now() - 7 * 24 * 60 * 60 * 1000;
  if (range === "30d") return Date.now() - 30 * 24 * 60 * 60 * 1000;
  return 0; // all time
}

/**
 * Returns the ms until next Saturday at 12:00 AM (midnight)
 */
function getMsUntilNextSaturday() {
  const now = new Date();
  const day = now.getDay(); // 0 = Sun, 6 = Sat
  const daysUntilSaturday = (6 - day + 7) % 7 || 7; // always next Saturday, not today

  const next = new Date(now);
  next.setDate(now.getDate() + daysUntilSaturday);
  next.setHours(0, 0, 0, 0);

  return next.getTime() - now.getTime();
}

/**
 * Build and send the weekly study summary embed, then reset the period
 */
async function sendWeeklySummaryAndReset(client, voiceTimeStore) {
  for (const [guildId, guild] of client.guilds.cache) {
    try {
      const channel = guild.channels.cache.get(WEEKLY_SUMMARY_CHANNEL_ID);
      if (!channel) continue;

      const winner = voiceTimeStore.getWinner(guildId);
      const top10 = voiceTimeStore.getLeaderboard(guildId, 10);

      if (top10.length === 0) {
        await channel.send({
          content: "📅 **Weekly Study Reset** — No voice study time recorded this week. The leaderboard has been reset. Keep it up next week! 💪",
        });
      } else {
        const lines = top10.map((entry, i) => {
          const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `**${i + 1}.**`;
          return (
            `${medal} <@${entry.userId}>\n` +
            `   🎙️ ${entry.weeklyHours}h this week | 📚 ${entry.lifetimeHours}h all time`
          );
        });

        const winnerLine = winner
          ? `\n\n🏆 **This week's winner: <@${winner.userId}> with ${winner.weeklyHours}h!** 🎉`
          : "";

        const embed = new EmbedBuilder()
          .setTitle("📅 Weekly Study Room Results")
          .setDescription(lines.join("\n\n") + winnerLine)
          .setColor(0xf1c40f)
          .setFooter({
            text: `Week ending ${new Date().toLocaleDateString()} | Leaderboard has been reset. Good luck this week! 💚`,
          });

        await channel.send({ embeds: [embed] });
      }

      // Reset weekly minutes for all users
      await voiceTimeStore.resetPeriod(guildId);
    } catch (err) {
      console.error(`[WeeklyReset] Error processing guild ${guildId}:`, err);
    }
  }
}

/**
 * Schedule the weekly Saturday 12am reset.
 * Call this once on bot startup.
 */
export function scheduleWeeklyReset(client, voiceTimeStore) {
  const msUntilFirst = getMsUntilNextSaturday();
  const days = (msUntilFirst / 1000 / 60 / 60 / 24).toFixed(2);
  console.log(`[WeeklyReset] First reset scheduled in ${days} days (next Saturday 12:00 AM).`);

  setTimeout(() => {
    sendWeeklySummaryAndReset(client, voiceTimeStore);

    setInterval(() => {
      sendWeeklySummaryAndReset(client, voiceTimeStore);
    }, 7 * 24 * 60 * 60 * 1000);
  }, msUntilFirst);
}

/**
 * Handle quiz leaderboard command
 */
export async function handleLeaderboard(interaction, scores) {
  const mode = interaction.options.getString("mode") ?? "all";
  const range = interaction.options.getString("range") ?? "7d";
  const minAttempts = interaction.options.getInteger("minattempts") ?? 1;

  const sinceMs = parseRange(range);
  const rows = scores.top({
    guildId: interaction.guildId,
    mode,
    sinceMs,
    minAttempts,
    limit: 10,
  });

  const title = `🏆 Leaderboard • ${range.toUpperCase()} • ${mode.toUpperCase()}`;
  if (rows.length === 0) {
    await interaction.reply({
      content: `${title}\nNo qualifying results yet.`,
      ephemeral: false,
    });
    return;
  }

  const lines = rows.map(
    (r, i) =>
      `**${i + 1}.** <@${r.userId}> — ${r.percent}% (${r.points}/${r.max}, ${r.attempts} attempts)`
  );

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(lines.join("\n"))
    .setColor("#FEE75C");

  await interaction.reply({ embeds: [embed], ephemeral: false });
}

/**
 * Handle user stats command
 */
export async function handleMyStats(interaction, scores) {
  const range = interaction.options.getString("range") ?? "7d";
  const sinceMs = parseRange(range);
  const me = scores.userStats({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    sinceMs,
  });

  const embed = new EmbedBuilder()
    .setTitle(`📈 Your stats • ${range.toUpperCase()}`)
    .setDescription(
      `Attempts: **${me.attempts}**\nScore: **${me.points}/${me.max}**\nAverage: **${me.percent}%**`
    )
    .setColor("#57F287");

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

/**
 * Handle study leaderboard command — shows voice chat time this week
 */
export async function handleStudyLeaderboard(interaction, voiceTimeStore) {
  await interaction.deferReply({ ephemeral: false });

  const leaderboard = voiceTimeStore.getLeaderboard(interaction.guildId, 10);

  if (leaderboard.length === 0) {
    await interaction.editReply({
      content: "🎙️ No voice study time recorded yet this week. Join a study room to get started!",
    });
    return;
  }

  const lines = leaderboard.map((entry, i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `**${i + 1}.**`;
    return (
      `${medal} <@${entry.userId}>\n` +
      `   🎙️ **${entry.weeklyHours}h** this week  |  📚 ${entry.lifetimeHours}h all time`
    );
  });

  const timeLeft = formatTimeRemaining(getMsUntilNextSaturday());

  const embed = new EmbedBuilder()
    .setTitle("🏆 Study Room Leaderboard — This Week")
    .setDescription(lines.join("\n\n"))
    .setColor(0x5865f2)
    .setFooter({ text: `Resets in: ${timeLeft} (Saturday 12:00 AM) | Based on voice chat time` });

  await interaction.editReply({ embeds: [embed] });
}

/**
 * Handle /timeleft command — shows time until next weekly reset
 */
export async function handleTimeLeft(interaction) {
  const ms = getMsUntilNextSaturday();
  const timeLeft = formatTimeRemaining(ms);

  const nextSat = new Date();
  const daysUntil = (6 - nextSat.getDay() + 7) % 7 || 7;
  nextSat.setDate(nextSat.getDate() + daysUntil);
  nextSat.setHours(0, 0, 0, 0);

  const embed = new EmbedBuilder()
    .setTitle("⏰ Next Weekly Reset")
    .setDescription(
      `The study room leaderboard resets every **Saturday at 12:00 AM**.\n\n` +
      `**Time remaining:** ${timeLeft}\n` +
      `**Next reset:** ${nextSat.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`
    )
    .setColor(0xe67e22)
    .setFooter({ text: "The winner (most voice time) is announced at each reset!" });

  await interaction.reply({ embeds: [embed], ephemeral: false });
}

/**
 * Handle violation stats command (admin only)
 */
export async function handleViolationStats(interaction, studyStatsStore) {
  if (
    interaction.user.id !== OWNER_ID &&
    !interaction.member.permissions.has("Administrator")
  ) {
    await interaction.reply({
      content: "❌ This command is only available to administrators.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const violationStats = studyStatsStore.getViolationStats(interaction.guildId);

  if (violationStats.length === 0) {
    await interaction.editReply({
      content:
        "✅ No violations found! All users have passed their AFK checks and avoided gaming during study sessions.",
    });
    return;
  }

  const lines = violationStats.map((user, i) => {
    const violations = [];
    if (user.afkViolations > 0) violations.push(`❌ ${user.afkViolations} AFK (no DM response)`);
    if (user.gamingViolations > 0) violations.push(`🎮 ${user.gamingViolations} Gaming detected`);

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
 * Handle /help command - show all available commands
 */
export async function handleHelpCommand(interaction) {
  const { OWNER_ID } = await import("../services/study/config.js");
  const isOwner = interaction.user.id === OWNER_ID;

  const embed = new EmbedBuilder()
    .setTitle("📚 TamoohBot - Command List")
    .setColor(0x5865f2)
    .addFields(
      {
        name: "📝 Quiz Commands",
        value:
          "• `/quiz start` - Start a new quiz (MCQ, Find Error, Output, Code)\n" +
          "• `/quiz leaderboard` - View top quiz performers\n" +
          "• `/quiz stats` - View your quiz statistics",
        inline: false,
      },
      {
        name: "📖 Study Commands",
        value:
          "• `/study_leaderboard` - View top 10 students by study time\n" +
          "  Shows tickets, lifetime hours, current period hours, and win chance",
        inline: false,
      },
      {
        name: "⚡ TamoohBot Commands",
        value:
          "• `/tamooh mystats` - View your personal study statistics and giveaway odds\n" +
          "• `/tamooh insights` - View server-wide study insights (Admin only)\n" +
          "• `/tamooh violations` - View violation report (Admin only)\n" +
          "• `/tamooh reset-period` - Reset giveaway period (Admin only)",
        inline: false,
      },
      {
        name: "🎟️ Period-Based Ticket System",
        value:
          "**Formula:** `30 + √(lifetime hours) × 5 + (current period hours) × 3`\n\n" +
          "**How it works:**\n" +
          "• Lifetime hours = All valid study hours (never deleted) 📚\n" +
          "• Current period = Hours since last giveaway reset 🔥\n" +
          "• Recent study counts MORE than old hours!\n\n" +
          "**Every Saturday at 12:00 AM:** Leaderboard auto-resets\n" +
          "• Weekly summary is posted in <#1481815772371222561>\n" +
          "• Current period hours → 0 (fresh start)\n" +
          "• Lifetime hours stay forever ✅\n" +
          "• Newcomers compete fairly with veterans!",
        inline: false,
      },
      {
        name: "🎮 Study Session Buttons",
        value:
          "Use the study session message buttons to:\n" +
          "• Start solo sessions (25min or 50min)\n" +
          "• Join group queues\n" +
          "• View your comprehensive stats 📊\n" +
          "• Manage study role notifications",
        inline: false,
      }
    );

  if (isOwner) {
    embed.addFields({
      name: "🔧 Legacy Commands (! prefix) - Owner Only",
      value:
        "• `!insights` - Server insights (use `/tamooh insights` instead)\n" +
        "• `!insights my` - Personal stats (use `/tamooh mystats` instead)\n" +
        "• `!violations` - Violations (use `/tamooh violations` instead)\n" +
        "• `!reset_period` - Reset period (use `/tamooh reset-period` instead)\n" +
        "• `!giveaway <prize>` - Run a giveaway",
      inline: false,
    });
  }

  embed.setFooter({ text: "Study consistently and good luck! 💚 | TamoohBot v2.0" });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
