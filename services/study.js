import Discord from "discord.js";
import { studyStatsStore } from "./StudyStatsStore.js";

const {
  Events,
  ButtonStyle,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ChannelType
} = Discord;

// ---- CONFIG ----
// These can be configured per server in the future
const STUDY_CHANNEL_ID = "1443362550447341609";
const VOICE_CATEGORY_ID = null; // Set to a category ID if you want VCs created under a specific category
const STUDY_ROLE_ID = "1443203557628186755"; // Role ID for study notifications
const OWNER_ID = "274462470674972682";

const FOCUS_MS = 25 * 60 * 1000; // 25 minutes
const EMPTY_TIMEOUT_MS = 60 * 1000; // 1 minute
const DELETE_DELAY_MS = 60 * 1000; // 60 seconds after completion
const GROUP_QUEUE_THRESHOLD = 3; // Number of users needed to start group session
const QUEUE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes - auto-start queue if not full

// ---- STATE ----
const state = {
  sessionCounter: 0,
  activeSessions: new Map(), // voiceChannelId -> session
  groupQueue: new Set(), // Set of user IDs waiting for group session
  activeGroupSession: null, // { voiceChannelId, textChannelId } or null
  queueTimeout: null, // Timeout for auto-starting queue
  queueGuild: null, // Guild where queue is active
  queueChannel: null, // Text channel where queue was started
};

/**
 * Setup the study system
 * @param {Discord.Client} client - Discord client
 */
export function setupStudySystem(client) {
  console.log("[Study] Study system loaded");

  // Owner command to post control message
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (message.author.id !== OWNER_ID) return;
    if (message.content.trim() !== "!initstudy") return;

    try {
      const embed = new EmbedBuilder()
        .setTitle("📚 Study With Me")
        .setColor(0x5865F2)
        .setDescription(
          "مع الطموحين.. الدراسة أسهل**.**\n" +
          "اختر الطريقة اللي تناسبك:\n\n" +

          "👥 **الدراسة مع الطموحين‎‎‎**\n" +
          "**Join Group Queue**\n" +
          "سجل انك تبي تدرس مع قروب، وإذا صرتوا 3 يسوي روم ويبدأ التايمر.\n\n\n" +

          "**Join Active Group**\n" +
          "ادخل على قروب بادي.\n\n\n" +

          "🧭 **خيارات إضافية**\n" +
          "**View My Progress**\n" +
          "شوف إجمالي وقتك وجلساتك.\n\n" +

          "🔔 **التنبيهات**\n" +
          "فعّل التنبيهات إذا حاب تعرف إذا فيه قروب جديد."
        );

      // Row 1 – Group study (primary)
      const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("study_queue")
          .setLabel("Join Group Queue")
          .setEmoji("👥")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("study_join_active")
          .setLabel("Join Ongoing Group")
          .setEmoji("🟢")
          .setStyle(ButtonStyle.Primary)
      );

      // Row 2 – Solo timer (low key)
      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("study_solo")
          .setLabel("Quick Solo Timer")
          .setEmoji("⏱️")
          .setStyle(ButtonStyle.Secondary)
      );

      // Row 3 – Progress
      const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("study_stats")
          .setLabel("View My Progress")
          .setEmoji("📊")
          .setStyle(ButtonStyle.Secondary)
      );

      // Row 4 – Notifications
      const row4 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("study_role_add")
          .setLabel("Enable Notifications")
          .setEmoji("🔔")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("study_role_remove")
          .setLabel("Disable Notifications")
          .setEmoji("🔕")
          .setStyle(ButtonStyle.Secondary)
      );

      // Row 5 – Exit
      const row5 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("study_queue_leave")
          .setLabel("Leave Queue")
          .setEmoji("🟥")
          .setStyle(ButtonStyle.Danger)
      );

      await message.channel.send({
        embeds: [embed],
        components: [row1, row2, row3, row4, row5],
      });

      await message.reply("Study control message posted!");
    } catch (error) {
      console.error("[Study] Error posting control message:", error);
      message.reply("Error posting control message").catch(() => { });
    }
  });

  // Voice state updates (handle empty rooms)
  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    try {
      const channelIds = new Set();
      if (oldState.channelId) channelIds.add(oldState.channelId);
      if (newState.channelId) channelIds.add(newState.channelId);

      for (const channelId of channelIds) {
        const session = state.activeSessions.get(channelId);
        if (!session) continue;

        const guild = client.guilds.cache.get(session.guildId);
        if (!guild) continue;

        const vc = guild.channels.cache.get(channelId);
        if (!vc) continue;

        const memberCount = vc.members.filter(m => !m.user.bot).size;

        // Start empty timeout if room is empty
        if (memberCount === 0 && !session.emptyTimeout) {
          session.emptyTimeout = setTimeout(async () => {
            const currentVc = guild.channels.cache.get(channelId);
            const currentCount = currentVc?.members.filter(m => !m.user.bot).size || 0;

            if (currentCount === 0) {
              console.log(`[Study] Canceling session ${session.id} - empty room`);
              await cancelSession(session, client, "Empty room timeout");
            }
          }, EMPTY_TIMEOUT_MS);
        }

        // Clear timeout if someone joins
        if (memberCount > 0 && session.emptyTimeout) {
          clearTimeout(session.emptyTimeout);
          session.emptyTimeout = null;
        }
      }
    } catch (error) {
      console.error("[Study] Voice state error:", error);
    }
  });
}

