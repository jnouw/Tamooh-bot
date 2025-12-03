import Discord from "discord.js";
import { studyStatsStore } from "../services/StudyStatsStore.js";
import { STUDY_ROLE_ID, TAMOOH_ROLE_ID, OWNER_ID } from "../services/study/config.js";

const { EmbedBuilder } = Discord;

/**
 * Parse time range string to milliseconds
 */
function parseRange(range) {
  if (range === "7d") return Date.now() - 7 * 24 * 60 * 60 * 1000;
  if (range === "30d") return Date.now() - 30 * 24 * 60 * 60 * 1000;
  return 0; // all time
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
      `**${i + 1}.** <@${r.userId}> — ${r.percent}% (${r.points}/${r.max}, ${
        r.attempts
      } attempts)`
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
 * Handle study leaderboard command
 */
export async function handleStudyLeaderboard(interaction) {
  await interaction.deferReply({ ephemeral: false });

  const leaderboard = studyStatsStore.getLeaderboard(interaction.guildId, 10);

  if (leaderboard.length === 0) {
    await interaction.editReply({
      content: "📚 No study sessions recorded yet. Be the first to start!",
    });
    return;
  }

  // Calculate tickets for leaderboard users using new period-based formula
  const usersWithTickets = leaderboard.map(entry => {
    const tickets = studyStatsStore.calculateTickets(entry.lifetimeHours, entry.currentPeriodHours);

    return {
      ...entry,
      tickets
    };
  });

  // SORT BY TICKETS (descending) - this is what determines giveaway winners!
  usersWithTickets.sort((a, b) => b.tickets - a.tickets);

  // Calculate ACTUAL total tickets across ALL eligible users (matching giveaway logic)
  // This ensures win chances are accurate, not overstated
  await interaction.guild.members.fetch();
  const allMembers = interaction.guild.members.cache;
  let totalTickets = 0;

  for (const [userId, member] of allMembers) {
    // Skip bots
    if (member.user.bot) continue;

    // Check if user has BOTH required roles (same as giveaway logic)
    const hasStudyRole = member.roles.cache.has(STUDY_ROLE_ID);
    const hasTamoohRole = member.roles.cache.has(TAMOOH_ROLE_ID);

    if (!hasStudyRole || !hasTamoohRole) continue;

    // Get user's session stats
    const stats = studyStatsStore.getUserStats(userId, interaction.guildId);

    // Calculate tickets using new formula
    const tickets = studyStatsStore.calculateTickets(stats.lifetimeHours, stats.currentPeriodHours);

    totalTickets += tickets;
  }

  // Create leaderboard lines with tickets, lifetime hours, current period hours, and win chance
  const lines = usersWithTickets.map((entry, i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `**${i + 1}.**`;
    const winChance = totalTickets > 0
      ? ((entry.tickets / totalTickets) * 100).toFixed(2)
      : "0.00";

    return `${medal} <@${entry.userId}>\n` +
           `   🎫 ${entry.tickets} tickets | 📚 ${entry.lifetimeHours}h lifetime | 🔥 ${entry.currentPeriodHours}h this period\n` +
           `   🎲 ${winChance}% win chance`;
  });

  const periodStart = studyStatsStore.getGiveawayPeriodStart(interaction.guildId);
  const periodInfo = periodStart > 0
    ? `Current period started: ${new Date(periodStart).toLocaleDateString()}`
    : "No period reset yet - all hours count equally";

  const embed = new EmbedBuilder()
    .setTitle("📚 Study Leaderboard - Top 10")
    .setDescription(lines.join("\n\n"))
    .setColor(0x5865F2)
    .setFooter({ text: `${periodInfo} | Formula: 30 + √lifetime×5 + current×3` });

  await interaction.editReply({ embeds: [embed] });
}

/**
 * Handle violation stats command (admin only)
 */
export async function handleViolationStats(interaction) {
  // Check if user is admin/owner
  if (interaction.user.id !== OWNER_ID && !interaction.member.permissions.has("Administrator")) {
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
      content: "✅ No violations found! All users have passed their AFK checks and avoided gaming during study sessions.",
    });
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

    return `**${i + 1}.** <@${user.userId}>\n` +
           `   📊 Sessions: ${user.validSessions} valid / ${user.totalSessions} total (${validRate}%)\n` +
           `   ⚠️ Violations: ${violations.join(", ")}`;
  });

  const embed = new EmbedBuilder()
    .setTitle("⚠️ Study Session Violations Report")
    .setDescription(lines.join("\n\n"))
    .setColor(0xED4245)
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
    .setTitle("📚 Tamooh Bot - Command List")
    .setColor(0x5865F2)
    .addFields(
      {
        name: "📝 Quiz Commands (Slash)",
        value:
          "• `/quiz start` - Start a new quiz (MCQ, Find Error, Output, Code)\n" +
          "• `/quiz leaderboard` - View top quiz performers\n" +
          "• `/quiz stats` - View your quiz statistics",
        inline: false,
      },
      {
        name: "📖 Study Commands (Slash)",
        value:
          "• `/study_leaderboard` - View top 10 students by study time\n" +
          "  Shows tickets, lifetime hours, current period hours, and win chance",
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
          "**After each giveaway:** Admin resets the period\n" +
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

  // Add owner-only commands section if user is owner
  if (isOwner) {
    embed.addFields({
      name: "⚙️ Admin Commands (! prefix) - Owner Only",
      value:
        "• `!violations` - View detailed violation report\n" +
        "  Shows users with AFK or gaming violations during study sessions\n\n" +
        "• `!reset_period` - Reset giveaway period (soft reset)\n" +
        "  Resets current period hours to 0, keeps lifetime hours forever\n" +
        "  Use after each giveaway for fair competition",
      inline: false,
    });
    embed.setFooter({ text: "Study consistently and good luck! 💚 | Owner mode active 👑" });
  } else {
    embed.setFooter({ text: "Study consistently and good luck! 💚" });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
