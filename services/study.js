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
const STUDY_LOG_CHANNEL_ID = "1443363449504530492"; // Channel for session logging
const VOICE_CATEGORY_ID = "1366787196719468645"; // Set to a category ID if you want VCs created under a specific category
const STUDY_ROLE_ID = "1443203557628186755"; // Role ID for study notifications (@نذاكر سوا)
const TAMOOH_ROLE_ID = "1367043626806542336"; // Role ID for @طموح
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
 * Send a log message to the study log channel
 */
async function logToChannel(client, guildId, embed) {
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const logChannel = guild.channels.cache.get(STUDY_LOG_CHANNEL_ID);
    if (!logChannel) {
      console.warn("[Study] Log channel not found");
      return;
    }

    await logChannel.send({ embeds: [embed] });
  } catch (error) {
    console.error("[Study] Failed to send log:", error.message);
  }
}

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

  // Owner command to run a giveaway
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (message.author.id !== OWNER_ID) return;
    if (!message.content.trim().startsWith("!giveaway")) return;

    try {
      // Parse prize name from command
      const args = message.content.trim().split(/\s+/);
      if (args.length < 2) {
        return message.reply("❌ Please specify a prize name. Example: `!giveaway airpods4`");
      }

      const prizeName = args.slice(1).join(" ");
      const guildId = message.guild.id;

      await message.reply(`🎁 Starting giveaway for **${prizeName}**...\nFetching eligible participants...`);

      // Fetch all guild members
      await message.guild.members.fetch();

      // Get all users with session counts
      const allMembers = message.guild.members.cache;
      const eligibleUsers = [];

      for (const [userId, member] of allMembers) {
        // Skip bots
        if (member.user.bot) continue;

        // Check if user has BOTH required roles
        const hasStudyRole = member.roles.cache.has(STUDY_ROLE_ID);
        const hasTamoohRole = member.roles.cache.has(TAMOOH_ROLE_ID);

        if (!hasStudyRole || !hasTamoohRole) continue;

        // Get user's session stats
        const stats = studyStatsStore.getUserStats(userId, guildId);

        // Add to eligible users with their session count (tickets = 1 base + sessions)
        eligibleUsers.push({
          userId,
          username: member.user.username,
          displayName: member.displayName || member.user.username,
          sessions: stats.totalSessions,
          hours: stats.totalHours,
          tickets: 1 + stats.totalSessions // 1 base ticket for having both roles + sessions
        });
      }

      // Check if we have any eligible users
      if (eligibleUsers.length === 0) {
        return message.channel.send("❌ No eligible participants found!\n\nUsers must have both roles: <@&" + STUDY_ROLE_ID + "> and <@&" + TAMOOH_ROLE_ID + ">");
      }

      // Build weighted pool (1 base ticket for roles + 1 ticket per session)
      const weightedPool = [];
      for (const user of eligibleUsers) {
        for (let i = 0; i < user.tickets; i++) {
          weightedPool.push(user);
        }
      }

      // Pick a random winner from the weighted pool
      const winnerIndex = Math.floor(Math.random() * weightedPool.length);
      const winner = weightedPool[winnerIndex];

      // Calculate total tickets
      const totalTickets = weightedPool.length;

      // Create winner announcement embed
      const embed = new EmbedBuilder()
        .setTitle("🎉 Giveaway Winner!")
        .setColor(0xFFD700) // Gold color
        .setDescription(
          `**Prize:** ${prizeName}\n\n` +
          `**Winner:** <@${winner.userId}>\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n\n` +
          `**Winner Stats:**\n` +
          `🎫 Tickets: ${winner.tickets}\n` +
          `📚 Study Sessions: ${winner.sessions}\n` +
          `⏱️ Study Hours: ${winner.hours}\n\n` +
          `**Giveaway Info:**\n` +
          `👥 Eligible Participants: ${eligibleUsers.length}\n` +
          `🎫 Total Tickets: ${totalTickets}\n` +
          `📊 Win Chance: ${((winner.tickets / totalTickets) * 100).toFixed(2)}%`
        )
        .setFooter({ text: "More sessions = More chances to win!" })
        .setTimestamp();

      // Send announcement
      await message.channel.send({ embeds: [embed] });

      // Log to study log channel
      const logEmbed = new EmbedBuilder()
        .setTitle("🎁 Giveaway Completed")
        .setColor(0xFFD700)
        .addFields(
          { name: "Prize", value: prizeName, inline: true },
          { name: "Winner", value: `<@${winner.userId}>`, inline: true },
          { name: "Winner Tickets", value: `${winner.tickets}`, inline: true },
          { name: "Total Participants", value: `${eligibleUsers.length}`, inline: true },
          { name: "Total Tickets", value: `${totalTickets}`, inline: true },
          { name: "Triggered By", value: `<@${message.author.id}>`, inline: true }
        )
        .setTimestamp();

      await logToChannel(client, guildId, logEmbed);

      console.log(`[Giveaway] Winner: ${winner.username} (${winner.tickets} tickets out of ${totalTickets})`);

    } catch (error) {
      console.error("[Giveaway] Error running giveaway:", error);
      message.reply("❌ Error running giveaway. Check console for details.").catch(() => { });
    }
  });

  // Voice state updates (handle empty rooms, mute new joiners, unmute leavers)
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

        // If someone joined this channel, mute them if session is active
        if (newState.channelId === channelId && oldState.channelId !== channelId) {
          // User joined this channel
          const member = newState.member;
          if (member && !member.user.bot && session.timer) {
            // Session is active (timer is running), mute the new joiner
            try {
              await member.voice.setMute(true);
              console.log(`[Study] Muted ${member.user.username} who joined active session ${session.id}`);
            } catch (error) {
              console.error(`[Study] Failed to mute new joiner ${member.id}:`, error.message);
            }
          }
        }

        // If someone left this channel, unmute them so they're not muted elsewhere
        if (oldState.channelId === channelId && newState.channelId !== channelId) {
          // User left this channel
          const member = oldState.member;
          if (member && !member.user.bot && session.timer) {
            // Session is still active, unmute them so mute doesn't persist
            try {
              await member.voice.setMute(false);
              console.log(`[Study] Unmuted ${member.user.username} who left active session ${session.id}`);
            } catch (error) {
              console.error(`[Study] Failed to unmute leaver ${member.id}:`, error.message);
            }
          }
        }

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

    // Move user to the voice channel if they're in one
    const member = interaction.member;
    let movedUser = false;
    if (member.voice.channel) {
      try {
        await member.voice.setChannel(vc);
        movedUser = true;
        console.log(`[Study] Moved ${username} into solo session VC`);
      } catch (error) {
        console.error(`[Study] Failed to move user to VC:`, error.message);
      }
    }

    // Start 25-minute timer
    startPomodoroTimer(session, client);

    // Log session start
    const startEmbed = new EmbedBuilder()
      .setTitle("📚 Solo Session Started")
      .setColor(0x5865F2)
      .addFields(
        { name: "User", value: `<@${user.id}>`, inline: true },
        { name: "Session ID", value: `#${session.id}`, inline: true },
        { name: "Duration", value: "25 minutes", inline: true },
        { name: "Voice Channel", value: `<#${vc.id}>`, inline: false }
      )
      .setTimestamp();
    await logToChannel(client, guild.id, startEmbed);

    // Reply with jump link
    await interaction.editReply({
      content: movedUser
        ? `✅ **Solo session created!**\n\n⏱️ 25-minute timer started. Good luck!`
        : `✅ **Solo session created!**\n\nClick to join: <#${vc.id}>\n\n⏱️ 25-minute timer started. Good luck!`,
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

  // Cancel any active solo session for this user
  for (const [vcId, session] of state.activeSessions) {
    if (session.type === "solo" && session.creatorId === userId) {
      console.log(`[Study] Canceling user's solo session ${session.id} (joining group queue)`);
      await cancelSession(session, client, "User joined group queue");
      break; // User can only have one solo session
    }
  }

  // Add to queue
  state.groupQueue.add(userId);
  const queueSize = state.groupQueue.size;

  // Start timeout if this is the first person
  if (queueSize === 1) {
    state.queueGuild = interaction.guild;
    state.queueChannel = interaction.channel;

    state.queueTimeout = setTimeout(async () => {
      try {
        if (state.groupQueue.size > 0) {
          await interaction.channel.send({
            content: `⏰ Queue timeout! Starting session with ${state.groupQueue.size} ${state.groupQueue.size === 1 ? 'person' : 'people'}...`
          });
          await startGroupSession(interaction.guild, interaction.channel, client);
        }
      } catch (error) {
        console.error('[Study] Queue timeout error:', error);
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

    try {
      await interaction.channel.send({
        content: announcement,
        allowedMentions: {
          roles: STUDY_ROLE_ID ? [STUDY_ROLE_ID] : [],
          users: [userId]
        }
      });
    } catch (error) {
      // If role ping fails (missing permissions), send without role ping
      if (error.code === 50013) {
        console.warn('[Study] Missing permission to mention role, sending without role ping');
        await interaction.channel.send({
          content: `👥 <@${userId}> joined the study queue! **(${queueSize}/${GROUP_QUEUE_THRESHOLD})**\n\nJoin now to start a group session!`,
          allowedMentions: { users: [userId] }
        });
      } else {
        console.error('[Study] Failed to send queue announcement:', error);
      }
    }
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

  const userId = interaction.user.id;

  // Cancel any active solo session for this user
  for (const [vcId, session] of state.activeSessions) {
    if (session.type === "solo" && session.creatorId === userId) {
      console.log(`[Study] Canceling user's solo session ${session.id} (joining active group)`);
      await cancelSession(session, client, "User joined active group");
      break; // User can only have one solo session
    }
  }

  const vcId = state.activeGroupSession.voiceChannelId;
  const member = interaction.member;
  let movedUser = false;

  // Move user to the group voice channel if they're in one
  if (member.voice.channel) {
    try {
      const vc = interaction.guild.channels.cache.get(vcId);
      if (vc) {
        await member.voice.setChannel(vc);
        movedUser = true;
        console.log(`[Study] Moved ${member.displayName || member.user.username} into active group session`);
      }
    } catch (error) {
      console.error(`[Study] Failed to move user to group VC:`, error.message);
    }
  }

  await interaction.editReply({
    content: movedUser
      ? `🚀 **Joined the active group session!**\n\n⏱️ Good luck!`
      : `🚀 **Join the active group session:**\n\n<#${vcId}>`,
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

    // Move queued users who are in voice channels
    let movedCount = 0;
    for (const userId of queuedUsers) {
      try {
        const member = await guild.members.fetch(userId);
        if (member.voice.channel) {
          await member.voice.setChannel(vc);
          movedCount++;
          console.log(`[Study] Moved ${member.displayName || member.user.username} into group session`);
        }
      } catch (error) {
        console.error(`[Study] Failed to move user ${userId} to group VC:`, error.message);
      }
    }

    // Announce
    const mentions = queuedUsers.map(id => `<@${id}>`).join(", ");
    const announceContent = movedCount === queuedUsers.length
      ? `🎉 **Group Pomodoro starting!**\n\n${mentions}\n\n⏱️ 25-minute session begins now!`
      : `🎉 **Group Pomodoro starting!**\n\n${mentions}\n\nJoin the channel: <#${vc.id}>\n⏱️ 25-minute session begins now!`;

    await textChannel.send({
      content: announceContent,
      allowedMentions: { users: queuedUsers }
    });

    // Start timer
    startPomodoroTimer(session, client);

    // Log session start
    const startEmbed = new EmbedBuilder()
      .setTitle("👥 Group Session Started")
      .setColor(0x57F287)
      .addFields(
        { name: "Participants", value: `${queuedUsers.length}`, inline: true },
        { name: "Session ID", value: `#${session.id}`, inline: true },
        { name: "Duration", value: "25 minutes", inline: true },
        { name: "Voice Channel", value: `<#${vc.id}>`, inline: false },
        { name: "Users", value: mentions, inline: false }
      )
      .setTimestamp();
    await logToChannel(client, guild.id, startEmbed);

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
 * Mute or unmute all non-bot members in a voice channel
 */
async function setVoiceChannelMute(client, session, shouldMute) {
  try {
    const guild = client.guilds.cache.get(session.guildId);
    if (!guild) return;

    const vc = guild.channels.cache.get(session.voiceChannelId);
    if (!vc) return;

    const members = vc.members.filter(m => !m.user.bot);

    for (const [memberId, member] of members) {
      try {
        await member.voice.setMute(shouldMute);
      } catch (error) {
        console.error(`[Study] Failed to ${shouldMute ? 'mute' : 'unmute'} member ${memberId}:`, error.message);
      }
    }

    const action = shouldMute ? 'muted' : 'unmuted';
    console.log(`[Study] ${action} ${members.size} members in session ${session.id}`);
  } catch (error) {
    console.error(`[Study] Error ${shouldMute ? 'muting' : 'unmuting'} members:`, error);
  }
}

/**
 * Start 25-minute Pomodoro timer
 */
async function startPomodoroTimer(session, client) {
  // Mute all members in the voice channel
  await setVoiceChannelMute(client, session, true);

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

    // Unmute all members before completion
    await setVoiceChannelMute(client, session, false);

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

      // Log completion to log channel
      const logEmbed = new EmbedBuilder()
        .setTitle("✅ Session Completed")
        .setColor(0x57F287)
        .addFields(
          { name: "Session ID", value: `#${session.id}`, inline: true },
          { name: "Type", value: session.type === "solo" ? "Solo" : "Group", inline: true },
          { name: "Participants", value: `${participantCount}`, inline: true },
          { name: "Duration", value: "25 minutes", inline: true },
          { name: "Users", value: mentions, inline: false }
        )
        .setTimestamp();
      await logToChannel(client, session.guildId, logEmbed);
    } else {
      console.log(`[Study] Session ${session.id} completed with no participants`);

      // Log completion with no participants
      const logEmbed = new EmbedBuilder()
        .setTitle("✅ Session Completed")
        .setColor(0x95A5A6)
        .addFields(
          { name: "Session ID", value: `#${session.id}`, inline: true },
          { name: "Type", value: session.type === "solo" ? "Solo" : "Group", inline: true },
          { name: "Participants", value: "0", inline: true },
          { name: "Status", value: "No participants remained", inline: false }
        )
        .setTimestamp();
      await logToChannel(client, session.guildId, logEmbed);
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
    // Log cancellation
    const logEmbed = new EmbedBuilder()
      .setTitle("❌ Session Cancelled")
      .setColor(0xE74C3C)
      .addFields(
        { name: "Session ID", value: `#${session.id}`, inline: true },
        { name: "Type", value: session.type === "solo" ? "Solo" : "Group", inline: true },
        { name: "Reason", value: reason, inline: false }
      )
      .setTimestamp();
    await logToChannel(client, session.guildId, logEmbed);

    // Unmute all members before cancelling
    await setVoiceChannelMute(client, session, false);

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
      content: `👋 <@${userId}> left the study queue (${queueSize}/${GROUP_QUEUE_THRESHOLD})`,
      allowedMentions: { users: [userId] }
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
