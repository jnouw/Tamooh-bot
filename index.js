import "dotenv/config";
import Discord from "discord.js";

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = Discord;

import { SessionManager } from "./services/SessionManager.js";
import { QuestionLoader } from "./services/QuestionLoader.js";
import { gradeJava, checkJavaAvailable } from "./grader/SimpleJavaRunner.js";
import { CONFIG } from "./config.js";
import { logger } from "./utils/logger.js";
import {
  validateLineNumber,
  validateOutput,
  normalizeOutput,
  codeWithLineNumbers,
  letter,
} from "./utils/helpers.js";
import { ScoreStore } from "./services/ScoreStore.js";
import { sanitizeJavaCode } from "./utils/sanitize.js"; // NEW IMPORT
import { setupStudySystem } from "./services/study.js"; // ✅ STUDY FEATURE

// Initialize services
const questionLoader = new QuestionLoader();
const sessionManager = new SessionManager();
const scores = new ScoreStore();

// Rate limiting map: userId -> timestamp of last quiz start
const rateLimitMap = new Map();

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});


// ✅ Init Study With Me system (buttons + VC + logging)
setupStudySystem(client);

// Check Java availability on startup
let javaAvailable = false;
checkJavaAvailable().then((available) => {
  javaAvailable = available;
  if (available) {
    logger.info("Java runtime detected");
  } else {
    logger.error("Java runtime not found - coding challenges will fail!");
    console.error(
      "⚠️  WARNING: Java is not available. Install Java to enable coding challenges."
    );
  }
});

client.once("ready", () => {
  logger.info(`Bot logged in as ${client.user.tag}`);
  console.log(`✅ Logged in as ${client.user.tag}`);

  // Start health check if configured
  if (CONFIG.LOG_STATS && CONFIG.HEALTH_CHECK_INTERVAL_MS) {
    startHealthCheck();
  }
});

/**
 * Periodic health check
 */
function startHealthCheck() {
  setInterval(() => {
    const sessionStats = sessionManager.getStats();
    const scoreStats = scores.getStats();

    logger.info("Health check", {
      sessions: sessionStats,
      scores: scoreStats,
      uptime: Math.floor(process.uptime()),
      memory: Math.floor(process.memoryUsage().heapUsed / 1024 / 1024) + "MB",
    });
  }, CONFIG.HEALTH_CHECK_INTERVAL_MS);
}

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction);
    } else if (interaction.isButton()) {
      await handleButton(interaction);
    } else if (interaction.isModalSubmit()) {
      await handleModalSubmit(interaction);
    }
  } catch (error) {
    logger.error("Interaction error", {
      error: error.message,
      stack: error.stack,
    });
    console.error("Error handling interaction:", error);

    const errorMessage = {
      content:
        "❌ An unexpected error occurred. Please try starting a new quiz with `/quiz start`",
      ephemeral: true,
    };

    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMessage);
      } else if (interaction.isRepliable()) {
        await interaction.reply(errorMessage);
      }
    } catch (replyError) {
      logger.error("Failed to send error message", {
        error: replyError.message,
      });
    }
  }
});

/**
 * Handle slash commands
 */
