import Discord from "discord.js";
import { studyStatsStore } from "./StudyStatsStore.js";
import { sessionStateStore } from "./SessionStateStore.js";

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
const BREAK_MS = 5 * 60 * 1000; // 5 minutes
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
 * Auto-assign study role to user if they don't have it
 */
async function autoAssignStudyRole(member) {
  if (!STUDY_ROLE_ID) return;

  try {
    // Check if user already has the role
    if (member.roles.cache.has(STUDY_ROLE_ID)) {
      return; // Already has the role
    }

    // Assign the role
    const role = member.guild.roles.cache.get(STUDY_ROLE_ID);
    if (!role) {
      console.warn("[Study] Study role not found for auto-assignment");
      return;
    }

    await member.roles.add(role);
    console.log(`[Study] Auto-assigned study role to ${member.user.username}`);
  } catch (error) {
    console.error("[Study] Failed to auto-assign study role:", error.message);
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
          "سجل انك تبي تدرس مع قروب، وإذا صرتوا 3 يسوي روم ويبدأ التايمر.\n\n" +

          "⏱️ **Solo Timer**\n" +
          "ابدأ جلسة دراسة فردية لمدة 25 دقيقة.\n\n" +

          "🧭 **خيارات إضافية**\n" +
          "**View My Progress**\n" +
          "شوف إجمالي وقتك وجلساتك.\n\n" +

          "🔔 **التنبيهات**\n" +
          "فعّل التنبيهات إذا حاب تعرف إذا فيه قروب جديد."
        );

      // Row 1 – Join group + Quick solo
      const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("study_queue")
          .setLabel("Join Group Queue")
          .setEmoji("👥")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("study_solo")
          .setLabel("Quick Solo Timer")
          .setEmoji("⏱️")
          .setStyle(ButtonStyle.Secondary)
      );

      // Row 2 – Leave queue + View progress
      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("study_queue_leave")
          .setLabel("Leave Queue")
          .setEmoji("🟥")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId("study_stats")
          .setLabel("View My Progress")
          .setEmoji("📊")
          .setStyle(ButtonStyle.Secondary)
      );

      // Row 3 – Notifications
      const row3 = new ActionRowBuilder().addComponents(
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

      await message.channel.send({
        embeds: [embed],
        components: [row1, row2, row3],
      });

      await message.reply("Study control message posted!");
    } catch (error) {
      console.error("[Study] Error posting control message:", error);
      message.reply("Error posting control message").catch(() => { });
    }
  });

  // Command to post study group join message
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (message.author.id !== OWNER_ID) return;
    if (message.content.trim() !== "!studygroup") return;

    try {
      const embed = new EmbedBuilder()
        .setTitle("📚 قروب المذاكرين")
        .setColor(0x5865F2)
        .setDescription(
          "انضم لقروب المذاكرين وشارك مع زملائك في جلسات الدراسة!\n\n" +
          "اضغط على الزر بالأسفل للحصول على صلاحيات الوصول للقناة 👇"
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("study_group_join")
          .setLabel("انضم لقروب المذاكرين من هنا")
          .setEmoji("📖")
          .setStyle(ButtonStyle.Primary)
      );

      await message.channel.send({
        embeds: [embed],
        components: [row],
      });

      await message.delete().catch(() => {});
    } catch (error) {
      console.error("[Study] Error posting study group join message:", error);
      message.reply("Error posting study group join message").catch(() => { });
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

      // Create eligible users list sorted by tickets (descending)
      const sortedUsers = [...eligibleUsers].sort((a, b) => b.tickets - a.tickets);

      // Build the eligible users list
      let userListText = "";
      for (let i = 0; i < sortedUsers.length; i++) {
        const user = sortedUsers[i];
        const winPercentage = ((user.tickets / totalTickets) * 100).toFixed(2);
        userListText += `**${i + 1}.** ${user.displayName}\n`;
        userListText += `   └ 📚 Sessions: ${user.sessions} | 🎫 Tickets: ${user.tickets} | 📊 Win Chance: ${winPercentage}%\n\n`;
      }

      // Split the user list if it's too long for Discord (max 2000 chars per message)
      const MAX_MESSAGE_LENGTH = 1900; // Leave some buffer
      const userListChunks = [];
      let currentChunk = "";

      const lines = userListText.split('\n');
      for (const line of lines) {
        if ((currentChunk + line + '\n').length > MAX_MESSAGE_LENGTH) {
          userListChunks.push(currentChunk);
          currentChunk = line + '\n';
        } else {
          currentChunk += line + '\n';
        }
      }
      if (currentChunk.trim()) {
        userListChunks.push(currentChunk);
      }

      // Send eligible users list
      for (let i = 0; i < userListChunks.length; i++) {
        const listEmbed = new EmbedBuilder()
          .setTitle(i === 0 ? "📋 All Eligible Participants" : `📋 All Eligible Participants (continued ${i + 1})`)
          .setColor(0x5865F2)
          .setDescription(userListChunks[i])
          .setFooter({
            text: i === userListChunks.length - 1
              ? `Total: ${eligibleUsers.length} participants | ${totalTickets} tickets`
              : `Page ${i + 1}/${userListChunks.length}`
          });

        if (i === userListChunks.length - 1) {
          listEmbed.setTimestamp();
        }

        await message.channel.send({ embeds: [listEmbed] });
      }

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
          if (member && !member.user.bot) {
            // Always unmute when leaving study VC to prevent mute from persisting
            try {
              await member.voice.setMute(false);
              console.log(`[Study] Unmuted ${member.user.username} who left session ${session.id}`);
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

  // Auto-assign study role
  await autoAssignStudyRole(interaction.member);

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

    // Persist state
    sessionStateStore.saveState(state).catch(err =>
      console.error('[Study] Failed to save state after removing from queue:', err)
    );
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
    session.username = username; // Store username for VC name updates

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

  // Auto-assign study role
  await autoAssignStudyRole(interaction.member);

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

  // Persist state
  sessionStateStore.saveState(state).catch(err =>
    console.error('[Study] Failed to save state after adding to queue:', err)
  );

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
 * Handle show stats button click
 */
async function handleShowStats(interaction) {
  await interaction.deferReply({ ephemeral: true });

  // Auto-assign study role
  await autoAssignStudyRole(interaction.member);

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

    // Persist state (queue cleared and active group session set)
    sessionStateStore.saveState(state).catch(err =>
      console.error('[Study] Failed to save state after starting group session:', err)
    );

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
    phase: "focus", // "focus" or "break"
    pomodoroCount: 0, // Number of completed focus sessions
    username: null, // For solo sessions, store username
  };

  state.activeSessions.set(vcId, session);

  // Persist state
  sessionStateStore.saveState(state).catch(err =>
    console.error('[Study] Failed to save state after creating session:', err)
  );

  return session;
}

/**
 * Update voice channel name based on session phase
 */
async function updateVoiceChannelName(client, session) {
  try {
    const guild = client.guilds.cache.get(session.guildId);
    if (!guild) return;

    const vc = guild.channels.cache.get(session.voiceChannelId);
    if (!vc) return;

    let newName;
    if (session.type === "solo") {
      if (session.phase === "focus") {
        newName = `📚 Study – ${session.username} – Focus`;
      } else {
        newName = `☕ Break – ${session.username}`;
      }
    } else {
      if (session.phase === "focus") {
        newName = `📚 Study Group – Focus`;
      } else {
        newName = `☕ Group Break`;
      }
    }

    await vc.setName(newName);
    console.log(`[Study] Updated VC name to: ${newName}`);
  } catch (error) {
    console.error(`[Study] Failed to update VC name:`, error.message);
  }
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
  // Set phase to focus
  session.phase = "focus";
  session.startedAt = Date.now();

  // Update VC name to show focus phase
  await updateVoiceChannelName(client, session);

  // Mute all members in the voice channel
  await setVoiceChannelMute(client, session, true);

  session.timer = setTimeout(async () => {
    await completeFocusSession(session, client);
  }, FOCUS_MS);
}

/**
 * Complete a focus session and start break
 */
async function completeFocusSession(session, client) {
  console.log(`[Study] Completing focus session ${session.id}`);

  try {
    const guild = client.guilds.cache.get(session.guildId);
    if (!guild) return;

    const vc = guild.channels.cache.get(session.voiceChannelId);
    const textChannel = guild.channels.cache.get(session.textChannelId);

    // Unmute all members
    await setVoiceChannelMute(client, session, false);

    // Get participants (non-bot members)
    const participants = vc?.members.filter(m => !m.user.bot) || new Map();
    const participantCount = participants.size;

    if (participantCount > 0) {
      // Increment pomodoro count
      session.pomodoroCount++;

      // Log completion for each participant
      for (const [userId] of participants) {
        await studyStatsStore.recordSession(userId, session.guildId, 25);
      }

      // Send DM to each participant about break time
      for (const [userId, member] of participants) {
        try {
          const dmEmbed = new EmbedBuilder()
            .setTitle("🎉 Study Session Complete!")
            .setColor(0x57F287)
            .setDescription(
              `Great job on completing your **25-minute** study session!\n\n` +
              `**Session #${session.pomodoroCount}** completed!\n\n` +
              `☕ **Time for a 5-minute break!**\n` +
              `Stretch, grab water, or rest your eyes.\n\n` +
              `The next focus session will start automatically. 💪`
            )
            .setTimestamp();

          await member.user.send({ embeds: [dmEmbed] });
          console.log(`[Study] Sent break DM to ${member.user.username}`);
        } catch (error) {
          // User might have DMs disabled
          console.log(`[Study] Could not send DM to ${member.user.username}: ${error.message}`);
        }
      }

      // Post summary
      const mentions = Array.from(participants.keys()).map(id => `<@${id}>`).join(", ");
      const embed = new EmbedBuilder()
        .setTitle("✅ Focus Session Completed")
        .setColor(0x57F287)
        .setDescription(
          `**Duration:** 25 minutes\n` +
          `**Session:** #${session.pomodoroCount}\n` +
          `**Participants:** ${participantCount}\n\n` +
          `${mentions}\n\n` +
          `☕ **5-minute break starting now!**\n` +
          `Next focus session starts automatically.`
        )
        .setTimestamp();

      if (textChannel) {
        await textChannel.send({ embeds: [embed] });
      }

      console.log(`[Study] Focus session ${session.id} completed (Pomodoro #${session.pomodoroCount}) with ${participantCount} participants`);

      // Log completion to log channel
      const logEmbed = new EmbedBuilder()
        .setTitle("✅ Focus Session Completed")
        .setColor(0x57F287)
        .addFields(
          { name: "Session ID", value: `#${session.id}`, inline: true },
          { name: "Type", value: session.type === "solo" ? "Solo" : "Group", inline: true },
          { name: "Pomodoro", value: `#${session.pomodoroCount}`, inline: true },
          { name: "Participants", value: `${participantCount}`, inline: true },
          { name: "Duration", value: "25 minutes", inline: true },
          { name: "Users", value: mentions, inline: false }
        )
        .setTimestamp();
      await logToChannel(client, session.guildId, logEmbed);

      // Start break timer
      await startBreakTimer(session, client);
    } else {
      console.log(`[Study] Focus session ${session.id} completed with no participants - continuing anyway`);

      // Still increment the counter
      session.pomodoroCount++;

      // Log completion with no participants
      const logEmbed = new EmbedBuilder()
        .setTitle("✅ Focus Session Completed")
        .setColor(0x95A5A6)
        .addFields(
          { name: "Session ID", value: `#${session.id}`, inline: true },
          { name: "Type", value: session.type === "solo" ? "Solo" : "Group", inline: true },
          { name: "Pomodoro", value: `#${session.pomodoroCount}`, inline: true },
          { name: "Participants", value: "0", inline: true },
          { name: "Status", value: "No participants remained", inline: false }
        )
        .setTimestamp();
      await logToChannel(client, session.guildId, logEmbed);

      // Start break timer even with no participants
      await startBreakTimer(session, client);
    }

    // Persist state
    sessionStateStore.saveState(state).catch(err =>
      console.error('[Study] Failed to save state after completing focus session:', err)
    );

  } catch (error) {
    console.error("[Study] Error completing focus session:", error);
  }
}

/**
 * Start 5-minute break timer
 */
async function startBreakTimer(session, client) {
  // Clear the focus timer
  if (session.timer) clearTimeout(session.timer);

  // Set phase to break
  session.phase = "break";
  session.startedAt = Date.now();

  // Update VC name to show break phase
  await updateVoiceChannelName(client, session);

  console.log(`[Study] Starting 5-minute break for session ${session.id}`);

  session.timer = setTimeout(async () => {
    await completeBreakSession(session, client);
  }, BREAK_MS);

  // Persist state
  sessionStateStore.saveState(state).catch(err =>
    console.error('[Study] Failed to save state after starting break:', err)
  );
}

/**
 * Complete break and start next focus session
 */
async function completeBreakSession(session, client) {
  console.log(`[Study] Completing break for session ${session.id}, starting next focus session`);

  try {
    const guild = client.guilds.cache.get(session.guildId);
    if (!guild) return;

    const vc = guild.channels.cache.get(session.voiceChannelId);
    const textChannel = guild.channels.cache.get(session.textChannelId);

    // Get participants (non-bot members)
    const participants = vc?.members.filter(m => !m.user.bot) || new Map();
    const participantCount = participants.size;

    if (participantCount > 0) {
      // Send DM to each participant about next session
      for (const [userId, member] of participants) {
        try {
          const dmEmbed = new EmbedBuilder()
            .setTitle("📚 Break Complete!")
            .setColor(0x5865F2)
            .setDescription(
              `Break time is over!\n\n` +
              `**Next focus session (Session #${session.pomodoroCount + 1}) starting now!**\n\n` +
              `Let's get back to work! 💪`
            )
            .setTimestamp();

          await member.user.send({ embeds: [dmEmbed] });
          console.log(`[Study] Sent next session DM to ${member.user.username}`);
        } catch (error) {
          console.log(`[Study] Could not send DM to ${member.user.username}: ${error.message}`);
        }
      }

      // Post announcement
      const mentions = Array.from(participants.keys()).map(id => `<@${id}>`).join(", ");
      const embed = new EmbedBuilder()
        .setTitle("📚 Next Focus Session Starting!")
        .setColor(0x5865F2)
        .setDescription(
          `Break complete!\n\n` +
          `${mentions}\n\n` +
          `**Session #${session.pomodoroCount + 1}** starting now!`
        )
        .setTimestamp();

      if (textChannel) {
        await textChannel.send({ embeds: [embed] });
      }
    }

    // Start next focus session
    await startPomodoroTimer(session, client);

  } catch (error) {
    console.error("[Study] Error completing break session:", error);
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

    // Persist state
    sessionStateStore.saveState(state).catch(err =>
      console.error('[Study] Failed to save state after canceling session:', err)
    );

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

  // Persist state
  sessionStateStore.saveState(state).catch(err =>
    console.error('[Study] Failed to save state after removing from queue:', err)
  );

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
 * Handle joining study group - gives role and notifies about channel access
 */
async function handleStudyGroupJoin(interaction) {
  await interaction.deferReply({ ephemeral: true });

  if (!STUDY_ROLE_ID || !STUDY_CHANNEL_ID) {
    return interaction.editReply({
      content: "❌ Study group not configured. Contact an admin.",
    });
  }

  try {
    const member = interaction.member;
    const role = interaction.guild.roles.cache.get(STUDY_ROLE_ID);
    const channel = interaction.guild.channels.cache.get(STUDY_CHANNEL_ID);

    if (!role) {
      return interaction.editReply({
        content: "❌ Study role not found. Contact an admin.",
      });
    }

    if (!channel) {
      return interaction.editReply({
        content: "❌ Study channel not found. Contact an admin.",
      });
    }

    if (member.roles.cache.has(STUDY_ROLE_ID)) {
      return interaction.editReply({
        content: `✅ You're already a member of the study group!\n\nYou can access the channel here: ${channel}`,
      });
    }

    await member.roles.add(role);
    await interaction.editReply({
      content: `✅ Welcome to the study group!\n\nYou now have access to ${channel}\n\nRole: ${role}`,
    });
  } catch (error) {
    console.error("[Study] Error joining study group:", error);
    await interaction.editReply({
      content: "❌ Failed to join study group. Make sure the bot has permission to manage roles.",
    });
  }
}

/**
 * Recover sessions from persistent storage after bot restart
 * This function should be called once when the bot starts
 */
export async function recoverSessions(client) {
  console.log('[Study] Attempting to recover sessions from persistent storage...');

  // Restore state from disk
  const restored = sessionStateStore.restoreState(state);

  if (!restored) {
    console.log('[Study] No sessions to recover');
    return;
  }

  // Check and recover each active session
  const sessionsToRecover = Array.from(state.activeSessions.values());
  let recoveredCount = 0;
  let cleanedCount = 0;

  for (const session of sessionsToRecover) {
    try {
      const guild = client.guilds.cache.get(session.guildId);
      if (!guild) {
        console.log(`[Study] Session ${session.id}: Guild not found, cleaning up`);
        state.activeSessions.delete(session.voiceChannelId);
        cleanedCount++;
        continue;
      }

      const vc = guild.channels.cache.get(session.voiceChannelId);
      if (!vc) {
        console.log(`[Study] Session ${session.id}: Voice channel deleted, cleaning up`);
        state.activeSessions.delete(session.voiceChannelId);
        if (session.type === "group" && state.activeGroupSession?.voiceChannelId === session.voiceChannelId) {
          state.activeGroupSession = null;
        }
        cleanedCount++;
        continue;
      }

      // Check how much time has elapsed
      const elapsed = Date.now() - session.startedAt;
      const phaseMs = session.phase === "break" ? BREAK_MS : FOCUS_MS;
      const remaining = phaseMs - elapsed;

      // If session should have already completed
      if (remaining <= 0) {
        console.log(`[Study] Session ${session.id}: Timer already expired for ${session.phase} phase, completing now`);
        if (session.phase === "break") {
          await completeBreakSession(session, client);
        } else {
          await completeFocusSession(session, client);
        }
        recoveredCount++;
        continue;
      }

      // Check if there are any non-bot members in the voice channel
      const memberCount = vc.members.filter(m => !m.user.bot).size;

      if (memberCount === 0) {
        console.log(`[Study] Session ${session.id}: Voice channel empty, canceling`);
        await cancelSession(session, client, "Empty room after restart");
        cleanedCount++;
        continue;
      }

      // Restart the timer for the remaining time
      console.log(`[Study] Session ${session.id}: Recovering ${session.phase} phase with ${Math.round(remaining / 1000)}s remaining`);
      session.timer = setTimeout(async () => {
        if (session.phase === "break") {
          await completeBreakSession(session, client);
        } else {
          await completeFocusSession(session, client);
        }
      }, remaining);

      // Mute all members if in focus phase (they should already be muted, but ensure it)
      if (session.phase === "focus") {
        await setVoiceChannelMute(client, session, true);
      }

      // Update VC name to reflect current phase
      await updateVoiceChannelName(client, session);

      recoveredCount++;
    } catch (error) {
      console.error(`[Study] Failed to recover session ${session.id}:`, error.message);
      state.activeSessions.delete(session.voiceChannelId);
      cleanedCount++;
    }
  }

  // Log recovery summary
  console.log(`[Study] Recovery complete: ${recoveredCount} sessions recovered, ${cleanedCount} cleaned up`);

  // Log queue status
  if (state.groupQueue.size > 0) {
    console.log(`[Study] Recovered queue with ${state.groupQueue.size} users (timeout not restarted - users should re-join)`);
  }

  // Save the cleaned-up state
  await sessionStateStore.saveState(state);
}

/**
 * Export button handlers for use in main button handler
 */
export {
  handleSoloPomodoro,
  handleGroupQueue,
  handleShowStats,
  handleQueueLeave,
  handleRoleAdd,
  handleRoleRemove,
  handleStudyGroupJoin
};
