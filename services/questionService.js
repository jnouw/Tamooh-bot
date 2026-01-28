import Discord from "discord.js";
import { CONFIG } from "../config.js";
import { codeWithLineNumbers, letter } from "../utils/helpers.js";

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = Discord;

/**
 * Send a question to the channel
 */
export async function sendQuestion(channel, session, sessionManager, advance) {
  const idx = session.index;
  const total = session.items.length;
  const footer = `Question ${idx + 1}/${total}`;

  switch (session.mode) {
    case "mcq":
      await sendMCQQuestion(channel, session, footer, sessionManager, advance);
      break;
    case "finderror":
      await sendFinderrorQuestion(channel, session, footer, sessionManager, advance);
      break;
    case "output":
      await sendOutputQuestion(channel, session, footer, sessionManager, advance);
      break;
    case "code":
      await sendCodeQuestion(channel, session, footer, sessionManager, advance);
      break;
  }
}

/**
 * Get timer seconds, using override if set (for resumed sessions)
 */
function getTimerSecs(session, defaultSecs) {
  if (session.timerOverrideSecs) {
    const override = session.timerOverrideSecs;
    delete session.timerOverrideSecs; // Clear after use
    return Math.max(CONFIG.MIN_TIME_SECONDS, override);
  }
  return defaultSecs;
}

/**
 * Send MCQ question
 */
async function sendMCQQuestion(channel, session, footer, sessionManager, advance) {
  const idx = session.index;
  const q = session.items[idx];
  const baseSecs = Math.max(
    CONFIG.MIN_TIME_SECONDS,
    q.timeSec ?? CONFIG.TIMERS.MCQ
  );
  const secs = getTimerSecs(session, baseSecs);

  const embed = new EmbedBuilder()
    .setTitle(q.prompt)
    .setColor("#5865F2")
    .setFooter({ text: `${footer} • ${secs}s` });

  if (q.image) embed.setImage(q.image);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`mcq:${session.sid}:${idx}:0`)
      .setLabel(`A) ${q.choices[0]}`)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`mcq:${session.sid}:${idx}:1`)
      .setLabel(`B) ${q.choices[1]}`)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`mcq:${session.sid}:${idx}:2`)
      .setLabel(`C) ${q.choices[2]}`)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`mcq:${session.sid}:${idx}:3`)
      .setLabel(`D) ${q.choices[3]}`)
      .setStyle(ButtonStyle.Secondary)
  );

  const msg = await channel.send({
    content: `<@${session.userId}>`,
    embeds: [embed],
    components: [row],
  });

  sessionManager.startTimer(session.sid, idx, secs, async () => {
    session.answers[idx] = {
      kind: "mcq",
      chosen: null,
      correct: false,
      timeout: true,
    };
    try {
      await msg.edit({ components: [] });
    } catch {}
    await channel.send(
      `⏰ Time's up! Correct answer: **${letter(q.answerIndex)}**`
    );
    await advance(channel, session);
  });
}

/**
 * Send finderror question
 */
async function sendFinderrorQuestion(channel, session, footer, sessionManager, advance) {
  const idx = session.index;
  const q = session.items[idx];
  const baseSecs = Math.max(
    CONFIG.MIN_TIME_SECONDS,
    q.timeSec ?? CONFIG.TIMERS.FINDERROR
  );
  const secs = getTimerSecs(session, baseSecs);

  const embed = new EmbedBuilder()
    .setTitle(q.title || "Find the Error")
    .setDescription(codeWithLineNumbers(q.code))
    .setColor("#FEE75C")
    .setFooter({ text: `${footer} • ${secs}s` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`openline:${session.sid}:${idx}`)
      .setLabel("Submit line number")
      .setStyle(ButtonStyle.Primary)
  );

  const msg = await channel.send({
    content: `<@${session.userId}>`,
    embeds: [embed],
    components: [row],
  });

  sessionManager.startTimer(session.sid, idx, secs, async () => {
    session.answers[idx] = {
      kind: "finderror",
      step: "line",
      chosen: null,
      correct: false,
      timeout: true,
    };
    try {
      await msg.edit({ components: [] });
    } catch {}
    await channel.send(
      `⏰ Time's up! The error was on line **${q.correctLine}**`
    );
    await advance(channel, session);
  });
}

