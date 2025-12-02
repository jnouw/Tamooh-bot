import Discord from "discord.js";
import { studyStatsStore } from "../StudyStatsStore.js";
import { sessionStateStore } from "../SessionStateStore.js";
import { createSession, startPomodoroTimer, cancelSession, state } from "./sessionManager.js";
import { startGroupSession } from "./queueManager.js";
import { logToChannel, autoAssignStudyRole, getMotivationalMessage } from "./utils.js";
import {
  VOICE_CATEGORY_ID,
  DELETE_DELAY_MS,
  GROUP_QUEUE_THRESHOLD,
  QUEUE_TIMEOUT_MS,
  STUDY_ROLE_ID,
  STUDY_CHANNEL_ID
} from "./config.js";

const { ChannelType, EmbedBuilder } = Discord;

/**
 * Handle solo Pomodoro button click
 */
export async function handleSoloPomodoro(interaction, client, duration) {
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

    // Create session (pass username for VC name updates)
    const session = createSession("solo", guild.id, vc.id, interaction.channel.id, user.id, duration, username);

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
    await startPomodoroTimer(session, client);

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
export async function handleGroupQueue(interaction, client, duration) {
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
          const msg = await interaction.channel.send({
            content: `⏰ ${duration}min queue timeout! Starting session with ${state.groupQueues[duration].size} ${state.groupQueues[duration].size === 1 ? 'person' : 'people'}...`
          });
          // Auto-delete timeout message after 1 minute
          setTimeout(() => msg.delete().catch(err => {
            console.log(`[Study] Could not delete queue timeout message: ${err.message}`);
          }), DELETE_DELAY_MS);
          await startGroupSession(interaction.guild, interaction.channel, client, duration);
        }
      } catch (error) {
        console.error(`[Study] ${duration}min queue timeout error:`, error);
        // Clear queue and timeout on error to prevent stuck state
        state.groupQueues[duration].clear();
        state.queueTimeouts[duration] = null;
        state.queueGuilds[duration] = null;
        state.queueChannels[duration] = null;
        sessionStateStore.saveState(state).catch(err =>
          console.error('[Study] Failed to save state after queue timeout error:', err)
        );
        // Notify users
        try {
          await interaction.channel.send({
            content: `❌ Failed to start ${duration}min group session. Please try joining the queue again.`
          });
        } catch {}
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
      const msg = await interaction.channel.send({
        content: announcement,
        allowedMentions: {
          roles: STUDY_ROLE_ID ? [STUDY_ROLE_ID] : [],
          users: [userId]
        }
      });

      // Auto-delete queue announcements after 1 minute
      setTimeout(() => msg.delete().catch(err => {
        console.log(`[Study] Could not delete queue announcement: ${err.message}`);
      }), DELETE_DELAY_MS);

    } catch (error) {
      // If role ping fails (missing permissions), send without role ping
      if (error.code === 50013) {
        console.warn('[Study] Missing permission to mention role, sending without role ping');
        const msg = await interaction.channel.send({
          content: `👥 <@${userId}> joined the ${duration}min study queue! **(${queueSize}/${GROUP_QUEUE_THRESHOLD})**\n\nJoin now to start a group session!`,
          allowedMentions: { users: [userId] }
        });
        setTimeout(() => msg.delete().catch(err => {
          console.log(`[Study] Could not delete queue announcement (fallback): ${err.message}`);
        }), DELETE_DELAY_MS);
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
    try {
      await startGroupSession(interaction.guild, interaction.channel, client, duration);
    } catch (error) {
      console.error(`[Study] Failed to start group session:`, error);
      // startGroupSession already clears the queue, so just notify users
      try {
        await interaction.channel.send({
          content: `❌ Failed to start ${duration}min group session. Please try joining the queue again.`
        });
      } catch {}
    }
  }
}

/**
 * Handle show stats button click
 */
export async function handleShowStats(interaction) {
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
 * Handle leaving the queue
 */
export async function handleQueueLeave(interaction) {
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
    const msg = await interaction.channel.send({
      content: `👋 <@${userId}> left the ${foundInQueue}min study queue (${queueSize}/${GROUP_QUEUE_THRESHOLD})`,
      allowedMentions: { users: [userId] }
    });
    // Auto-delete leave message after 1 minute
    setTimeout(() => msg.delete().catch(err => {
      console.log(`[Study] Could not delete leave message: ${err.message}`);
    }), DELETE_DELAY_MS);
  }
}

/**
 * Handle adding study role to user
 */
export async function handleRoleAdd(interaction) {
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
export async function handleRoleRemove(interaction) {
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
export async function handleStudyGroupJoin(interaction) {
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
