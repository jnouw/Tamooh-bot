import Discord from "discord.js";
import { STUDY_LOG_CHANNEL_ID, STUDY_ROLE_ID, STUDY_CHANNEL_ID } from "./config.js";

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

/**
 * Announce a milestone achievement in the study channel
 */
export async function announceMilestone(client, guildId, userId, milestone, totalStats) {
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const studyChannel = guild.channels.cache.get(STUDY_CHANNEL_ID);
    if (!studyChannel) {
      console.warn("[Study] Study channel not found for milestone announcement");
      return;
    }

    let title, description, color;

    if (milestone.type === 'first_session') {
      title = "🎉 First Session Complete!";
      description = `<@${userId}> just completed their first study session!\n\nWelcome to the journey! 🚀`;
      color = 0x57F287; // Green
    } else if (milestone.type === 'hours') {
      const hours = milestone.value;
      title = `🏆 ${hours} Hour Milestone!`;

      let emoji = "⭐";
      let message = "Keep up the great work!";

      if (hours >= 100) {
        emoji = "👑";
        message = "Legendary dedication!";
      } else if (hours >= 72) {
        emoji = "💎";
        message = "You're a study champion!";
      } else if (hours >= 48) {
        emoji = "🔥";
        message = "Unstoppable progress!";
      } else if (hours >= 24) {
        emoji = "💪";
        message = "Amazing commitment!";
      }

      description = `${emoji} <@${userId}> just reached **${hours} hours** of study time!\n\n` +
                   `**Total Stats:**\n` +
                   `⏱️ ${totalStats.totalHours} hours\n` +
                   `📚 ${totalStats.totalSessions} sessions completed\n\n` +
                   `${message}`;
      color = 0xFFD700; // Gold
    }

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(color)
      .setDescription(description)
      .setTimestamp();

    await studyChannel.send({ embeds: [embed] });
    console.log(`[Study] Announced milestone for user ${userId}: ${milestone.type} - ${milestone.value}`);

  } catch (error) {
    console.error("[Study] Failed to announce milestone:", error.message);
  }
}
