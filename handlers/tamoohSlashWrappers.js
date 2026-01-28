import { studyStatsStore } from "../services/StudyStatsStore.js";
import { isAdmin } from "../utils/adminUtils.js";
import { collectUserStatsData } from "./adminCommandHandlers.js";
import {
  buildUserStatsEmbed,
  buildServerInsightsEmbed,
  buildViolationsEmbed,
  buildResetConfirmEmbed,
  buildResetCompleteEmbed
} from "../utils/statsEmbedBuilder.js";

/**
 * Slash command wrapper for /tamooh mystats
 */
export async function handleTamoohMyStatsCommand(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const data = await collectUserStatsData(
    interaction.user.id,
    interaction.guild.id,
    interaction.guild,
    interaction.member
  );

  const embed = buildUserStatsEmbed(data);
  await interaction.editReply({ embeds: [embed] });
}

/**
 * Slash command wrapper for /tamooh insights
 */
export async function handleTamoohInsightsCommand(interaction) {
  if (!isAdmin({ user: interaction.user, member: interaction.member })) {
    await interaction.reply({ content: "❌ This command is only available to administrators.", ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const insights = studyStatsStore.getServerInsights(interaction.guildId);

  if (insights.totalSessions === 0) {
    await interaction.editReply("📊 No study sessions recorded yet. Start studying to see insights!");
    return;
  }

  const embed = buildServerInsightsEmbed(insights);
  await interaction.editReply({ embeds: [embed] });
}

/**
 * Slash command wrapper for /tamooh violations
 */
export async function handleTamoohViolationsCommand(interaction) {
  if (!isAdmin({ user: interaction.user, member: interaction.member })) {
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

  const embed = buildViolationsEmbed(violationStats);
  await interaction.editReply({ embeds: [embed] });
}

/**
 * Slash command wrapper for /tamooh reset-period
 */
export async function handleTamoohResetPeriodCommand(interaction) {
  if (!isAdmin({ user: interaction.user, member: interaction.member })) {
    await interaction.reply({ content: "❌ This command is only available to administrators.", ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const confirmEmbed = buildResetConfirmEmbed();
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
        const embed = buildResetCompleteEmbed(result);
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
