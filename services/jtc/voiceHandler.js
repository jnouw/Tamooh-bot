/**
 * JTC Voice State Handler
 * Handles VoiceStateUpdate events for the JTC system
 */

import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { CONFIG } from '../../config.js';
import { logger } from '../../utils/logger.js';
import {
    createRoom,
    deleteRoom,
    getRoomByOwner,
    hasRoom,
    isJTCRoom,
    isCreatingRoom,
    startCreating,
    endCreating,
    setEmptyTimeout,
    cancelEmptyTimeout,
} from './sessionManager.js';

/**
 * Main voice state update handler
 */
export async function handleVoiceStateUpdate(oldState, newState) {
    // Skip if JTC not configured
    if (!CONFIG.JTC?.CREATOR_CHANNEL_ID) return;

    const userId = newState.member?.id || oldState.member?.id;
    if (!userId) return;

    // Ignore bots
    if (newState.member?.user?.bot || oldState.member?.user?.bot) return;

    const oldChannelId = oldState.channelId;
    const newChannelId = newState.channelId;

    // Case 1: User joined a channel
    if (!oldChannelId && newChannelId) {
        await handleJoin(newState, newChannelId);
        return;
    }

    // Case 2: User left a channel
    if (oldChannelId && !newChannelId) {
        await handleLeave(oldState, oldChannelId);
        return;
    }

    // Case 3: User moved between channels
    if (oldChannelId && newChannelId && oldChannelId !== newChannelId) {
        await handleLeave(oldState, oldChannelId);
        await handleJoin(newState, newChannelId);
        return;
    }
}

async function handleJoin(state, channelId) {
    // Joined the creator channel
    if (channelId === CONFIG.JTC.CREATOR_CHANNEL_ID) {
        await handleJoinCreator(state);
        return;
    }

    // Joined a JTC room - cancel delete timer
    if (isJTCRoom(channelId)) {
        cancelEmptyTimeout(channelId);
    }
}

async function handleLeave(state, channelId) {
    if (isJTCRoom(channelId)) {
        await handleLeaveRoom(state, channelId);
    }
}

async function handleJoinCreator(state) {
    const member = state.member;
    const userId = member.id;
    const guild = state.guild;

    // Check if user already owns a room
    if (hasRoom(userId)) {
        const existingRoom = getRoomByOwner(userId);
        if (existingRoom) {
            // Verify the channel still exists before trying to move user
            const existingChannel = guild.channels.cache.get(existingRoom.voiceChannelId);
            if (existingChannel) {
                try {
                    await member.voice.setChannel(existingRoom.voiceChannelId);
                    cancelEmptyTimeout(existingRoom.voiceChannelId);
                    logger.info('[JTC] Moved user to existing room', { userId, channelId: existingRoom.voiceChannelId });
                    return;
                } catch (error) {
                    logger.error('[JTC] Failed to move user to existing room', { error: error.message });
                    // Channel may have been deleted, clean up stale entry
                    deleteRoom(existingRoom.voiceChannelId);
                    logger.info('[JTC] Cleaned up stale room entry', { userId, channelId: existingRoom.voiceChannelId });
                }
            } else {
                // Channel was deleted externally, clean up stale entry
                deleteRoom(existingRoom.voiceChannelId);
                logger.info('[JTC] Cleaned up stale room entry (channel not found)', { userId, channelId: existingRoom.voiceChannelId });
            }
            // Continue to create a new room for the user
        }
    }

    // Prevent race condition
    if (isCreatingRoom(userId)) {
        logger.debug('[JTC] Ignoring duplicate create request', { userId });
        return;
    }

    startCreating(userId);

    try {
        // Check category capacity
        const category = guild.channels.cache.get(CONFIG.JTC.CATEGORY_ID);
        if (category && category.children.cache.size >= 50) {
            logger.warn('[JTC] Category full, disconnecting user', { userId });
            // Disconnect user since we can't create a room
            try {
                await member.voice.disconnect('JTC category full');
            } catch (disconnectError) {
                logger.error('[JTC] Failed to disconnect user from full category', { error: disconnectError.message });
            }
            return;
        }

        // Create the voice channel
        const displayName = member.displayName || member.user.username;
        const channelName = `${displayName}'s Room`;

        const voiceChannel = await guild.channels.create({
            name: channelName.slice(0, 100),
            type: ChannelType.GuildVoice,
            parent: CONFIG.JTC.CATEGORY_ID,
            permissionOverwrites: [
                {
                    id: guild.id,
                    allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak],
                },
                {
                    id: userId,
                    allow: [PermissionFlagsBits.Connect],
                },
            ],
        });

        logger.info('[JTC] Created room', { channelName, userId });

        createRoom({
            guildId: guild.id,
            ownerId: userId,
            voiceChannelId: voiceChannel.id,
        });

        // Move user to the new room
        try {
            await member.voice.setChannel(voiceChannel.id);
        } catch (moveError) {
            logger.error('[JTC] Failed to move user, cleaning up', { error: moveError.message });
            await voiceChannel.delete('JTC room creation failed').catch(() => {});
            deleteRoom(voiceChannel.id);
        }
    } catch (error) {
        logger.error('[JTC] Failed to create room', { error: error.message, userId });
    } finally {
        endCreating(userId);
    }
}

