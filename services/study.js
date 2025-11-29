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
const EMPTY_TIMEOUT_MS = 60 * 1000; // 1 minute
const DELETE_DELAY_MS = 60 * 1000; // 60 seconds after completion
const GROUP_QUEUE_THRESHOLD = 3; // Number of users needed to start group session
const QUEUE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes - auto-start queue if not full

// ---- STATE ----
const state = {
  sessionCounter: 0,
  activeSessions: new Map(), // voiceChannelId -> session
  groupQueues: {
    25: new Set(), // Set of user IDs waiting for 25min group session
    50: new Set(), // Set of user IDs waiting for 50min group session
  },
  activeGroupSessions: {
    25: null, // { voiceChannelId, textChannelId } or null
    50: null, // { voiceChannelId, textChannelId } or null
  },
  queueTimeouts: {
    25: null, // Timeout for auto-starting 25min queue
    50: null, // Timeout for auto-starting 50min queue
  },
  queueGuilds: {
    25: null, // Guild where 25min queue is active
    50: null, // Guild where 50min queue is active
  },
  queueChannels: {
    25: null, // Text channel where 25min queue was started
    50: null, // Text channel where 50min queue was started
  },
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
          "سجل انك تبي تدرس مع قروب، وإذا صرتوا 3 يسوي روم ويبدأ التايمر.\n" +
          "اختر: 25 دقيقة أو 50 دقيقة.\n\n" +

          "⏱️ **Solo Timer**\n" +
          "ابدأ جلسة دراسة فردية.\n" +
          "اختر: 25 دقيقة أو 50 دقيقة.\n\n" +

          "🧭 **خيارات إضافية**\n" +
          "**View My Progress**\n" +
          "شوف إجمالي وقتك وجلساتك.\n\n" +

          "🔔 **التنبيهات**\n" +
          "فعّل التنبيهات إذا حاب تعرف إذا فيه قروب جديد."
        );

      // Row 1 – Group study (25min and 50min)
      const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("study_queue_25")
          .setLabel("Join 25min Group")
          .setEmoji("👥")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("study_queue_50")
          .setLabel("Join 50min Group")
          .setEmoji("👥")
          .setStyle(ButtonStyle.Primary)
      );

      // Row 2 – Solo timers (25min and 50min)
      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("study_solo_25")
          .setLabel("Solo 25min")
          .setEmoji("🍅")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("study_solo_50")
          .setLabel("Solo 50min")
          .setEmoji("🍅")
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

        // Add to eligible users with their ticket count (tickets = 1 base + hours × 10)
        eligibleUsers.push({
          userId,
          username: member.user.username,
          displayName: member.displayName || member.user.username,
          sessions: stats.totalSessions,
          hours: stats.totalHours,
          tickets: 1 + Math.round(stats.totalHours * 10) // 1 base ticket for having both roles + (hours × 10)
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
        .setFooter({ text: "More study time = More chances to win!" })
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
async function handleSoloPomodoro(interaction, client, duration) {
  await interaction.deferReply({ ephemeral: true });

  // Auto-assign study role
  await autoAssignStudyRole(interaction.member);

  const guild = interaction.guild;
  const user = interaction.user;
  const username = interaction.member.displayName || user.username;

  // Remove user from both queues if they're in any
  for (const dur of [25, 50]) {
    if (state.groupQueues[dur].has(user.id)) {
      state.groupQueues[dur].delete(user.id);
      const queueSize = state.groupQueues[dur].size;

      // If queue is now empty, clear timeout
      if (queueSize === 0) {
        if (state.queueTimeouts[dur]) {
          clearTimeout(state.queueTimeouts[dur]);
          state.queueTimeouts[dur] = null;
        }
        state.queueGuilds[dur] = null;
        state.queueChannels[dur] = null;
        console.log(`[Study] ${dur}min queue emptied (user started solo session), timeout cleared`);
      } else {
        console.log(`[Study] User removed from ${dur}min queue to start solo session. Queue size: ${queueSize}`);
      }

      // Persist state
      sessionStateStore.saveState(state).catch(err =>
        console.error('[Study] Failed to save state after removing from queue:', err)
      );
      break; // User can only be in one queue
    }
  }

  try {
    // Create voice channel
    const vcOptions = {
      name: `Study – Solo ${duration}min – ${username}`,
      type: ChannelType.GuildVoice,
    };

    if (VOICE_CATEGORY_ID) {
      vcOptions.parent = VOICE_CATEGORY_ID;
    }

    const vc = await guild.channels.create(vcOptions);

    // Create session
    const session = createSession("solo", guild.id, vc.id, interaction.channel.id, user.id, duration);

    // Move user to the voice channel if they're in one
    const member = interaction.member;
    let movedUser = false;
    if (member.voice.channel) {
      try {
        await member.voice.setChannel(vc);
        movedUser = true;
        console.log(`[Study] Moved ${username} into solo ${duration}min session VC`);
      } catch (error) {
        console.error(`[Study] Failed to move user to VC:`, error.message);
      }
    }

    // Start timer
    startPomodoroTimer(session, client);

    // Log session start
    const startEmbed = new EmbedBuilder()
      .setTitle("📚 Solo Session Started")
      .setColor(0x5865F2)
      .addFields(
        { name: "User", value: `<@${user.id}>`, inline: true },
        { name: "Session ID", value: `#${session.id}`, inline: true },
        { name: "Duration", value: `${duration} minutes`, inline: true },
        { name: "Voice Channel", value: `<#${vc.id}>`, inline: false }
      )
      .setTimestamp();
    await logToChannel(client, guild.id, startEmbed);

    // Reply with jump link
    await interaction.editReply({
      content: movedUser
        ? `✅ **Solo ${duration}min session created!**\n\n⏱️ Timer started. Good luck!`
        : `✅ **Solo ${duration}min session created!**\n\nClick to join: <#${vc.id}>\n\n⏱️ Timer started. Good luck!`,
    });

    console.log(`[Study] Solo ${duration}min session created for ${username}`);
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
async function handleGroupQueue(interaction, client, duration) {
  await interaction.deferReply({ ephemeral: true });

  // Auto-assign study role
  await autoAssignStudyRole(interaction.member);

  const userId = interaction.user.id;

  // Check if already in any queue
  for (const dur of [25, 50]) {
    if (state.groupQueues[dur].has(userId)) {
      return interaction.editReply({
        content: `You're already in the ${dur}min group queue!`,
      });
    }
  }

  // Cancel any active solo session for this user
  for (const [vcId, session] of state.activeSessions) {
    if (session.type === "solo" && session.creatorId === userId) {
      console.log(`[Study] Canceling user's solo session ${session.id} (joining ${duration}min group queue)`);
      await cancelSession(session, client, `User joined ${duration}min group queue`);
      break; // User can only have one solo session
    }
  }

  // Add to the specific duration queue
  state.groupQueues[duration].add(userId);
  const queueSize = state.groupQueues[duration].size;

  // Persist state
  sessionStateStore.saveState(state).catch(err =>
    console.error('[Study] Failed to save state after adding to queue:', err)
  );

  // Start timeout if this is the first person
  if (queueSize === 1) {
    state.queueGuilds[duration] = interaction.guild;
    state.queueChannels[duration] = interaction.channel;

    state.queueTimeouts[duration] = setTimeout(async () => {
      try {
        if (state.groupQueues[duration].size > 0) {
          await interaction.channel.send({
            content: `⏰ ${duration}min queue timeout! Starting session with ${state.groupQueues[duration].size} ${state.groupQueues[duration].size === 1 ? 'person' : 'people'}...`
          });
          await startGroupSession(interaction.guild, interaction.channel, client, duration);
        }
      } catch (error) {
        console.error(`[Study] ${duration}min queue timeout error:`, error);
      }
    }, QUEUE_TIMEOUT_MS);

    console.log(`[Study] ${duration}min queue timeout started (${QUEUE_TIMEOUT_MS / 60000} minutes)`);
  }

  await interaction.editReply({
    content: `✅ Added to ${duration}min group queue!\n\n**Queue size:** ${queueSize}/${GROUP_QUEUE_THRESHOLD}\n\n${queueSize === 1 ? `⏰ Session will auto-start in ${QUEUE_TIMEOUT_MS / 60000} minutes if not full` : ''}`,
  });

  // Announce in channel with role ping (if not full yet)
  if (queueSize < GROUP_QUEUE_THRESHOLD) {
    const rolePing = STUDY_ROLE_ID ? `<@&${STUDY_ROLE_ID}>` : "";
    const announcement = rolePing
      ? `${rolePing} 👥 <@${userId}> joined the ${duration}min study queue! **(${queueSize}/${GROUP_QUEUE_THRESHOLD})**\n\nJoin now to start a group session!`
      : `👥 <@${userId}> joined the ${duration}min study queue (${queueSize}/${GROUP_QUEUE_THRESHOLD})`;

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
          content: `👥 <@${userId}> joined the ${duration}min study queue! **(${queueSize}/${GROUP_QUEUE_THRESHOLD})**\n\nJoin now to start a group session!`,
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
    if (state.queueTimeouts[duration]) {
      clearTimeout(state.queueTimeouts[duration]);
      state.queueTimeouts[duration] = null;
    }
    await startGroupSession(interaction.guild, interaction.channel, client, duration);
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
async function startGroupSession(guild, textChannel, client, duration) {
  try {
    // Create group VC
    const vcOptions = {
      name: `Study – Group ${duration}min`,
      type: ChannelType.GuildVoice,
    };

    if (VOICE_CATEGORY_ID) {
      vcOptions.parent = VOICE_CATEGORY_ID;
    }

    const vc = await guild.channels.create(vcOptions);

    // Create session
    const session = createSession("group", guild.id, vc.id, textChannel.id, null, duration);

    // Set active group session for this duration
    state.activeGroupSessions[duration] = {
      voiceChannelId: vc.id,
      textChannelId: textChannel.id
    };

    // Get queued users for this duration
    const queuedUsers = Array.from(state.groupQueues[duration]);

    // Clear queue and timeout for this duration
    state.groupQueues[duration].clear();
    if (state.queueTimeouts[duration]) {
      clearTimeout(state.queueTimeouts[duration]);
      state.queueTimeouts[duration] = null;
    }
    state.queueGuilds[duration] = null;
    state.queueChannels[duration] = null;

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
          console.log(`[Study] Moved ${member.displayName || member.user.username} into ${duration}min group session`);
        }
      } catch (error) {
        console.error(`[Study] Failed to move user ${userId} to group VC:`, error.message);
      }
    }

    // Announce
    const mentions = queuedUsers.map(id => `<@${id}>`).join(", ");
    const announceContent = movedCount === queuedUsers.length
      ? `🎉 **Group ${duration}min Pomodoro starting!**\n\n${mentions}\n\n⏱️ ${duration}-minute session begins now!`
      : `🎉 **Group ${duration}min Pomodoro starting!**\n\n${mentions}\n\nJoin the channel: <#${vc.id}>\n⏱️ ${duration}-minute session begins now!`;

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
        { name: "Duration", value: `${duration} minutes`, inline: true },
        { name: "Voice Channel", value: `<#${vc.id}>`, inline: false },
        { name: "Users", value: mentions, inline: false }
      )
      .setTimestamp();
    await logToChannel(client, guild.id, startEmbed);

    console.log(`[Study] Group ${duration}min session started with ${queuedUsers.length} users`);
  } catch (error) {
    console.error("[Study] Error starting group session:", error);
  }
}

/**
 * Create a new study session
 */
function createSession(type, guildId, vcId, textId, creatorId, duration) {
  const id = ++state.sessionCounter;
  const session = {
    id,
    type, // "solo" or "group"
    guildId,
    voiceChannelId: vcId,
    textChannelId: textId,
    creatorId, // Only for solo sessions
    duration, // Duration in minutes (25 or 50)
    startedAt: Date.now(),
    timer: null,
    emptyTimeout: null,
    completed: false,
  };

  state.activeSessions.set(vcId, session);

  // Persist state
  sessionStateStore.saveState(state).catch(err =>
    console.error('[Study] Failed to save state after creating session:', err)
  );

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
 * Start Pomodoro timer based on session duration
 */
async function startPomodoroTimer(session, client) {
  // Mute all members in the voice channel
  await setVoiceChannelMute(client, session, true);

  const focusMs = session.duration * 60 * 1000; // Convert minutes to milliseconds
  session.timer = setTimeout(async () => {
    await completeSession(session, client);
  }, focusMs);
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
        await studyStatsStore.recordSession(userId, session.guildId, session.duration);
      }

      // Calculate break time (1/5 of session duration)
      const breakMinutes = Math.round(session.duration / 5);

      // Send DM to each participant about break time
      for (const [userId, member] of participants) {
        try {
          const dmEmbed = new EmbedBuilder()
            .setTitle("🎉 Study Session Complete!")
            .setColor(0x57F287)
            .setDescription(
              `Great job on completing your **${session.duration}-minute** study session!\n\n` +
              `🧘 **Time for a break!**\n` +
              `Take ${breakMinutes} minutes to rest, stretch, or grab a snack.\n\n` +
              `You've earned it! 💪`
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
        .setTitle("✅ Study Session Completed")
        .setColor(0x57F287)
        .setDescription(
          `**Duration:** ${session.duration} minutes\n` +
          `**Participants:** ${participantCount}\n\n` +
          `${mentions}\n\n` +
          `Great work! 🎉`
        )
        .setTimestamp();

      if (textChannel) {
        await textChannel.send({ embeds: [embed] });
      }

      console.log(`[Study] Session ${session.id} (${session.duration}min) completed with ${participantCount} participants`);

      // Log completion to log channel
      const logEmbed = new EmbedBuilder()
        .setTitle("✅ Session Completed")
        .setColor(0x57F287)
        .addFields(
          { name: "Session ID", value: `#${session.id}`, inline: true },
          { name: "Type", value: session.type === "solo" ? "Solo" : "Group", inline: true },
          { name: "Participants", value: `${participantCount}`, inline: true },
          { name: "Duration", value: `${session.duration} minutes`, inline: true },
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
    if (session.type === "group" && session.duration) {
      if (state.activeGroupSessions[session.duration]?.voiceChannelId === session.voiceChannelId) {
        state.activeGroupSessions[session.duration] = null;
      }
    }

    // Persist state
    sessionStateStore.saveState(state).catch(err =>
      console.error('[Study] Failed to save state after completing session:', err)
    );

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
    if (session.type === "group" && session.duration) {
      if (state.activeGroupSessions[session.duration]?.voiceChannelId === session.voiceChannelId) {
        state.activeGroupSessions[session.duration] = null;
      }
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

  // Check which queue the user is in
  let foundInQueue = null;
  for (const dur of [25, 50]) {
    if (state.groupQueues[dur].has(userId)) {
      foundInQueue = dur;
      break;
    }
  }

  // Check if in any queue
  if (!foundInQueue) {
    return interaction.editReply({
      content: "You're not in any queue.",
    });
  }

  // Remove from the specific queue
  state.groupQueues[foundInQueue].delete(userId);
  const queueSize = state.groupQueues[foundInQueue].size;

  // If queue is now empty, clear timeout
  if (queueSize === 0) {
    if (state.queueTimeouts[foundInQueue]) {
      clearTimeout(state.queueTimeouts[foundInQueue]);
      state.queueTimeouts[foundInQueue] = null;
    }
    state.queueGuilds[foundInQueue] = null;
    state.queueChannels[foundInQueue] = null;
    console.log(`[Study] ${foundInQueue}min queue emptied, timeout cleared`);
  }

  // Persist state
  sessionStateStore.saveState(state).catch(err =>
    console.error('[Study] Failed to save state after removing from queue:', err)
  );

  await interaction.editReply({
    content: `✅ Removed from ${foundInQueue}min queue.\n\n${queueSize > 0 ? `**Queue size:** ${queueSize}/${GROUP_QUEUE_THRESHOLD}` : 'Queue is now empty.'}`,
  });

  // Announce if queue still has people
  if (queueSize > 0) {
    await interaction.channel.send({
      content: `👋 <@${userId}> left the ${foundInQueue}min study queue (${queueSize}/${GROUP_QUEUE_THRESHOLD})`,
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
        if (session.type === "group" && session.duration) {
          if (state.activeGroupSessions[session.duration]?.voiceChannelId === session.voiceChannelId) {
            state.activeGroupSessions[session.duration] = null;
          }
        }
        cleanedCount++;
        continue;
      }

      // Use default duration if not set (backward compatibility)
      const sessionDuration = session.duration || 25;
      const focusMs = sessionDuration * 60 * 1000;

      // Check how much time has elapsed
      const elapsed = Date.now() - session.startedAt;
      const remaining = focusMs - elapsed;

      // If session should have already completed
      if (remaining <= 0) {
        console.log(`[Study] Session ${session.id}: Timer already expired, completing now`);
        await completeSession(session, client);
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
      console.log(`[Study] Session ${session.id} (${sessionDuration}min): Recovering with ${Math.round(remaining / 1000)}s remaining`);
      session.timer = setTimeout(async () => {
        await completeSession(session, client);
      }, remaining);

      // Mute all members (they should already be muted, but ensure it)
      await setVoiceChannelMute(client, session, true);

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
  for (const dur of [25, 50]) {
    if (state.groupQueues[dur]?.size > 0) {
      console.log(`[Study] Recovered ${dur}min queue with ${state.groupQueues[dur].size} users (timeout not restarted - users should re-join)`);
    }
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
