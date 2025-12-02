import Discord from "discord.js";
import { studyStatsStore } from "../StudyStatsStore.js";

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = Discord;

/**
 * AFK Checker - sends DMs to users after sessions to verify they're not AFK
 * Users have 5 minutes to respond or their session won't count
 */
class AFKChecker {
  constructor() {
    // Map of messageId -> { userId, sessionId, guildId, timestamp }
    this.pendingChecks = new Map();

    // Map of sessionId -> Set of userIds who responded
    this.responses = new Map();
  }

  /**
   * Send AFK check DM to a user
   * @param {Discord.User} user - Discord user
   * @param {number} sessionId - Session ID in stats store
   * @param {string} guildId - Guild ID
   * @param {number} duration - Session duration in minutes
   * @returns {Promise<boolean>} - Whether DM was sent successfully
   */
  async sendAFKCheck(user, sessionId, guildId, duration) {
    try {
      const embed = new EmbedBuilder()
        .setTitle("✅ Study Session Complete!")
        .setColor(0x5865F2)
        .setDescription(
          `You've completed a **${duration}-minute** study session!\n\n` +
          `**⚠️ Please confirm you were actively studying:**\n` +
          `Click the button below within **5 minutes** to count this session.\n\n` +
          `If you don't respond, this session won't be counted.`
        )
        .setFooter({ text: "⏰ You have 5 minutes to respond" })
        .setTimestamp();

      const button = new ButtonBuilder()
        .setCustomId(`afk_check_${sessionId}_${guildId}_${user.id}`)
        .setLabel("✅ I was studying!")
        .setStyle(ButtonStyle.Success);

      const row = new ActionRowBuilder().addComponents(button);

      const dmMessage = await user.send({ embeds: [embed], components: [row] });

      // Store pending check
      this.pendingChecks.set(dmMessage.id, {
        userId: user.id,
        sessionId,
        guildId,
        timestamp: Date.now()
      });

      console.log(`[AFKChecker] Sent AFK check to ${user.username} for session ${sessionId}`);

      // Set timeout to invalidate session if no response after 5 minutes
      setTimeout(() => {
        this.handleTimeout(dmMessage.id, user, sessionId);
      }, 5 * 60 * 1000); // 5 minutes

      return true;
    } catch (error) {
      console.error(`[AFKChecker] Failed to send AFK check to ${user.username}:`, error.message);

      // If we can't send DM, invalidate the session immediately
      await studyStatsStore.updateSessionValidity(sessionId, false);

      return false;
    }
  }

  /**
   * Handle button click response
   * @param {Discord.ButtonInteraction} interaction - Button interaction
   */
  async handleResponse(interaction) {
    const [_, __, sessionId, guildId, userId] = interaction.customId.split('_');

    if (interaction.user.id !== userId) {
      await interaction.reply({
        content: "❌ This check is not for you!",
        ephemeral: true
      });
      return;
    }

    // Check if already responded
    const sessionResponses = this.responses.get(parseInt(sessionId)) || new Set();
    if (sessionResponses.has(userId)) {
      await interaction.reply({
        content: "✅ You've already confirmed this session!",
        ephemeral: true
      });
      return;
    }

    // Mark as responded
    sessionResponses.add(userId);
    this.responses.set(parseInt(sessionId), sessionResponses);

    // Update session validity (will be valid only if no gaming was detected)
    const session = await studyStatsStore.updateSessionValidity(parseInt(sessionId), true);

    // Update the DM message
    const validEmbed = new EmbedBuilder()
      .setTitle("✅ Response Confirmed!")
      .setColor(0x57F287)
      .setDescription(
        session?.valid
          ? `**Your session has been counted!**\n\nKeep up the great work! 💪`
          : `**Response received!**\n\nYour session is being processed.`
      )
      .setTimestamp();

    await interaction.update({ embeds: [validEmbed], components: [] });

    console.log(`[AFKChecker] User ${userId} confirmed session ${sessionId} - Valid: ${session?.valid}`);
  }

  /**
   * Handle timeout (user didn't respond)
   * @param {string} messageId - DM message ID
   * @param {Discord.User} user - Discord user
   * @param {number} sessionId - Session ID
   */
  async handleTimeout(messageId, user, sessionId) {
    const check = this.pendingChecks.get(messageId);
    if (!check) return; // Already handled

    const sessionResponses = this.responses.get(sessionId) || new Set();
    if (sessionResponses.has(check.userId)) {
      // User already responded, no need to invalidate
      this.pendingChecks.delete(messageId);
      return;
    }

    // User didn't respond - invalidate session
    await studyStatsStore.updateSessionValidity(sessionId, false);

    console.log(`[AFKChecker] User ${user.username} didn't respond to AFK check for session ${sessionId} - invalidated`);

    // Try to update the DM to show timeout
    try {
      const channel = await user.createDM();
      const dmMessage = await channel.messages.fetch(messageId);

      const timeoutEmbed = new EmbedBuilder()
        .setTitle("⏰ Time's Up!")
        .setColor(0xE74C3C)
        .setDescription(
          `You didn't respond within 5 minutes.\n\n` +
          `**This session will not be counted.**\n\n` +
          `Make sure to respond next time to get credit for your study time!`
        )
        .setTimestamp();

      await dmMessage.edit({ embeds: [timeoutEmbed], components: [] });
    } catch (error) {
      console.log(`[AFKChecker] Could not update timeout message for ${user.username}`);
    }

    // Clean up
    this.pendingChecks.delete(messageId);
  }

  /**
   * Clean up old pending checks (older than 10 minutes)
   */
  cleanup() {
    const now = Date.now();
    const tenMinutes = 10 * 60 * 1000;

    // Clean up old pending checks
    for (const [messageId, check] of this.pendingChecks.entries()) {
      if (now - check.timestamp > tenMinutes) {
        this.pendingChecks.delete(messageId);

        // Also clean up the response tracking for this session if no more pending checks
        const stillHasPendingForSession = Array.from(this.pendingChecks.values())
          .some(c => c.sessionId === check.sessionId);

        if (!stillHasPendingForSession) {
          this.responses.delete(check.sessionId);
        }
      }
    }
  }
}

// Export singleton instance
export const afkChecker = new AFKChecker();

// Clean up old checks every 5 minutes
setInterval(() => {
  afkChecker.cleanup();
}, 5 * 60 * 1000);

/**
 * Handle AFK check button interaction
 * @param {Discord.ButtonInteraction} interaction - Button interaction
 */
export async function handleAFKCheck(interaction) {
  await afkChecker.handleResponse(interaction);
}
