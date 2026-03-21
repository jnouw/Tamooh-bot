import "dotenv/config";
import fs from "fs";
import cron from "node-cron";
import Discord from "discord.js";

const { Client, GatewayIntentBits, EmbedBuilder } = Discord;

/* =========================
   CONFIG
========================= */
const TOKEN = process.env.TOKEN;
const CHANNEL_ID = process.env.LEADERBOARD_CHANNEL_ID;
const TIMEZONE = process.env.TIMEZONE || "Asia/Riyadh";

/* =========================
   SIMPLE DATA STORE
========================= */
class StudyStatsStore {
  constructor(file = "data.json") {
    this.file = file;
    this.data = {};

    if (fs.existsSync(file)) {
      this.data = JSON.parse(fs.readFileSync(file));
    }
  }

  save() {
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  getGuild(guildId) {
    if (!this.data[guildId]) {
      this.data[guildId] = {
        users: {},
        periodStart: Date.now(),
      };
    }
    return this.data[guildId];
  }

  addStudyTime(guildId, userId, hours) {
    const guild = this.getGuild(guildId);

    if (!guild.users[userId]) {
      guild.users[userId] = {
        lifetimeHours: 0,
        currentPeriodHours: 0,
      };
    }

    guild.users[userId].lifetimeHours += hours;
    guild.users[userId].currentPeriodHours += hours;

    this.save();
  }

  getLeaderboard(guildId, limit = 10) {
    const guild = this.getGuild(guildId);

    return Object.entries(guild.users)
      .map(([userId, data]) => ({
        userId,
        ...data,
      }))
      .sort((a, b) => b.currentPeriodHours - a.currentPeriodHours)
      .slice(0, limit);
  }

  calculateTickets(lifetime, current) {
    return Math.floor(30 + Math.sqrt(lifetime) * 5 + current * 3);
  }

  resetPeriod(guildId) {
    const guild = this.getGuild(guildId);

    for (const userId of Object.keys(guild.users)) {
      guild.users[userId].currentPeriodHours = 0;
    }

    guild.periodStart = Date.now();

    this.save();
  }
}

/* =========================
   BOT SETUP
========================= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const store = new StudyStatsStore();

/* =========================
   WEEKLY RESET (CRON)
========================= */
function startWeeklyReset() {
  cron.schedule(
    "0 0 * * 6",
    async () => {
      console.log("⏰ Weekly reset running...");

      for (const [guildId, guild] of client.guilds.cache) {
        try {
          const leaderboard = store.getLeaderboard(guildId, 10);

          if (!leaderboard.length) continue;

          const sorted = leaderboard
            .map((u) => ({
              ...u,
              tickets: store.calculateTickets(
                u.lifetimeHours,
                u.currentPeriodHours
              ),
            }))
            .sort((a, b) => b.tickets - a.tickets);

          const lines = sorted.map((u, i) => {
            const medal =
              i === 0
                ? "🥇"
                : i === 1
                ? "🥈"
                : i === 2
                ? "🥉"
                : `**${i + 1}.**`;

            return `${medal} <@${u.userId}> — 🎫 ${u.tickets} | 🔥 ${u.currentPeriodHours}h`;
          });

          const embed = new EmbedBuilder()
            .setTitle("🏆 Weekly Leaderboard (Final Results)")
            .setDescription(lines.join("\n"))
            .setColor(0xFEE75C)
            .setTimestamp()
            .setFooter({ text: "New week started automatically 🔥" });

          let channel = null;

          if (CHANNEL_ID) {
            channel = await guild.channels.fetch(CHANNEL_ID).catch(() => null);
          }

          if (!channel) channel = guild.systemChannel;

          if (channel) {
            await channel.send({ embeds: [embed] });
          } else {
            console.warn(`No channel found for guild ${guildId}`);
          }

          // RESET WEEK
          store.resetPeriod(guildId);

          console.log(`✅ Reset done for ${guild.name}`);
        } catch (err) {
          console.error(err);
        }
      }
    },
    { timezone: TIMEZONE }
  );
}

/* =========================
   COMMANDS (TEST)
========================= */
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "addhours") {
    const hours = interaction.options.getNumber("hours");

    store.addStudyTime(interaction.guildId, interaction.user.id, hours);

    await interaction.reply(`✅ Added ${hours} hours`);
  }

  if (interaction.commandName === "leaderboard") {
    const data = store.getLeaderboard(interaction.guildId, 10);

    if (!data.length) {
      return interaction.reply("No data yet.");
    }

    const lines = data.map(
      (u, i) =>
        `**${i + 1}.** <@${u.userId}> — 🔥 ${u.currentPeriodHours}h`
    );

    await interaction.reply(lines.join("\n"));
  }
});

/* =========================
   START BOT
========================= */
client.once("ready", () => {
  console.log(`🚀 Logged in as ${client.user.tag}`);

  startWeeklyReset();
});

client.login(TOKEN);
    embed.setFooter({ text: "Study consistently and good luck! 💚 | TamoohBot v2.0" });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
