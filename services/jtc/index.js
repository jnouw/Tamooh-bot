/**
 * JTC (Join-to-Create) System
 * Provides dynamic voice room creation
 */

import { Events } from 'discord.js';
import { CONFIG } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { handleVoiceStateUpdate, cleanupOrphanedChannels } from './voiceHandler.js';
import { handleJTCButton, handleJTCModal, handleJTCSelectMenu, buildControlPanel, JTC_BUTTON_IDS, JTC_MODAL_IDS, JTC_SELECT_IDS } from './buttonHandler.js';

/**
 * Sets up the JTC system on a Discord client
 */
export function setupJTCSystem(client) {
    // Validate configuration
    if (!CONFIG.JTC?.CREATOR_CHANNEL_ID || !CONFIG.JTC?.CATEGORY_ID) {
        logger.warn('[JTC] Missing configuration, system disabled');
        console.log('[JTC] System disabled - set JTC config in config.js');
        return;
    }

    logger.info('[JTC] Setting up Join-to-Create system');

    // Register voice state handler
    client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
        try {
            await handleVoiceStateUpdate(oldState, newState);
        } catch (error) {
            logger.error('[JTC] Voice state error', { error: error.message });
        }
    });

    // Cleanup orphaned channels on ready
    client.once(Events.ClientReady, async () => {
        logger.info('[JTC] Bot ready, cleaning up orphans');
        await cleanupOrphanedChannels(client);
        logger.info('[JTC] System ready');
        console.log('[JTC] Join-to-Create system ready');
    });
}

/**
 * Checks if an interaction is JTC-related
 */
export function isJTCInteraction(interaction) {
    if (interaction.isButton()) {
        return Object.values(JTC_BUTTON_IDS).includes(interaction.customId);
    }
    if (interaction.isModalSubmit()) {
        return Object.values(JTC_MODAL_IDS).includes(interaction.customId);
    }
    if (interaction.isStringSelectMenu()) {
        return Object.values(JTC_SELECT_IDS).includes(interaction.customId);
    }
    return false;
}

/**
 * Routes JTC interactions to appropriate handlers
 */
export async function handleJTCInteraction(interaction) {
    if (interaction.isButton()) {
        return handleJTCButton(interaction);
    }
    if (interaction.isModalSubmit()) {
        return handleJTCModal(interaction);
    }
    if (interaction.isStringSelectMenu()) {
        return handleJTCSelectMenu(interaction);
    }
}

/**
 * Posts the JTC control panel
 */
export async function postJTCControlPanel(client, channelId) {
    const channel = client.channels.cache.get(channelId || CONFIG.JTC?.CONTROLS_CHANNEL_ID);
    if (!channel) {
        throw new Error('Control panel channel not found');
    }

    const { embed, components } = buildControlPanel();
    const message = await channel.send({ embeds: [embed], components });
    logger.info('[JTC] Posted control panel', { messageId: message.id });
    return message;
}

export { buildControlPanel } from './buttonHandler.js';
