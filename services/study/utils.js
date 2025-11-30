import Discord from "discord.js";
import { STUDY_LOG_CHANNEL_ID, STUDY_ROLE_ID } from "./config.js";

const { EmbedBuilder } = Discord;

/**
 * Send a log message to the study log channel
 */
export async function logToChannel(client, guildId, embed) {
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const logChannel = guild.channels.cache.get(STUDY_LOG_CHANNEL_ID);
    if (!logChannel) {
      console.warn("[Study] Log channel not found");
      return;
    }

    await logChannel.send({ embeds: [embed] });
  } catch (error) {
    console.error("[Study] Failed to send log:", error.message);
  }
}

/**
 * Auto-assign study role to user if they don't have it
 */
export async function autoAssignStudyRole(member) {
  if (!STUDY_ROLE_ID) return;

  try {
    // Check if user already has the role
    if (member.roles.cache.has(STUDY_ROLE_ID)) {
      return; // Already has the role
    }

    // Assign the role
    const role = member.guild.roles.cache.get(STUDY_ROLE_ID);
    if (!role) {
      console.warn("[Study] Study role not found for auto-assignment");
      return;
    }

    await member.roles.add(role);
    console.log(`[Study] Auto-assigned study role to ${member.user.username}`);
  } catch (error) {
    console.error("[Study] Failed to auto-assign study role:", error.message);
  }
}

/**
 * Get a motivational message based on session count
 */
export function getMotivationalMessage(sessions) {
  if (sessions === 0) return "Start your first session!";
  if (sessions < 5) return "Great start! Keep it up!";
  if (sessions < 10) return "You're building a solid habit!";
  if (sessions < 25) return "Impressive dedication!";
  if (sessions < 50) return "You're on fire! 🔥";
  if (sessions < 100) return "Study master in the making!";
  return "Legendary dedication! 🏆";
}
