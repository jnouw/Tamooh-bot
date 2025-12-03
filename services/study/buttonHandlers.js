import Discord, {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from "discord.js";
import { studyStatsStore } from "../StudyStatsStore.js";
import { createSession, startPomodoroTimer, findMatchingSession, getActiveSessions } from "./sessionManager.js";
import { logToChannel, autoAssignStudyRole, getMotivationalMessage } from "./utils.js";
import {
  VOICE_CATEGORY_ID,
  DELETE_DELAY_MS,
  STUDY_ROLE_ID,
  STUDY_CHANNEL_ID
} from "./config.js";

const { ChannelType, EmbedBuilder } = Discord;

/**
 * Handle "Start Studying" button click - opens topic modal
 */
export async function handleStudyStart(interaction, mode, duration) {
  const customId = `study_topic:${mode}:${duration || "null"}`;

  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle("What are you studying?");

  const topicInput = new TextInputBuilder()
    .setCustomId("topic")
    .setLabel("Topic (e.g. Math, CS101)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Enter your subject...")
    .setRequired(true)
    .setMaxLength(30);

  modal.addComponents(new ActionRowBuilder().addComponents(topicInput));
  await interaction.showModal(modal);
}

/**
 * Handle topic submission - join existing or create new session
 */
export async function handleTopicSubmit(interaction, client, mode, duration, topic) {
  await interaction.deferReply({ ephemeral: true });
  await autoAssignStudyRole(interaction.member);

  const guild = interaction.guild;
  const user = interaction.user;
  const username = interaction.member.displayName || user.username;

  try {
    // Join an existing matching session if present
    const existingSession = findMatchingSession(guild.id, topic, mode, duration);
    if (existingSession) {
      const vc = guild.channels.cache.get(existingSession.voiceChannelId);
      if (vc) {
        if (interaction.member.voice.channel) {
          try {
            await interaction.member.voice.setChannel(vc);
            await interaction.editReply({
              content: `✅ **Joined existing session!**\n\nTopic: **${topic}**\nMode: **${mode === "pomodoro" ? `${duration}m Pomodoro` : "Open Mic"}**\n\nMoved you to <#${vc.id}>`
            });
          } catch {
            await interaction.editReply({
              content: `✅ **Joined existing session!**\n\nTopic: **${topic}**\nMode: **${mode === "pomodoro" ? `${duration}m Pomodoro` : "Open Mic"}**\n\nClick to join: <#${vc.id}>`
            });
          }
        } else {
          await interaction.editReply({
            content: `✅ **Joined existing session!**\n\nTopic: **${topic}**\nMode: **${mode === "pomodoro" ? `${duration}m Pomodoro` : "Open Mic"}**\n\nClick to join: <#${vc.id}>`
          });
        }
        return;
      }
    }

    // Create a new session
    const emoji = mode === "pomodoro" ? "🍅" : "🎙️";
    const durationStr = mode === "pomodoro" ? `(${duration}m)` : "";
    const vcName = `${emoji} Study ${topic} ${durationStr}`.trim();

    const vcOptions = {
      name: vcName,
      type: ChannelType.GuildVoice
    };
    if (VOICE_CATEGORY_ID) vcOptions.parent = VOICE_CATEGORY_ID;

    const vc = await guild.channels.create(vcOptions);

    const session = createSession(
      mode,
      guild.id,
      vc.id,
      interaction.channel.id,
      user.id,
      duration,
      username,
      topic,
      mode
    );

    let movedUser = false;
    if (interaction.member.voice.channel) {
      try {
        await interaction.member.voice.setChannel(vc);
        movedUser = true;
      } catch (error) {
        console.error("[Study] Failed to move user to VC:", error.message);
      }
    }

    if (mode === "pomodoro") {
      await startPomodoroTimer(session, client);
    }

    const startEmbed = new EmbedBuilder()
      .setTitle(`${emoji} Study Session Started`)
      .setColor(0x5865F2)
      .addFields(
        { name: "Topic", value: topic, inline: true },
        { name: "Mode", value: mode === "pomodoro" ? `${duration}m Pomodoro` : "Open Mic", inline: true },
        { name: "Creator", value: `<@${user.id}>`, inline: true },
        { name: "Voice Channel", value: `<#${vc.id}>`, inline: false }
      )
      .setTimestamp();
    await logToChannel(client, guild.id, startEmbed);

    await interaction.editReply({
      content: movedUser
        ? `✅ **Session created!**\n\nTopic: **${topic}**\nMode: **${mode === "pomodoro" ? `${duration}m Pomodoro` : "Open Mic"}**\n\nGood luck!`
        : `✅ **Session created!**\n\nTopic: **${topic}**\nMode: **${mode === "pomodoro" ? `${duration}m Pomodoro` : "Open Mic"}**\n\nClick to join: <#${vc.id}>`
    });
  } catch (error) {
    console.error("[Study] Error creating session:", error);
    await interaction.editReply({
      content: "Failed to create study session. Please try again."
    });
  }
}

/**
 * Handle "Find Active Groups" button
 */
export async function handleFindGroups(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const sessions = getActiveSessions(interaction.guild.id);

  if (sessions.length === 0) {
    return interaction.editReply({
      content: "❌ No active study groups found. Start one yourself!"
    });
  }

  const embed = new EmbedBuilder()
    .setTitle("🔍 Active Study Groups")
    .setDescription("Click a button below to join a group:")
    .setColor(0x5865F2);

  const rows = [];
  let currentRow = new ActionRowBuilder();

  for (let i = 0; i < Math.min(sessions.length, 10); i++) {
    const s = sessions[i];
    const emoji = s.mode === "pomodoro" ? "🍅" : "🎙️";
    const label = `${s.topic} (${s.mode === "pomodoro" ? `${s.duration}m` : "Open"})`;
    const count = s.participants.size;
    const labelWithCount = `${label} - ${count}👤`;

    const btn = new ButtonBuilder()
      .setCustomId(`study_join_direct:${s.voiceChannelId}`)
      .setLabel(labelWithCount)
      .setEmoji(emoji)
      .setStyle(ButtonStyle.Secondary);

    currentRow.addComponents(btn);
    if (currentRow.components.length === 5) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
  }
  if (currentRow.components.length > 0) rows.push(currentRow);

  await interaction.editReply({
    embeds: [embed],
    components: rows
  });
}

/**
 * Handle direct join button click
 */
export async function handleJoinDirect(interaction, voiceChannelId) {
  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;
  const vc = guild.channels.cache.get(voiceChannelId);

  if (!vc) {
    return interaction.editReply({ content: "❌ This session has ended." });
  }

  if (interaction.member.voice.channel) {
    try {
      await interaction.member.voice.setChannel(vc);
      return interaction.editReply({ content: `✅ **Joined!**\n\nMoved you to <#${vc.id}>` });
    } catch {
      // fall through to link reply
    }
  }

  await interaction.editReply({
    content: `✅ **Joined!**\n\nClick to join: <#${vc.id}>`
  });
}

/**
 * Handle show stats button click
 */
export async function handleShowStats(interaction) {
  await interaction.deferReply({ ephemeral: true });
  await autoAssignStudyRole(interaction.member);

  const userId = interaction.user.id;
  const guildId = interaction.guild.id;

  const stats = studyStatsStore.getUserStats(userId, guildId);
  const winStats = studyStatsStore.getUserWinStats(userId, guildId);
  const tickets = studyStatsStore.calculateTickets(stats.lifetimeHours, stats.currentPeriodHours);

  const allSessions = studyStatsStore.data.sessions.filter(
    (s) => s.userId === userId && s.guildId === guildId
  );
  const totalAttempts = allSessions.length;
  const invalidSessions = allSessions.filter((s) => !s.valid).length;
  const validationRate =
    totalAttempts > 0 ? ((stats.totalSessions / totalAttempts) * 100).toFixed(1) + "%" : "N/A";

  const avgSessionLength =
    stats.totalSessions > 0 ? (stats.lifetimeHours / stats.totalSessions).toFixed(1) : 0;

  const embed = new EmbedBuilder()
    .setTitle("📊 Your Comprehensive Study Stats")
    .setColor(0x5865F2)
    .setDescription("Here's your complete study journey breakdown!")
    .addFields(
      { name: "📚 Study Summary", value: "━━━━━━━━━━━━━━━", inline: false },
      { name: "Valid Sessions", value: `${stats.totalSessions}`, inline: true },
      { name: "Lifetime Hours", value: `${stats.lifetimeHours}h`, inline: true },
      { name: "Avg Session", value: `${avgSessionLength}h`, inline: true },

      { name: "📅 Current Period", value: "━━━━━━━━━━━━━━━", inline: false },
      { name: "Period Hours", value: `${stats.currentPeriodHours}h`, inline: true },
      {
        name: "Period Sessions",
        value: `${allSessions.filter(
          (s) => s.valid && s.timestamp >= (studyStatsStore.data.giveawayPeriods[guildId] || 0)
        ).length}`,
        inline: true
      },
      { name: "Next Giveaway Tickets", value: `🎫 ${tickets}`, inline: true },

      { name: "✅ Session Quality", value: "━━━━━━━━━━━━━━━", inline: false },
      { name: "Total Attempts", value: `${totalAttempts}`, inline: true },
      { name: "Failed Sessions", value: `${invalidSessions}`, inline: true },
      { name: "Success Rate", value: `${validationRate}`, inline: true },

      { name: "🏆 Giveaway Stats", value: "━━━━━━━━━━━━━━━", inline: false },
      { name: "Total Wins", value: `${winStats.totalWins}`, inline: true },
      { name: "Win Rate", value: `${winStats.winRate}%`, inline: true },
      { name: "Status", value: winStats.totalWins > 0 ? "🌟 Winner!" : "🎯 Keep studying!", inline: true }
    )
    .setFooter({ text: getMotivationalMessage(stats.totalSessions) })
    .setTimestamp();

  if (winStats.recentWins.length > 0) {
    const recentWinsList = winStats.recentWins
      .slice(0, 3)
      .map((w) => {
        const date = new Date(w.timestamp);
        return `• ${w.prizeName} (${date.toLocaleDateString()})`;
      })
      .join("\n");

    embed.addFields({
      name: "🎁 Recent Wins",
      value: recentWinsList,
      inline: false
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

/**
 * Handle leaving the (removed) queue
 */
export async function handleQueueLeave(interaction) {
  await interaction.deferReply({ ephemeral: true });
  await interaction.editReply({
    content: "Queueing was removed; sessions start immediately now. There's no queue to leave."
  });
}

/**
 * Handle adding study role to user
 */
export async function handleRoleAdd(interaction) {
  await interaction.deferReply({ ephemeral: true });

  if (!STUDY_ROLE_ID) {
    return interaction.editReply({
      content: "❌ Study role not configured. Contact an admin."
    });
  }

  try {
    const member = interaction.member;
    const role = interaction.guild.roles.cache.get(STUDY_ROLE_ID);

    if (!role) {
      return interaction.editReply({
        content: "❌ Study role not found. Contact an admin."
      });
    }

    if (member.roles.cache.has(STUDY_ROLE_ID)) {
      return interaction.editReply({
        content: "✅ You already have study notifications enabled!"
      });
    }

    await member.roles.add(role);
    await interaction.editReply({
      content: `✅ You'll now be notified when study sessions start!\n\nRole: ${role}`
    });
  } catch (error) {
    console.error("[Study] Error adding role:", error);
    await interaction.editReply({
      content: "❌ Failed to add role. Make sure the bot has permission to manage roles."
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
      content: "❌ Study role not configured. Contact an admin."
    });
  }

  try {
    const member = interaction.member;
    const role = interaction.guild.roles.cache.get(STUDY_ROLE_ID);

    if (!role) {
      return interaction.editReply({
        content: "❌ Study role not found. Contact an admin."
      });
    }

    if (!member.roles.cache.has(STUDY_ROLE_ID)) {
      return interaction.editReply({
        content: "✅ You don't have study notifications enabled."
      });
    }

    await member.roles.remove(role);
    await interaction.editReply({
      content: "✅ Study notifications disabled. You can re-enable them anytime!"
    });
  } catch (error) {
    console.error("[Study] Error removing role:", error);
    await interaction.editReply({
      content: "❌ Failed to remove role. Make sure the bot has permission to manage roles."
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
      content: "❌ Study group not configured. Contact an admin."
    });
  }

  try {
    const member = interaction.member;
    const role = interaction.guild.roles.cache.get(STUDY_ROLE_ID);
    const channel = interaction.guild.channels.cache.get(STUDY_CHANNEL_ID);

    if (!role) {
      return interaction.editReply({
        content: "❌ Study role not found. Contact an admin."
      });
    }

    if (!channel) {
      return interaction.editReply({
        content: "❌ Study channel not found. Contact an admin."
      });
    }

    if (member.roles.cache.has(STUDY_ROLE_ID)) {
      return interaction.editReply({
        content: `✅ You're already a member of the study group!\n\nYou can access the channel here: ${channel}`
      });
    }

    await member.roles.add(role);
    await interaction.editReply({
      content: `✅ Welcome to the study group!\n\nYou now have access to ${channel}\n\nRole: ${role}`
    });
  } catch (error) {
    console.error("[Study] Error joining study group:", error);
    await interaction.editReply({
      content: "❌ Failed to join study group. Make sure the bot has permission to manage roles."
    });
  }
}
