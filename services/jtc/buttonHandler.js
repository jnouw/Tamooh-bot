/**
 * JTC Button, Modal, and Select Menu Handlers
 */

import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    EmbedBuilder,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import {
    getRoomByOwner,
    deleteRoom,
    setRoomLocked,
    isOnCooldown,
    setCooldown,
} from './sessionManager.js';

// Button IDs
export const JTC_BUTTON_IDS = {
    LOCK: 'jtc_lock',
    UNLOCK: 'jtc_unlock',
    SET_LIMIT: 'jtc_set_limit',
    RENAME: 'jtc_rename',
    KICK: 'jtc_kick',
    END_ROOM: 'jtc_end_room',
    CONFIRM_END: 'jtc_confirm_end',
    CANCEL_END: 'jtc_cancel_end',
};

// Modal IDs
export const JTC_MODAL_IDS = {
    SET_LIMIT: 'jtc_modal_set_limit',
    RENAME: 'jtc_modal_rename',
};

// Select Menu IDs
export const JTC_SELECT_IDS = {
    KICK_USER: 'jtc_select_kick',
};

/**
 * Handles button interactions
 */
export async function handleJTCButton(interaction) {
    const { customId } = interaction;

    // Check cooldown
    if (isOnCooldown(interaction.user.id)) {
        return interaction.reply({
            content: '> Please wait a moment before clicking again.',
            ephemeral: true,
        });
    }
    setCooldown(interaction.user.id);

    switch (customId) {
        case JTC_BUTTON_IDS.LOCK:
            return handleLockRoom(interaction);
        case JTC_BUTTON_IDS.UNLOCK:
            return handleUnlockRoom(interaction);
        case JTC_BUTTON_IDS.SET_LIMIT:
            return showSetLimitModal(interaction);
        case JTC_BUTTON_IDS.RENAME:
            return showRenameModal(interaction);
        case JTC_BUTTON_IDS.KICK:
            return showKickMenu(interaction);
        case JTC_BUTTON_IDS.END_ROOM:
            return showEndConfirmation(interaction);
        case JTC_BUTTON_IDS.CONFIRM_END:
            return handleConfirmEnd(interaction);
        case JTC_BUTTON_IDS.CANCEL_END:
            return handleCancelEnd(interaction);
    }
}

/**
 * Handles modal submissions
 */
export async function handleJTCModal(interaction) {
    const { customId } = interaction;

    switch (customId) {
        case JTC_MODAL_IDS.SET_LIMIT:
            return handleSetLimitSubmit(interaction);
        case JTC_MODAL_IDS.RENAME:
            return handleRenameSubmit(interaction);
    }
}

/**
 * Handles select menu interactions
 */
export async function handleJTCSelectMenu(interaction) {
    const { customId } = interaction;

    if (customId === JTC_SELECT_IDS.KICK_USER) {
        return handleKickUserSelect(interaction);
    }
}

// Helper to get user's room and channel
async function getUserRoomAndChannel(interaction) {
    const room = getRoomByOwner(interaction.user.id);

    if (!room) {
        await interaction.reply({
            content: "> You don't have a room. Join **+ Create Room** first!",
            ephemeral: true,
        });
        return null;
    }

    const channel = interaction.guild.channels.cache.get(room.voiceChannelId);

    if (!channel) {
        deleteRoom(room.voiceChannelId);
        await interaction.reply({
            content: '> Your room no longer exists.',
            ephemeral: true,
        });
        return null;
    }

    return { room, channel };
}

// ============ Button Handlers ============

async function handleLockRoom(interaction) {
    const result = await getUserRoomAndChannel(interaction);
    if (!result) return;

    const { room, channel } = result;

    if (room.locked) {
        return interaction.reply({
            content: '> Your room is already locked.',
            ephemeral: true,
        });
    }

    try {
        await channel.permissionOverwrites.edit(interaction.guild.id, {
            Connect: false,
        });
        setRoomLocked(room.voiceChannelId, true);

        await interaction.reply({
            content: '> Room locked. New members cannot join.',
            ephemeral: true,
        });
    } catch (error) {
        logger.error('[JTC] Failed to lock room', { error: error.message });
        await interaction.reply({
            content: '> Failed to lock room. Please try again.',
            ephemeral: true,
        });
    }
}

