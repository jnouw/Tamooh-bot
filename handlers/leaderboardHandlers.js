import Discord from "discord.js";
import { studyStatsStore } from "../services/StudyStatsStore.js";

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

  const lines = leaderboard.map((entry, i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `**${i + 1}.**`;
    return `${medal} <@${entry.userId}> — **${entry.totalHours}h** (${entry.totalSessions} sessions)`;
  });

  const embed = new EmbedBuilder()
    .setTitle("📚 Study Leaderboard")
    .setDescription(lines.join("\n"))
    .setColor(0x5865F2)
    .setFooter({ text: "Keep up the great work!" });

  await interaction.editReply({ embeds: [embed] });
}
