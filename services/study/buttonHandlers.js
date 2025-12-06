import Discord, {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from "discord.js";
import { studyStatsStore } from "../StudyStatsStore.js";
import { createSession, startPomodoroTimer, startSuggestiveTimer, findMatchingSession, getActiveSessions } from "./sessionManager.js";
import { logToChannel, autoAssignStudyRole, getMotivationalMessage } from "./utils.js";
import {
  VOICE_CATEGORY_ID,
  DELETE_DELAY_MS,
  STUDY_ROLE_ID,
  TAMOOH_ROLE_ID,
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
    } else if (mode === "openmic") {
      await startSuggestiveTimer(session, client);
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

  // Get all stats
  const stats = studyStatsStore.getUserStats(userId, guildId);
  const winStats = studyStatsStore.getUserWinStats(userId, guildId);
  const ranking = studyStatsStore.getUserRanking(userId, guildId);
  const guildStats = studyStatsStore.getGuildStats(guildId);
  const streak = studyStatsStore.getStudyStreak(userId, guildId);
  const tickets = studyStatsStore.calculateTickets(stats.lifetimeHours, stats.currentPeriodHours);

  // Calculate ACTUAL total tickets (matching giveaway logic)
  // This counts ALL eligible users with required roles, not just those with sessions
  await interaction.guild.members.fetch();
  const allMembers = interaction.guild.members.cache;
  let totalTickets = 0;

  for (const [memberId, member] of allMembers) {
    // Skip bots
    if (member.user.bot) continue;

    // Check if user has BOTH required roles (same as giveaway logic)
    const hasStudyRole = member.roles.cache.has(STUDY_ROLE_ID);
    const hasTamoohRole = member.roles.cache.has(TAMOOH_ROLE_ID);

    if (!hasStudyRole || !hasTamoohRole) continue;

    // Get user's session stats
    const memberStats = studyStatsStore.getUserStats(memberId, guildId);

    // Calculate tickets using formula (baseline 30 + bonuses)
    const memberTickets = studyStatsStore.calculateTickets(memberStats.lifetimeHours, memberStats.currentPeriodHours);

    totalTickets += memberTickets;
  }

  // Calculate accurate win chance
  const winChance = totalTickets > 0 ? (tickets / totalTickets) * 100 : 0;
  const winningChances = {
    userTickets: tickets,
    totalTickets: totalTickets,
    winChance: Math.round(winChance * 100) / 100 // Two decimal places
  };

  const allSessions = studyStatsStore.data.sessions.filter(
    (s) => s.userId === userId && s.guildId === guildId
  );
  const totalAttempts = allSessions.length;
  const invalidSessions = allSessions.filter((s) => !s.valid).length;
  const validationRate =
    totalAttempts > 0 ? ((stats.totalSessions / totalAttempts) * 100).toFixed(1) + "%" : "N/A";

  const avgSessionLength =
    stats.totalSessions > 0 ? (stats.lifetimeHours / stats.totalSessions).toFixed(1) : 0;

  // Create progress bar
  const createProgressBar = (current, max, length = 10) => {
    const filledLength = Math.min(Math.round((current / max) * length), length);
    const emptyLength = length - filledLength;
    return "█".repeat(filledLength) + "░".repeat(emptyLength);
  };

  // Determine rank emoji and color
  let rankEmoji = "📊";
  let embedColor = 0x5865F2;
  if (ranking.rank === 1) {
    rankEmoji = "👑";
    embedColor = 0xFFD700; // Gold
  } else if (ranking.rank === 2) {
    rankEmoji = "🥈";
    embedColor = 0xC0C0C0; // Silver
  } else if (ranking.rank === 3) {
    rankEmoji = "🥉";
    embedColor = 0xCD7F32; // Bronze
  } else if (ranking.percentile >= 90) {
    rankEmoji = "⭐";
    embedColor = 0x9B59B6; // Purple
  } else if (ranking.percentile >= 75) {
    rankEmoji = "🔥";
    embedColor = 0xE67E22; // Orange
  }

  // Calculate gap to leader
  const gapToLeader = guildStats.topHours - stats.lifetimeHours;
  const gapText = gapToLeader > 0
    ? `${gapToLeader.toFixed(1)}h behind #1`
    : "You're #1! 🎉";

  // Calculate comparison to average
  const vsAverage = stats.lifetimeHours - guildStats.averageHours;
  const vsAverageText = vsAverage >= 0
    ? `+${vsAverage.toFixed(1)}h above average`
    : `${Math.abs(vsAverage).toFixed(1)}h below average`;

  // Competitive description
  let description = `${rankEmoji} **Rank #${ranking.rank}** out of ${ranking.totalUsers} (Top ${ranking.percentile}%)\n`;
  if (ranking.rank === 1) {
    description += "🏆 **You're dominating the leaderboard!**";
  } else if (ranking.percentile >= 90) {
    description += "⚡ **You're in the elite top 10%!**";
  } else if (ranking.percentile >= 75) {
    description += "💪 **Strong performance! Keep climbing!**";
  } else if (ranking.percentile >= 50) {
    description += "📈 **You're above average! Push harder!**";
  } else {
    description += "🎯 **Time to grind and climb the ranks!**";
  }

  // Determine next milestone
  const hourMilestones = [3, 10, 24, 48, 72, 96, 120, 168, 240, 336, 500, 1000];
  const nextMilestone = hourMilestones.find(m => m > stats.lifetimeHours) || (Math.ceil(stats.lifetimeHours / 100) * 100 + 100);
  const hoursToNext = nextMilestone - stats.lifetimeHours;
  const milestoneProgress = stats.lifetimeHours / nextMilestone;
  const milestoneBar = createProgressBar(stats.lifetimeHours, nextMilestone, 12);

  // Build embed
  const embed = new EmbedBuilder()
    .setTitle("💎 Your Competitive Study Profile")
    .setColor(embedColor)
    .setDescription(description)
    .addFields(
      // Competitive Overview
      { name: "🏅 Server Standing", value: `Rank: **#${ranking.rank}** / ${ranking.totalUsers} (Top ${ranking.percentile}%)\n${gapText}`, inline: false },

      // Core Stats
      { name: "📚 Study Performance", value: `Lifetime: **${stats.lifetimeHours}h** (${vsAverageText})\nSessions: ${stats.totalSessions} | Avg: ${avgSessionLength}h`, inline: true },

      // Current Period (Competition)
      { name: "⚔️ Current Competition", value: `Period Hours: **${stats.currentPeriodHours}h**\nTickets: 🎫 **${tickets}** | Success: ${validationRate}`, inline: true },

      // Winning Chances
      { name: "🎰 Next Giveaway Odds", value: `Win Chance: **${winningChances.winChance}%**\nYour Share: ${tickets}/${winningChances.totalTickets} tickets`, inline: false },

      // Progress & Goals
      { name: "🎯 Next Milestone", value: `Goal: **${nextMilestone}h**\n${milestoneBar} ${hoursToNext.toFixed(1)}h to go!`, inline: false }
    );

  // Add streak section if user has any sessions
  if (stats.totalSessions > 0) {
    const streakEmoji = streak.currentStreak >= 7 ? "🔥" : streak.currentStreak >= 3 ? "⚡" : "📅";
    let streakText = `Current: **${streak.currentStreak} days** ${streakEmoji} | Best: **${streak.longestStreak} days**\n`;
    streakText += `Last Study: ${streak.lastStudyDate || "N/A"}`;
    if (streak.currentStreak === 0 && streak.longestStreak > 0) {
      streakText += "\n💔 Streak lost! Start a new one today!";
    }

    embed.addFields({
      name: "🔥 Study Streak",
      value: streakText,
      inline: false
    });
  }

  // Giveaway Stats (only if there have been giveaways)
  if (winStats.totalGiveaways > 0) {
    const winRateDisplay = winStats.winRate > 0 ? `${winStats.winRate}%` : "0%";
    const giveawayStatus = winStats.totalWins > 0
      ? "🌟 Winner!"
      : "🎯 Keep grinding for your first win!";

    let giveawayText = `Wins: **${winStats.totalWins}** | Win Rate: **${winRateDisplay}** | ${giveawayStatus}`;

    if (winStats.recentWins.length > 0) {
      const recentWinsList = winStats.recentWins
        .slice(0, 3)
        .map((w) => {
          const date = new Date(w.timestamp);
          return `• ${w.prizeName} (${date.toLocaleDateString()})`;
        })
        .join("\n");
      giveawayText += `\n\n**Recent Wins:**\n${recentWinsList}`;
    }

    embed.addFields({
      name: "🏆 Giveaway Performance",
      value: giveawayText,
      inline: false
    });
  }

  // Competitive footer message
  let footerText = "";
  if (ranking.rank === 1) {
    footerText = "👑 Defend your throne! Stay consistent!";
  } else if (winningChances.winChance >= 20) {
    footerText = `🎰 ${winningChances.winChance}% chance to win! You're in a great position!`;
  } else if (ranking.rank <= 3) {
    footerText = "🔥 So close to the top! Keep pushing!";
  } else if (ranking.percentile >= 75) {
    footerText = "⚡ You're in the top tier! Don't stop now!";
  } else if (winningChances.winChance < 5 && stats.currentPeriodHours < 10) {
    footerText = `📈 Study more to boost your ${winningChances.winChance}% odds!`;
  } else if (hoursToNext <= 5) {
    footerText = `🎯 Just ${hoursToNext.toFixed(1)}h until your next milestone!`;
  } else if (streak.currentStreak >= 3) {
    footerText = `🔥 ${streak.currentStreak}-day streak! Don't break it!`;
  } else {
    footerText = "💪 Every hour counts. Start studying now!";
  }

  embed.setFooter({ text: footerText }).setTimestamp();

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
