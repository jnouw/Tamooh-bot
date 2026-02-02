/**
 * JTC Session Manager
 * Manages in-memory state for JTC rooms using a two-map approach
 */

import { CONFIG } from '../../config.js';
import { logger } from '../../utils/logger.js';

/**
 * @typedef {Object} JTCRoom
 * @property {string} guildId
 * @property {string} ownerId
 * @property {string} voiceChannelId
 * @property {number} createdAt
 * @property {boolean} locked
 * @property {NodeJS.Timeout|null} emptyTimeout
 */

// Primary storage: channelId -> room object
const roomsByChannel = new Map();

// Secondary index: ownerId -> channelId
const roomsByOwner = new Map();

// Creation lock to prevent race conditions
const creatingRoom = new Set();

// Button cooldowns: userId -> lastClickTimestamp
const buttonCooldowns = new Map();

/**
 * Creates a new JTC room entry
 */
export function createRoom({ guildId, ownerId, voiceChannelId }) {
    const room = {
        guildId,
        ownerId,
        voiceChannelId,
        createdAt: Date.now(),
        locked: false,
        emptyTimeout: null,
    };

    roomsByChannel.set(voiceChannelId, room);
    roomsByOwner.set(ownerId, voiceChannelId);

    logger.info('[JTC] Created room', { channelId: voiceChannelId, ownerId });
    return room;
}

/**
 * Gets a room by channel ID
 */
export function getRoomByChannel(channelId) {
    return roomsByChannel.get(channelId);
}

/**
 * Gets a room by owner ID
 */
export function getRoomByOwner(ownerId) {
    const channelId = roomsByOwner.get(ownerId);
    if (!channelId) return undefined;
    return roomsByChannel.get(channelId);
}

/**
 * Checks if a channel is a JTC room
 */
export function isJTCRoom(channelId) {
    return roomsByChannel.has(channelId);
}

/**
 * Checks if a user owns a room
 */
export function hasRoom(ownerId) {
    return roomsByOwner.has(ownerId);
}

/**
 * Deletes a room from tracking
 */
export function deleteRoom(channelId) {
    const room = roomsByChannel.get(channelId);
    if (!room) return;

    if (room.emptyTimeout) {
        clearTimeout(room.emptyTimeout);
        room.emptyTimeout = null;
    }

    roomsByChannel.delete(channelId);
    roomsByOwner.delete(room.ownerId);

    logger.info('[JTC] Deleted room', { channelId, ownerId: room.ownerId });
}

/**
 * Updates a room's locked status
 */
export function setRoomLocked(channelId, locked) {
    const room = roomsByChannel.get(channelId);
    if (room) {
        room.locked = locked;
    }
}

/**
 * Sets an empty room timeout
 */
export function setEmptyTimeout(channelId, callback) {
    const room = roomsByChannel.get(channelId);
    if (!room) return;

    if (room.emptyTimeout) {
        clearTimeout(room.emptyTimeout);
    }

    const timeoutMs = CONFIG.JTC?.EMPTY_ROOM_TIMEOUT_MS || 30000;
    room.emptyTimeout = setTimeout(() => {
        room.emptyTimeout = null;
        callback();
    }, timeoutMs);

    logger.debug('[JTC] Started delete timer', { channelId, timeoutMs });
}

/**
 * Cancels an empty room timeout
 */
export function cancelEmptyTimeout(channelId) {
    const room = roomsByChannel.get(channelId);
    if (!room || !room.emptyTimeout) return;

    clearTimeout(room.emptyTimeout);
    room.emptyTimeout = null;

    logger.debug('[JTC] Cancelled delete timer', { channelId });
}

/**
 * Checks if a user is in the creation process
 */
export function isCreatingRoom(userId) {
    return creatingRoom.has(userId);
}

/**
 * Marks a user as in the creation process
 */
export function startCreating(userId) {
    creatingRoom.add(userId);
}

/**
 * Removes a user from the creation process
 */
export function endCreating(userId) {
    creatingRoom.delete(userId);
}

/**
 * Checks if a user is on button cooldown
 */
export function isOnCooldown(userId) {
    const last = buttonCooldowns.get(userId);
    if (!last) return false;
    const cooldownMs = CONFIG.JTC?.BUTTON_COOLDOWN_MS || 2000;
    return Date.now() - last < cooldownMs;
}

/**
 * Sets button cooldown for a user
 */
export function setCooldown(userId) {
    buttonCooldowns.set(userId, Date.now());
}

/**
 * Gets all tracked rooms
 */
export function getAllRooms() {
    return new Map(roomsByChannel);
}

/**
 * Gets room count
 */
export function getRoomCount() {
    return roomsByChannel.size;
}