/**
 * Send output question
 */
async function sendOutputQuestion(channel, session, footer, sessionManager, advance) {
  const idx = session.index;
  const q = session.items[idx];
  const baseSecs = Math.max(
    CONFIG.MIN_TIME_SECONDS,
    q.timeSec ?? CONFIG.TIMERS.OUTPUT
  );
  const secs = getTimerSecs(session, baseSecs);

  const embed = new EmbedBuilder()
    .setTitle(q.title || "What is the Output?")
    .setDescription(codeWithLineNumbers(q.code))
    .setColor("#57F287")
    .setFooter({ text: `${footer} • ${secs}s` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`openout:${session.sid}:${idx}`)
      .setLabel("Submit output")
      .setStyle(ButtonStyle.Primary)
  );

  const msg = await channel.send({
    content: `<@${session.userId}>`,
    embeds: [embed],
    components: [row],
  });

  sessionManager.startTimer(session.sid, idx, secs, async () => {
    session.answers[idx] = {
      kind: "output",
      submitted: null,
      correct: false,
      timeout: true,
    };
    try {
      await msg.edit({ components: [] });
    } catch {}
    await channel.send(
      "⏰ Time's up! Expected output:\n```\n" + q.expectedOutput + "\n```"
    );
    await advance(channel, session);
  });
}

/**
 * Send code question
 */
async function sendCodeQuestion(channel, session, footer, sessionManager, advance) {
  const idx = session.index;
  const p = session.items[idx];

  // Get the timer from question or config
  let baseSecs;

  if (p.timeSec) {
    baseSecs = Math.max(CONFIG.MIN_CODE_TIME_SECONDS, p.timeSec);
  } else {
    const configTime = CONFIG.TIMERS.CODE;
    const calculatedTime = Math.round((CONFIG.CODE_TIMEOUT_MS * 4) / 1000);
    baseSecs = Math.max(CONFIG.MIN_CODE_TIME_SECONDS, configTime || calculatedTime);
  }

  // Use override if resuming with remaining time, otherwise use base
  const secs = session.timerOverrideSecs
    ? Math.max(CONFIG.MIN_CODE_TIME_SECONDS, session.timerOverrideSecs)
    : baseSecs;
  delete session.timerOverrideSecs; // Clear after use

  const embed = new EmbedBuilder()
    .setTitle(p.title || "Coding Challenge")
    .setDescription(
      `**Problem**\n${p.prompt}\n\n` +
        `**Starter Code**\n\`\`\`java\n${p.starter}\n\`\`\`\n`
    )
    .addFields(
      {
        name: "📋 How to Submit",
        value:
          `1️⃣ Copy the starter code above\n` +
          `2️⃣ Write your solution inside \`main()\`\n` +
          `3️⃣ Click "Submit solution" below\n` +
          `4️⃣ Paste your **COMPLETE** code`,
        inline: false,
      },
      {
        name: "✅ Correct Submission",
        value:
          `\`\`\`java\n` +
          `import java.util.Scanner;\n\n` +
          `public class Main {\n` +
          `  public static void main(String[] args) {\n` +
          `    // YOUR SOLUTION HERE\n` +
          `  }\n` +
          `}\n` +
          `\`\`\``,
        inline: false,
      },
      {
        name: "❌ Wrong Submissions",
        value:
          `Don't submit:\n` +
          `• Just your code without the class\n` +
          `• Missing \`import\` statements\n` +
          `• Incomplete code`,
        inline: false,
      }
    )
    .setColor("#EB459E")
    .setFooter({ text: `${footer} • ${secs}s to attempt` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`opencode:${session.sid}:${idx}`)
      .setLabel("📝 Submit solution")
      .setStyle(ButtonStyle.Success)
  );

  const msg = await channel.send({
    content: `<@${session.userId}>`,
    embeds: [embed],
    components: [row],
  });

  sessionManager.startTimer(session.sid, idx, secs, async () => {
    session.answers[idx] = {
      kind: "code",
      submitted: false,
      correct: false,
      timeout: true,
    };
    try {
      await msg.edit({ components: [] });
    } catch {}
    await channel.send(`⏰ Time's up on the coding challenge!`);
    await advance(channel, session);
  });
}
