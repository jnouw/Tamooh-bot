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
              { name: 'Coding Challenge (1 question)', value: 'code' }
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
    .toJSON(),

  new SlashCommandBuilder()
    .setName('study_leaderboard')
    .setDescription('Show top students by study time')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('tamooh')
    .setDescription('TamoohBot study system commands')
    .addSubcommand(sc =>
      sc.setName('mystats')
        .setDescription('View your personal study statistics and giveaway odds')
    )
    .addSubcommand(sc =>
      sc.setName('insights')
        .setDescription('View server-wide study insights (Admin only)')
    )
    .addSubcommand(sc =>
      sc.setName('violations')
        .setDescription('View AFK and gaming violation report (Admin only)')
    )
    .addSubcommand(sc =>
      sc.setName('reset-period')
        .setDescription('Reset giveaway period for fair competition (Admin only)')
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all available commands')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('swap')
    .setDescription('Section swap matchmaking')
    .addSubcommand(sc =>
      sc.setName('add')
        .setDescription('Create a new swap request')
        .addStringOption(o =>
          o.setName('campus')
            .setDescription('Campus (F or M)')
            .setRequired(true)
            .addChoices(
              { name: 'F', value: 'F' },
              { name: 'M', value: 'M' }
            )
        )
        .addStringOption(o =>
          o.setName('course')
            .setDescription('Course code (e.g., CS101)')
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('have_section')
            .setDescription('Your current section (e.g., 1120)')
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('want_section')
            .setDescription('Section you want (e.g., 1132)')
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('note')
            .setDescription('Optional note (e.g., availability)')
        )
    )
    .addSubcommand(sc =>
      sc.setName('my')
        .setDescription('View your open swap requests')
    )
    .addSubcommand(sc =>
      sc.setName('cancel')
        .setDescription('Cancel a swap request')
        .addIntegerOption(o =>
          o.setName('id')
            .setDescription('Request ID to cancel')
            .setRequired(true)
        )
    )
    .addSubcommand(sc =>
      sc.setName('help')
        .setDescription('Show swap matchmaking help')
    )
    .addSubcommandGroup(g =>
      g.setName('admin')
        .setDescription('Admin commands for swap matchmaking')
        .addSubcommand(sc =>
          sc.setName('settings')
            .setDescription('View or update swap settings')
            .addBooleanOption(o =>
              o.setName('allow_three_way')
                .setDescription('Enable 3-way swap cycles')
            )
            .addIntegerOption(o =>
              o.setName('confirm_timeout_minutes')
                .setDescription('Minutes to confirm a match')
                .setMinValue(5)
                .setMaxValue(1440)
            )
            .addIntegerOption(o =>
              o.setName('request_expiry_days')
                .setDescription('Days before requests expire')
                .setMinValue(1)
                .setMaxValue(30)
            )
        )
        .addSubcommand(sc =>
          sc.setName('stats')
            .setDescription('View swap statistics')
            .addStringOption(o =>
              o.setName('campus')
                .setDescription('Filter by campus')
                .addChoices(
                  { name: 'F', value: 'F' },
                  { name: 'M', value: 'M' }
                )
            )
            .addStringOption(o =>
              o.setName('course')
                .setDescription('Filter by course')
            )
        )
        .addSubcommand(sc =>
          sc.setName('purge_expired')
            .setDescription('Purge expired requests and matches')
        )
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('verify-setup')
    .setDescription('Post the verification embed (Admin only)')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('verify-check')
    .setDescription('Check if a user is verified')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to check (defaults to yourself)')
        .setRequired(false)
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
