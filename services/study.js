import Discord from "discord.js";
import { sessionStateStore } from "./SessionStateStore.js";
import { state, cancelSession } from "./study/sessionManager.js";
import { studyStatsStore } from "./StudyStatsStore.js";
import { runGiveaway } from "./study/giveawayManager.js";
import { EMPTY_TIMEOUT_MS, OWNER_ID } from "./study/config.js";

const { Events, ButtonStyle, EmbedBuilder, ActionRowBuilder, ButtonBuilder } = Discord;

// Re-export study handlers for use in index.js
export {
  handleStudyStart,
  handleTopicSubmit,
  handleFindGroups,
  handleJoinDirect,
  handleShowStats,
  handleRoleAdd,
  handleRoleRemove,
  handleStudyGroupJoin
} from "./study/buttonHandlers.js";

// Re-export AFK checker handler
export { handleAFKCheck } from "./study/afkChecker.js";

/**
 * Setup the study system
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
          "**Welcome to the Study Dashboard!**\n\n" +
          "Choose your preferred study mode below:\n\n" +
          "🍅 **Pomodoro Sessions**\n" +
          "Structured 25/50 min focus sessions with auto-mute.\n" +
          "• **Start 25m**: 25 min focus + 5 min break\n" +
          "• **Start 50m**: 50 min focus + 10 min break\n\n" +
          "🎙️ **Open Mic Sessions**\n" +
          "Flexible study rooms with voice allowed. No timer.\n\n" +
          "🔍 **Find Active Groups**\n" +
          "See a list of active study rooms you can join instantly."
        );

      const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("study_start_pomodoro_25")
          .setLabel("Start 25m")
          .setEmoji("🍅")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("study_start_pomodoro_50")
          .setLabel("Start 50m")
          .setEmoji("🍅")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("study_start_openmic")
          .setLabel("Start Open Mic")
          .setEmoji("🎙️")
          .setStyle(ButtonStyle.Primary)
      );

      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("study_find_groups")
          .setLabel("Find Active Groups")
          .setEmoji("🔍")
          .setStyle(ButtonStyle.Secondary)
      );

      const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("study_stats")
          .setLabel("My Stats")
          .setEmoji("📊")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("study_role_add")
          .setLabel("Notifications On")
          .setEmoji("🔔")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("study_role_remove")
          .setLabel("Notifications Off")
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
        .setTitle("📣 Join the Study Group")
        .setColor(0x5865F2)
        .setDescription(
          "Get notified about new study sessions and access the study channel.\n\n" +
          "Click the button below to join the study group and receive notifications."
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("study_group_join")
          .setLabel("Join the Study Group")
          .setEmoji("✅")
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

        // If someone joined this channel
        if (newState.channelId === channelId && oldState.channelId !== channelId) {
          const member = newState.member;
          if (member && !member.user.bot) {
            session.participants.set(member.id, { joinedAt: Date.now() });
            console.log(`[Study] User ${member.user.username} joined session ${session.id} at ${new Date().toISOString()}`);

            if (session.mode === "pomodoro" && session.phase === "focus" && session.timer) {
              try {
                await member.voice.setMute(true);
                session.mutedUsers.add(member.id);
                console.log(`[Study] Muted ${member.user.username} who joined active focus session ${session.id}`);
              } catch (error) {
                console.error(`[Study] Failed to mute new joiner ${member.id}:`, error.message);
              }

              const { activityTracker } = await import("./study/activityTracker.js");
              const sessionData = activityTracker.sessionActivities.get(channelId);
              if (sessionData && !sessionData.has(member.id)) {
                sessionData.set(member.id, {
                  gamingStartTime: null,
                  totalGamingMs: 0
                });
                console.log(`[Study] Added ${member.user.username} to activity tracking for session ${session.id}`);
              }
            } else if (session.mode === "openmic") {
              if (member.voice.serverMute) {
                try {
                  await member.voice.setMute(false);
                } catch {}
              }
            }
          }
        }

        // If someone left this channel
        if (oldState.channelId === channelId && newState.channelId !== channelId) {
          const member = oldState.member;
          if (member && !member.user.bot) {
            if (session.mode === "openmic") {
              const participantData = session.participants.get(member.id);
              if (participantData) {
                const timeInSessionMs = Date.now() - participantData.joinedAt;
                const creditMinutes = Math.round(timeInSessionMs / 60000 * 10) / 10;

                if (creditMinutes >= 1) {
                  await studyStatsStore.recordSession(
                    member.id,
                    session.guildId,
                    creditMinutes,
                    { valid: true, gamingMinutes: 0, afkCheckPassed: true }
                  );
                  console.log(`[Study] Recorded ${creditMinutes}m for ${member.user.username} in Open Mic session ${session.id}`);
                }
                session.participants.delete(member.id);
              }
            }

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

        if (memberCount === 0 && !session.emptyTimeout) {
          session.emptyTimeout = setTimeout(async () => {
            if (session.completed) return;
            const currentVc = guild.channels.cache.get(channelId);
            const currentCount = currentVc?.members.filter(m => !m.user.bot).size || 0;

            if (currentCount === 0) {
              console.log(`[Study] Canceling session ${session.id} - empty room`);
              await cancelSession(session, client, "Empty room timeout");
            }
          }, EMPTY_TIMEOUT_MS);
        }

        if (memberCount > 0 && session.emptyTimeout) {
          clearTimeout(session.emptyTimeout);
          session.emptyTimeout = null;
        }
      }

      // Unmute users who join non-study channels
      if (newState.channelId && newState.channelId !== oldState.channelId) {
        const member = newState.member;
        if (member && !member.user.bot && member.voice.serverMute) {
          const isStudyChannel = state.activeSessions.has(newState.channelId);
          if (!isStudyChannel) {
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
 */