async function handleUnlockRoom(interaction) {
    const result = await getUserRoomAndChannel(interaction);
    if (!result) return;

    const { room, channel } = result;

    if (!room.locked) {
        return interaction.reply({
            content: '> Your room is already unlocked.',
            ephemeral: true,
        });
    }

    try {
        await channel.permissionOverwrites.edit(interaction.guild.id, {
            Connect: true,
        });
        setRoomLocked(room.voiceChannelId, false);

        await interaction.reply({
            content: '> Room unlocked. Anyone can join now.',
            ephemeral: true,
        });
    } catch (error) {
        logger.error('[JTC] Failed to unlock room', { error: error.message });
        await interaction.reply({
            content: '> Failed to unlock room. Please try again.',
            ephemeral: true,
        });
    }
}

async function showSetLimitModal(interaction) {
    const result = await getUserRoomAndChannel(interaction);
    if (!result) return;

    const { channel } = result;

    const modal = new ModalBuilder()
        .setCustomId(JTC_MODAL_IDS.SET_LIMIT)
        .setTitle('Set User Limit');

    const limitInput = new TextInputBuilder()
        .setCustomId('limit')
        .setLabel('User limit (0 for unlimited, max 99)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(String(channel.userLimit || 0))
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(2);

    modal.addComponents(new ActionRowBuilder().addComponents(limitInput));
    await interaction.showModal(modal);
}

async function showRenameModal(interaction) {
    const result = await getUserRoomAndChannel(interaction);
    if (!result) return;

    const { channel } = result;

    const modal = new ModalBuilder()
        .setCustomId(JTC_MODAL_IDS.RENAME)
        .setTitle('Rename Your Room');

    const nameInput = new TextInputBuilder()
        .setCustomId('name')
        .setLabel('New room name (max 100 characters)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(channel.name)
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(100);

    modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
    await interaction.showModal(modal);
}

async function showKickMenu(interaction) {
    const result = await getUserRoomAndChannel(interaction);
    if (!result) return;

    const { channel } = result;

    const members = channel.members.filter(
        m => !m.user.bot && m.id !== interaction.user.id
    );

    if (members.size === 0) {
        return interaction.reply({
            content: '> No one to kick from your room.',
            ephemeral: true,
        });
    }

    const options = members.map(member => ({
        label: member.displayName,
        description: member.user.tag,
        value: member.id,
    }));

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(JTC_SELECT_IDS.KICK_USER)
        .setPlaceholder('Select a user to kick')
        .addOptions(options.slice(0, 25));

    await interaction.reply({
        content: '> Select a user to kick from your room:',
        components: [new ActionRowBuilder().addComponents(selectMenu)],
        ephemeral: true,
    });
}

async function showEndConfirmation(interaction) {
    const result = await getUserRoomAndChannel(interaction);
    if (!result) return;

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(JTC_BUTTON_IDS.CONFIRM_END)
            .setLabel('Yes, Delete')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(JTC_BUTTON_IDS.CANCEL_END)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
        content: '> **Are you sure you want to delete your room?**\n> Everyone will be disconnected.',
        components: [row],
        ephemeral: true,
    });
}

async function handleConfirmEnd(interaction) {
    const result = await getUserRoomAndChannel(interaction);
    if (!result) return;

    const { room, channel } = result;

    try {
        await channel.delete('Owner ended room');
        deleteRoom(room.voiceChannelId);

        await interaction.update({
            content: '> Room deleted.',
            components: [],
        });
    } catch (error) {
        logger.error('[JTC] Failed to delete room', { error: error.message });
        await interaction.update({
            content: '> Failed to delete room. Please try again.',
            components: [],
        });
    }
}

async function handleCancelEnd(interaction) {
    await interaction.update({
        content: '> Cancelled.',
        components: [],
    });
}

