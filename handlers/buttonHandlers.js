import Discord from "discord.js";
import { CONFIG } from "../config.js";
import { letter } from "../utils/helpers.js";
import { sendQuestion } from "../services/questionService.js";
import { advance } from "./quizHandlers.js";

const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle } = Discord;

/**
 * Handle MCQ answer selection
 */
export async function handleMCQAnswer(interaction, parts, session, sessionManager, scores) {
  const [_, sid, idxStr, choiceStr] = parts;
  const idx = parseInt(idxStr, 10);
  const choice = parseInt(choiceStr, 10);

  if (session.mode !== "mcq") return;

  if (session.answers[idx] && !session.answers[idx].timeout) {
    await interaction.reply({
      content: "⚠️ You already answered this question!",
      ephemeral: true,
    });
    return;
  }

  sessionManager.clearTimer(session.sid, idx);

  const q = session.items[idx];
  const correct = choice === q.answerIndex;

  if (correct) session.score += 1;

  session.answers[idx] = {
    kind: "mcq",
    chosen: choice,
    correct,
    timestamp: new Date(),
  };

  // Disable buttons on the message after answering
  try {
    await interaction.message.edit({ components: [] });
  } catch {}

  const feedback = correct
    ? "✅ Correct!"
    : `❌ Wrong. Correct answer: ${letter(q.answerIndex)}`;

  if (q.explanation && !correct) {
    await interaction.reply({
      content: `${feedback}\n💡 ${q.explanation}`,
      ephemeral: true,
    });
  } else {
    await interaction.reply({
      content: feedback,
      ephemeral: true,
    });
  }

  await advance(interaction.channel, session, sessionManager, scores);
}

/**
 * Show modal for line number input
 */
export async function handleOpenLineModal(interaction, parts, session) {
  const [_, sid, idxStr] = parts;
  const idx = parseInt(idxStr, 10);

  if (session.mode !== "finderror") return;

  if (session.answers[idx] && !session.answers[idx].timeout) {
    await interaction.reply({
      content: "⚠️ You already answered this question!",
      ephemeral: true,
    });
    return;
  }

  const q = session.items[idx];
  const modal = new ModalBuilder()
    .setCustomId(`line:${sid}:${idxStr}`)
    .setTitle("Enter the error line number")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("line")
          .setLabel(`Line number (1-${q.code.length})`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("e.g., 3")
      )
    );

  await interaction.showModal(modal);
}

/**
 * Handle error type selection
 */
export async function handleErrorTypeAnswer(interaction, parts, session, sessionManager, scores) {
  const [_, sid, idxStr, optStr] = parts;
  const idx = parseInt(idxStr, 10);
  const opt = parseInt(optStr, 10);

  if (session.mode !== "finderror") return;

  sessionManager.clearTimer(session.sid, idx);

  const q = session.items[idx];
  const correct = opt === q.correctErrorIndex;

  if (correct) session.score += 1;

  session.answers[idx].step = "complete";
  session.answers[idx].errorType = opt;
  session.answers[idx].correct = correct;

  // Disable the error-type buttons in the ephemeral message
  try {
    await interaction.message.edit({ components: [] });
  } catch {}

  const feedback = correct
    ? "✅ Correct!"
    : `❌ Wrong. Correct error type: ${q.errorOptions[q.correctErrorIndex]}`;

  await interaction.reply({
    content: feedback,
    ephemeral: true,
  });

  await advance(interaction.channel, session, sessionManager, scores);
}

/**
 * Show modal for output submission
 */
export async function handleOpenOutputModal(interaction, parts, session) {
  const [_, sid, idxStr] = parts;

  if (session.mode !== "output") return;

  const idx = parseInt(idxStr, 10);

  if (session.answers[idx] && !session.answers[idx].timeout) {
    await interaction.reply({
      content: "⚠️ You already answered this question!",
      ephemeral: true,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`out:${sid}:${idxStr}`)
    .setTitle("What is the output?")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("out")
          .setLabel("Output (include all console output)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder("Enter the exact output...")
      )
    );

  await interaction.showModal(modal);
}

/**
 * Show modal for code submission
 */
export async function handleOpenCodeModal(interaction, parts, session) {
  const [_, sid, idxStr] = parts;

  if (session.mode !== "code") return;

  const idx = parseInt(idxStr, 10);

  if (session.answers[idx] && !session.answers[idx].timeout) {
    await interaction.reply({
      content: "⚠️ You already answered this question!",
      ephemeral: true,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`code:${sid}:${idxStr}`)
    .setTitle("Submit your solution")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("code")
          .setLabel("Paste your complete Java code")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder(
            "import java.util.Scanner;\n\npublic class Main {\n  public static void main(String[] args) {\n    // your code\n  }\n}"
          )
      )
    );

  await interaction.showModal(modal);
}

/**
 * Handle resume button
 */
export async function handleResumeButton(interaction, parts, sessionManager, scores) {
  const sid = parts[1];
  const session = sessionManager.getSession(sid);
  if (!session) {
    await interaction.update({
      content: "⚠️ Quiz session expired. Start a new one.",
      embeds: [],
      components: [],
    });
    return;
  }
  const channel = await interaction.client.channels.fetch(session.channelId);
  await interaction.update({
    content: `✅ Resuming your quiz in ${channel}`,
    embeds: [],
    components: [],
  });
  await sendQuestion(channel, session, sessionManager, (ch, sess) => advance(ch, sess, sessionManager, scores));
}

/**
 * Handle cancel button
 */
export async function handleCancelButton(interaction, parts, sessionManager) {
  const sid = parts[1];
  const session = sessionManager.getSession(sid);
  if (session) sessionManager.removeSession(sid);
  await interaction.update({
    content: "✅ Previous quiz cancelled. Use `/quiz start` to begin again.",
    embeds: [],
    components: [],
  });
}
