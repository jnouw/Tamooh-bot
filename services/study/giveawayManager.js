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

      // Get user's session stats (with lifetime and current period hours)
      const stats = studyStatsStore.getUserStats(userId, guildId);

      // Calculate tickets using new period-based formula
      // Formula: 10 + √lifetimeHours × 5 + currentPeriodHours × 2
      // This rewards recent study more while respecting lifetime effort
      const tickets = studyStatsStore.calculateTickets(stats.lifetimeHours, stats.currentPeriodHours);

      // Add to eligible users with their ticket count
      eligibleUsers.push({
        userId,
        username: member.user.username,
        displayName: member.displayName || member.user.username,
        sessions: stats.totalSessions,
        hours: stats.lifetimeHours,
        currentPeriodHours: stats.currentPeriodHours,
        tickets: tickets
      });
    }

    // Check if we have any eligible users
    if (eligibleUsers.length === 0) {
      return message.channel.send("❌ No eligible participants found!\n\nUsers must have both roles: <@&" + STUDY_ROLE_ID + "> and <@&" + TAMOOH_ROLE_ID + ">");
    }

    // Build weighted pool (8 base tickets + √hours scaling))
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

    // 🥁 DRAMATIC COUNTDOWN! 🥁
    const drumRollMsg = await message.channel.send("🥁 **Selecting the winner...**");

    await new Promise(resolve => setTimeout(resolve, 2000));
    await drumRollMsg.edit("🥁 **3...**");

    await new Promise(resolve => setTimeout(resolve, 1000));
    await drumRollMsg.edit("🥁 **2...**");

    await new Promise(resolve => setTimeout(resolve, 1000));
    await drumRollMsg.edit("🥁 **1...**");

    await new Promise(resolve => setTimeout(resolve, 1000));
    await drumRollMsg.delete().catch(() => {});

    // Calculate winner statistics
    const winPercentage = ((winner.tickets / totalTickets) * 100).toFixed(2);
    const avgSessionLength = winner.sessions > 0 ? (winner.hours / winner.sessions).toFixed(1) : 0;

    // Calculate percentile rank
    const usersWithFewerTickets = eligibleUsers.filter(u => u.tickets < winner.tickets).length;
    const percentileRank = Math.round(((eligibleUsers.length - usersWithFewerTickets) / eligibleUsers.length) * 100);

    // Create winner announcement embed
    const embed = new EmbedBuilder()
      .setTitle("🎉 Giveaway Winner!")
      .setColor(0xFFD700) // Gold color
      .setDescription(
        `**Prize:** ${prizeName}\n\n` +
        `**Winner:** <@${winner.userId}>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        (winner.hours > 0
          ? `**🏆 Winner's Study Journey:**\n` +
            `⏱️ Total Study Time: ${winner.hours} hours\n` +
            `📚 Study Sessions Completed: ${winner.sessions} sessions\n` +
            `📈 Average Session Length: ${avgSessionLength} hours\n` +
            `🎫 Tickets Earned: ${winner.tickets}\n` +
            `📊 Win Probability: ${winPercentage}%\n` +
            `🔥 Percentile Rank: Top ${percentileRank}% of all participants\n\n`
          : `**🏆 Winner's Stats:**\n` +
            `⏱️ Total Study Time: 0 hours\n` +
            `📚 Study Sessions Completed: 0 sessions\n` +
            `🎫 Tickets Earned: ${winner.tickets} (baseline entry)\n` +
            `📊 Win Probability: ${winPercentage}%\n` +
            `✨ Status: First win before first session!\n\n`
        ) +
        `**Giveaway Summary:**\n` +
        `👥 Total Participants: ${eligibleUsers.length}\n` +
        `🎫 Total Tickets in Pool: ${totalTickets}`
      )
      .setFooter({ text: "More study time = More chances to win!" })
      .setTimestamp();

    // Send announcement
    await message.channel.send({ embeds: [embed] });

    // Create eligible users list sorted by hours (descending), then by tickets
    const sortedUsers = [...eligibleUsers].sort((a, b) => {
      if (b.hours !== a.hours) return b.hours - a.hours;
      return b.tickets - a.tickets;
    });

    // Group users by hour tiers
    const groups = {
      "25plus": { title: "🏆 25+ Hours", users: [] },
      "10to25": { title: "⭐ 10-25 Hours", users: [] },
      "5to10": { title: "💪 5-10 Hours", users: [] },
      "under5": { title: "🌱 Under 5 Hours", users: [] },
      "zero": { title: "🆕 No Study Time Yet", users: [] }
    };

    // Categorize users into groups
    for (const user of sortedUsers) {
      if (user.hours === 0) {
        groups.zero.users.push(user);
      } else if (user.hours >= 25) {
        groups["25plus"].users.push(user);
      } else if (user.hours >= 10) {
        groups["10to25"].users.push(user);
      } else if (user.hours >= 5) {
        groups["5to10"].users.push(user);
      } else {
        groups.under5.users.push(user);
      }
    }

    // Build the eligible users list
    let userListText = "";
    let currentRank = 1;

    // Process each group
    for (const [key, group] of Object.entries(groups)) {
      if (group.users.length === 0) continue;

      // Handle zero-hour users specially (inline with pipe separators)
      if (key === "zero") {
        const zeroWinPercentage = ((8 / totalTickets) * 100).toFixed(2);
        userListText += `━━━ ${group.title} | 📊 ${zeroWinPercentage}% each ━━━\n`;

        // Group users in rows of 5
        for (let i = 0; i < group.users.length; i += 5) {
          const chunk = group.users.slice(i, i + 5);
          userListText += chunk.map(u => u.displayName).join(" | ") + "\n";
        }
        userListText += "\n";
      } else {
        // Regular groups with individual listings
        userListText += `━━━ ${group.title} ━━━\n`;
        for (const user of group.users) {
          const winPercentage = ((user.tickets / totalTickets) * 100).toFixed(2);
          userListText += `**${currentRank}.** ${user.displayName} — ⏱️ ${user.hours}h | 📊 ${winPercentage}%\n`;
          currentRank++;
        }
        userListText += "\n";
      }
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

    // Calculate total hours for footer
    const totalHours = Math.round(eligibleUsers.reduce((sum, user) => sum + user.hours, 0) * 100) / 100;
    const days = Math.floor(totalHours / 24);
    const remainingHours = Math.round((totalHours % 24) * 100) / 100;

    // Send eligible users list
    for (let i = 0; i < userListChunks.length; i++) {
      const listEmbed = new EmbedBuilder()
        .setTitle(i === 0 ? "📋 All Eligible Participants" : `📋 All Eligible Participants (continued ${i + 1})`)
        .setColor(0x5865F2)
        .setDescription(userListChunks[i])
        .setFooter({
          text: i === userListChunks.length - 1
            ? `Total: ${eligibleUsers.length} participants | ${totalHours} hours\nThat's ${days} days and ${remainingHours} hours of study time!`
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
