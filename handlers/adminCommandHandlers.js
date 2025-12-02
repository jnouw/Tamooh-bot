import { studyStatsStore } from "../services/StudyStatsStore.js";
import { OWNER_ID } from "../services/study/config.js";
import Discord from "discord.js";

const { EmbedBuilder } = Discord;

/**
 * Check if user is admin or owner
 */
function isAdmin(message) {
  return (
    message.author.id === OWNER_ID ||
    message.member?.permissions.has("Administrator")
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
 * Handle !tickets command - manage ticket overrides
 * Usage:
 *   !tickets list
 *   !tickets clear
 *   !tickets clear @user
 *   !tickets set @user 50
 */
export async function handleTicketsCommand(message, args) {
  if (!isAdmin(message)) {
    await message.reply("❌ This command is only available to administrators.");
    return;
  }

  const action = args[0]?.toLowerCase();

  if (!action) {
    await message.reply(
      "❌ **Usage:**\n" +
        "• `!tickets list` - Show all ticket overrides\n" +
        "• `!tickets clear` - Clear all overrides\n" +
        "• `!tickets clear @user` - Clear specific user override\n" +
        "• `!tickets set @user <number>` - Set user tickets (0 to remove)"
    );
    return;
  }

  if (action === "list") {
    const overrides = studyStatsStore.getGuildTicketOverrides(message.guildId);

    if (overrides.size === 0) {
      await message.reply(
        "📋 No ticket overrides are currently set. All users use the formula: 8 + √hours × 8"
      );
      return;
    }

    const lines = Array.from(overrides.entries())
      .map(([userId, tickets]) => `• <@${userId}>: **${tickets}** tickets`)
      .join("\n");

    const embed = new EmbedBuilder()
      .setTitle("🎫 Ticket Overrides")
      .setDescription(lines)
      .setColor(0x5865f2)
      .setFooter({ text: `Total overrides: ${overrides.size}` });

    await message.reply({ embeds: [embed] });
  } else if (action === "clear") {
    const mentionedUser = message.mentions.users.first();

    if (mentionedUser) {
      // Clear specific user
      await studyStatsStore.setTicketOverride(
        mentionedUser.id,
        message.guildId,
        0
      );
      await message.reply(
        `✅ Cleared ticket override for <@${mentionedUser.id}>`
      );
    } else {
      // Clear all overrides for the guild
      const overrides = studyStatsStore.getGuildTicketOverrides(message.guildId);
      let count = 0;

      for (const [userId, _] of overrides) {
        await studyStatsStore.setTicketOverride(userId, message.guildId, 0);
        count++;
      }

      await message.reply(
        `✅ Cleared **${count}** ticket overrides. All users will now use the formula: 8 + √hours × 8`
      );
    }
  } else if (action === "set") {
    const mentionedUser = message.mentions.users.first();
    const tickets = parseInt(args[2]);

    if (!mentionedUser || isNaN(tickets) || tickets < 0) {
      await message.reply(
        "❌ **Usage:** `!tickets set @user <number>`\n" +
          "Example: `!tickets set @john 50`"
      );
      return;
    }

    await studyStatsStore.setTicketOverride(
      mentionedUser.id,
      message.guildId,
      tickets
    );

    if (tickets === 0) {
      await message.reply(
        `✅ Cleared ticket override for <@${mentionedUser.id}>. They will now use the formula: 8 + √hours × 8`
      );
    } else {
      await message.reply(
        `✅ Set ticket override for <@${mentionedUser.id}> to **${tickets} tickets**`
      );
    }
  } else {
    await message.reply(
      `❌ Unknown action: \`${action}\`\n\n` +
        "**Available actions:**\n" +
        "• `list` - Show all overrides\n" +
        "• `clear` - Clear all or specific user\n" +
        "• `set` - Set user tickets"
    );
  }
}
