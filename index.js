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
import { setupStudySystem, handleStudyStart, handleTopicSubmit, handleFindGroups, handleJoinDirect, handleShowStats, handleRoleAdd, handleRoleRemove, handleStudyGroupJoin, recoverSessions } from "./services/study.js";
import { StudyStatsStore } from "./services/StudyStatsStore.js";
import { VoiceTimeStore } from "./services/VoiceTimeStore.js";
import { handleQuizStart } from "./handlers/quizHandlers.js";
import { handleLeaderboard, handleMyStats, handleStudyLeaderboard, handleHelpCommand, handleTimeLeft, scheduleWeeklyReset } from "./handlers/leaderboardHandlers.js";
import { handleViolationsCommand, handleResetPeriodCommand, handleInsightsCommand } from "./handlers/adminCommandHandlers.js";
import { handleTamoohMyStatsCommand, handleTamoohInsightsCommand, handleTamoohViolationsCommand, handleTamoohResetPeriodCommand } from "./handlers/tamoohSlashWrappers.js";
import { swapStore } from "./services/SwapStore.js";
import { swapCoordinator } from "./services/SwapCoordinator.js";
import {
  handleSwapAdd,
  handleSwapMy,
  handleSwapCancel,
  handleSwapHelp,
  handleSwapAdminSettings,
  handleSwapAdminStats,
  handleSwapAdminPurge
} from "./handlers/swapHandlers.js";
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
import {
  handleVerifySetup,
  handleVerifyCheck,
  logMemberApplication,
  logScreeningPass,
  handleVerifyEmailButton,
  handleEmailModalSubmit,
  handleEnterCodeButton,
  handleCodeModalSubmit
} from "./handlers/verifyHandlers.js";
import { verificationStore } from "./services/VerificationStore.js";
import { setupJTCSystem, isJTCInteraction, handleJTCInteraction, postJTCControlPanel } from "./services/jtc/index.js";
import { VOICE_CATEGORY_ID } from "./services/study/config.js";

// Initialize services
const questionLoader = new QuestionLoader();
const sessionManager = new SessionManager();
const scores = new ScoreStore();
const studyStatsStore = new StudyStatsStore();
const voiceTimeStore = new VoiceTimeStore();

// Track when users join study voice channels: "guildId_userId" -> joinTimestamp
const voiceJoinTimes = new Map();

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences, // Required for gaming detection (member.presence.activities)
    GatewayIntentBits.GuildMessageReactions, // Required for reaction-based commands
  ],
});

// Init Study With Me system
setupStudySystem(client, studyStatsStore);

// Init JTC (Join-to-Create) voice room system
setupJTCSystem(client);

// Init Quiz Session persistence
try {
  await sessionManager.init();
  const recoveredSessions = sessionManager.loadPersistedSessions();
  if (recoveredSessions.length > 0) {
    logger.info('Recovered quiz sessions from previous run', { count: recoveredSessions.length });
  }
} catch (error) {
  logger.error('Failed to initialize SessionManager persistence', { error: error.message });
  console.error('⚠️  WARNING: Quiz session persistence failed to initialize.');
}

// Init Section Swap Matchmaking system
try {
  swapStore.init();
} catch (error) {
  logger.error('Failed to initialize SwapStore', { error: error.message });
  console.error('⚠️  WARNING: Section swap system failed to initialize.');
}