async function handleSlashCommand(interaction) {
  if (interaction.commandName !== "quiz") return;

  // Lock to Qimah guild if env is set
  if (
    process.env.QIMAH_GUILD_ID &&
    interaction.guildId !== process.env.QIMAH_GUILD_ID
  ) {
    await interaction.reply({
      content: "This bot is locked to the Qimah server.",
      ephemeral: true,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "start") {
    await handleQuizStart(interaction);
  } else if (subcommand === "leaderboard") {
    await handleLeaderboard(interaction);
  } else if (subcommand === "stats") {
    await handleMyStats(interaction);
  }
}

/**
 * Check rate limit for user
 */
function checkRateLimit(userId) {
  if (!CONFIG.RATE_LIMIT.ENABLED) return { allowed: true };

  const lastStart = rateLimitMap.get(userId);
  const now = Date.now();

  if (lastStart) {
    const timeSince = now - lastStart;
    if (timeSince < CONFIG.RATE_LIMIT.QUIZ_START_COOLDOWN_MS) {
      const remaining = Math.ceil(
        (CONFIG.RATE_LIMIT.QUIZ_START_COOLDOWN_MS - timeSince) / 1000
      );
      return {
        allowed: false,
        message: `⏳ Please wait ${remaining} seconds before starting another quiz.`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Update rate limit for user
 */
function updateRateLimit(userId) {
  rateLimitMap.set(userId, Date.now());

  // Clean up old entries (older than 1 hour)
  if (rateLimitMap.size > 1000) {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [id, timestamp] of rateLimitMap.entries()) {
      if (timestamp < cutoff) {
        rateLimitMap.delete(id);
      }
    }
  }
}

/**
 * Start a new quiz
 */
async function handleQuizStart(interaction) {
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

  await sendQuestion(channel, session);
}

async function handleButton(interaction) {
  const parts = interaction.customId.split(":");
  const kind = parts[0];

  // Resume / cancel flow
  if (kind === "resume") {
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
    await sendQuestion(channel, session);
    return;
  }

  if (kind === "cancel") {
    const sid = parts[1];
    const session = sessionManager.getSession(sid);
    if (session) sessionManager.removeSession(sid);
    await interaction.update({
      content: "✅ Previous quiz cancelled. Use `/quiz start` to begin again.",
      embeds: [],
      components: [],
    });
    return;
  }

  // Regular question actions below require a valid session and the same user
  const session = sessionManager.getSession(parts[1]);
  if (!session) {
    await interaction.reply({
      content: "⚠️ This quiz session has expired.",
      ephemeral: true,
    });
    return;
  }
  if (session.userId !== interaction.user.id) {
    await interaction.reply({
      content: "⚠️ This is not your quiz.",
      ephemeral: true,
    });
    return;
  }

  switch (kind) {
    case "mcq":
      await handleMCQAnswer(interaction, parts, session);
      break;
    case "openline":
      await handleOpenLineModal(interaction, parts, session);
      break;
    case "errtype":
      await handleErrorTypeAnswer(interaction, parts, session);
      break;
    case "openout":
      await handleOpenOutputModal(interaction, parts, session);
      break;
    case "opencode":
      await handleOpenCodeModal(interaction, parts, session);
      break;
  }
}

/**
 * Handle MCQ answer selection
 */
async function handleMCQAnswer(interaction, parts, session) {
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

  await advance(interaction.channel, session);
}

/**
 * Show modal for line number input
 */
async function handleOpenLineModal(interaction, parts, session) {
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
async function handleErrorTypeAnswer(interaction, parts, session) {
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

  await advance(interaction.channel, session);
}

/**
 * Show modal for output submission
 */
async function handleOpenOutputModal(interaction, parts, session) {
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
async function handleOpenCodeModal(interaction, parts, session) {
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
 * Handle modal submissions
 */
async function handleModalSubmit(interaction) {
  const parts = interaction.customId.split(":");
  const kind = parts[0];
  const sid = parts[1];

  const session = sessionManager.getSession(sid);
  if (!session) {
    await interaction.reply({
      content: "⚠️ This quiz session has expired.",
      ephemeral: true,
    });
    return;
  }

  if (session.userId !== interaction.user.id) return;

  switch (kind) {
    case "line":
      await handleLineSubmission(interaction, parts, session);
      break;
    case "out":
      await handleOutputSubmission(interaction, parts, session);
      break;
    case "code":
      await handleCodeSubmission(interaction, parts, session);
      break;
  }
}

/**
 * Handle line number submission for finderror
 */
async function handleLineSubmission(interaction, parts, session) {
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

    await advance(interaction.channel, session);
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
    await advance(interaction.channel, session);
  });
}

/**
 * Handle output submission
 */
async function handleOutputSubmission(interaction, parts, session) {
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

  await advance(interaction.channel, session);
}

/**
 * Handle code submission
 */
async function handleCodeSubmission(interaction, parts, session) {
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
  await advance(interaction.channel, session);
}

/**
 * Send a question to the channel
 */
async function sendQuestion(channel, session) {
  const idx = session.index;
  const total = session.items.length;
  const footer = `Question ${idx + 1}/${total}`;

  switch (session.mode) {
    case "mcq":
      await sendMCQQuestion(channel, session, footer);
      break;
    case "finderror":
      await sendFinderrorQuestion(channel, session, footer);
      break;
    case "output":
      await sendOutputQuestion(channel, session, footer);
      break;
    case "code":
      await sendCodeQuestion(channel, session, footer);
      break;
  }
}

/**
 * Send MCQ question
 */
async function sendMCQQuestion(channel, session, footer) {
  const idx = session.index;
  const q = session.items[idx];
  const secs = Math.max(
    CONFIG.MIN_TIME_SECONDS,
    q.timeSec ?? CONFIG.TIMERS.MCQ
  );

  const embed = new EmbedBuilder()
    .setTitle(q.prompt)
    .setColor("#5865F2")
    .setFooter({ text: `${footer} • ${secs}s` });

  if (q.image) embed.setImage(q.image);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`mcq:${session.sid}:${idx}:0`)
      .setLabel(`A) ${q.choices[0]}`)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`mcq:${session.sid}:${idx}:1`)
      .setLabel(`B) ${q.choices[1]}`)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`mcq:${session.sid}:${idx}:2`)
      .setLabel(`C) ${q.choices[2]}`)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`mcq:${session.sid}:${idx}:3`)
      .setLabel(`D) ${q.choices[3]}`)
      .setStyle(ButtonStyle.Secondary)
  );

  const msg = await channel.send({
    content: `<@${session.userId}>`,
    embeds: [embed],
    components: [row],
  });

  sessionManager.startTimer(session.sid, idx, secs, async () => {
    session.answers[idx] = {
      kind: "mcq",
      chosen: null,
      correct: false,
      timeout: true,
    };
    try {
      await msg.edit({ components: [] });
    } catch {}
    await channel.send(
      `⏰ Time's up! Correct answer: **${letter(q.answerIndex)}**`
    );
    await advance(channel, session);
  });
}

/**
 * Send finderror question
 */
async function sendFinderrorQuestion(channel, session, footer) {
  const idx = session.index;
  const q = session.items[idx];
  const secs = Math.max(
    CONFIG.MIN_TIME_SECONDS,
    q.timeSec ?? CONFIG.TIMERS.FINDERROR
  );

  const embed = new EmbedBuilder()
    .setTitle(q.title || "Find the Error")
    .setDescription(codeWithLineNumbers(q.code))
    .setColor("#FEE75C")
    .setFooter({ text: `${footer} • ${secs}s` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`openline:${session.sid}:${idx}`)
      .setLabel("Submit line number")
      .setStyle(ButtonStyle.Primary)
  );

  const msg = await channel.send({
    content: `<@${session.userId}>`,
    embeds: [embed],
    components: [row],
  });

  sessionManager.startTimer(session.sid, idx, secs, async () => {
    session.answers[idx] = {
      kind: "finderror",
      step: "line",
      chosen: null,
      correct: false,
      timeout: true,
    };
    try {
      await msg.edit({ components: [] });
    } catch {}
    await channel.send(
      `⏰ Time's up! The error was on line **${q.correctLine}**`
    );
    await advance(channel, session);
  });
}

/**
 * Send output question
 */
async function sendOutputQuestion(channel, session, footer) {
  const idx = session.index;
  const q = session.items[idx];
  const secs = Math.max(
    CONFIG.MIN_TIME_SECONDS,
    q.timeSec ?? CONFIG.TIMERS.OUTPUT
  );

  const embed = new EmbedBuilder()
    .setTitle(q.title || "What is the Output?")
    .setDescription(codeWithLineNumbers(q.code))
    .setColor("#57F287")
    .setFooter({ text: `${footer} • ${secs}s` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`openout:${session.sid}:${idx}`)
      .setLabel("Submit output")
      .setStyle(ButtonStyle.Primary)
  );

  const msg = await channel.send({
    content: `<@${session.userId}>`,
    embeds: [embed],
    components: [row],
  });

  sessionManager.startTimer(session.sid, idx, secs, async () => {
    session.answers[idx] = {
      kind: "output",
      submitted: null,
      correct: false,
      timeout: true,
    };
    try {
      await msg.edit({ components: [] });
    } catch {}
    await channel.send(
      "⏰ Time's up! Expected output:\n```\n" + q.expectedOutput + "\n```"
    );
    await advance(channel, session);
  });
}

/**
 * Send code question
 */
async function sendCodeQuestion(channel, session, footer) {
  const idx = session.index;
  const p = session.items[idx];

  // Get the timer from question or config
  // Priority: question's timeSec > CONFIG.TIMERS.CODE > calculated from timeout
  let secs;

  if (p.timeSec) {
    // Question specifies time
    secs = Math.max(CONFIG.MIN_CODE_TIME_SECONDS, p.timeSec);
  } else {
    // Use CONFIG.TIMERS.CODE, or fallback to calculated time
    const configTime = CONFIG.TIMERS.CODE;
    const calculatedTime = Math.round((CONFIG.CODE_TIMEOUT_MS * 4) / 1000);
    secs = Math.max(CONFIG.MIN_CODE_TIME_SECONDS, configTime || calculatedTime);
  }

  const embed = new EmbedBuilder()
    .setTitle(p.title || "Coding Challenge")
    .setDescription(
      `**Problem**\n${p.prompt}\n\n` +
        `**Starter Code**\n\`\`\`java\n${p.starter}\n\`\`\`\n`
    )
    .addFields(
      {
        name: "📋 How to Submit",
        value:
          `1️⃣ Copy the starter code above\n` +
          `2️⃣ Write your solution inside \`main()\`\n` +
          `3️⃣ Click "Submit solution" below\n` +
          `4️⃣ Paste your **COMPLETE** code`,
        inline: false,
      },
      {
        name: "✅ Correct Submission",
        value:
          `\`\`\`java\n` +
          `import java.util.Scanner;\n\n` +
          `public class Main {\n` +
          `  public static void main(String[] args) {\n` +
          `    // YOUR SOLUTION HERE\n` +
          `  }\n` +
          `}\n` +
          `\`\`\``,
        inline: false,
      },
      {
        name: "❌ Wrong Submissions",
        value:
          `Don't submit:\n` +
          `• Just your code without the class\n` +
          `• Missing \`import\` statements\n` +
          `• Incomplete code`,
        inline: false,
      }
    )
    .setColor("#EB459E")
    .setFooter({ text: `${footer} • ${secs}s to attempt` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`opencode:${session.sid}:${idx}`)
      .setLabel("📝 Submit solution")
      .setStyle(ButtonStyle.Success)
  );

  const msg = await channel.send({
    content: `<@${session.userId}>`,
    embeds: [embed],
    components: [row],
  });

  sessionManager.startTimer(session.sid, idx, secs, async () => {
    session.answers[idx] = {
      kind: "code",
      submitted: false,
      correct: false,
      timeout: true,
    };
    try {
      await msg.edit({ components: [] });
    } catch {}
    await channel.send(`⏰ Time's up on the coding challenge!`);
    await advance(channel, session);
  });
}

/**
 * Advance to next question or finish quiz
 */
async function advance(channel, session) {
  session.index += 1;

  if (session.index >= session.items.length) {
    session.finished = true;
    await showSummary(channel, session);
    sessionManager.finishSession(session.sid);
  } else {
    await sendQuestion(channel, session);
  }
}

/**
 * Show quiz summary
 */
async function showSummary(channel, session) {
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
    scores.record({
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

/**
 * Leaderboard and stats
 */
function parseRange(range) {
  if (range === "7d") return Date.now() - 7 * 24 * 60 * 60 * 1000;
  if (range === "30d") return Date.now() - 30 * 24 * 60 * 60 * 1000;
  return 0; // all time
}

async function handleLeaderboard(interaction) {
  const mode = interaction.options.getString("mode") ?? "all";
  const range = interaction.options.getString("range") ?? "7d";
  const minAttempts = interaction.options.getInteger("minattempts") ?? 1;

  const sinceMs = parseRange(range);
  const rows = scores.top({
    guildId: interaction.guildId,
    mode,
    sinceMs,
    minAttempts,
    limit: 10,
  });

  const title = `🏆 Leaderboard • ${range.toUpperCase()} • ${mode.toUpperCase()}`;
  if (rows.length === 0) {
    await interaction.reply({
      content: `${title}\nNo qualifying results yet.`,
      ephemeral: false,
    });
    return;
  }

  const lines = rows.map(
    (r, i) =>
      `**${i + 1}.** <@${r.userId}> — ${r.percent}% (${r.points}/${r.max}, ${
        r.attempts
      } attempts)`
  );

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(lines.join("\n"))
    .setColor("#FEE75C");

  await interaction.reply({ embeds: [embed], ephemeral: false });
}

async function handleMyStats(interaction) {
  const range = interaction.options.getString("range") ?? "7d";
  const sinceMs = parseRange(range);
  const me = scores.userStats({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    sinceMs,
  });

  const embed = new EmbedBuilder()
    .setTitle(`📈 Your stats • ${range.toUpperCase()}`)
    .setDescription(
      `Attempts: **${me.attempts}**\nScore: **${me.points}/${me.max}**\nAverage: **${me.percent}%**`
    )
    .setColor("#57F287");

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, cleaning up...");
  try {
    await scores.save();
  } catch (error) {
    logger.error("Failed to save scores on shutdown", { error: error.message });
  }
  sessionManager.cleanup();
  client.destroy();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, cleaning up...");
  try {
    await scores.save();
  } catch (error) {
    logger.error("Failed to save scores on shutdown", { error: error.message });
  }
  sessionManager.cleanup();
  client.destroy();
  process.exit(0);
});

// Login
client.login(process.env.DISCORD_TOKEN);
