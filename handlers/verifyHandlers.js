import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { CONFIG } from '../config.js';
import { logger } from '../utils/logger.js';
import { isAdmin } from '../utils/adminUtils.js';
import { verificationStore } from '../services/VerificationStore.js';

/**
 * Handle /verify-setup command
 * Posts the verification embed with email and Qimah buttons
 */
export async function handleVerifySetup(interaction) {
  // Admin only
  if (!isAdmin(interaction)) {
    return interaction.reply({
      content: '❌ This command is admin-only.',
      ephemeral: true,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(CONFIG.VERIFY.EMBED_TITLE)
    .setDescription(CONFIG.VERIFY.EMBED_DESCRIPTION)
    .setColor(CONFIG.VERIFY.EMBED_COLOR)
    .addFields([
      {
        name: '📌 كيف يعمل التحقق؟ | How does verification work?',
        value: [
          '**الخيار 1: الإيميل الجامعي**',
          '1. اضغط على زر "التحقق بالإيميل الجامعي"',
          '2. أدخل إيميلك الجامعي واسمك',
          '3. ستستلم كود تحقق على إيميلك',
          '4. أدخل الكود للتحقق',
          '',
          '**Option 1: University Email**',
          '1. Click "Verify with University Email"',
          '2. Enter your university email and name',
          '3. You will receive a verification code',
          '4. Enter the code to verify',
          '',
          '**الخيار 2: أعضاء Qimah**',
          'إذا كنت عضواً في Qimah، يمكنك ربط حسابك مباشرة.',
        ].join('\n'),
      },
    ])
    .setFooter({ text: 'Qimah Verification System' });

  // Build buttons
  const buttons = [];

  // Email verification button
  buttons.push(
    new ButtonBuilder()
      .setCustomId('verify_email')
      .setLabel(CONFIG.VERIFY.BUTTON_EMAIL)
      .setStyle(ButtonStyle.Primary)
  );

  // Qimah OAuth button (only if URL is configured)
  if (CONFIG.VERIFY.OAUTH_URL) {
    buttons.push(
      new ButtonBuilder()
        .setLabel(CONFIG.VERIFY.BUTTON_QIMAH)
        .setStyle(ButtonStyle.Link)
        .setURL(CONFIG.VERIFY.OAUTH_URL)
    );
  }

  // Enter code button (for users who already received email)
  buttons.push(
    new ButtonBuilder()
      .setCustomId('verify_enter_code')
      .setLabel(CONFIG.VERIFY.BUTTON_ENTER_CODE)
      .setStyle(ButtonStyle.Secondary)
  );

  const row = new ActionRowBuilder().addComponents(buttons);

  // Send to channel (not ephemeral)
  await interaction.channel.send({
    embeds: [embed],
    components: [row],
  });

  // Confirm to admin
  await interaction.reply({
    content: '✅ Verification embed posted!',
    ephemeral: true,
  });

  logger.info('Verification embed posted', {
    channelId: interaction.channelId,
    adminId: interaction.user.id,
  });
}

/**
 * Handle /verify-check command
 * Check if a user is verified
 */
export async function handleVerifyCheck(interaction) {
  if (!CONFIG.VERIFY.ROLE_ID) {
    return interaction.reply({
      content: '❌ Verification system not configured (VERIFIED_ROLE_ID not set).',
      ephemeral: true,
    });
  }

  const targetUser = interaction.options.getUser('user') || interaction.user;

  try {
    const member = await interaction.guild.members.fetch(targetUser.id);
    const isVerified = member.roles.cache.has(CONFIG.VERIFY.ROLE_ID);

    await interaction.reply({
      content: isVerified
        ? `✅ <@${targetUser.id}> is verified.`
        : `❌ <@${targetUser.id}> is not verified.`,
      ephemeral: true,
    });
  } catch (error) {
    logger.error('Failed to check verification status', {
      targetUserId: targetUser.id,
      error: error.message,
    });
    await interaction.reply({
      content: '❌ Could not check verification status.',
      ephemeral: true,
    });
  }
}

/**
 * Log new member application to the configured channel
 * Called on guildMemberAdd event
 */
export async function logMemberApplication(member) {
  if (!CONFIG.VERIFY.APPLICATION_LOG_CHANNEL_ID) {
    return;
  }

  try {
    const channel = await member.client.channels.fetch(
      CONFIG.VERIFY.APPLICATION_LOG_CHANNEL_ID
    );

    if (!channel) {
      logger.warn('Application log channel not found', {
        channelId: CONFIG.VERIFY.APPLICATION_LOG_CHANNEL_ID,
      });
      return;
    }

    const accountAge = Date.now() - member.user.createdTimestamp;
    const accountAgeDays = Math.floor(accountAge / (1000 * 60 * 60 * 24));

    // Flag suspicious accounts (less than 7 days old)
    const isSuspicious = accountAgeDays < 7;

    const embed = new EmbedBuilder()
      .setTitle(isSuspicious ? '⚠️ New Member (New Account)' : '📋 New Member')
      .setColor(isSuspicious ? 0xFFA500 : 0x5865F2)
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
      .addFields([
        { name: 'User', value: `<@${member.id}>`, inline: true },
        { name: 'Username', value: member.user.tag, inline: true },
        { name: 'ID', value: member.id, inline: true },
        {
          name: 'Account Created',
          value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
          inline: true,
        },
        {
          name: 'Account Age',
          value: `${accountAgeDays} days`,
          inline: true,
        },
        {
          name: 'Joined Server',
          value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
          inline: true,
        },
      ])
      .setTimestamp();

    if (isSuspicious) {
      embed.setDescription('⚠️ **Warning:** Account is less than 7 days old.');
    }

    await channel.send({ embeds: [embed] });

    logger.info('Logged member application', {
      memberId: member.id,
      username: member.user.tag,
      accountAgeDays,
      isSuspicious,
    });
  } catch (error) {
    logger.error('Failed to log member application', {
      memberId: member.id,
      error: error.message,
    });
  }
}

/**
 * Log when a member passes membership screening
 * Called on guildMemberUpdate when pending changes from true to false
 */
export async function logScreeningPass(member) {
  if (!CONFIG.VERIFY.APPLICATION_LOG_CHANNEL_ID) {
    return;
  }

  try {
    const channel = await member.client.channels.fetch(
      CONFIG.VERIFY.APPLICATION_LOG_CHANNEL_ID
    );

    if (!channel) {
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('✅ Membership Screening Passed')
      .setColor(0x57F287)
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
      .addFields([
        { name: 'User', value: `<@${member.id}>`, inline: true },
        { name: 'Username', value: member.user.tag, inline: true },
      ])
      .setTimestamp();

    await channel.send({ embeds: [embed] });

    logger.info('Logged screening pass', {
      memberId: member.id,
      username: member.user.tag,
    });
  } catch (error) {
    logger.error('Failed to log screening pass', {
      memberId: member.id,
      error: error.message,
    });
  }
}

// ==================== EMAIL VERIFICATION HANDLERS ====================

/**
 * Handle verify_email button click
 * Shows the email input modal
 */
export async function handleVerifyEmailButton(interaction) {
  // Check rate limit
  const rateLimit = verificationStore.checkRateLimit(interaction.user.id);
  if (!rateLimit.allowed) {
    const resetTime = Math.floor(rateLimit.resetAt / 1000);
    return interaction.reply({
      content: `⚠️ لقد تجاوزت الحد المسموح من المحاولات.\nYou have exceeded the rate limit.\n\nيمكنك المحاولة مرة أخرى <t:${resetTime}:R>\nYou can try again <t:${resetTime}:R>`,
      ephemeral: true,
    });
  }

  // Check if already verified
  if (CONFIG.VERIFY.ROLE_ID) {
    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (member.roles.cache.has(CONFIG.VERIFY.ROLE_ID)) {
        return interaction.reply({
          content: '✅ أنت متحقق بالفعل! | You are already verified!',
          ephemeral: true,
        });
      }
    } catch (error) {
      logger.error('Failed to check verification status', { error: error.message });
    }
  }

  // Show email modal
  const modal = new ModalBuilder()
    .setCustomId('verify_email_modal')
    .setTitle('التحقق بالإيميل الجامعي | Email Verification');

  const emailInput = new TextInputBuilder()
    .setCustomId('email')
    .setLabel('الإيميل الجامعي | University Email')
    .setPlaceholder('example@stu.ksu.edu.sa')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const nameInput = new TextInputBuilder()
    .setCustomId('name')
    .setLabel('الاسم الكامل | Full Name')
    .setPlaceholder('محمد أحمد | Mohammed Ahmed')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  modal.addComponents(
    new ActionRowBuilder().addComponents(emailInput),
    new ActionRowBuilder().addComponents(nameInput)
  );

  await interaction.showModal(modal);
}

/**
 * Handle email modal submission
 * Validates email, sends verification code via n8n webhook
 */
export async function handleEmailModalSubmit(interaction) {
  const email = interaction.fields.getTextInputValue('email').trim().toLowerCase();
  const name = interaction.fields.getTextInputValue('name').trim();

  // Validate email domain
  if (!verificationStore.isEmailAllowed(email)) {
    const allowedDomains = CONFIG.VERIFY.ALLOWED_EMAIL_DOMAINS.join(', ');
    return interaction.reply({
      content: `❌ يجب استخدام إيميل جامعي صالح.\nYou must use a valid university email.\n\nالنطاقات المسموحة | Allowed domains: ${allowedDomains}`,
      ephemeral: true,
    });
  }

  // Check if email is already used
  if (verificationStore.isEmailUsed(email)) {
    return interaction.reply({
      content: '❌ هذا الإيميل مستخدم من قبل حساب آخر.\nThis email is already used by another account.',
      ephemeral: true,
    });
  }

  // Check rate limit again (in case they opened modal and waited)
  const rateLimit = verificationStore.checkRateLimit(interaction.user.id);
  if (!rateLimit.allowed) {
    const resetTime = Math.floor(rateLimit.resetAt / 1000);
    return interaction.reply({
      content: `⚠️ لقد تجاوزت الحد المسموح من المحاولات.\nيمكنك المحاولة مرة أخرى <t:${resetTime}:R>`,
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    // Create pending verification and get code
    const code = verificationStore.createPendingVerification(
      interaction.user.id,
      email,
      name
    );

    // Send email via n8n webhook
    if (CONFIG.VERIFY.EMAIL_WEBHOOK_URL) {
      const response = await fetch(CONFIG.VERIFY.EMAIL_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          name,
          code,
          discord_id: interaction.user.id,
          discord_username: interaction.user.tag,
        }),
      });

      if (!response.ok) {
        logger.error('Failed to send verification email', {
          status: response.status,
          discordId: interaction.user.id,
          email,
        });
        return interaction.editReply({
          content: '❌ فشل إرسال الإيميل. يرجى المحاولة لاحقاً.\nFailed to send email. Please try again later.',
        });
      }
    } else {
      logger.warn('EMAIL_WEBHOOK_URL not configured, code not sent', { code, discordId: interaction.user.id });
    }

    // Success message with code entry button
    const expiryMinutes = CONFIG.VERIFY.CODE_EXPIRY_MINUTES;

    const embed = new EmbedBuilder()
      .setTitle('📧 تم إرسال كود التحقق | Verification Code Sent')
      .setDescription([
        `تم إرسال كود التحقق إلى **${email}**`,
        `A verification code has been sent to **${email}**`,
        '',
        `⏰ الكود صالح لمدة ${expiryMinutes} دقيقة`,
        `⏰ Code is valid for ${expiryMinutes} minutes`,
        '',
        '**ملاحظة:** تحقق من مجلد السبام إذا لم تجد الإيميل',
        '**Note:** Check spam folder if you don\'t see the email',
      ].join('\n'))
      .setColor(0x5865F2);

    const button = new ButtonBuilder()
      .setCustomId('verify_enter_code')
      .setLabel(CONFIG.VERIFY.BUTTON_ENTER_CODE)
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(button);

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });

    logger.info('Verification email requested', {
      discordId: interaction.user.id,
      email,
      name,
    });
  } catch (error) {
    logger.error('Error in email verification flow', {
      error: error.message,
      discordId: interaction.user.id,
    });

    await interaction.editReply({
      content: '❌ حدث خطأ. يرجى المحاولة لاحقاً.\nAn error occurred. Please try again later.',
    });
  }
}

