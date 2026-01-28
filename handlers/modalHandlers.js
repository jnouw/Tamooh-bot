import Discord from "discord.js";
import { CONFIG } from "../config.js";
import { logger } from "../utils/logger.js";
import { validateLineNumber, validateOutput, normalizeOutput } from "../utils/helpers.js";
import { gradeJava } from "../grader/SimpleJavaRunner.js";
import { sanitizeJavaCode } from "../utils/sanitize.js";
import { advance } from "./quizFlow.js";

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = Discord;

/**
 * Handle line number submission for finderror
 */
export async function handleLineSubmission(interaction, parts, session, sessionManager, scores) {
  const [_, sid, idxStr] = parts;
  const idx = parseInt(idxStr, 10);
  const q = session.items[idx];

  const lineVal = interaction.fields.getTextInputValue("line").trim();

  const validation = validateLineNumber(lineVal, q.code.length);
  if (!validation.valid) {
    await interaction.reply({
      content: `❌ ${validation.error}`,
      ephemeral: true,
    });
    return;
  }

  const lineNum = validation.value;
  sessionManager.clearTimer(session.sid, idx);

  if (lineNum !== q.correctLine) {
    session.answers[idx] = {
      kind: "finderror",
      step: "line",
      chosen: lineNum,
      correct: false,
      timestamp: new Date(),
    };

    await interaction.reply({
      content: `❌ Wrong line. The error was on line ${q.correctLine}.`,
      ephemeral: true,
    });

    await advance(interaction.channel, session, sessionManager, scores);
    return;
  }

  session.answers[idx] = {
    kind: "finderror",
    step: "line",
    chosen: lineNum,
    correct: true,
    timestamp: new Date(),
  };

  const row = new ActionRowBuilder().addComponents(
    ...q.errorOptions.map((label, i) =>
      new ButtonBuilder()
        .setCustomId(`errtype:${sid}:${idxStr}:${i}`)
        .setLabel(label)
        .setStyle(ButtonStyle.Secondary)
    )
  );

  await interaction.reply({
    content: "✅ Correct line! Now identify the error type:",
    components: [row],
    ephemeral: true,
  });

  // Start second timer for choosing the error type
  const step2Secs = CONFIG.TIMERS.FINDERROR_STEP2;
  sessionManager.startTimer(session.sid, idx, step2Secs, async () => {
    session.answers[idx].step = "complete";
    session.answers[idx].correct = false;
    session.answers[idx].timeout = true;
    try {
      await interaction.followUp({
        content: `⏰ Time's up on error type. Correct type: ${
          q.errorOptions[q.correctErrorIndex]
        }`,
        ephemeral: true,
      });
    } catch {}
    await advance(interaction.channel, session, sessionManager, scores);
  });
}

/**
 * Handle output submission
 */
export async function handleOutputSubmission(interaction, parts, session, sessionManager, scores) {
  const [_, sid, idxStr] = parts;
  const idx = parseInt(idxStr, 10);
  const q = session.items[idx];

  const userOut = interaction.fields.getTextInputValue("out");

  const validation = validateOutput(userOut);
  if (!validation.valid) {
    await interaction.reply({
      content: `❌ ${validation.error}`,
      ephemeral: true,
    });
    return;
  }

  sessionManager.clearTimer(session.sid, idx);

  const correct =
    normalizeOutput(userOut) === normalizeOutput(q.expectedOutput);

  if (correct) session.score += 1;

  session.answers[idx] = {
    kind: "output",
    submitted: userOut,
    correct,
    timestamp: new Date(),
  };

  const feedback = correct
    ? "✅ Correct!"
    : "❌ Wrong.\n\n**Expected:**\n```\n" + q.expectedOutput + "\n```";

  await interaction.reply({
    content: feedback,
    ephemeral: true,
  });

  await advance(interaction.channel, session, sessionManager, scores);
}

/**
 * Handle code submission
 */
export async function handleCodeSubmission(interaction, parts, session, sessionManager, scores) {
  const [_, sid, idxStr] = parts;
  const idx = parseInt(idxStr, 10);
  const p = session.items[idx];

  const code = interaction.fields.getTextInputValue("code");

  const sanitizeResult = sanitizeJavaCode(code);
  if (!sanitizeResult.valid) {
    await interaction.reply({
      content: `❌ ${sanitizeResult.error}`,
      ephemeral: true,
    });
    return;
  }

  if (code.length > CONFIG.MAX_CODE_LENGTH) {
    await interaction.reply({
      content: `❌ Code too long (max ${CONFIG.MAX_CODE_LENGTH} characters).`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  sessionManager.clearTimer(session.sid, idx);

  let result;
  try {
    const timeoutMs = Math.min(
      p.timeoutMs ?? CONFIG.CODE_TIMEOUT_MS,
      CONFIG.MAX_TEST_TIMEOUT_MS
    );
    result = await gradeJava({
      code,
      tests: p.tests,
      timeoutMs,
    });
  } catch (error) {
    logger.error("Grader crashed", {
      error: error.message,
      userId: session.userId,
    });
    await interaction.editReply({
      content: "❌ Grader error: Unable to test your code. Please try again.",
    });
    return;
  }

  let msg;
  if (!result.ok) {
    msg = `❌ **Error**\n\`\`\`\n${result.error || "Unknown error"}\n\`\`\``;
  } else {
    const testResults = result.results
      .map((r) => {
        const status = r.pass ? "✅" : "❌";
        const detail = r.pass ? "" : ` - ${r.err || "Failed"}`;
        return `${status} Test ${r.i + 1}${detail} (${r.ms}ms)`;
      })
      .join("\n");

    msg = `**Results: ${result.passed}/${result.total} passed**\n${testResults}`;
  }

  const correct = result.ok && result.passed === result.total;
  if (correct) session.score += 1;

  session.answers[idx] = {
    kind: "code",
    passed: result.passed || 0,
    total: result.total || p.tests.length,
    correct,
    timestamp: new Date(),
  };

  await interaction.editReply({ content: msg });
  await advance(interaction.channel, session, sessionManager, scores);
}
