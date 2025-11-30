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
      groupQueues: {
        25: [], // Array of user IDs for 25min queue
        50: []  // Array of user IDs for 50min queue
      },
      activeGroupSessions: {
        25: null, // { voiceChannelId, textChannelId } or null
        50: null  // { voiceChannelId, textChannelId } or null
      }
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
        const loaded = JSON.parse(raw);

        // Backward compatibility: migrate old format to new
        if (loaded.groupQueue && !loaded.groupQueues) {
          // Old format detected
          console.log('[SessionState] Migrating old state format to new multi-queue format');
          this.data = {
            sessionCounter: loaded.sessionCounter || 0,
            activeSessions: loaded.activeSessions || [],
            groupQueues: {
              25: loaded.groupQueue || [], // Migrate old queue to 25min
              50: []
            },
            activeGroupSessions: {
              25: loaded.activeGroupSession || null, // Migrate old session to 25min
              50: null
            }
          };
        } else {
          // New format
          this.data = loaded;
        }

        const totalQueued = (this.data.groupQueues[25]?.length || 0) + (this.data.groupQueues[50]?.length || 0);
        console.log(`[SessionState] Loaded state: ${this.data.activeSessions.length} sessions, ${totalQueued} queued users (${this.data.groupQueues[25]?.length || 0} in 25min, ${this.data.groupQueues[50]?.length || 0} in 50min)`);
      }
    } catch (error) {
      console.error('[SessionState] Failed to load:', error.message);
      this.data = {
        sessionCounter: 0,
        activeSessions: [],
        groupQueues: {
          25: [],
          50: []
        },
        activeGroupSessions: {
          25: null,
          50: null
        }
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
        duration: session.duration, // Save duration (25 or 50)
        startedAt: session.startedAt,
        completed: session.completed,
        phase: session.phase || "focus", // Save phase ("focus" or "break")
        pomodoroCount: session.pomodoroCount || 0, // Save pomodoro count
        username: session.username || null, // Save username for solo sessions
        mutedUsers: Array.from(session.mutedUsers || new Set()) // Save muted users list
      });
    }

    // Convert Sets to Arrays for each duration
    const groupQueues = {
      25: Array.from(state.groupQueues[25] || new Set()),
      50: Array.from(state.groupQueues[50] || new Set())
    };

    this.data = {
      sessionCounter: state.sessionCounter,
      activeSessions: sessionsArray,
      groupQueues: groupQueues,
      activeGroupSessions: state.activeGroupSessions
    };

    await this.save();
  }

  /**
   * Restore state to the in-memory state object
   * @param {Object} state - The state object from study.js
   * @returns {boolean} - True if state was restored, false if no state to restore
   */
  restoreState(state) {
    const hasActiveSessions = this.data.activeSessions.length > 0;
    const hasQueuedUsers = (this.data.groupQueues[25]?.length || 0) + (this.data.groupQueues[50]?.length || 0) > 0;
    const hasActiveGroupSessions = this.data.activeGroupSessions[25] || this.data.activeGroupSessions[50];

    if (!hasActiveSessions && !hasQueuedUsers && !hasActiveGroupSessions) {
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
        emptyTimeout: null,
        mutedUsers: new Set(sessionData.mutedUsers || []) // Restore muted users as Set
      });
    }

    // Restore group queues for each duration (convert Arrays back to Sets)
    state.groupQueues[25].clear();
    state.groupQueues[50].clear();

    for (const userId of this.data.groupQueues[25] || []) {
      state.groupQueues[25].add(userId);
    }
    for (const userId of this.data.groupQueues[50] || []) {
      state.groupQueues[50].add(userId);
    }

    // Restore active group sessions
    state.activeGroupSessions[25] = this.data.activeGroupSessions[25] || null;
    state.activeGroupSessions[50] = this.data.activeGroupSessions[50] || null;

    const totalQueued = state.groupQueues[25].size + state.groupQueues[50].size;
    console.log(`[SessionState] Restored state: ${state.activeSessions.size} sessions, ${totalQueued} queued users (${state.groupQueues[25].size} in 25min, ${state.groupQueues[50].size} in 50min)`);
    return true;
  }

  /**
   * Clear all state (used when sessions are completed)
   */
  async clearState() {
    this.data = {
      sessionCounter: 0,
      activeSessions: [],
      groupQueues: {
        25: [],
        50: []
      },
      activeGroupSessions: {
        25: null,
        50: null
      }
    };
    await this.save();
  }
}

// Export singleton instance
export const sessionStateStore = new SessionStateStore();