// ============ Modal Handlers ============

async function handleSetLimitSubmit(interaction) {
    const result = await getUserRoomAndChannel(interaction);
    if (!result) return;

    const { channel } = result;
    const limitStr = interaction.fields.getTextInputValue('limit');
    const limit = parseInt(limitStr, 10);

    if (isNaN(limit) || limit < 0 || limit > 99) {
        return interaction.reply({
            content: '> Invalid limit. Please enter a number between 0 and 99.',
            ephemeral: true,
        });
    }

    try {
        await channel.setUserLimit(limit);
        const message = limit === 0
            ? '> User limit removed (unlimited).'
            : `> User limit set to ${limit}.`;

        await interaction.reply({ content: message, ephemeral: true });
    } catch (error) {
        logger.error('[JTC] Failed to set limit', { error: error.message });
        await interaction.reply({
            content: '> Failed to set user limit. Please try again.',
            ephemeral: true,
        });
    }
}

async function handleRenameSubmit(interaction) {
    const result = await getUserRoomAndChannel(interaction);
    if (!result) return;

    const { channel } = result;
    const newName = interaction.fields.getTextInputValue('name').trim();

    if (!newName) {
        return interaction.reply({
            content: '> Please enter a valid name.',
            ephemeral: true,
        });
    }

    try {
        await channel.setName(newName.slice(0, 100));
        await interaction.reply({
            content: `> Renamed to **${newName}**.`,
            ephemeral: true,
        });
    } catch (error) {
        if (error.message?.includes('rate')) {
            return interaction.reply({
                content: '> Too many renames. Discord limits to 2 per 10 minutes. Try again later.',
                ephemeral: true,
            });
        }
        logger.error('[JTC] Failed to rename', { error: error.message });
        await interaction.reply({
            content: '> Failed to rename room. Please try again.',
            ephemeral: true,
        });
    }
}

// ============ Select Menu Handlers ============

async function handleKickUserSelect(interaction) {
    const result = await getUserRoomAndChannel(interaction);
    if (!result) return;

    const { channel } = result;
    const targetId = interaction.values[0];
    const targetMember = channel.members.get(targetId);

    if (!targetMember) {
        return interaction.update({
            content: '> User is no longer in your room.',
            components: [],
        });
    }

    try {
        await targetMember.voice.disconnect('Kicked by room owner');
        await interaction.update({
            content: `> Kicked **${targetMember.displayName}** from your room.`,
            components: [],
        });
    } catch (error) {
        logger.error('[JTC] Failed to kick user', { error: error.message });
        await interaction.update({
            content: '> Failed to kick user. Please try again.',
            components: [],
        });
    }
}

// ============ Control Panel Builder ============

export function buildControlPanel() {
    const embed = new EmbedBuilder()
        .setTitle('Voice Room Controls')
        .setDescription(
            '**Create a Room**\n' +
            'Join **+ Create Room** to get your own voice channel instantly.\n\n' +
            '**Manage Your Room**\n' +
            'Use the buttons below. Only works if you have an active room.\n\n' +
            '**Auto-Cleanup**\n' +
            'Rooms delete automatically 30s after everyone leaves.'
        )
        .setColor(0x5865F2);

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(JTC_BUTTON_IDS.LOCK)
            .setLabel('Lock')
            .setEmoji('🔒')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(JTC_BUTTON_IDS.UNLOCK)
            .setLabel('Unlock')
            .setEmoji('🔓')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(JTC_BUTTON_IDS.SET_LIMIT)
            .setLabel('Set Limit')
            .setEmoji('👥')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(JTC_BUTTON_IDS.RENAME)
            .setLabel('Rename')
            .setEmoji('✏️')
            .setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(JTC_BUTTON_IDS.KICK)
            .setLabel('Kick User')
            .setEmoji('🚫')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(JTC_BUTTON_IDS.END_ROOM)
            .setLabel('End Room')
            .setEmoji('🧹')
            .setStyle(ButtonStyle.Danger)
    );

    return { embed, components: [row1, row2] };
}
