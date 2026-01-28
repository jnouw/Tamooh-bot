import Discord from "discord.js";
import { CONFIG } from "../config.js";
import { logger } from "../utils/logger.js";
import { sendQuestion } from "../services/questionService.js";

const { EmbedBuilder } = Discord;

/**
 * Advance to next question or finish quiz
 */
export async function advance(channel, session, sessionManager, scores) {
  session.index += 1;

  if (session.index >= session.items.length) {
    session.finished = true;
    await showSummary(channel, session, scores);
    sessionManager.finishSession(session.sid);
  } else {
    await sendQuestion(channel, session, sessionManager, (ch, sess) => advance(ch, sess, sessionManager, scores));
  }
}

/**
 * Show quiz summary
 */
async function showSummary(channel, session, scores) {
  const total = session.items.length;
  const pct = Math.round((session.score / total) * 100);

  const lines = session.items.map((_, i) => {
    const a = session.answers[i];
    const mark = a?.correct ? "✅" : a?.timeout ? "⏰" : "❌";
    return `${mark} Question ${i + 1}`;
  });

  const performanceEmoji =
    pct >= 80 ? "🎉" : pct >= 60 ? "👍" : pct >= 40 ? "📚" : "💪";

  const embed = new EmbedBuilder()
    .setTitle(`${performanceEmoji} Quiz Complete!`)
    .setDescription(lines.join("\n"))
    .addFields({
      name: "Final Score",
      value: `**${session.score}/${total}** (${pct}%)`,
      inline: true,
    })
    .setColor(pct >= 70 ? "#57F287" : pct >= 40 ? "#FEE75C" : "#ED4245")
    .setFooter({ text: "Great job! Use /quiz start to try again" });

  await channel.send({ content: `<@${session.userId}>`, embeds: [embed] });

  // Record result for leaderboard
  try {
    await scores.record({
      guildId: session.guildId,
      userId: session.userId,
      mode: session.mode,
      score: session.score,
      total,
      chapter: session.chapter ?? null,
    });
    await scores.save();
  } catch (e) {
    logger.error("Failed to record score", { error: e.message });
  }

  // Optional thread deletion
  if (CONFIG.THREAD_DELETE_ON_SUMMARY && channel.isThread()) {
    setTimeout(async () => {
      try {
        await channel.delete();
        logger.info("Thread deleted", { channelId: channel.id });
      } catch (error) {
        logger.error("Failed to delete thread", { error: error.message });
      }
    }, CONFIG.THREAD_DELETE_DELAY_MS);
  }

  logger.info("Quiz completed", {
    userId: session.userId,
    mode: session.mode,
    score: session.score,
    total,
    percentage: pct,
  });
}
