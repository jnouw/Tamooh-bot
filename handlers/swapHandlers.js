import { PermissionFlagsBits } from 'discord.js';
import { swapStore } from '../services/SwapStore.js';
import { swapMatcher } from '../services/SwapMatcher.js';
import { swapCoordinator } from '../services/SwapCoordinator.js';
import { CONFIG } from '../config.js';
import { logger } from '../utils/logger.js';
import { createRateLimiter } from '../utils/sanitize.js';

// Rate limiter for /swap add: 30 seconds cooldown
const swapAddRateLimiter = createRateLimiter(CONFIG.SWAP.ADD_COOLDOWN_MS, 1);

/**
 * Validate and normalize campus input
 */
function normalizeCampus(input) {
  const campus = input.trim().toUpperCase();
  if (!CONFIG.SWAP.VALID_CAMPUSES.includes(campus)) {
    return { valid: false, error: `Campus must be one of: ${CONFIG.SWAP.VALID_CAMPUSES.join(', ')}` };
  }
  return { valid: true, value: campus };
}

/**
 * Validate and normalize course input
 */
function normalizeCourse(input) {
  const course = input.trim().toUpperCase();
  if (!course) {
    return { valid: false, error: 'Course cannot be empty' };
  }
  if (course.length > 20) {
    return { valid: false, error: 'Course name too long (max 20 characters)' };
  }
  return { valid: true, value: course };
}

/**
 * Validate and normalize section input
 */
function normalizeSection(input) {
  const section = String(input).trim();
  if (!section) {
    return { valid: false, error: 'Section cannot be empty' };
  }
  if (section.length > 20) {
    return { valid: false, error: 'Section too long (max 20 characters)' };
  }
  return { valid: true, value: section };
}

/**
 * Check if user has the required student role (if configured)
 */
function hasStudentRole(member) {
  if (!CONFIG.SWAP.STUDENT_ROLE_ID) {
    return true; // No restriction
  }
  return member.roles.cache.has(CONFIG.SWAP.STUDENT_ROLE_ID);
}

/**
 * Check if user is an admin
 */
