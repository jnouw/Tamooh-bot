import Discord from "discord.js";
import { CONFIG } from "../config.js";
import { logger } from "../utils/logger.js";
import { checkRateLimit, updateRateLimit } from "../utils/rateLimit.js";
import { sendQuestion } from "../services/questionService.js";

const { ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = Discord;

/**
 * Start a new quiz
 */
export async function handleQuizStart(interaction, questionLoader, sessionManager, scores, javaAvailable) {
  const mode = interaction.options.getString("mode");
  const chapter = interaction.options.getString("chapter") ?? null;
  const privatethread = interaction.options.getBoolean("privatethread") ?? true;

  // Check rate limit
  const rateLimit = checkRateLimit(interaction.user.id);
  if (!rateLimit.allowed) {
    await interaction.reply({ content: rateLimit.message, ephemeral: true });
    return;
  }

  // Warn if Java is not available for code mode
  if (mode === "code" && !javaAvailable) {
    await interaction.reply({
      content:
        "⚠️ Java runtime is not available. Coding challenges cannot be graded. Please contact an administrator.",
      ephemeral: true,
    });
    return;
  }

  // Get fixed count for this mode
  const count = CONFIG.QUESTION_COUNTS[mode] || 5;

  // Check for existing session - offer resume or cancel
  if (
    sessionManager.hasActiveSession(interaction.user.id, interaction.guildId)
  ) {
    const existingSession = sessionManager.getUserSession(
      interaction.user.id,
      interaction.guildId
    );

    if (existingSession) {
      const embed = new EmbedBuilder()
        .setTitle("⚠️ Active Quiz Found")
        .setDescription(
          `You already have a **${existingSession.mode}** quiz in progress.\n\n` +
            `Progress: Question ${existingSession.index + 1}/${
              existingSession.items.length
            }\n` +
            `Score: ${existingSession.score}/${existingSession.index}\n\n` +
            `What would you like to do?`
        )
        .setColor("#FEE75C");

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`resume:${existingSession.sid}`)
          .setLabel("📖 Resume Quiz")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`cancel:${existingSession.sid}`)
          .setLabel("🗑️ Cancel & Start New")
          .setStyle(ButtonStyle.Danger)
      );

      await interaction.reply({
        embeds: [embed],
        components: [row],
        ephemeral: true,
      });
      return;
    }
  }

  // Load questions
  let items;
  try {
    items = await questionLoader.getQuestions(mode, count, chapter);
  } catch (error) {
    logger.error("Failed to load questions", {
      mode,
      chapter,
      error: error.message,
    });
    await interaction.reply({
      content: `❌ ${error.message}`,
      ephemeral: true,
    });
    return;
  }

  // If fewer questions available, just use what we have
  if (items.length === 0) {
    await interaction.reply({
      content: "❌ No questions available for the selected criteria.",
      ephemeral: true,
    });
    return;
  }

  const actualCount = items.length;
  const countMessage = actualCount < count ? ` (${actualCount} available)` : "";

  // Create thread if requested
  let channel = interaction.channel;
  if (privatethread && interaction.channel?.type === ChannelType.GuildText) {
    try {
      channel = await interaction.channel.threads.create({
        name: `quiz-${interaction.user.username}-${Date.now()
          .toString()
          .slice(-5)}`,
        autoArchiveDuration: CONFIG.THREAD_AUTO_ARCHIVE_MINUTES,
        type: ChannelType.PrivateThread,
        invitable: false,
      });

      // Ensure the quiz participant can access the private thread
      try {
        await channel.members.add(interaction.user.id);
      } catch (error) {
        logger.warn("Failed to add user to private quiz thread", {
          error: error.message,
          channelId: channel.id,
          userId: interaction.user.id,
        });
        // Fall back to the original channel if we can't add them
        channel = interaction.channel;
      }
    } catch (error) {
      logger.error("Failed to create thread", { error: error.message });
    }
  }

  // Update rate limit
  updateRateLimit(interaction.user.id);

  const location =
    channel.id !== interaction.channel.id ? ` in ${channel}` : "";
  await interaction.reply({
    content: `🎯 Starting **${mode}** quiz with ${actualCount} question(s)${countMessage}${location}`,
    ephemeral: true,
  });

  const session = sessionManager.createSession({
    mode,
    items,
    userId: interaction.user.id,
    guildId: interaction.guildId,
    channelId: channel.id,
    chapter,
  });

  logger.info("Quiz started", {
    userId: interaction.user.id,
    mode,
    count: actualCount,
    chapter,
  });

  await sendQuestion(channel, session, sessionManager, (ch, sess) => advance(ch, sess, sessionManager, scores));
}

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
