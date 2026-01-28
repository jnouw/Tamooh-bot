import Discord from "discord.js";
import { sessionStateStore } from "../SessionStateStore.js";
import { logToChannel, announceMilestone } from "./utils.js";
import { DELETE_DELAY_MS } from "./config.js";
import { setVoiceChannelMute, updateVoiceChannelName, setVoiceChannelStatus } from "./voiceManager.js";
import { activityTracker } from "./activityTracker.js";

const { EmbedBuilder } = Discord;

// Module-level studyStatsStore reference (set via setStudyStatsStore)
let studyStatsStore = null;

/**
 * Set the studyStatsStore reference (called from study.js)
 */
export function setStudyStatsStore(store) {
  studyStatsStore = store;
}

// Session state
export const state = {
  sessionCounter: 0,
  activeSessions: new Map(), // voiceChannelId -> session
};

/**
 * Create a new study session
 */
export function createSession(type, guildId, vcId, textId, creatorId, duration, username = null, topic = null, mode = "pomodoro") {
  const id = ++state.sessionCounter;
  const session = {
    id,
    type, // "pomodoro" or "openmic" (formerly "solo"/"group")
    mode, // "pomodoro" or "openmic"
    topic,
    guildId,
    voiceChannelId: vcId,
    textChannelId: textId,
    creatorId, // Only for solo sessions (or if we track creator for groups)
    duration, // Duration in minutes (25 or 50) - null for openmic
    startedAt: Date.now(),
    timer: null,
    emptyTimeout: null,
    completed: false,
    phase: "focus", // "focus" or "break"
    pomodoroCount: 0, // Number of completed focus sessions
    username, // For solo sessions, store username for VC name updates
    mutedUsers: new Set(), // Track users who have been muted
    participants: new Map(), // userId -> { joinedAt: number }
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

  // Set channel status (solo or group based on participant count)
  try {
    const guild = client.guilds.cache.get(session.guildId);
    const vc = guild?.channels.cache.get(session.voiceChannelId);
    const participantCount = vc?.members.filter(m => !m.user.bot).size || 0;
    const isSolo = participantCount <= 1;
    await setVoiceChannelStatus(client, session, isSolo);
  } catch (error) {
    console.error(`[Study] Failed to set VC status:`, error);
  }

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
 * Start suggestive timer for open mic sessions (50+10, non-enforced)
 */
export async function startSuggestiveTimer(session, client) {
  session.phase = "focus";
  session.startedAt = Date.now();
  session.duration = 50; // Set duration for tracking purposes

  console.log(`[Study] Starting suggestive 50+10 timer for open mic session ${session.id}`);

  // Timer for 50-minute focus suggestion
  const focusMs = 50 * 60 * 1000;
  session.timer = setTimeout(async () => {
    if (session.completed) return;
    await completeSuggestiveFocus(session, client);
  }, focusMs);

  // Persist state
  sessionStateStore.saveState(state).catch(err =>
    console.error('[Study] Failed to save state after starting suggestive timer:', err)
  );
}

/**
 * Complete suggestive focus phase and suggest break
 */
async function completeSuggestiveFocus(session, client) {
  console.log(`[Study] Suggestive focus phase complete for open mic session ${session.id}`);

  try {
    // Start suggestive break timer
    session.phase = "break";
    session.startedAt = Date.now();

    const breakMs = 10 * 60 * 1000;
    session.timer = setTimeout(async () => {
      if (session.completed) return;
      await completeSuggestiveBreak(session, client);
    }, breakMs);

    // Persist state
    sessionStateStore.saveState(state).catch(err =>
      console.error('[Study] Failed to save state after suggestive focus:', err)
    );

  } catch (error) {
    console.error("[Study] Error completing suggestive focus:", error);
  }
}

/**
 * Complete suggestive break and suggest next focus
 */
async function completeSuggestiveBreak(session, client) {
  console.log(`[Study] Suggestive break complete for open mic session ${session.id}`);

  try {
    session.pomodoroCount++;

    // Start next suggestive focus cycle
    await startSuggestiveTimer(session, client);

  } catch (error) {
    console.error("[Study] Error completing suggestive break:", error);
  }
}

/**
 * Complete a focus session and start break
 */
export async function completeFocusSessionPublic(session, client) {
  return completeFocusSession(session, client);
}

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

        // Calculate credit based on when they joined
        const participantData = session.participants.get(userId);
        const joinedAt = participantData ? participantData.joinedAt : session.startedAt;
        const timeInSessionMs = Date.now() - joinedAt;

        // Credit is minimum of (session duration, time present)
        // Convert to minutes, round to 1 decimal
        const sessionDurationMs = session.duration * 60 * 1000;
        const creditMinutes = Math.min(session.duration, Math.round(timeInSessionMs / 60000 * 10) / 10);

        // Session is valid only if no gaming was detected
        const isValid = gamingMinutes === 0;

        // Record session (valid if no gaming detected)
        const { milestone, sessionId } = await studyStatsStore.recordSession(
          userId,
          session.guildId,
          creditMinutes, // Use calculated credit instead of full duration
          {
            valid: isValid, // Valid if no gaming detected
            gamingMinutes: gamingMinutes,
            afkCheckPassed: true // No longer using AFK check
          }
        );

        // Announce milestone if reached
        if (milestone && isValid) {
          await announceMilestone(client, member.user, session.guildId, milestone);
        }
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
          { name: "Mode", value: session.mode === "pomodoro" ? "Pomodoro" : "Open Mic", inline: true },
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
          { name: "Mode", value: session.mode === "pomodoro" ? "Pomodoro" : "Open Mic", inline: true },
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
export async function startBreakTimer(session, client) {
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
export async function completeBreakSessionPublic(session, client) {
  return completeBreakSession(session, client);
}

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
        { name: "Mode", value: session.mode === "pomodoro" ? "Pomodoro" : "Open Mic", inline: true },
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

/**
 * Get list of active sessions that are joinable
 */
export function getActiveSessions(guildId) {
  const sessions = [];
  for (const session of state.activeSessions.values()) {
    if (session.guildId === guildId && !session.completed) {
      sessions.push(session);
    }
  }
  return sessions;
}

/**
 * Find a matching session for the given topic and mode
 */
export function findMatchingSession(guildId, topic, mode, duration) {
  const normalizedTopic = topic.toLowerCase().trim();
  
  for (const session of state.activeSessions.values()) {
    if (session.guildId !== guildId || session.completed) continue;
    
    // Check mode match
    if (session.mode !== mode) continue;
    
    // Check duration match (only for pomodoro)
    if (mode === "pomodoro" && session.duration !== duration) continue;
    
    // Check topic match
    if (session.topic && session.topic.toLowerCase().trim() === normalizedTopic) {
      return session;
    }
  }
  
  return null;
}