/**
 * Handle solo Pomodoro button click
 */
async function handleSoloPomodoro(interaction, client) {
  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;
  const user = interaction.user;
  const username = interaction.member.displayName || user.username;

  // Remove user from queue if they're in it
  if (state.groupQueue.has(user.id)) {
    state.groupQueue.delete(user.id);
    const queueSize = state.groupQueue.size;

    // If queue is now empty, clear timeout
    if (queueSize === 0) {
      if (state.queueTimeout) {
        clearTimeout(state.queueTimeout);
        state.queueTimeout = null;
      }
      state.queueGuild = null;
      state.queueChannel = null;
      console.log("[Study] Queue emptied (user started solo session), timeout cleared");
    } else {
      console.log(`[Study] User removed from queue to start solo session. Queue size: ${queueSize}`);
    }
  }

  try {
    // Create voice channel
    const vcOptions = {
      name: `Study – Solo – ${username}`,
      type: ChannelType.GuildVoice,
    };

    if (VOICE_CATEGORY_ID) {
      vcOptions.parent = VOICE_CATEGORY_ID;
    }

    const vc = await guild.channels.create(vcOptions);

    // Create session
    const session = createSession("solo", guild.id, vc.id, interaction.channel.id, user.id);

    // Start 25-minute timer
    startPomodoroTimer(session, client);

    // Reply with jump link
    await interaction.editReply({
      content: `✅ **Solo session created!**\n\nClick to join: <#${vc.id}>\n\n⏱️ 25-minute timer started. Good luck!`,
    });

    console.log(`[Study] Solo session created for ${username}`);
  } catch (error) {
    console.error("[Study] Error creating solo session:", error);
    await interaction.editReply({
      content: "Failed to create study channel. Please try again.",
    });
  }
}

/**
 * Handle group queue button click
 */
