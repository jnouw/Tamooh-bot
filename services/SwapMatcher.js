import { swapStore } from './SwapStore.js';
import { logger } from '../utils/logger.js';

/**
 * SwapMatcher - Handles matching logic for section swaps
 */
class SwapMatcher {
  /**
   * Attempt to find a match for a newly created request
   * Returns match info if found, null otherwise
   */
  async attemptMatch(request, client) {
    const settings = swapStore.getSettings(request.guild_id);

    // Priority 1: Try 2-way reciprocal match
    const twoWayPartner = swapStore.findTwoWayMatch(request);
    if (twoWayPartner) {
      logger.info('Found 2-way match', {
        requestId: request.id,
        partnerId: twoWayPartner.id,
      });

      return this._createTwoWayMatch(request, twoWayPartner, settings);
    }

    // Priority 2: Try 3-way cycle if enabled
    if (settings.allow_three_way) {
      const threeWayCycle = swapStore.findThreeWayCycle(request);
      if (threeWayCycle) {
        logger.info('Found 3-way cycle', {
          requestId: request.id,
          xId: threeWayCycle.X.id,
          yId: threeWayCycle.Y.id,
        });

        return this._createThreeWayMatch(request, threeWayCycle.X, threeWayCycle.Y, settings);
      }
    }

    // No match found
    return null;
  }

  /**
   * Create a 2-way match between two requests
   */
  _createTwoWayMatch(request1, request2, settings) {
    const match = swapStore.createMatch({
      guildId: request1.guild_id,
      campus: request1.campus,
      course: request1.course,
      matchType: 'two_way',
      requestIds: [request1.id, request2.id],
      timeoutMinutes: settings.confirm_timeout_minutes,
    });

    return {
      match,
      type: 'two_way',
      requests: [
        swapStore.getRequestById(request1.id),
        swapStore.getRequestById(request2.id),
      ],
    };
  }

  /**
   * Create a 3-way match between three requests
   */
  _createThreeWayMatch(requestNew, requestX, requestY, settings) {
    const match = swapStore.createMatch({
      guildId: requestNew.guild_id,
      campus: requestNew.campus,
      course: requestNew.course,
      matchType: 'three_way',
      requestIds: [requestNew.id, requestX.id, requestY.id],
      timeoutMinutes: settings.confirm_timeout_minutes,
    });

    return {
      match,
      type: 'three_way',
      requests: [
        swapStore.getRequestById(requestNew.id),
        swapStore.getRequestById(requestX.id),
        swapStore.getRequestById(requestY.id),
      ],
    };
  }

  /**
   * Format match details for display
   */
  formatMatchSummary(matchResult, mentions = true) {
    const { match, type, requests } = matchResult;
    const settings = swapStore.getSettings(match.guild_id);

    const typeLabel = type === 'two_way' ? '2-Way Swap' : '3-Way Cycle';
    const timeoutMinutes = settings.confirm_timeout_minutes;

    let summary = `## 🔄 Section Swap Match Found!\n\n`;
    summary += `**Match Type:** ${typeLabel}\n`;
    summary += `**Campus:** ${match.campus}\n`;
    summary += `**Course:** ${match.course}\n\n`;
    summary += `### Participants\n`;

    for (const req of requests) {
      const mention = mentions ? `<@${req.user_id}>` : `User ${req.user_id}`;
      summary += `- ${mention}: Section **${req.have_section}** → **${req.want_section}**`;
      if (req.note) {
        summary += ` *(${req.note})*`;
      }
      summary += '\n';
    }

    summary += `\n### Instructions\n`;
    summary += `Each participant must type exactly \`CONFIRMED\` (case-insensitive) in this thread within **${timeoutMinutes} minutes** to confirm the swap.\n\n`;
    summary += `⚠️ If not all participants confirm in time, the match will be cancelled and your requests will be reopened.`;

    return summary;
  }

  /**
   * Format confirmation update message
   */
  formatConfirmationUpdate(userId, confirmed, total, allConfirmed) {
    if (allConfirmed) {
      return `✅ **Match Confirmed!** All participants have confirmed.\n\n` +
        `You can now coordinate the official add/drop process. Good luck with your section swap! 🎉`;
    }

    return `✓ <@${userId}> confirmed (**${confirmed}/${total}**)`;
  }

  /**
   * Format timeout message
   */
  formatTimeoutMessage() {
    return `⏳ **Match Timed Out**\n\n` +
      `Not all participants confirmed in time. The match has been cancelled and all requests have been reopened.\n\n` +
      `You can try again by waiting for another match or creating a new request.`;
  }

  /**
   * Format match cancelled message
   */
  formatCancelledMessage() {
    return `❌ **Match Cancelled**\n\n` +
      `A participant cancelled their request. The match has been cancelled and remaining requests have been reopened.`;
  }
}

export const swapMatcher = new SwapMatcher();
