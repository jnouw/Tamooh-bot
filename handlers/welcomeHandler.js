import { EmbedBuilder } from "discord.js";
import { existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { CONFIG } from "../config.js";
import { logger } from "../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WELCOME_IMAGE_URL = "https://media.discordapp.net/attachments/1421591829647982604/1484037310612770938/image.png?ex=69c7f9b2&is=69c6a832&hm=6adc43855229b126060187d3c81ae805b7019de718038957629ac4020389d751&=&format=webp&quality=lossless&width=864&height=864";

// Persistent store — ensures welcome fires exactly once per user, even across restarts
const dataDir = join(__dirname, "../data");
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
const _db = new Database(join(dataDir, "welcome.db"));
_db.pragma("journal_mode = WAL");
_db.exec(`
  CREATE TABLE IF NOT EXISTS welcomed_users (
    discord_id TEXT PRIMARY KEY,
    welcomed_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  )
`);

function hasBeenWelcomed(userId) {
  return !!_db.prepare("SELECT 1 FROM welcomed_users WHERE discord_id = ?").get(userId);
}

function markWelcomed(userId) {
  _db.prepare("INSERT OR IGNORE INTO welcomed_users (discord_id) VALUES (?)").run(userId);
}

/**
 * Sends the Qimah welcome message tagging the new member and key channels.
 * Called after a member passes membership screening.
 * @param {import("discord.js").GuildMember} member
 * @param {boolean} force - bypass dedup (for testing)
 */
export async function sendWelcomeMessage(member, force = false) {
  if (!CONFIG.WELCOME.ENABLED) return;
  if (!force && hasBeenWelcomed(member.id)) {
    logger.info("Welcome already sent, skipping", { userId: member.id });
    return;
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

  const description = [
    `Welcome ${member} to Qimah!`,
    `حياك الله ${member} في سيرفر قمة`,
    ``,
    `**New to discord?**`,
    `تقدر تشوف شرح مفصل هنا:`,
    NEW_USER_VIDEO_URL ?? ``,
    ``,
    `**Chatting:**`,
    `تبي تسولف مع المجتمع؟ اضغط هنا —`,
    `<#${CHAT_CHANNEL_ID}>`,
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
    .setImage(WELCOME_IMAGE_URL);

  const payload = { embeds: [embed] };

  // Mark BEFORE sending so concurrent events can't slip through
  markWelcomed(member.id);
  try {
    await channel.send(payload);
    logger.info("Welcome message sent", { userId: member.id, guildId: member.guild.id });
  } catch (error) {
    logger.error("Failed to send welcome message", { error: error.message, userId: member.id });
  }
}