async function handleGroupQueue(interaction, client) {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;

  // Check if already in queue
  if (state.groupQueue.has(userId)) {
    return interaction.editReply({
      content: "You're already in the queue!",
    });
  }

  // Add to queue
  state.groupQueue.add(userId);
  const queueSize = state.groupQueue.size;

  // Start timeout if this is the first person
  if (queueSize === 1) {
    state.queueGuild = interaction.guild;
    state.queueChannel = interaction.channel;

    state.queueTimeout = setTimeout(async () => {
      if (state.groupQueue.size > 0) {
        await interaction.channel.send({
          content: `⏰ Queue timeout! Starting session with ${state.groupQueue.size} ${state.groupQueue.size === 1 ? 'person' : 'people'}...`
        });
        await startGroupSession(interaction.guild, interaction.channel, client);
      }
    }, QUEUE_TIMEOUT_MS);

    console.log(`[Study] Queue timeout started (${QUEUE_TIMEOUT_MS / 60000} minutes)`);
  }

  await interaction.editReply({
    content: `✅ Added to group queue!\n\n**Queue size:** ${queueSize}/${GROUP_QUEUE_THRESHOLD}\n\n${queueSize === 1 ? `⏰ Session will auto-start in ${QUEUE_TIMEOUT_MS / 60000} minutes if not full` : ''}`,
  });

  // Announce in channel with role ping (if not full yet)
  if (queueSize < GROUP_QUEUE_THRESHOLD) {
    const rolePing = STUDY_ROLE_ID ? `<@&${STUDY_ROLE_ID}>` : "";
    const announcement = rolePing
      ? `${rolePing} 👥 <@${userId}> joined the study queue! **(${queueSize}/${GROUP_QUEUE_THRESHOLD})**\n\nJoin now to start a group session!`
      : `👥 <@${userId}> joined the study queue (${queueSize}/${GROUP_QUEUE_THRESHOLD})`;

    await interaction.channel.send({
      content: announcement
    });
  }

  // Start session if threshold reached
  if (queueSize >= GROUP_QUEUE_THRESHOLD) {
    // Clear timeout since we're starting now
    if (state.queueTimeout) {
      clearTimeout(state.queueTimeout);
      state.queueTimeout = null;
    }
    await startGroupSession(interaction.guild, interaction.channel, client);
  }
}

/**
 * Handle join active group button click
 */
async function handleJoinActive(interaction, client) {
  await interaction.deferReply({ ephemeral: true });

  if (!state.activeGroupSession) {
    return interaction.editReply({
      content: "No active group session right now. Use **Join Group Queue** to start one!",
    });
  }

  const vcId = state.activeGroupSession.voiceChannelId;
  await interaction.editReply({
    content: `🚀 **Join the active group session:**\n\n<#${vcId}>`,
  });
}

/**
 * Handle show stats button click
 */
async function handleShowStats(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  const guildId = interaction.guild.id;

  const stats = studyStatsStore.getUserStats(userId, guildId);

  const embed = new EmbedBuilder()
    .setTitle("📊 Your Study Stats")
    .setColor(0x5865F2)
    .addFields(
      { name: "Total Sessions", value: `${stats.totalSessions}`, inline: true },
      { name: "Total Minutes", value: `${stats.totalMinutes}`, inline: true },
      { name: "Total Hours", value: `${stats.totalHours}`, inline: true }
    )
    .setFooter({ text: getMotivationalMessage(stats.totalSessions) });

  await interaction.editReply({ embeds: [embed] });
}

/**
 * Start a group session when queue threshold is reached
 */
async function startGroupSession(guild, textChannel, client) {
  try {
    // Create group VC
    const vcOptions = {
      name: "Study – Pomodoro Group",
      type: ChannelType.GuildVoice,
    };

    if (VOICE_CATEGORY_ID) {
      vcOptions.parent = VOICE_CATEGORY_ID;
    }

    const vc = await guild.channels.create(vcOptions);

    // Create session
    const session = createSession("group", guild.id, vc.id, textChannel.id, null);

    // Set active group session
    state.activeGroupSession = {
      voiceChannelId: vc.id,
      textChannelId: textChannel.id
    };

    // Get queued users
    const queuedUsers = Array.from(state.groupQueue);

    // Clear queue and timeout
    state.groupQueue.clear();
    if (state.queueTimeout) {
      clearTimeout(state.queueTimeout);
      state.queueTimeout = null;
    }
    state.queueGuild = null;
    state.queueChannel = null;

    // Announce
    const mentions = queuedUsers.map(id => `<@${id}>`).join(", ");
    await textChannel.send({
      content: `🎉 **Group Pomodoro starting!**\n\n${mentions}\n\nJoin the channel: <#${vc.id}>\n⏱️ 25-minute session begins now!`
    });

    // Start timer
    startPomodoroTimer(session, client);

    console.log(`[Study] Group session started with ${queuedUsers.length} users`);
  } catch (error) {
    console.error("[Study] Error starting group session:", error);
  }
}

