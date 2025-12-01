import Discord from "discord.js";
import { studyStatsStore } from "../StudyStatsStore.js";
import { logToChannel } from "./utils.js";
import { STUDY_ROLE_ID, TAMOOH_ROLE_ID } from "./config.js";

const { EmbedBuilder } = Discord;

/**
 * Run a giveaway based on study session participation
 */
export async function runGiveaway(message, prizeName) {
  const guildId = message.guild.id;

  try {
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
        tickets: 1 + Math.round(stats.totalHours * 10)
      });
    }

    // Check if we have any eligible users
    if (eligibleUsers.length === 0) {
      return message.channel.send("❌ No eligible participants found!\n\nUsers must have both roles: <@&" + STUDY_ROLE_ID + "> and <@&" + TAMOOH_ROLE_ID + ">");
    }

    // Build weighted pool (1 base ticket for roles + tickets based on hours)
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

    await logToChannel(message.client, guildId, logEmbed);

    console.log(`[Giveaway] Winner: ${winner.username} (${winner.tickets} tickets out of ${totalTickets})`);

  } catch (error) {
    console.error("[Giveaway] Error running giveaway:", error);
    throw error;
  }
}
