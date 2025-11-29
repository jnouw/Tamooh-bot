import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Store for persisting active study sessions and queue state
 * This allows the bot to recover sessions after a restart
 */
export class SessionStateStore {
  constructor(fileName = 'session_state.json') {
    this.dir = join(__dirname, '../data');
    this.file = join(this.dir, fileName);
    this.data = {
      sessionCounter: 0,
      activeSessions: [], // Array of session objects
      groupQueue: [], // Array of user IDs
      activeGroupSession: null // { voiceChannelId, textChannelId } or null
    };
    this.saveQueue = Promise.resolve();
    this.pendingSave = false;

    this.init();
  }

  async init() {
    try {
      await mkdir(this.dir, { recursive: true });
      await this.load();
    } catch (error) {
      console.error('[SessionState] Failed to initialize:', error.message);
    }
  }

  async load() {
    try {
      if (existsSync(this.file)) {
        const raw = await readFile(this.file, 'utf8');
        this.data = JSON.parse(raw);
        console.log(`[SessionState] Loaded state: ${this.data.activeSessions.length} sessions, ${this.data.groupQueue.length} queued users`);
      }
    } catch (error) {
      console.error('[SessionState] Failed to load:', error.message);
      this.data = {
        sessionCounter: 0,
        activeSessions: [],
        groupQueue: [],
        activeGroupSession: null
      };
    }
  }

  async save() {
    this.saveQueue = this.saveQueue.then(async () => {
      try {
        const data = JSON.stringify(this.data, null, 2);
        await writeFile(this.file, data, 'utf8');
        this.pendingSave = false;
      } catch (error) {
        console.error('[SessionState] Failed to save:', error.message);
      }
    });
    return this.saveQueue;
  }

  /**
   * Save the current state from the in-memory state object
   * @param {Object} state - The state object from study.js
   */
  async saveState(state) {
    // Convert Map to Array for JSON serialization
    const sessionsArray = [];
    for (const [voiceChannelId, session] of state.activeSessions) {
      // Don't save the timeout objects (timer, emptyTimeout) - they can't be serialized
      sessionsArray.push({
        id: session.id,
        type: session.type,
        guildId: session.guildId,
        voiceChannelId: session.voiceChannelId,
        textChannelId: session.textChannelId,
        creatorId: session.creatorId,
        startedAt: session.startedAt,
        completed: session.completed
      });
    }

    // Convert Set to Array
    const queueArray = Array.from(state.groupQueue);

    this.data = {
      sessionCounter: state.sessionCounter,
      activeSessions: sessionsArray,
      groupQueue: queueArray,
      activeGroupSession: state.activeGroupSession
    };

    await this.save();
  }

  /**
   * Restore state to the in-memory state object
   * @param {Object} state - The state object from study.js
   * @returns {boolean} - True if state was restored, false if no state to restore
   */
  restoreState(state) {
    if (this.data.activeSessions.length === 0 &&
        this.data.groupQueue.length === 0 &&
        !this.data.activeGroupSession) {
      console.log('[SessionState] No state to restore');
      return false;
    }

    // Restore session counter
    state.sessionCounter = this.data.sessionCounter;

    // Restore active sessions (convert Array back to Map)
    state.activeSessions.clear();
    for (const sessionData of this.data.activeSessions) {
      // Add the session to the map with null timers (will be restarted by recovery logic)
      state.activeSessions.set(sessionData.voiceChannelId, {
        ...sessionData,
        timer: null,
        emptyTimeout: null
      });
    }

    // Restore group queue (convert Array back to Set)
    state.groupQueue.clear();
    for (const userId of this.data.groupQueue) {
      state.groupQueue.add(userId);
    }

    // Restore active group session
    state.activeGroupSession = this.data.activeGroupSession;

    console.log(`[SessionState] Restored state: ${state.activeSessions.size} sessions, ${state.groupQueue.size} queued users`);
    return true;
  }

  /**
   * Clear all state (used when sessions are completed)
   */
  async clearState() {
    this.data = {
      sessionCounter: 0,
      activeSessions: [],
      groupQueue: [],
      activeGroupSession: null
    };
    await this.save();
  }
}

// Export singleton instance
export const sessionStateStore = new SessionStateStore();