/**
 * Create a new study session
 */
function createSession(type, guildId, vcId, textId, creatorId) {
  const id = ++state.sessionCounter;
  const session = {
    id,
    type, // "solo" or "group"
    guildId,
    voiceChannelId: vcId,
    textChannelId: textId,
    creatorId, // Only for solo sessions
    startedAt: Date.now(),
    timer: null,
    emptyTimeout: null,
    completed: false,
  };

  state.activeSessions.set(vcId, session);
  return session;
}

/**
 * Start 25-minute Pomodoro timer
 */
function startPomodoroTimer(session, client) {
  session.timer = setTimeout(async () => {
    await completeSession(session, client);
  }, FOCUS_MS);
}

/**
 * Complete a session successfully
 */
async function completeSession(session, client) {
  if (session.completed) return;
  session.completed = true;

  console.log(`[Study] Completing session ${session.id}`);

  try {
    const guild = client.guilds.cache.get(session.guildId);
    if (!guild) return;

    const vc = guild.channels.cache.get(session.voiceChannelId);
    const textChannel = guild.channels.cache.get(session.textChannelId);

    // Get participants (non-bot members)
    const participants = vc?.members.filter(m => !m.user.bot) || new Map();
    const participantCount = participants.size;

    if (participantCount > 0) {
      // Log completion for each participant
      for (const [userId] of participants) {
        await studyStatsStore.recordSession(userId, session.guildId, 25);
      }

      // Post summary
      const mentions = Array.from(participants.keys()).map(id => `<@${id}>`).join(", ");
      const embed = new EmbedBuilder()
        .setTitle("✅ Study Session Completed")
        .setColor(0x57F287)
        .setDescription(
          `**Duration:** 25 minutes\n` +
          `**Participants:** ${participantCount}\n\n` +
          `${mentions}\n\n` +
          `Great work! 🎉`
        )
        .setTimestamp();

      if (textChannel) {
        await textChannel.send({ embeds: [embed] });
      }

      console.log(`[Study] Session ${session.id} completed with ${participantCount} participants`);
    } else {
      console.log(`[Study] Session ${session.id} completed with no participants`);
    }

    // Clear timers
    if (session.timer) clearTimeout(session.timer);
    if (session.emptyTimeout) clearTimeout(session.emptyTimeout);

    // Remove from active sessions
    state.activeSessions.delete(session.voiceChannelId);

    // Clear active group session if this was a group session
    if (session.type === "group" && state.activeGroupSession?.voiceChannelId === session.voiceChannelId) {
      state.activeGroupSession = null;
    }

    // Delete VC after delay
    setTimeout(async () => {
      try {
        if (vc) {
          await vc.delete("Session completed");
        }
      } catch (error) {
        console.error("[Study] Error deleting VC:", error);
      }
    }, DELETE_DELAY_MS);

  } catch (error) {
    console.error("[Study] Error completing session:", error);
  }
}

/**
 * Cancel a session (empty room)
 */
async function cancelSession(session, client, reason) {
  if (session.completed) return;
  session.completed = true;

  console.log(`[Study] Canceling session ${session.id}: ${reason}`);

  try {
    // Clear timers
    if (session.timer) clearTimeout(session.timer);
    if (session.emptyTimeout) clearTimeout(session.emptyTimeout);

    // Remove from active sessions
    state.activeSessions.delete(session.voiceChannelId);

    // Clear active group session if this was a group session
    if (session.type === "group" && state.activeGroupSession?.voiceChannelId === session.voiceChannelId) {
      state.activeGroupSession = null;
    }

    // Delete VC immediately
    const guild = client.guilds.cache.get(session.guildId);
    if (guild) {
      const vc = guild.channels.cache.get(session.voiceChannelId);
      if (vc) {
        await vc.delete(reason);
      }
    }

    // No stats logged for canceled sessions
  } catch (error) {
    console.error("[Study] Error canceling session:", error);
  }
}

