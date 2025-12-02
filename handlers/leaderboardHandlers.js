import Discord from "discord.js";
import { studyStatsStore } from "../services/StudyStatsStore.js";
import { STUDY_ROLE_ID, TAMOOH_ROLE_ID } from "../services/study/config.js";

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

  // Calculate tickets for leaderboard users
  const usersWithTickets = leaderboard.map(entry => {
    // Check for ticket override first, otherwise calculate from hours
    const ticketOverride = studyStatsStore.getTicketOverride(entry.userId, interaction.guildId);
    const tickets = ticketOverride !== null
      ? ticketOverride
      : (8 + Math.round(Math.sqrt(entry.totalHours) * 8));

    return {
      ...entry,
      tickets
    };
  });

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

    // Calculate tickets (override or formula)
    const ticketOverride = studyStatsStore.getTicketOverride(userId, interaction.guildId);
    const tickets = ticketOverride !== null
      ? ticketOverride
      : (8 + Math.round(Math.sqrt(stats.totalHours) * 8));

    totalTickets += tickets;
  }

  // Create leaderboard lines with tickets, hours, and ACCURATE win chance
  const lines = usersWithTickets.map((entry, i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `**${i + 1}.**`;
    const winChance = totalTickets > 0
      ? ((entry.tickets / totalTickets) * 100).toFixed(2)
      : "0.00";

    return `${medal} <@${entry.userId}>\n` +
           `   🎫 ${entry.tickets} tickets | ⏱️ ${entry.totalHours}h | 🎲 ${winChance}% chance`;
  });

  const embed = new EmbedBuilder()
    .setTitle("📚 Study Leaderboard - Top 10")
    .setDescription(lines.join("\n\n"))
    .setColor(0x5865F2)
    .setFooter({ text: "More study time = More tickets = Higher win chance!" });

  await interaction.editReply({ embeds: [embed] });
}
