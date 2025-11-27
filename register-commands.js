import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

if (!process.env.CLIENT_ID) {
  console.error('❌ CLIENT_ID is not set');
  process.exit(1);
}
if (!process.env.QIMAH_GUILD_ID) {
  console.error('❌ QIMAH_GUILD_ID is not set. Set it to your Qimah server ID.');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName('quiz')
    .setDescription('Interactive programming quizzes')
    .addSubcommand(sc =>
      sc.setName('start')
        .setDescription('Start a new quiz')
        .addStringOption(o =>
          o.setName('mode')
            .setDescription('Quiz type')
            .setRequired(true)
            .addChoices(
              { name: 'Multiple Choice (8 questions)', value: 'mcq' },
              { name: 'Find the Error (3 questions)', value: 'finderror' },
              { name: 'Predict Output (5 questions)', value: 'output' },
              { name: 'Coding Challenge (5 questions)', value: 'code' }
            )
        )
        .addStringOption(o =>
          o.setName('chapter')
            .setDescription('Chapter filter (code mode only)')
        )
        .addBooleanOption(o =>
          o.setName('privatethread')
            .setDescription('Create private thread (default: true)')
        )
    )
    .addSubcommand(sc =>
      sc.setName('leaderboard')
        .setDescription('Show top students')
        .addStringOption(o =>
          o.setName('mode')
            .setDescription('Filter by mode')
            .addChoices(
              { name: 'All', value: 'all' },
              { name: 'MCQ', value: 'mcq' },
              { name: 'Find the Error', value: 'finderror' },
              { name: 'Predict Output', value: 'output' },
              { name: 'Coding', value: 'code' }
            )
        )
        .addStringOption(o =>
          o.setName('range')
            .setDescription('Time range')
            .addChoices(
              { name: 'This week', value: '7d' },
              { name: 'This month', value: '30d' },
              { name: 'All time', value: 'all' }
            )
        )
        .addIntegerOption(o =>
          o.setName('minattempts')
            .setDescription('Min attempts to qualify')
            .setMinValue(1)
        )
    )
    .addSubcommand(sc =>
      sc.setName('stats')
        .setDescription('Show your stats')
        .addStringOption(o =>
          o.setName('range')
            .setDescription('Time range')
            .addChoices(
              { name: 'This week', value: '7d' },
              { name: 'This month', value: '30d' },
              { name: 'All time', value: 'all' }
            )
        )
    )
    .toJSON()
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

try {
  console.log('🔄 Registering guild slash commands...');
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.QIMAH_GUILD_ID),
    { body: commands }
  );
  console.log('✅ Slash commands registered successfully to the guild!');
} catch (error) {
  console.error('❌ Failed to register commands:', error);
  process.exit(1);
}
