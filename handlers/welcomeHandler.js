import { EmbedBuilder } from "discord.js";
import { CONFIG } from "../config.js";
import { logger } from "../utils/logger.js";

const WELCOME_IMAGE = "https://media.discordapp.net/attachments/1421591829647982604/1484037310612770938/image.png?ex=69c010b2&is=69bebf32&hm=a9c0e4ec134e93373adb7aba09cf76d8bcc5c385af21958fe8dd594ac3db21fd&format=webp&quality=lossless&width=864&height=864&";

/**
 * Sends the Qimah welcome message tagging the new member and key channels.
 * Called after a member passes membership screening.
 * @param {import("discord.js").GuildMember} member
 */
export async function sendWelcomeMessage(member) {
  if (!CONFIG.WELCOME.ENABLED) return;

  const channelId = CONFIG.WELCOME.CHANNEL_ID;
  if (!channelId) {
    logger.warn("Welcome channel not configured (WELCOME_CHANNEL_ID)");
    return;
  }

  const channel = member.guild.channels.cache.get(channelId);
  if (!channel) {
    logger.warn("Welcome channel not found", { channelId });
    return;
  }

  const { CHAT_CHANNEL_ID, TICKETS_CHANNEL_ID, GUIDE_CHANNEL_ID, NEW_USER_VIDEO_URL } = CONFIG.WELCOME;

  const ticketsMention = TICKETS_CHANNEL_ID ? `<#${TICKETS_CHANNEL_ID}>` : `#📩open-tickets`;
  const guideMention   = GUIDE_CHANNEL_ID   ? `<#${GUIDE_CHANNEL_ID}>`   : `#❓guide-me`;
  const videoLine      = NEW_USER_VIDEO_URL
    ? `تقدر تشوف شرح مفصل هنا:\n${NEW_USER_VIDEO_URL}`
    : `تقدر تشوف شرح مفصل هنا`;

  const description = [
    `Welcome ${member} to Qimah!`,
    `حياك الله ${member} في سيرفر قمة`,
    ``,
    `**New to discord?**`,
    videoLine,
    ``,
    `**Chatting**`,
    `تبي تسولف مع المجتمع؟ اضغط هنا — <#${CHAT_CHANNEL_ID}>-💬`,
    ``,
    `**Voice Channels**`,
    `اضغط على زر المكالمة باليسار عشان تدخل مع غيرك. سلم، ذاكر، وعادي لو تجلس وتحط ميوت، ما فيها حرج.`,
    ``,
    `**Need help?**`,
    `لو احتجت مساعدة، افتح تذكرة هنا`,
    ticketsMention,
    ``,
    `ما تعرف وش هي التذكرة؟ اضغط هنا`,
    guideMention,
  ].join("\n");

  const embed = new EmbedBuilder()
    .setColor(CONFIG.WELCOME.COLOR)
    .setDescription(description)
    .setImage(WELCOME_IMAGE);

  try {
    await channel.send({ embeds: [embed] });
    logger.info("Welcome message sent", { userId: member.id, guildId: member.guild.id });
  } catch (error) {
    logger.error("Failed to send welcome message", { error: error.message, userId: member.id });
  }
}
