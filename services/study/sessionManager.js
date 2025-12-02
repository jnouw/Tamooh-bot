import Discord from "discord.js";
import { studyStatsStore } from "../StudyStatsStore.js";
import { sessionStateStore } from "../SessionStateStore.js";
import { logToChannel, announceMilestone } from "./utils.js";
import { DELETE_DELAY_MS } from "./config.js";
import { setVoiceChannelMute, updateVoiceChannelName } from "./voiceManager.js";
import { activityTracker } from "./activityTracker.js";
import { afkChecker } from "./afkChecker.js";

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
    activityCheckInterval: null, // Interval for checking user activities
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

  // Start activity tracking for this focus session
  try {
    const guild = client.guilds.cache.get(session.guildId);
    const vc = guild?.channels.cache.get(session.voiceChannelId);

    if (vc) {
      const participants = vc.members.filter(m => !m.user.bot);
      const userIds = Array.from(participants.keys());

      if (userIds.length > 0) {
        activityTracker.startTracking(session.voiceChannelId, userIds);

        // Do immediate check to catch anyone already gaming when session starts
        await activityTracker.checkAllUsers(client, session.voiceChannelId, session.guildId);

        // Check activities every 30 seconds
        session.activityCheckInterval = setInterval(() => {
          activityTracker.checkAllUsers(client, session.voiceChannelId, session.guildId);
        }, 30 * 1000);

        console.log(`[Study] Started activity tracking for session ${session.id}`);
      }
    }
  } catch (error) {
    console.error(`[Study] Failed to start activity tracking for session ${session.id}:`, error);
  }

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

      // Stop activity tracking and get gaming times
      if (session.activityCheckInterval) {
        clearInterval(session.activityCheckInterval);
        session.activityCheckInterval = null;
      }

      const gamingTimes = activityTracker.finalizeTracking(session.voiceChannelId);

      // Log completion for each participant and check for milestones
      for (const [userId, member] of participants) {
        const gamingMinutes = gamingTimes.get(userId) || 0;

        // Record session with gaming data (initially invalid, will be validated after AFK check)
        const { milestone, sessionId } = await studyStatsStore.recordSession(
          userId,
          session.guildId,
          session.duration,
          {
            valid: false, // Will be set to true only if AFK check passes AND no gaming
            gamingMinutes: gamingMinutes,
            afkCheckPassed: false
          }
        );

        // Send AFK check DM
        await afkChecker.sendAFKCheck(member.user, sessionId, session.guildId, session.duration);

        // Note: Milestones will only be announced after AFK check passes
        // So we don't announce them here anymore
      }

      console.log(`[Study] Focus session ${session.id} completed (Pomodoro #${session.pomodoroCount}) with ${participantCount} participants`);

      // Check for gaming violations
      const gamingViolations = [];
      for (const [userId] of participants) {
        const gamingMinutes = gamingTimes.get(userId) || 0;
        if (gamingMinutes > 0) {
          gamingViolations.push(`<@${userId}>: ${gamingMinutes} min`);
        }
      }

      // Log completion to admin log channel (keep for tracking)
      const mentions = Array.from(participants.keys()).map(id => `<@${id}>`).join(", ");
      const logEmbed = new EmbedBuilder()
        .setTitle("✅ Focus Session Completed")
        .setColor(gamingViolations.length > 0 ? 0xFFA500 : 0x57F287) // Orange if gaming detected
        .addFields(
          { name: "Session ID", value: `#${session.id}`, inline: true },
          { name: "Type", value: session.type === "solo" ? "Solo" : "Group", inline: true },
          { name: "Pomodoro", value: `#${session.pomodoroCount}`, inline: true },
          { name: "Participants", value: `${participantCount}`, inline: true },
          { name: "Duration", value: `${session.duration} minutes`, inline: true },
          { name: "Users", value: mentions, inline: false }
        )
        .setTimestamp();

      // Add gaming violations field if any detected
      if (gamingViolations.length > 0) {
        logEmbed.addFields({
          name: "🎮 Gaming Detected",
          value: gamingViolations.join("\n"),
          inline: false
        });
      }

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
    if (session.activityCheckInterval) clearInterval(session.activityCheckInterval);

    // Stop activity tracking
    activityTracker.stopTracking(session.voiceChannelId);

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