async function handleLeaveRoom(state, channelId) {
    const channel = state.guild.channels.cache.get(channelId);
    if (!channel) {
        deleteRoom(channelId);
        return;
    }

    const humanCount = channel.members.filter(m => !m.user.bot).size;

    if (humanCount === 0) {
        setEmptyTimeout(channelId, async () => {
            const currentChannel = state.guild.channels.cache.get(channelId);
            if (!currentChannel) {
                deleteRoom(channelId);
                return;
            }

            const currentHumanCount = currentChannel.members.filter(m => !m.user.bot).size;
            if (currentHumanCount === 0) {
                try {
                    await currentChannel.delete('JTC room empty timeout');
                    logger.info('[JTC] Deleted empty room', { channelId });
                } catch (error) {
                    logger.error('[JTC] Failed to delete empty room', { error: error.message });
                }
                deleteRoom(channelId);
            }
        });
    }
}

/**
 * Cleans up orphaned JTC channels on bot startup
 */
export async function cleanupOrphanedChannels(client) {
    if (!CONFIG.JTC?.CATEGORY_ID) return;

    const category = client.channels.cache.get(CONFIG.JTC.CATEGORY_ID);
    if (!category) {
        logger.warn('[JTC] Category not found, skipping orphan cleanup');
        return;
    }

    let cleanedCount = 0;
    let reregisteredCount = 0;

    for (const [channelId, channel] of category.children.cache) {
        if (channel.type !== ChannelType.GuildVoice) continue;
        if (channelId === CONFIG.JTC.CREATOR_CHANNEL_ID) continue;

        // Only consider untracked channels that look like JTC rooms (end with "'s Room")
        // This prevents accidentally deleting manually-created voice channels
        if (!isJTCRoom(channelId) && channel.name.endsWith("'s Room")) {
            const humanMembers = channel.members.filter(m => !m.user.bot);
            const memberCount = humanMembers.size;

            if (memberCount === 0) {
                try {
                    await channel.delete('Orphaned JTC channel cleanup');
                    logger.info('[JTC] Deleted orphaned channel', { channelName: channel.name });
                    cleanedCount++;
                } catch (error) {
                    logger.error('[JTC] Failed to delete orphaned channel', { error: error.message });
                }
            } else {
                // Re-register non-empty orphaned rooms so they get properly tracked
                // Pick first member who doesn't already own a room as the new owner
                let newOwner = null;
                for (const [memberId] of humanMembers) {
                    if (!hasRoom(memberId)) {
                        newOwner = memberId;
                        break;
                    }
                }

                if (newOwner) {
                    createRoom({
                        guildId: channel.guild.id,
                        ownerId: newOwner,
                        voiceChannelId: channelId,
                    });
                    reregisteredCount++;
                    logger.info('[JTC] Re-registered orphaned room', {
                        channelName: channel.name,
                        newOwnerId: newOwner,
                        memberCount
                    });
                } else {
                    // All members already own rooms - just log it
                    // Room will become a true orphan when they all leave
                    logger.warn('[JTC] Orphaned room with no adoptable owner', {
                        channelName: channel.name,
                        memberCount
                    });
                }
            }
        }
    }

    if (cleanedCount > 0 || reregisteredCount > 0) {
        logger.info('[JTC] Orphan cleanup complete', { deleted: cleanedCount, reregistered: reregisteredCount });
    }
}
