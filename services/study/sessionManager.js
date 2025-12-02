import Discord from "discord.js";
import { studyStatsStore } from "../StudyStatsStore.js";
import { sessionStateStore } from "../SessionStateStore.js";
import { logToChannel, announceMilestone } from "./utils.js";
import { DELETE_DELAY_MS } from "./config.js";
import { setVoiceChannelMute, updateVoiceChannelName } from "./voiceManager.js";

const { EmbedBuilder } = Discord;

// Session state
export const state = {
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
 * Create a new study session
 */
export function createSession(type, guildId, vcId, textId, creatorId, duration, username = null) {
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
    phase: "focus", // "focus" or "break"
    pomodoroCount: 0, // Number of completed focus sessions
    username, // For solo sessions, store username for VC name updates
    mutedUsers: new Set(), // Track users who have been muted
  };

  state.activeSessions.set(vcId, session);

  // Persist state
  sessionStateStore.saveState(state).catch(err =>
    console.error('[Study] Failed to save state after creating session:', err)
  );

  return session;
}

/**
 * Start Pomodoro timer based on session duration
 */
export async function startPomodoroTimer(session, client) {
  // Set phase to focus
  session.phase = "focus";
  session.startedAt = Date.now();

  // Update VC name to show focus phase
  await updateVoiceChannelName(client, session);

  // Mute all members in the voice channel
  await setVoiceChannelMute(client, session, true);

  const focusMs = session.duration * 60 * 1000; // Convert minutes to milliseconds
  session.timer = setTimeout(async () => {
    if (session.completed) return; // Don't process if session was canceled
    await completeFocusSession(session, client);
  }, focusMs);
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

      // Log completion for each participant and check for milestones
      for (const [userId] of participants) {
        const { milestone } = await studyStatsStore.recordSession(userId, session.guildId, session.duration);

        // Announce milestone if reached
        if (milestone) {
          const userStats = studyStatsStore.getUserStats(userId, session.guildId);
          await announceMilestone(client, session.guildId, userId, milestone, userStats);
        }
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
              `**Session #${session.pomodoroCount}** completed!\n\n` +
              `☕ **Time for a ${breakMinutes}-minute break!**\n` +
              `Stretch, grab water, or rest your eyes.\n\n` +
              `The next focus session will start automatically. 💪`
            )
            .setTimestamp();

          await member.user.send({ embeds: [dmEmbed] });
          console.log(`[Study] Sent break DM to ${member.user.username}`);
        } catch (error) {
          console.log(`[Study] Could not send DM to ${member.user.username}: ${error.message}`);
        }
      }

      // Post summary
      const mentions = Array.from(participants.keys()).map(id => `<@${id}>`).join(", ");
      const embed = new EmbedBuilder()
        .setTitle("✅ Focus Session Completed")
        .setColor(0x57F287)
        .setDescription(
          `**Duration:** ${session.duration} minutes\n` +
          `**Session:** #${session.pomodoroCount}\n` +
          `**Participants:** ${participantCount}\n\n` +
          `${mentions}\n\n` +
          `☕ **${breakMinutes}-minute break starting now!**\n` +
          `Next focus session starts automatically.`
        )
        .setTimestamp();

      if (textChannel) {
        const msg = await textChannel.send({ embeds: [embed] });
        setTimeout(() => msg.delete().catch(() => {}), DELETE_DELAY_MS);
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
          { name: "Duration", value: `${session.duration} minutes`, inline: true },
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
 * Start break timer (duration is 1/5 of focus duration)
 */
async function startBreakTimer(session, client) {
  // Clear the focus timer
  if (session.timer) clearTimeout(session.timer);

  // Set phase to break
  session.phase = "break";
  session.startedAt = Date.now();

  // Update VC name to show break phase
  await updateVoiceChannelName(client, session);

  // Calculate break duration (1/5 of focus duration)
  const breakMs = Math.round((session.duration / 5) * 60 * 1000);
  console.log(`[Study] Starting ${Math.round(session.duration / 5)}-minute break for session ${session.id}`);

  session.timer = setTimeout(async () => {
    if (session.completed) return; // Don't process if session was canceled
    await completeBreakSession(session, client);
  }, breakMs);

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
        const msg = await textChannel.send({ embeds: [embed] });
        setTimeout(() => msg.delete().catch(() => {}), DELETE_DELAY_MS);
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
export async function cancelSession(session, client, reason) {
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

  } catch (error) {
    console.error("[Study] Error canceling session:", error);
  }
}
