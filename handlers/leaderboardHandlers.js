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
 * Handle study leaderboard command — shows voice chat time this week (including live sessions)
 */
export async function handleStudyLeaderboard(interaction, voiceTimeStore, voiceJoinTimes) {
  await interaction.deferReply({ ephemeral: false });

  // Get saved data for all users
  const stored = voiceTimeStore.getLeaderboard(interaction.guildId, 999);
  const userMap = new Map(stored.map(e => [e.userId, { ...e, isLive: false }]));

  // Add live time for users currently in a study channel
  const now = Date.now();
  for (const [key, joinTime] of voiceJoinTimes) {
    const [guildId, userId] = key.split('_');
    if (guildId !== interaction.guildId) continue;

    const liveMinutes = Math.floor((now - joinTime) / 60000);
    const base = userMap.get(userId) || { userId, weeklyMinutes: 0, lifetimeMinutes: 0 };
    const weeklyMinutes = base.weeklyMinutes + liveMinutes;
    const lifetimeMinutes = base.lifetimeMinutes + liveMinutes;
    userMap.set(userId, {
      userId,
      weeklyMinutes,
      lifetimeMinutes,
      weeklyHours: Math.round(weeklyMinutes / 60 * 10) / 10,
      lifetimeHours: Math.round(lifetimeMinutes / 60 * 10) / 10,
      isLive: true,
    });
  }

  const leaderboard = Array.from(userMap.values())
    .filter(u => u.weeklyMinutes > 0)
    .sort((a, b) => b.weeklyMinutes - a.weeklyMinutes)
    .slice(0, 10);

  if (leaderboard.length === 0) {
    await interaction.editReply({
      content: "🎙️ No voice study time recorded yet this week. Join a study room to get started!",
    });
    return;
  }

  const lines = leaderboard.map((entry, i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `**${i + 1}.**`;
    const live = entry.isLive ? " 🔴" : "";
    return (
      `${medal} <@${entry.userId}>${live}\n` +
      `   🎙️ **${entry.weeklyHours}h** this week  |  📚 ${entry.lifetimeHours}h all time`
    );
  });

  const timeLeft = formatTimeRemaining(getMsUntilNextSaturday());

  const embed = new EmbedBuilder()
    .setTitle("🏆 Study Room Leaderboard — This Week")
    .setDescription(lines.join("\n\n"))
    .setColor(0x5865f2)
    .setFooter({ text: `🔴 = currently in study room | Resets in: ${timeLeft} (Saturday 12:00 AM)` });

  await interaction.editReply({ embeds: [embed] });
}

/**
 * Handle /mystudytime command — shows a student their own voice time stats
 */
export async function handleMyStudyTime(interaction, voiceTimeStore, voiceJoinTimes) {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  const stored = voiceTimeStore.getUserTime(userId, guildId);

  // Check if they're currently in a study room
  const key = `${guildId}_${userId}`;
  const joinTime = voiceJoinTimes.get(key);
  const liveMinutes = joinTime ? Math.floor((Date.now() - joinTime) / 60000) : 0;

  const weeklyMinutes = stored.weeklyMinutes + liveMinutes;
  const lifetimeMinutes = stored.lifetimeMinutes + liveMinutes;
  const weeklyHours = Math.round(weeklyMinutes / 60 * 10) / 10;
  const lifetimeHours = Math.round(lifetimeMinutes / 60 * 10) / 10;

  // Get their rank on the leaderboard (including live data)
  const allStored = voiceTimeStore.getLeaderboard(guildId, 999);
  const userMap = new Map(allStored.map(e => [e.userId, { ...e }]));

  const now = Date.now();
  for (const [k, jt] of voiceJoinTimes) {
    const [gId, uId] = k.split('_');
    if (gId !== guildId) continue;
    const lm = Math.floor((now - jt) / 60000);
    const base = userMap.get(uId) || { userId: uId, weeklyMinutes: 0, lifetimeMinutes: 0 };
    userMap.set(uId, { ...base, weeklyMinutes: base.weeklyMinutes + lm });
  }

  const sorted = Array.from(userMap.values())
    .filter(u => u.weeklyMinutes > 0)
    .sort((a, b) => b.weeklyMinutes - a.weeklyMinutes);

  const rank = sorted.findIndex(u => u.userId === userId) + 1;
  const rankText = rank > 0 ? `#${rank} out of ${sorted.length}` : "Unranked";

  const liveText = joinTime
    ? `\n🔴 **Currently studying:** ${liveMinutes}m active right now`
    : "";

  const timeLeft = formatTimeRemaining(getMsUntilNextSaturday());

  const embed = new EmbedBuilder()
    .setTitle(`📊 Your Study Stats`)
    .setDescription(
      `🎙️ **This week:** ${weeklyHours}h\n` +
      `📚 **All time:** ${lifetimeHours}h\n` +
      `🏆 **Rank:** ${rankText}` +
      liveText
    )
    .setColor(joinTime ? 0xe74c3c : 0x2ecc71)
    .setFooter({ text: `Leaderboard resets in: ${timeLeft} (Saturday 12:00 AM)` });

  await interaction.reply({ embeds: [embed], ephemeral: true });
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
