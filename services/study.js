import Discord from "discord.js";

const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ButtonStyle,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ChannelType
} = Discord;


import fs from "fs";

// ---- CONFIG ----
const STUDY_CHANNEL_ID = "1443362550447341609";
const LOG_CHANNEL_ID = "1443363449504530492";
const STUDY_ROLE_ID = "1443203557628186755";
const OWNER_ID = "274462470674972682";

const FOCUS_MS = 25 * 60 * 1000;
const BREAK_MS = 5 * 60 * 1000;
const EMPTY_TIMEOUT_MS = 3 * 60 * 1000;
const LOG_FILE_PATH = "./study_sessions.log";

// ---- STATE ----
const state = {
  sessionCounter: 0,
  activeSessions: new Map(),
  pomodoroQueue: {
    active: false,
    users: new Set(),
    textChannelId: null,
    startedByUserId: null,
  },
};

// Run on bot startup
export function setupStudySystem(client) {
  console.log("[Study] Loaded study system.");

  // Owner-only command to post the study panel
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    console.log("[Study] Saw message:", message.content, "from", message.author.id);

    if (message.author.id !== OWNER_ID) return;


    if (message.content.trim() === "!initstudy") {
      if (message.channel.id !== STUDY_CHANNEL_ID) {
        return message.reply("Use this in the study channel.");
      }

      const embed = new EmbedBuilder()
        .setTitle("📚 نذاكر سوا - Study With Me")
        .setColor(0x1e6649)
        .setDescription(
          [
            "1️⃣ **Start study now** — يفتح جلسة مذاكرة مباشرة.",
            "2️⃣ **Pomodoro Mode (Join Queue)** — يدخل الطابور. تبدأ الجلسة لما نكمل 3 أشخاص.",
            "3️⃣ **Join group** — تنضم لطابور موجود.",
            "",
            "الروم يحذف نفسه بعد 3 دقائق من يكون فاضي.",
          ].join("\n")
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("study_now")
          .setLabel("Start study now")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("pomodoro_queue")
          .setLabel("Pomodoro Mode (Join Queue)")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("pomodoro_join")
          .setLabel("Join group")
          .setStyle(ButtonStyle.Secondary)
      );

      await message.channel.send({
        embeds: [embed],
        components: [row],
      });

      await message.reply("Study panel posted. Pin it.");
    }
  });

  // ---- BUTTON HANDLERS ----
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;

    try {
      if (interaction.customId === "study_now")
        return handleStudyNow(interaction);

      if (interaction.customId === "pomodoro_queue")
        return handlePomodoroQueue(interaction);

      if (interaction.customId === "pomodoro_join")
        return handlePomodoroJoin(interaction);
    } catch (err) {
      console.error(err);
      if (!interaction.replied)
        interaction.reply({
          content: "Oops… خطأ بسيط، حاول مرة ثانية.",
          ephemeral: true,
        });
    }
  });

  // ---- VOICE UPDATE ----
  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    try {
      const joined = newState.channelId;
      const left = oldState.channelId;

      const checkSet = new Set();
      if (joined) checkSet.add(joined);
      if (left) checkSet.add(left);

      for (const chId of checkSet) {
        const session = state.activeSessions.get(chId);
        if (!session) continue;

        const guild = await client.guilds.fetch(session.guildId);
        const vc = guild.channels.cache.get(chId);

        const memberCount = vc?.members?.size || 0;

        if (memberCount === 0 && !session.emptyTimeout) {
          session.emptyTimeout = setTimeout(async () => {
            const refreshed = guild.channels.cache.get(chId);
            if (!refreshed || refreshed.members.size === 0) {
              endSession(session, client, "Empty room timeout");
            } else {
              session.emptyTimeout = null;
            }
          }, EMPTY_TIMEOUT_MS);
        }

        if (memberCount > 0 && session.emptyTimeout) {
          clearTimeout(session.emptyTimeout);
          session.emptyTimeout = null;
        }
      }
    } catch (err) {
      console.error("VoiceState error:", err);
    }
  });
}

// ---- HELPERS ----

async function handleStudyNow(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;
  const vc = await guild.channels.create({
    name: "Study Session",
    type: ChannelType.GuildVoice,
  });

  const session = createSession("normal", guild.id, vc.id, interaction.channel.id);

  const ping = STUDY_ROLE_ID ? `<@&${STUDY_ROLE_ID}>` : "اللي حاب يذاكر";
  await interaction.channel.send(`${ping}\nجلسة مذاكرة بدأت: <#${vc.id}>`);

  // Move user if in VC
  const member = await guild.members.fetch(interaction.user.id);
  if (member.voice?.channel) {
    await member.voice.setChannel(vc).catch(() => {});
  }

  interaction.editReply(`تم فتح روم: <#${vc.id}>`);
}

