import Discord from "discord.js";
import { sessionStateStore } from "./SessionStateStore.js";
import { state, cancelSession } from "./study/sessionManager.js";
import { setVoiceChannelMute, updateVoiceChannelName } from "./study/voiceManager.js";
import { startPomodoroTimer } from "./study/sessionManager.js";
import { runGiveaway } from "./study/giveawayManager.js";
import { EMPTY_TIMEOUT_MS, OWNER_ID } from "./study/config.js";

const { Events, ButtonStyle, EmbedBuilder, ActionRowBuilder, ButtonBuilder } = Discord;

// Re-export button handlers for use in index.js
export {
  handleSoloPomodoro,
  handleGroupQueue,
  handleShowStats,
  handleQueueLeave,
  handleRoleAdd,
  handleRoleRemove,
  handleStudyGroupJoin
} from "./study/buttonHandlers.js";

// Re-export AFK checker handler
export { handleAFKCheck } from "./study/afkChecker.js";

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

      // Row 3 – Leave queue + View progress
      const row3 = new ActionRowBuilder().addComponents(
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

      await message.channel.send({
        embeds: [embed],
        components: [row1, row2, row3, row4],
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
      await runGiveaway(message, prizeName);
    } catch (error) {
      console.error("[Giveaway] Error running giveaway:", error);
      message.reply("❌ Error running giveaway. Check console for details.").catch(() => { });
    }
  });

  // Owner command to reset study stats/tickets
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (message.author.id !== OWNER_ID) return;
    if (!message.content.trim().startsWith("!resetstats")) return;

    try {
      const args = message.content.trim().split(/\s+/);
      const guildId = message.guild.id;

      // Parse command: !resetstats [@user] [hours]
      let targetUserId = null;
      let hours = 0;
      let resetAll = false;

      if (args.length === 1) {
        // !resetstats - reset all to 0
        resetAll = true;
      } else if (args[1] === "all") {
        // !resetstats all [hours]
        resetAll = true;
        hours = args[2] ? parseFloat(args[2]) : 0;
      } else if (args[1].startsWith("<@")) {
        // !resetstats @user [hours]
        targetUserId = args[1].replace(/[<@!>]/g, "");
        hours = args[2] ? parseFloat(args[2]) : 0;
      } else {
        return message.reply("❌ Usage:\n`!resetstats` - Reset all users to 0\n`!resetstats @user` - Reset user to 0\n`!resetstats @user 10` - Set user to 10 hours\n`!resetstats all 5` - Set all users to 5 hours");
      }

      if (isNaN(hours) || hours < 0) {
        return message.reply("❌ Hours must be a positive number");
      }

      const { studyStatsStore } = await import('./StudyStatsStore.js');

      if (resetAll) {
        // Reset all users
        const sessions = studyStatsStore.data.sessions.filter(s => s.guildId === guildId);
        const uniqueUsers = [...new Set(sessions.map(s => s.userId))];

        if (uniqueUsers.length === 0) {
          return message.reply("❌ No users found with study stats");
        }

        // Clear all sessions for this guild
        studyStatsStore.data.sessions = studyStatsStore.data.sessions.filter(s => s.guildId !== guildId);

        // If hours > 0, add new valid sessions
        if (hours > 0) {
          const minutes = Math.round(hours * 60);
          for (const userId of uniqueUsers) {
            studyStatsStore.data.sessions.push({
              userId,
              guildId,
              minutes,
              timestamp: Date.now(),
              valid: true,
              gamingMinutes: 0,
              afkCheckPassed: true
            });
          }
        }

        await studyStatsStore.save();

        const tickets = hours === 0 ? 8 : (8 + Math.round(Math.sqrt(hours) * 8));
        return message.reply(`✅ Reset stats for **${uniqueUsers.length}** users to **${hours}** hours (${tickets} tickets)`);

      } else if (targetUserId) {
        // Reset specific user
        const existingSessions = studyStatsStore.data.sessions.filter(
          s => s.guildId === guildId && s.userId === targetUserId
        );

        if (existingSessions.length === 0 && hours === 0) {
          return message.reply("❌ User has no study stats to reset");
        }

        // Remove user's sessions
        studyStatsStore.data.sessions = studyStatsStore.data.sessions.filter(
          s => !(s.guildId === guildId && s.userId === targetUserId)
        );

        // If hours > 0, add new valid session
        if (hours > 0) {
          const minutes = Math.round(hours * 60);
          studyStatsStore.data.sessions.push({
            userId: targetUserId,
            guildId,
            minutes,
            timestamp: Date.now(),
            valid: true,
            gamingMinutes: 0,
            afkCheckPassed: true
          });
        }

        await studyStatsStore.save();

        const tickets = hours === 0 ? 8 : (8 + Math.round(Math.sqrt(hours) * 8));
        return message.reply(`✅ Reset <@${targetUserId}>'s stats to **${hours}** hours (${tickets} tickets)`);
      }

    } catch (error) {
      console.error("[Study] Error resetting stats:", error);
      message.reply("❌ Error resetting stats. Check console for details.").catch(() => { });
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

        // If someone joined this channel, mute them if session is in FOCUS phase
        if (newState.channelId === channelId && oldState.channelId !== channelId) {
          // User joined this channel
          const member = newState.member;
          if (member && !member.user.bot && session.phase === "focus" && session.timer) {
            // Session is in focus phase, mute the new joiner
            try {
              await member.voice.setMute(true);
              session.mutedUsers.add(member.id);
              console.log(`[Study] Muted ${member.user.username} who joined active focus session ${session.id}`);
            } catch (error) {
              console.error(`[Study] Failed to mute new joiner ${member.id}:`, error.message);
            }

            // Add to activity tracking if session is being tracked
            const { activityTracker } = await import('./study/activityTracker.js');
            const sessionData = activityTracker.sessionActivities.get(channelId);
            if (sessionData && !sessionData.has(member.id)) {
              sessionData.set(member.id, {
                gamingStartTime: null,
                totalGamingMs: 0
              });
              console.log(`[Study] Added ${member.user.username} to activity tracking for session ${session.id}`);
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
              session.mutedUsers.delete(member.id);
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
            if (session.completed) return; // Don't process if session was already canceled
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

      // CRITICAL FIX: Unmute users who join non-study channels
      if (newState.channelId && newState.channelId !== oldState.channelId) {
        const member = newState.member;
        if (member && !member.user.bot && member.voice.serverMute) {
          // Check if the new channel is NOT a study session
          const isStudyChannel = state.activeSessions.has(newState.channelId);
          if (!isStudyChannel) {
            // User joined a non-study channel while server muted - unmute them
            try {
              await member.voice.setMute(false);
              console.log(`[Study] Unmuted ${member.user.username} who joined non-study channel ${newState.channelId}`);
            } catch (error) {
              console.error(`[Study] Failed to unmute user ${member.id} in non-study channel:`, error.message);
            }
          }
        }
      }
    } catch (error) {
      console.error("[Study] Voice state error:", error);
    }
  });
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

      // Use default duration and phase if not set (backward compatibility)
      const sessionDuration = session.duration || 25;
      const sessionPhase = session.phase || "focus";

      // Calculate phase duration
      const phaseMs = sessionPhase === "break"
        ? Math.round((sessionDuration / 5) * 60 * 1000)  // Break is 1/5 of focus
        : sessionDuration * 60 * 1000;                   // Focus duration

      // Check how much time has elapsed
      const elapsed = Date.now() - session.startedAt;
      const remaining = phaseMs - elapsed;

      // If session should have already completed
      if (remaining <= 0) {
        console.log(`[Study] Session ${session.id}: Timer already expired for ${sessionPhase} phase, completing now`);
        // For now, just start a new timer since we extracted the complete functions
        // This is a safe approach that ensures the session continues properly
        await startPomodoroTimer(session, client);
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
      console.log(`[Study] Session ${session.id}: Recovering ${sessionPhase} phase with ${Math.round(remaining / 1000)}s remaining`);
      await startPomodoroTimer(session, client);

      // Mute all members if in focus phase
      if (sessionPhase === "focus") {
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

  // Handle recovered queues - clear them since we can't reliably restart timeouts
  let clearedQueues = 0;
  for (const dur of [25, 50]) {
    if (state.groupQueues[dur]?.size > 0) {
      const queueSize = state.groupQueues[dur].size;
      console.log(`[Study] Clearing ${dur}min queue with ${queueSize} users (bot restarted - users need to rejoin)`);
      state.groupQueues[dur].clear();
      state.queueGuilds[dur] = null;
      state.queueChannels[dur] = null;
      clearedQueues++;
    }
  }

  if (clearedQueues > 0) {
    console.log(`[Study] Cleared ${clearedQueues} queue(s). Users will need to rejoin queues.`);
  }

  // Save the cleaned-up state
  await sessionStateStore.saveState(state);
}
