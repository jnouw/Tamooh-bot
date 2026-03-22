import { EmbedBuilder, AttachmentBuilder } from "discord.js";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { CONFIG } from "../config.js";
import { suggestionStore } from "../services/SuggestionStore.js";
import { logger } from "../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WELCOME_IMAGE_PATH = join(__dirname, "../assets/welcome.png");

/**
 * Sends the Qimah welcome message tagging the new member and key channels.
 * Called after a member passes membership screening.
 * Uses DB-backed dedup so it fires exactly once per user even across restarts.
 * @param {import("discord.js").GuildMember} member
 * @param {boolean} force - skip dedup check (for !testwelcome)
 */
export async function sendWelcomeMessage(member, force = false) {
  if (!CONFIG.WELCOME.ENABLED) return;

  // DB-backed dedup — persistent fallback across restarts
  if (!force) {
    try {
      if (!suggestionStore.canWelcome(member.id)) {
        logger.info("Welcome already sent, skipping", { userId: member.id });
        return;
      }
      suggestionStore.markWelcomed(member.id);
    } catch (err) {
      logger.error("Welcome dedup DB error", { error: err.message, userId: member.id });
      // Continue — the in-memory Set in index.js already guards against duplicates
    }
  }

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

  const hasImage = existsSync(WELCOME_IMAGE_PATH);

  const embed = new EmbedBuilder()
    .setColor(CONFIG.WELCOME.COLOR)
    .setDescription(description);

  if (hasImage) {
    embed.setImage("attachment://welcome.png");
  }

  const payload = { embeds: [embed] };
  if (hasImage) {
    payload.files = [new AttachmentBuilder(WELCOME_IMAGE_PATH, { name: "welcome.png" })];
  }

  try {
    await channel.send(payload);
    logger.info("Welcome message sent", { userId: member.id, guildId: member.guild.id });
  } catch (error) {
    logger.error("Failed to send welcome message", { error: error.message, userId: member.id });
  }
}
