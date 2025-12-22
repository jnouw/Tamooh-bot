import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { swapStore } from './SwapStore.js';
import { swapMatcher } from './SwapMatcher.js';
import { CONFIG } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * SwapCoordinator - Manages match threads and confirmation flow
 */
class SwapCoordinator {
  constructor() {
    this.expiryCheckInterval = null;
  }

  /**
   * Initialize the coordinator and start background jobs
   */
  init(client) {
    this.client = client;
    this._startExpiryChecker();
    logger.info('SwapCoordinator initialized');
  }

  /**
   * Create a coordination thread for a match
   */
  async createMatchThread(matchResult) {
    const { match, requests } = matchResult;
    const channelId = CONFIG.SWAP.MATCHES_CHANNEL_ID;

    if (!channelId) {
      logger.error('SWAP_MATCHES_CHANNEL_ID not configured');
      throw new Error('Swap matches channel not configured');
    }

    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      logger.error('Matches channel not found', { channelId });
      throw new Error('Matches channel not found');
    }

    // Generate thread name
    const sections = requests.map(r => r.have_section).join('-');
    const threadName = `swap-${match.campus}-${match.course}-${sections}`.substring(0, 100);

    try {
      // Try to create a private thread
      const thread = await channel.threads.create({
        name: threadName,
        autoArchiveDuration: 1440, // 24 hours
        type: ChannelType.PrivateThread,
        reason: `Section swap match #${match.match_id}`,
      });

      // Add all participants to the thread
      for (const req of requests) {
        try {
          await thread.members.add(req.user_id);
        } catch (error) {
          logger.warn('Failed to add participant to thread', {
            matchId: match.match_id,
            userId: req.user_id,
            error: error.message,
          });
        }
      }

      // Save thread ID
      swapStore.setMatchThreadId(match.match_id, thread.id);

      // Post the match summary
      const summary = swapMatcher.formatMatchSummary(matchResult, true);
      await thread.send(summary);

      logger.info('Match thread created', {
        matchId: match.match_id,
        threadId: thread.id,
        threadName,
      });

      return thread;
    } catch (error) {
      // Fallback: try creating a regular thread if private threads aren't supported
      if (error.code === 50001 || error.code === 50013) {
        return this._createFallbackThread(channel, matchResult);
      }
      throw error;
    }
  }

  /**
   * Fallback to public thread if private threads aren't available
   */
  async _createFallbackThread(channel, matchResult) {
    const { match, requests } = matchResult;
    const sections = requests.map(r => r.have_section).join('-');
    const threadName = `swap-${match.campus}-${match.course}-${sections}`.substring(0, 100);

    try {
      // Create a starter message
      const starterMessage = await channel.send({
        content: `🔒 **Section Swap Match** - Participants will be pinged in thread`,
      });

      const thread = await starterMessage.startThread({
        name: threadName,
        autoArchiveDuration: 1440,
        reason: `Section swap match #${match.match_id}`,
      });

      swapStore.setMatchThreadId(match.match_id, thread.id);

      const summary = swapMatcher.formatMatchSummary(matchResult, true);
      await thread.send(summary);

      logger.info('Fallback thread created', {
        matchId: match.match_id,
        threadId: thread.id,
      });

      return thread;
    } catch (error) {
      logger.error('Failed to create fallback thread', {
        matchId: match.match_id,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Handle a message in a match thread (for confirmation)
   */
  async handleThreadMessage(message) {
    // Ignore bot messages
    if (message.author.bot) return;

    // Check if this is a match thread
    const match = swapStore.getMatchByThreadId(message.channel.id);
    if (!match) return;

    // Only process pending_confirm matches
    if (match.status !== 'pending_confirm') return;

    // Check for CONFIRMED message
    const content = message.content.trim().toUpperCase();
    if (content !== 'CONFIRMED') return;

    // Attempt to confirm
    const result = swapStore.confirmParticipant(match.match_id, message.author.id);

    if (!result.success) {
      // Already confirmed or not a participant - silently ignore
      return;
    }

    // Send confirmation update
    const updateMessage = swapMatcher.formatConfirmationUpdate(
      message.author.id,
      result.confirmed,
      result.total,
      result.allConfirmed
    );
    await message.channel.send(updateMessage);

    // If all confirmed, archive the thread after a delay
    if (result.allConfirmed) {
      setTimeout(async () => {
        try {
          await message.channel.setArchived(true);
        } catch (error) {
          logger.warn('Failed to archive completed thread', {
            threadId: message.channel.id,
            error: error.message,
          });
        }
      }, 24 * 60 * 60 * 1000); // Archive after 24 hours
    }
  }

  /**
   * Start the background job to check for expired matches
   */
  _startExpiryChecker() {
    if (this.expiryCheckInterval) {
      clearInterval(this.expiryCheckInterval);
    }

    this.expiryCheckInterval = setInterval(async () => {
      await this._checkExpiredMatches();
    }, CONFIG.SWAP.EXPIRY_CHECK_INTERVAL_MS);

    logger.info('Swap expiry checker started', {
      intervalMs: CONFIG.SWAP.EXPIRY_CHECK_INTERVAL_MS,
    });
  }

  /**
   * Check and expire timed-out matches
   */
  async _checkExpiredMatches() {
    const expiredMatches = swapStore.getExpiredMatches();

    for (const match of expiredMatches) {
      try {
        // Expire the match in the database
        swapStore.expireMatch(match.match_id);

        // Notify in the thread if it exists
        if (match.thread_id) {
          const thread = await this.client.channels.fetch(match.thread_id).catch(() => null);
          if (thread) {
            await thread.send(swapMatcher.formatTimeoutMessage());

            // Lock and archive the thread
            try {
              await thread.setLocked(true);
              await thread.setArchived(true);
            } catch (error) {
              logger.warn('Failed to lock/archive expired thread', {
                threadId: match.thread_id,
                error: error.message,
              });
            }
          }
        }

        logger.info('Match expired and notified', { matchId: match.match_id });
      } catch (error) {
        logger.error('Error expiring match', {
          matchId: match.match_id,
          error: error.message,
        });
      }
    }

    // Also expire old requests per guild
    // Get all unique guild IDs from settings
    const guilds = [...swapStore.settings.keys()];
    for (const guildId of guilds) {
      const settings = swapStore.getSettings(guildId);
      swapStore.expireOldRequests(guildId, settings.request_expiry_days);
    }
  }

  /**
   * Notify when a request is cancelled that was part of a pending match
   */
  async notifyMatchCancelled(matchId) {
    const match = swapStore.getMatchById(matchId);
    if (!match || !match.thread_id) return;

    try {
      const thread = await this.client.channels.fetch(match.thread_id).catch(() => null);
      if (thread) {
        await thread.send(swapMatcher.formatCancelledMessage());

        try {
          await thread.setLocked(true);
          await thread.setArchived(true);
        } catch (error) {
          logger.warn('Failed to lock/archive cancelled thread', {
            threadId: match.thread_id,
            error: error.message,
          });
        }
      }
    } catch (error) {
      logger.error('Error notifying match cancellation', {
        matchId,
        error: error.message,
      });
    }
  }

  /**
   * Stop the coordinator
   */
  stop() {
    if (this.expiryCheckInterval) {
      clearInterval(this.expiryCheckInterval);
      this.expiryCheckInterval = null;
    }
    logger.info('SwapCoordinator stopped');
  }
}

export const swapCoordinator = new SwapCoordinator();
