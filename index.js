import "dotenv/config";
import Discord from "discord.js";

const {
  Client,
  GatewayIntentBits,
} = Discord;

import { SessionManager } from "./services/SessionManager.js";
import { QuestionLoader } from "./services/QuestionLoader.js";
import { gradeJava, checkJavaAvailable } from "./grader/SimpleJavaRunner.js";
import { CONFIG } from "./config.js";
import { logger } from "./utils/logger.js";
import { ScoreStore } from "./services/ScoreStore.js";
import { setupStudySystem, handleSoloPomodoro, handleGroupQueue, handleShowStats, handleQueueLeave, handleRoleAdd, handleRoleRemove, handleStudyGroupJoin, recoverSessions, handleAFKCheck } from "./services/study.js";
import { studyStatsStore } from "./services/StudyStatsStore.js";
import { handleQuizStart } from "./handlers/quizHandlers.js";
import { handleLeaderboard, handleMyStats, handleStudyLeaderboard } from "./handlers/leaderboardHandlers.js";
import {
  handleMCQAnswer,
  handleOpenLineModal,
  handleErrorTypeAnswer,
  handleOpenOutputModal,
  handleOpenCodeModal,
  handleResumeButton,
  handleCancelButton
} from "./handlers/buttonHandlers.js";
import {
  handleLineSubmission,
  handleOutputSubmission,
  handleCodeSubmission
} from "./handlers/modalHandlers.js";

// Initialize services
const questionLoader = new QuestionLoader();
const sessionManager = new SessionManager();
const scores = new ScoreStore();

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

// Init Study With Me system
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

client.once("ready", async () => {
  logger.info(`Bot logged in as ${client.user.tag}`);
  console.log(`✅ Logged in as ${client.user.tag}`);

  // Recover active study sessions from persistent storage
  try {
    await recoverSessions(client);
  } catch (error) {
    console.error('[Study] Failed to recover sessions:', error);
    logger.error('Failed to recover sessions', { error: error.message });
  }

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

  if (interaction.commandName === "quiz") {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "start") {
      await handleQuizStart(interaction, questionLoader, sessionManager, scores, javaAvailable);
    } else if (subcommand === "leaderboard") {
      await handleLeaderboard(interaction, scores);
    } else if (subcommand === "stats") {
      await handleMyStats(interaction, scores);
    }
  } else if (interaction.commandName === "study_leaderboard") {
    await handleStudyLeaderboard(interaction);
  }
}

async function handleButton(interaction) {
  const customId = interaction.customId;

  // Study system buttons (no session ID needed)
  if (customId === "study_solo_25") {
    return await handleSoloPomodoro(interaction, interaction.client, 25);
  }
  if (customId === "study_solo_50") {
    return await handleSoloPomodoro(interaction, interaction.client, 50);
  }
  if (customId === "study_queue_25") {
    return await handleGroupQueue(interaction, interaction.client, 25);
  }
  if (customId === "study_queue_50") {
    return await handleGroupQueue(interaction, interaction.client, 50);
  }
  if (customId === "study_stats") {
    return await handleShowStats(interaction);
  }
  if (customId === "study_queue_leave") {
    return await handleQueueLeave(interaction);
  }
  if (customId === "study_role_add") {
    return await handleRoleAdd(interaction);
  }
  if (customId === "study_role_remove") {
    return await handleRoleRemove(interaction);
  }
  if (customId === "study_group_join") {
    return await handleStudyGroupJoin(interaction);
  }
  if (customId.startsWith("afk_check_")) {
    return await handleAFKCheck(interaction);
  }

  // Quiz buttons (have session IDs)
  const parts = customId.split(":");
  const kind = parts[0];

  // Resume / cancel flow
  if (kind === "resume") {
    return await handleResumeButton(interaction, parts, sessionManager, scores);
  }

  if (kind === "cancel") {
    return await handleCancelButton(interaction, parts, sessionManager);
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
      await handleMCQAnswer(interaction, parts, session, sessionManager, scores);
      break;
    case "openline":
      await handleOpenLineModal(interaction, parts, session);
      break;
    case "errtype":
      await handleErrorTypeAnswer(interaction, parts, session, sessionManager, scores);
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
      await handleLineSubmission(interaction, parts, session, sessionManager, scores);
      break;
    case "out":
      await handleOutputSubmission(interaction, parts, session, sessionManager, scores);
      break;
    case "code":
      await handleCodeSubmission(interaction, parts, session, sessionManager, scores);
      break;
  }
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