export async function recoverSessions(client) {
  console.log("[Study] Attempting to recover sessions from persistent storage...");

  const restored = sessionStateStore.restoreState(state);

  if (!restored) {
    console.log("[Study] No sessions to recover");
    return;
  }

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
        cleanedCount++;
        continue;
      }

      const sessionDuration = session.duration || 25;
      const sessionPhase = session.phase || "focus";

      const phaseMs = sessionPhase === "break"
        ? Math.round((sessionDuration / 5) * 60 * 1000)
        : sessionDuration * 60 * 1000;

      const elapsed = Date.now() - session.startedAt;
      const remaining = phaseMs - elapsed;

      const memberCount = vc.members.filter(m => !m.user.bot).size;

      if (memberCount === 0) {
        console.log(`[Study] Session ${session.id}: Voice channel empty, canceling`);
        await cancelSession(session, client, "Empty room after restart");
        cleanedCount++;
        continue;
      }

      if (remaining <= 0) {
        console.log(`[Study] Session ${session.id}: Timer already expired for ${sessionPhase} phase, completing now`);

        const sessionManager = await import("./study/sessionManager.js");

        if (sessionPhase === "focus") {
          await sessionManager.completeFocusSessionPublic(session, client);
        } else {
          await sessionManager.completeBreakSessionPublic(session, client);
        }

        recoveredCount++;
        continue;
      }

      console.log(`[Study] Session ${session.id}: Recovering ${sessionPhase} phase with ${Math.round(remaining / 1000)}s remaining`);

      const sessionManager = await import("./study/sessionManager.js");
      if (sessionPhase === "focus") {
        await sessionManager.startPomodoroTimer(session, client);
      } else {
        await sessionManager.startBreakTimer(session, client);
      }

      recoveredCount++;
    } catch (error) {
      console.error(`[Study] Failed to recover session ${session.id}:`, error.message);
      state.activeSessions.delete(session.voiceChannelId);
      cleanedCount++;
    }
  }

  console.log(`[Study] Recovery complete: ${recoveredCount} sessions recovered, ${cleanedCount} cleaned up`);

  await sessionStateStore.saveState(state);
}