function isAdmin(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

/**
 * Handle /swap add command
 */
export async function handleSwapAdd(interaction) {
  // Check student role
  if (!hasStudentRole(interaction.member)) {
    return interaction.reply({
      content: '❌ You need the Student role to use this command.',
      ephemeral: true,
    });
  }

  // Check rate limit
  const rateLimit = swapAddRateLimiter.check(interaction.user.id);
  if (!rateLimit.allowed) {
    return interaction.reply({
      content: `⏳ Please wait ${rateLimit.resetIn} seconds before adding another swap request.`,
      ephemeral: true,
    });
  }

  // Get and validate inputs
  const campusInput = interaction.options.getString('campus');
  const courseInput = interaction.options.getString('course');
  const haveSectionInput = interaction.options.getString('have_section');
  const wantSectionInput = interaction.options.getString('want_section');
  const note = interaction.options.getString('note');

  // Validate campus
  const campusResult = normalizeCampus(campusInput);
  if (!campusResult.valid) {
    return interaction.reply({ content: `❌ ${campusResult.error}`, ephemeral: true });
  }

  // Validate course
  const courseResult = normalizeCourse(courseInput);
  if (!courseResult.valid) {
    return interaction.reply({ content: `❌ ${courseResult.error}`, ephemeral: true });
  }

  // Validate sections
  const haveResult = normalizeSection(haveSectionInput);
  if (!haveResult.valid) {
    return interaction.reply({ content: `❌ Have section: ${haveResult.error}`, ephemeral: true });
  }

  const wantResult = normalizeSection(wantSectionInput);
  if (!wantResult.valid) {
    return interaction.reply({ content: `❌ Want section: ${wantResult.error}`, ephemeral: true });
  }

  // Check have != want
  if (haveResult.value === wantResult.value) {
    return interaction.reply({
      content: '❌ Have section and want section must be different.',
      ephemeral: true,
    });
  }

  const campus = campusResult.value;
  const course = courseResult.value;
  const haveSection = haveResult.value;
  const wantSection = wantResult.value;

  // Check for duplicate request
  if (swapStore.hasDuplicateRequest(
    interaction.user.id,
    interaction.guildId,
    campus,
    course,
    haveSection,
    wantSection
  )) {
    return interaction.reply({
      content: '❌ You already have an open request with the same details.',
      ephemeral: true,
    });
  }

  // Check max requests per user per course
  const openCount = swapStore.countUserOpenRequests(
    interaction.user.id,
    interaction.guildId,
    campus,
    course
  );
  if (openCount >= CONFIG.SWAP.MAX_REQUESTS_PER_USER_COURSE) {
    return interaction.reply({
      content: `❌ You already have ${CONFIG.SWAP.MAX_REQUESTS_PER_USER_COURSE} open requests for ${campus} ${course}. Cancel one before adding more.`,
      ephemeral: true,
    });
  }

  // Defer reply since matching might take time
  await interaction.deferReply({ ephemeral: true });

  try {
    // Create the request
    const request = swapStore.createRequest({
      guildId: interaction.guildId,
      campus,
      course,
      userId: interaction.user.id,
      haveSection,
      wantSection,
      note,
    });

    // Attempt to find a match
    const matchResult = await swapMatcher.attemptMatch(request, interaction.client);

    if (matchResult) {
      // Match found! Create the coordination thread
      try {
        const thread = await swapCoordinator.createMatchThread(matchResult);

        await interaction.editReply({
          content: `🎉 **Match found!** A coordination thread has been created: ${thread}\n\n` +
            `Please go there to confirm the swap with the other participant(s).`,
        });
      } catch (error) {
        logger.error('Failed to create match thread', { error: error.message });
        await interaction.editReply({
          content: `🎉 **Match found!** However, there was an issue creating the coordination thread.\n\n` +
            `Please contact an admin to resolve this.`,
        });
      }
    } else {
      // No match yet
      await interaction.editReply({
        content: `✅ **Swap request created!** (ID: ${request.id})\n\n` +
          `**Campus:** ${campus}\n` +
          `**Course:** ${course}\n` +
          `**Have:** Section ${haveSection}\n` +
          `**Want:** Section ${wantSection}\n` +
          (note ? `**Note:** ${note}\n` : '') +
          `\nYou'll be notified when a matching swap is found. Use \`/swap my\` to view your requests.`,
      });
    }

    logger.info('Swap request handled', {
      requestId: request.id,
      userId: interaction.user.id,
      matched: !!matchResult,
    });
  } catch (error) {
    logger.error('Error in handleSwapAdd', { error: error.message, stack: error.stack });
    await interaction.editReply({
      content: '❌ An error occurred while creating your swap request. Please try again.',
    });
  }
}

/**
 * Handle /swap my command
 */
export async function handleSwapMy(interaction) {
  const requests = swapStore.getAllUserOpenRequests(interaction.user.id, interaction.guildId);

  if (requests.length === 0) {
    return interaction.reply({
      content: 'You have no open swap requests.\n\nUse `/swap add` to create one.',
      ephemeral: true,
    });
  }

  const now = Date.now();
  const lines = requests.map(r => {
    const age = formatAge(now - r.created_at);
    return `**#${r.id}** | ${r.campus} | ${r.course} | ${r.have_section} → ${r.want_section} | ${age}`;
  });

  const response = `## Your Open Swap Requests\n\n` +
    `| ID | Campus | Course | Sections | Age |\n` +
    `|---|---|---|---|---|\n` +
    lines.join('\n') +
    `\n\nUse \`/swap cancel id:<id>\` to cancel a request.`;

  return interaction.reply({
    content: response,
    ephemeral: true,
  });
}

/**
 * Handle /swap cancel command
 */
export async function handleSwapCancel(interaction) {
  const requestId = interaction.options.getInteger('id');

  const result = swapStore.cancelRequest(requestId, interaction.user.id);

  if (!result.success) {
    return interaction.reply({
      content: `❌ ${result.error}`,
      ephemeral: true,
    });
  }

  // If this request was part of a pending match, cancel it and notify others
  if (result.matchId) {
    const match = swapStore.getMatchById(result.matchId);
    if (match && match.status === 'pending_confirm') {
      swapStore.cancelMatch(result.matchId);
      await swapCoordinator.notifyMatchCancelled(result.matchId);
    }
  }

  return interaction.reply({
    content: `✅ Request #${requestId} has been cancelled.`,
    ephemeral: true,
  });
}

/**
 * Handle /swap help command
 */
export async function handleSwapHelp(interaction) {
  const settings = swapStore.getSettings(interaction.guildId);

  const helpText = `## Section Swap Help

**What is Section Swap?**
A matchmaking system to help you find classmates who want to swap sections with you.

**Commands:**
- \`/swap add\` - Create a new swap request
- \`/swap my\` - View your open requests
- \`/swap cancel\` - Cancel a request by ID
- \`/swap help\` - Show this help

**How it works:**
1. Use \`/swap add\` with your current section and desired section
2. The system automatically looks for matches:
   - **2-Way Swap:** You have A, want B. Someone has B, wants A. Perfect match!
   - **3-Way Cycle:** ${settings.allow_three_way ? 'Enabled' : 'Disabled'} - Three students form a swap cycle
3. When matched, you'll be added to a private thread to confirm
4. Type \`CONFIRMED\` in the thread within ${settings.confirm_timeout_minutes} minutes
5. Once all parties confirm, coordinate your official add/drop!

**Limits:**
- Max ${CONFIG.SWAP.MAX_REQUESTS_PER_USER_COURSE} open requests per course
- Requests expire after ${settings.request_expiry_days} days if not matched

**Tips:**
- Add a note with your availability for easier coordination
- Check \`/swap my\` regularly for your request status
- Cancel requests you no longer need`;

  return interaction.reply({
    content: helpText,
    ephemeral: true,
  });
}

/**
 * Handle /swap admin settings command
 */
export async function handleSwapAdminSettings(interaction) {
  if (!isAdmin(interaction.member)) {
    return interaction.reply({
      content: '❌ This command requires Administrator permissions.',
      ephemeral: true,
    });
  }

  const allowThreeWay = interaction.options.getBoolean('allow_three_way');
  const confirmTimeout = interaction.options.getInteger('confirm_timeout_minutes');
  const requestExpiry = interaction.options.getInteger('request_expiry_days');

  const updates = {};
  if (allowThreeWay !== null) updates.allow_three_way = allowThreeWay;
  if (confirmTimeout !== null) updates.confirm_timeout_minutes = confirmTimeout;
  if (requestExpiry !== null) updates.request_expiry_days = requestExpiry;

  if (Object.keys(updates).length === 0) {
    // Show current settings
    const settings = swapStore.getSettings(interaction.guildId);
    return interaction.reply({
      content: `## Current Swap Settings\n\n` +
        `- **3-Way Swaps:** ${settings.allow_three_way ? 'Enabled' : 'Disabled'}\n` +
        `- **Confirm Timeout:** ${settings.confirm_timeout_minutes} minutes\n` +
        `- **Request Expiry:** ${settings.request_expiry_days} days`,
      ephemeral: true,
    });
  }

  const newSettings = swapStore.updateSettings(interaction.guildId, updates);

  return interaction.reply({
    content: `✅ **Settings Updated**\n\n` +
      `- **3-Way Swaps:** ${newSettings.allow_three_way ? 'Enabled' : 'Disabled'}\n` +
      `- **Confirm Timeout:** ${newSettings.confirm_timeout_minutes} minutes\n` +
      `- **Request Expiry:** ${newSettings.request_expiry_days} days`,
    ephemeral: true,
  });
}

/**
 * Handle /swap admin stats command
 */
export async function handleSwapAdminStats(interaction) {
  if (!isAdmin(interaction.member)) {
    return interaction.reply({
      content: '❌ This command requires Administrator permissions.',
      ephemeral: true,
    });
  }

  const campus = interaction.options.getString('campus')?.toUpperCase() || null;
  const course = interaction.options.getString('course')?.toUpperCase() || null;

  const stats = swapStore.getStats(interaction.guildId, campus, course);

  // Format request stats
  const requestCounts = {};
  for (const r of stats.requests) {
    requestCounts[r.status] = r.count;
  }

  // Format match stats
  const matchCounts = { two_way: {}, three_way: {} };
  for (const m of stats.matches) {
    matchCounts[m.match_type][m.status] = m.count;
  }

  let response = `## Swap Statistics${campus ? ` (${campus})` : ''}${course ? ` (${course})` : ''}\n\n`;

  response += `### Requests\n`;
  response += `- Open: ${requestCounts.open || 0}\n`;
  response += `- Matched: ${requestCounts.matched || 0}\n`;
  response += `- Cancelled: ${requestCounts.cancelled || 0}\n`;
  response += `- Expired: ${requestCounts.expired || 0}\n\n`;

  response += `### Matches\n`;
  response += `**2-Way:**\n`;
  response += `- Confirmed: ${matchCounts.two_way.confirmed || 0}\n`;
  response += `- Pending: ${matchCounts.two_way.pending_confirm || 0}\n`;
  response += `- Expired: ${matchCounts.two_way.expired || 0}\n\n`;

  response += `**3-Way:**\n`;
  response += `- Confirmed: ${matchCounts.three_way.confirmed || 0}\n`;
  response += `- Pending: ${matchCounts.three_way.pending_confirm || 0}\n`;
  response += `- Expired: ${matchCounts.three_way.expired || 0}\n\n`;

  if (stats.topCourses.length > 0) {
    response += `### Top Courses\n`;
    for (const c of stats.topCourses) {
      response += `- ${c.campus} ${c.course}: ${c.total_requests} total (${c.open_requests} open)\n`;
    }
  }

  return interaction.reply({
    content: response,
    ephemeral: true,
  });
}

/**
 * Handle /swap admin purge_expired command
 */
export async function handleSwapAdminPurge(interaction) {
  if (!isAdmin(interaction.member)) {
    return interaction.reply({
      content: '❌ This command requires Administrator permissions.',
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const result = swapStore.purgeExpired(interaction.guildId);

  return interaction.editReply({
    content: `✅ **Purge Complete**\n\n` +
      `- Expired requests: ${result.expiredRequests}\n` +
      `- Expired matches: ${result.expiredMatches}`,
  });
}

/**
 * Format age as human-readable string
 */
function formatAge(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  return `${days}d`;
}
