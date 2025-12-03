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
