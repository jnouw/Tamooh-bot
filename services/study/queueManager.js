import Discord from "discord.js";
import { sessionStateStore } from "../SessionStateStore.js";
import { createSession, startPomodoroTimer, state } from "./sessionManager.js";
import { logToChannel } from "./utils.js";
import {
  VOICE_CATEGORY_ID,
  DELETE_DELAY_MS,
  GROUP_QUEUE_THRESHOLD,
  QUEUE_TIMEOUT_MS
} from "./config.js";

const { ChannelType, EmbedBuilder } = Discord;

/**
 * Start a group session when queue threshold is reached
 */
export async function startGroupSession(guild, textChannel, client, duration) {
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

    const msg = await textChannel.send({
      content: announceContent,
      allowedMentions: { users: queuedUsers }
    });

    // Auto-delete start message after 1 minute
    setTimeout(() => msg.delete().catch(() => {}), DELETE_DELAY_MS);

    // Start timer
    await startPomodoroTimer(session, client);

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