/**
 * Handle verify_enter_code button click
 * Shows the code input modal
 */
export async function handleEnterCodeButton(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('verify_code_modal')
    .setTitle('إدخال كود التحقق | Enter Verification Code');

  const codeInput = new TextInputBuilder()
    .setCustomId('code')
    .setLabel('كود التحقق | Verification Code')
    .setPlaceholder('123456')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(6)
    .setMaxLength(6);

  modal.addComponents(new ActionRowBuilder().addComponents(codeInput));

  await interaction.showModal(modal);
}

/**
 * Handle code modal submission
 * Verifies the code and assigns the verified role
 */
export async function handleCodeModalSubmit(interaction) {
  const code = interaction.fields.getTextInputValue('code').trim();

  // Verify the code
  const result = verificationStore.verifyCode(interaction.user.id, code);

  if (!result.success) {
    return interaction.reply({
      content: `❌ ${result.error}`,
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    // Mark as verified in database
    verificationStore.markVerified(interaction.user.id, result.email, result.name, 'email');

    // Assign verified role
    if (CONFIG.VERIFY.ROLE_ID) {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      await member.roles.add(CONFIG.VERIFY.ROLE_ID);
    }

    // Log successful verification
    await logSuccessfulVerification(interaction.client, interaction.user, result.email, result.name, 'email');

    await interaction.editReply({
      content: '✅ تم التحقق بنجاح! مرحباً بك في السيرفر.\n✅ Verification successful! Welcome to the server.',
    });

    logger.info('User verified via email', {
      discordId: interaction.user.id,
      email: result.email,
      name: result.name,
    });
  } catch (error) {
    logger.error('Error assigning verified role', {
      error: error.message,
      discordId: interaction.user.id,
    });

    await interaction.editReply({
      content: '⚠️ تم التحقق ولكن فشل إضافة الرتبة. يرجى التواصل مع الإدارة.\n⚠️ Verified but failed to assign role. Please contact an admin.',
    });
  }
}

/**
 * Log successful verification to the verification log channel
 */
async function logSuccessfulVerification(client, user, email, name, method) {
  if (!CONFIG.VERIFY.VERIFICATION_LOG_CHANNEL_ID) {
    return;
  }

  try {
    const channel = await client.channels.fetch(CONFIG.VERIFY.VERIFICATION_LOG_CHANNEL_ID);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setTitle('✅ New Verification')
      .setColor(0x57F287)
      .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
      .addFields([
        { name: 'User', value: `<@${user.id}>`, inline: true },
        { name: 'Username', value: user.tag, inline: true },
        { name: 'Method', value: method, inline: true },
        { name: 'Name', value: name || 'N/A', inline: true },
        { name: 'Email', value: email ? `||${email}||` : 'N/A', inline: true },
      ])
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (error) {
    logger.error('Failed to log verification', { error: error.message });
  }
}
