import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { CONFIG } from '../config.js';
import { suggestionStore } from '../services/SuggestionStore.js';
import { logger } from '../utils/logger.js';

/**
 * Posts the suggestion panel (button + description) to a channel.
 * Called via !initsuggestions admin command.
 */
export async function postSuggestionPanel(client, channelId) {
  const channel = await client.channels.fetch(channelId);

  const embed = new EmbedBuilder()
    .setColor(CONFIG.WELCOME.COLOR)
    .setDescription(
      'السلام عليكم يالطموحين 💪\n\n' +
      'اللي عنده اي اقتراحات اكتبوها هنا ⬇️\n\n' +
      'لا تشيل هم الاقتراح بيكون مجهول 🔒'
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('suggest_open')
      .setLabel('📝 اكتب اقتراحك')
      .setStyle(ButtonStyle.Primary)
  );

  return channel.send({ embeds: [embed], components: [row] });
}

/**
 * Opens the suggestion modal when the user clicks the button.
 */
export async function handleSuggestButton(interaction) {
  if (!suggestionStore.canSubmit(interaction.user.id)) {
    return interaction.reply({
      content: '⏳ بإمكانك تقديم اقتراح واحد كل يوم. جرب مرة ثانية باكر!',
      ephemeral: true,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId('suggest_modal')
    .setTitle('📝 اقتراح مجهول');

  const q1 = new TextInputBuilder()
    .setCustomId('suggestion')
    .setLabel('ما هو اقتراحك؟')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);

  const q2 = new TextInputBuilder()
    .setCustomId('implementation')
    .setLabel('كيف نقدر نطبقه؟')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);

  modal.addComponents(
    new ActionRowBuilder().addComponents(q1),
    new ActionRowBuilder().addComponents(q2),
  );

  await interaction.showModal(modal);
}

/**
 * Handles the submitted modal — stores the suggestion and posts to admin channel.
 */
export async function handleSuggestModal(interaction) {
  const suggestion = interaction.fields.getTextInputValue('suggestion');
  const implementation = interaction.fields.getTextInputValue('implementation');

  // Re-check rate limit (guards against race conditions)
  if (!suggestionStore.canSubmit(interaction.user.id)) {
    return interaction.reply({
      content: '⏳ بإمكانك تقديم اقتراح واحد كل يوم.',
      ephemeral: true,
    });
  }

  suggestionStore.add(interaction.user.id, suggestion, implementation);

  // Post to admin review channel
  const adminChannel = interaction.guild.channels.cache.get(CONFIG.SUGGESTIONS.ADMIN_CHANNEL_ID);
  if (adminChannel) {
    const total = suggestionStore.getAll().length;
    const embed = new EmbedBuilder()
      .setColor(CONFIG.WELCOME.COLOR)
      .setTitle('📬 اقتراح جديد')
      .addFields(
        { name: '💡 ما هو الاقتراح؟', value: suggestion },
        { name: '🔧 كيف نقدر نطبقه؟', value: implementation },
      )
      .setTimestamp()
      .setFooter({ text: `مجهول | #${total}` });

    await adminChannel.send({ embeds: [embed] });
  }

  await interaction.reply({
    content: '✅ وصل اقتراحك، شكراً على مشاركتك! 🙌',
    ephemeral: true,
  });

  logger.info('Suggestion submitted', { guildId: interaction.guild.id });
}