// Init Verification system
try {
  verificationStore.init();
  logger.info('Verification system initialized');
} catch (error) {
  logger.error('Failed to initialize VerificationStore', { error: error.message });
  console.error('⚠️  WARNING: Verification system failed to initialize.');
}

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

  // Schedule weekly Saturday 12am leaderboard reset
  scheduleWeeklyReset(client, voiceTimeStore);

  // Initialize swap coordinator (needs client)
  try {
    swapCoordinator.init(client);
    if (CONFIG.SWAP.MATCHES_CHANNEL_ID) {
      logger.info('Section swap system ready');
    } else {
      logger.warn('Section swap system: SWAP_MATCHES_CHANNEL_ID not configured');
    }
  } catch (error) {
    logger.error('Failed to initialize SwapCoordinator', { error: error.message });
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
    // Handle JTC interactions first (buttons, modals, select menus)
    if (isJTCInteraction(interaction)) {
      return await handleJTCInteraction(interaction);
    }

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
    await handleStudyLeaderboard(interaction, voiceTimeStore);
  } else if (interaction.commandName === "timeleft") {
    await handleTimeLeft(interaction);
  } else if (interaction.commandName === "tamooh") {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "mystats") {
      await handleTamoohMyStatsCommand(interaction, studyStatsStore);
    } else if (subcommand === "insights") {
      await handleTamoohInsightsCommand(interaction, studyStatsStore);
    } else if (subcommand === "violations") {
      await handleTamoohViolationsCommand(interaction, studyStatsStore);
    } else if (subcommand === "reset-period") {
      await handleTamoohResetPeriodCommand(interaction, studyStatsStore);
    }
  } else if (interaction.commandName === "help") {
    await handleHelpCommand(interaction);
  } else if (interaction.commandName === "verify-setup") {
    await handleVerifySetup(interaction);
  } else if (interaction.commandName === "verify-check") {
    await handleVerifyCheck(interaction);
  } else if (interaction.commandName === "swap") {
    const subcommandGroup = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand();

    if (subcommandGroup === "admin") {
      if (subcommand === "settings") {
        await handleSwapAdminSettings(interaction);
      } else if (subcommand === "stats") {
        await handleSwapAdminStats(interaction);
      } else if (subcommand === "purge_expired") {
        await handleSwapAdminPurge(interaction);
      }
    } else {
      if (subcommand === "add") {
        await handleSwapAdd(interaction);
      } else if (subcommand === "my") {
        await handleSwapMy(interaction);
      } else if (subcommand === "cancel") {
        await handleSwapCancel(interaction);
      } else if (subcommand === "help") {
        await handleSwapHelp(interaction);
      }
    }
  } else if (interaction.commandName === "jtcpanel") {
    // Admin-only: Post JTC control panel
    if (!interaction.memberPermissions?.has("Administrator")) {
      return interaction.reply({ content: "Admin only.", ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      const msg = await postJTCControlPanel(interaction.client, interaction.channelId);
      await interaction.editReply({ content: `Control panel posted! ID: ${msg.id}` });
    } catch (error) {
      await interaction.editReply({ content: `Failed: ${error.message}` });
    }
  }
}

/**
 * Track voice time in study channels
 */
client.on("voiceStateUpdate", (oldState, newState) => {
  const userId = newState.member?.id || oldState.member?.id;
  const guildId = newState.guild?.id || oldState.guild?.id;
  if (!userId || !guildId) return;
  if (newState.member?.user.bot || oldState.member?.user.bot) return;

  const studyCategoryId = process.env.VOICE_CATEGORY_ID || VOICE_CATEGORY_ID;
  const key = `${guildId}_${userId}`;

  const wasInStudy = oldState.channel?.parentId === studyCategoryId;
  const isInStudy = newState.channel?.parentId === studyCategoryId;

  if (!wasInStudy && isInStudy) {
    // User joined a study channel
    voiceJoinTimes.set(key, Date.now());
  } else if (wasInStudy && !isInStudy) {
    // User left a study channel — record their time
    const joinTime = voiceJoinTimes.get(key);
    if (joinTime) {
      const minutes = Math.floor((Date.now() - joinTime) / 60000);
      voiceTimeStore.addTime(userId, guildId, minutes);
      voiceJoinTimes.delete(key);
    }
  }
  // Moving between study channels: keep the original join time (no change needed)
});

/**
 * Handle ! prefix commands (admin only, hidden from slash command list)
 */
client.on("messageCreate", async (message) => {
  // Ignore bots
  if (message.author.bot) return;

  // Handle swap thread confirmations (for any message in threads)
  if (message.channel.isThread()) {
    try {
      await swapCoordinator.handleThreadMessage(message);
    } catch (error) {
      logger.error("Swap thread message error", {
        error: error.message,
        threadId: message.channel.id,
      });
    }
  }

  // Only process prefix commands starting with !
  if (!message.content.startsWith("!")) return;

  const args = message.content.slice(1).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  try {
    if (command === "violations") {
      await handleViolationsCommand(message, studyStatsStore);
    } else if (command === "reset_period") {
      await handleResetPeriodCommand(message, studyStatsStore);
    } else if (command === "insights") {
      await handleInsightsCommand(message, studyStatsStore);
    }
  } catch (error) {
    logger.error("Message command error", {
      error: error.message,
      stack: error.stack,
    });
    console.error("Error handling message command:", error);
    await message.reply("❌ An error occurred while processing the command.");
  }
});

async function handleButton(interaction) {
  const customId = interaction.customId;

  // Study system buttons (no session ID needed)
  if (customId === "study_start_pomodoro_25") {
    return await handleStudyStart(interaction, "pomodoro", 25);
  }
  if (customId === "study_start_pomodoro_50") {
    return await handleStudyStart(interaction, "pomodoro", 50);
  }
  if (customId === "study_start_openmic") {
    return await handleStudyStart(interaction, "openmic", null);
  }
  if (customId === "study_find_groups") {
    return await handleFindGroups(interaction);
  }
  if (customId.startsWith("study_join_direct:")) {
    const vcId = customId.split(":")[1];
    return await handleJoinDirect(interaction, vcId);
  }
  if (customId === "study_stats") {
    return await handleShowStats(interaction, studyStatsStore);
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

  // Verification system buttons
  if (customId === "verify_email") {
    return await handleVerifyEmailButton(interaction);
  }
  if (customId === "verify_enter_code") {
    return await handleEnterCodeButton(interaction);
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

  // Study topic submission
  if (kind === "study_topic") {
    const mode = parts[1];
    const duration = parts[2] === 'null' ? null : parseInt(parts[2]);
    const topic = interaction.fields.getTextInputValue("topic");

    return await handleTopicSubmit(interaction, interaction.client, mode, duration, topic);
  }

  // Verification modals
  if (interaction.customId === "verify_email_modal") {
    return await handleEmailModalSubmit(interaction);
  }
  if (interaction.customId === "verify_code_modal") {
    return await handleCodeModalSubmit(interaction);
  }

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

// Member join logging for verification system
client.on("guildMemberAdd", async (member) => {
  await logMemberApplication(member);
});

// Membership screening pass logging
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  // Check if user just passed membership screening
  if (oldMember.pending && !newMember.pending) {
    await logScreeningPass(newMember);
  }
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, cleaning up...");
  try {
    await scores.save();
  } catch (error) {
    logger.error("Failed to save scores on shutdown", { error: error.message });
  }
  sessionManager.cleanup();
  swapCoordinator.stop();
  swapStore.close();
  verificationStore.close();
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
  swapCoordinator.stop();
  swapStore.close();
  verificationStore.close();
  client.destroy();
  process.exit(0);
});

// Login
client.login(process.env.DISCORD_TOKEN);