/**
 * Get a motivational message based on session count
 */
function getMotivationalMessage(sessions) {
  if (sessions === 0) return "Start your first session!";
  if (sessions < 5) return "Great start! Keep it up!";
  if (sessions < 10) return "You're building a solid habit!";
  if (sessions < 25) return "Impressive dedication!";
  if (sessions < 50) return "You're on fire! 🔥";
  if (sessions < 100) return "Study master in the making!";
  return "Legendary dedication! 🏆";
}

/**
 * Handle leaving the queue
 */
async function handleQueueLeave(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;

  // Check if in queue
  if (!state.groupQueue.has(userId)) {
    return interaction.editReply({
      content: "You're not in the queue.",
    });
  }

  // Remove from queue
  state.groupQueue.delete(userId);
  const queueSize = state.groupQueue.size;

  // If queue is now empty, clear timeout
  if (queueSize === 0) {
    if (state.queueTimeout) {
      clearTimeout(state.queueTimeout);
      state.queueTimeout = null;
    }
    state.queueGuild = null;
    state.queueChannel = null;
    console.log("[Study] Queue emptied, timeout cleared");
  }

  await interaction.editReply({
    content: `✅ Removed from queue.\n\n${queueSize > 0 ? `**Queue size:** ${queueSize}/${GROUP_QUEUE_THRESHOLD}` : 'Queue is now empty.'}`,
  });

  // Announce if queue still has people
  if (queueSize > 0) {
    await interaction.channel.send({
      content: `👋 <@${userId}> left the study queue (${queueSize}/${GROUP_QUEUE_THRESHOLD})`
    });
  }
}

/**
 * Handle adding study role to user
 */
async function handleRoleAdd(interaction) {
  await interaction.deferReply({ ephemeral: true });

  if (!STUDY_ROLE_ID) {
    return interaction.editReply({
      content: "❌ Study role not configured. Contact an admin.",
    });
  }

  try {
    const member = interaction.member;
    const role = interaction.guild.roles.cache.get(STUDY_ROLE_ID);

    if (!role) {
      return interaction.editReply({
        content: "❌ Study role not found. Contact an admin.",
      });
    }

    if (member.roles.cache.has(STUDY_ROLE_ID)) {
      return interaction.editReply({
        content: "✅ You already have study notifications enabled!",
      });
    }

    await member.roles.add(role);
    await interaction.editReply({
      content: `✅ You'll now be notified when study sessions start!\n\nRole: ${role}`,
    });
  } catch (error) {
    console.error("[Study] Error adding role:", error);
    await interaction.editReply({
      content: "❌ Failed to add role. Make sure the bot has permission to manage roles.",
    });
  }
}

/**
 * Handle removing study role from user
 */
async function handleRoleRemove(interaction) {
  await interaction.deferReply({ ephemeral: true });

  if (!STUDY_ROLE_ID) {
    return interaction.editReply({
      content: "❌ Study role not configured. Contact an admin.",
    });
  }

  try {
    const member = interaction.member;
    const role = interaction.guild.roles.cache.get(STUDY_ROLE_ID);

    if (!role) {
      return interaction.editReply({
        content: "❌ Study role not found. Contact an admin.",
      });
    }

    if (!member.roles.cache.has(STUDY_ROLE_ID)) {
      return interaction.editReply({
        content: "✅ You don't have study notifications enabled.",
      });
    }

    await member.roles.remove(role);
    await interaction.editReply({
      content: "✅ Study notifications disabled. You can re-enable them anytime!",
    });
  } catch (error) {
    console.error("[Study] Error removing role:", error);
    await interaction.editReply({
      content: "❌ Failed to remove role. Make sure the bot has permission to manage roles.",
    });
  }
}

/**
 * Export button handlers for use in main button handler
 */
export {
  handleSoloPomodoro,
  handleGroupQueue,
  handleJoinActive,
  handleShowStats,
  handleQueueLeave,
  handleRoleAdd,
  handleRoleRemove
};