async function handlePomodoroQueue(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const queue = state.pomodoroQueue;
  const userId = interaction.user.id;

  // If no queue exists, create one
  if (!queue.active) {
    queue.active = true;
    queue.users = new Set([userId]);
    queue.textChannelId = interaction.channel.id;
    queue.startedByUserId = userId;

    const ping = STUDY_ROLE_ID ? `<@&${STUDY_ROLE_ID}>` : "اللي حاب يذاكر";
    await interaction.channel.send(
      `${ping}\nبدينا طابور بومودورو 25+5.\nنحتاج **3 أشخاص**.\nالحالي: <@${userId}>`
    );

    return interaction.editReply("دخلناك الطابور.");
  }

  // Queue exists: join it
  if (queue.users.has(userId)) {
    return interaction.editReply("انت موجود في الطابور.");
  }

  queue.users.add(userId);

  const names = [...queue.users].map((id) => `<@${id}>`).join(", ");
  await interaction.channel.send(`انضم شخص جديد.\nالآن في الطابور: ${names}`);

  interaction.editReply("انضمّيت.");

  maybeStartPomodoroSession(interaction.guild);
}

async function handlePomodoroJoin(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const queue = state.pomodoroQueue;
  const userId = interaction.user.id;

  if (!queue.active)
    return interaction.editReply("لا يوجد طابور. استخدم Pomodoro Mode لتبدأ.");

  if (queue.users.has(userId))
    return interaction.editReply("انت موجود في الطابور.");

  queue.users.add(userId);
  const names = [...queue.users].map((id) => `<@${id}>`).join(", ");

  await interaction.channel.send(`انضم شخص جديد.\nالآن: ${names}`);
  interaction.editReply("انضمّيت.");

  maybeStartPomodoroSession(interaction.guild);
}

async function maybeStartPomodoroSession(guild) {
  const queue = state.pomodoroQueue;
  if (!queue.active) return;
  if (queue.users.size < 3) return;

  // Start session
  queue.active = false;

  const textChannel = await guild.channels.fetch(queue.textChannelId);
  const vc = await guild.channels.create({
    name: "Study - Pomodoro",
    type: ChannelType.GuildVoice,
  });

  const session = createSession("pomodoro", guild.id, vc.id, textChannel.id);
  for (const uid of queue.users) session.participants.add(uid);

  const ping = STUDY_ROLE_ID ? `<@&${STUDY_ROLE_ID}>` : "اللي حاب يذاكر";

  await textChannel.send(
    `${ping}\nبدأت جلسة بومودورو في <#${vc.id}>.\n**${FOCUS_MS/60000} دقيقة تركيز + ${
      BREAK_MS / 60000
    } دقيقة راحة**`
  );

  // Move all queued users
  for (const uid of queue.users) {
    try {
      const m = await guild.members.fetch(uid);
      if (m.voice?.channel) await m.voice.setChannel(vc);
    } catch {}
  }

  // Clear queue
  queue.users.clear();
  queue.textChannelId = null;
  queue.startedByUserId = null;

  startPomodoroCycles(session, guild);
}

function createSession(type, guildId, vcId, textId) {
  const id = ++state.sessionCounter;
  const session = {
    id,
    type,
    guildId,
    voiceChannelId: vcId,
    textChannelId: textId,
    startedAt: new Date(),
    endedAt: null,
    participants: new Set(),
    emptyTimeout: null,
    pomodoro: type === "pomodoro" ? { cycle: 1, timer: null } : null,
  };

  state.activeSessions.set(vcId, session);
  return session;
}

async function startPomodoroCycles(session, guild) {
  const textChannel = await guild.channels.fetch(session.textChannelId);

  async function runCycle() {
    if (!state.activeSessions.has(session.voiceChannelId)) return;

    await textChannel.send(`⏱️ دورة ${session.pomodoro.cycle}: تركيز ${FOCUS_MS/60000} دقيقة.`);

    await delay(FOCUS_MS);
    if (!state.activeSessions.has(session.voiceChannelId)) return;

    await textChannel.send(`☕ استراحة ${BREAK_MS/60000} دقائق.`);
    await delay(BREAK_MS);
    if (!state.activeSessions.has(session.voiceChannelId)) return;

    session.pomodoro.cycle++;
    runCycle();
  }

  runCycle();
}

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function endSession(session, client, reason) {
  if (session.emptyTimeout) {
    clearTimeout(session.emptyTimeout);
    session.emptyTimeout = null;
  }

  state.activeSessions.delete(session.voiceChannelId);
  session.endedAt = new Date();

  try {
    const guild = await client.guilds.fetch(session.guildId);
    const vc = guild.channels.cache.get(session.voiceChannelId);
    if (vc) await vc.delete(reason || "Session end");
  } catch {}

  logSession(session, client);
}

function logSession(session, client) {
  // Write to file
  const data = {
    id: session.id,
    type: session.type,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    duration:
      (session.endedAt - session.startedAt) / 60000,
    participants: [...session.participants],
  };
  fs.appendFileSync(LOG_FILE_PATH, JSON.stringify(data) + "\n");

  // Log channel
  if (!LOG_CHANNEL_ID) return;
  client.channels.fetch(LOG_CHANNEL_ID).then((ch) => {
    ch?.send(
      `📝 **Session #${session.id}** ended.\nDuration: ${
        data.duration
      } min\nParticipants: ${data.participants
        .map((id) => `<@${id}>`)
        .join(", ")}`
    );
  });
}
