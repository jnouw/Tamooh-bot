# Qimah Quiz Bot - Refactoring Documentation

## Overview

This document tracks the architectural refactoring of the qimah-quiz-bot to address critical issues identified in the codebase analysis.

**Issues Addressed:**
1. Circular dependencies between handler modules
2. ~400 lines of duplicated code in admin commands
3. In-memory session loss on bot restart
4. Global singleton coupling preventing testability
5. Hardcoded Discord IDs

---

## Phase Status

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Break Circular Dependency | ✅ Complete |
| 2 | Consolidate Admin Commands | ✅ Complete |
| 3 | Add Session Persistence | ✅ Complete |
| 4 | Fix StudyStatsStore Injection | ✅ Complete |
| 5 | Move Hardcoded IDs to Config | ⏸️ Deferred |

---

## Phase 1: Break Circular Dependency ✅

### Problem
`modalHandlers.js` and `buttonHandlers.js` both imported `advance()` from `quizHandlers.js`, creating unclear dependency flow and potential circular import issues.

### Solution
Extracted `advance()` and `showSummary()` to a dedicated module.

### Changes Made

**New File: `handlers/quizFlow.js`**
- Contains `advance()` - advances quiz to next question or summary
- Contains `showSummary()` - displays final quiz results

**Modified Files:**
- `handlers/quizHandlers.js` - Removed `advance()` and `showSummary()`, now imports from quizFlow.js
- `handlers/buttonHandlers.js` - Changed import source to quizFlow.js
- `handlers/modalHandlers.js` - Changed import source to quizFlow.js

### Dependency Flow (After)
```
quizFlow.js (advance, showSummary)
    ↑
    ├── quizHandlers.js
    ├── buttonHandlers.js
    └── modalHandlers.js
```

---

## Phase 2: Consolidate Admin Commands ✅

### Problem
~400 lines duplicated between `adminCommandHandlers.js` (message commands) and `tamoohSlashWrappers.js` (slash commands).

### Solution
Extracted shared logic to utility modules.

### Changes Made

**New File: `utils/adminUtils.js`**
- `isAdmin()` - Check if user has admin permissions
- `createProgressBar()` - Generate text-based progress bars
- `formatHour()` - Format hour for display
- `getRankStyle()` - Get rank emoji and color based on percentile
- `getCompetitiveDescription()` - Generate rank description text
- `getCompetitiveFooter()` - Generate motivational footer text
- `getNextMilestone()` - Calculate next study hour milestone

**New File: `utils/statsEmbedBuilder.js`**
- `buildUserStatsEmbed()` - Build user stats embed
- `buildServerInsightsEmbed()` - Build server insights embed
- `buildViolationsEmbed()` - Build violations report embed
- `buildResetConfirmEmbed()` - Build reset confirmation embed
- `buildResetCompleteEmbed()` - Build reset complete embed

**Modified Files:**
- `handlers/adminCommandHandlers.js` - Reduced from 499 to 226 lines (-55%)
- `handlers/tamoohSlashWrappers.js` - Reduced from 464 to 137 lines (-70%)

### Shared Function
`collectUserStatsData()` exported from `adminCommandHandlers.js` and used by both message and slash command handlers.

---

## Phase 3: Add Session Persistence ✅

### Problem
`SessionManager` stored quiz sessions in-memory only. Bot restart lost all active quizzes.

### Solution
Added SQLite persistence layer using write-through cache pattern.

### Changes Made

**New File: `services/SessionStore.js`**
- SQLite database at `data/sessions.db`
- WAL mode for better concurrent performance
- Methods: `init()`, `saveSession()`, `updateSession()`, `deleteSession()`, `loadActiveSessions()`, `getSession()`, `cleanupFinished()`, `getStats()`

**Database Schema:**
```sql
CREATE TABLE quiz_sessions (
  sid TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  items TEXT NOT NULL,          -- JSON serialized questions
  current_index INTEGER DEFAULT 0,
  score INTEGER DEFAULT 0,
  answers TEXT DEFAULT '[]',    -- JSON serialized answers
  chapter TEXT,
  finished INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_activity INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Indexes for fast lookups
CREATE INDEX idx_sessions_user_guild ON quiz_sessions(user_id, guild_id, finished);
CREATE INDEX idx_sessions_expires ON quiz_sessions(expires_at);
CREATE INDEX idx_sessions_finished ON quiz_sessions(finished, expires_at);
```

**Modified File: `services/SessionManager.js`**
- Added `init()` - Initialize persistence layer
- Added `loadPersistedSessions()` - Load sessions on startup
- Added `persistSessionUpdate()` - Persist progress changes
- Modified `createSession()` - Save to database
- Modified `finishSession()` - Update database
- Modified `_removeSessionInternal()` - Delete from database
- Graceful fallback if persistence fails (memory-only mode)

**Modified File: `index.js`**
- Added SessionManager initialization on startup
- Logs recovered session count

### Behavior
- Sessions persist across bot restarts
- In-memory cache for performance
- Automatic cleanup of expired sessions
- Fallback to memory-only if SQLite fails

---

## Phase 4: Fix StudyStatsStore Injection ✅

### Problem
`studyStatsStore` exported as singleton, directly imported in 8+ files, preventing testability and guild isolation.

### Solution
Converted to dependency injection pattern matching `SessionManager` and `ScoreStore`.

### Changes Made
- `services/StudyStatsStore.js` - Removed singleton export
- `index.js` - Instantiated StudyStatsStore and pass to handlers
- `handlers/leaderboardHandlers.js` - Accepts studyStatsStore as parameter
- `handlers/adminCommandHandlers.js` - Accepts studyStatsStore as parameter
- `handlers/tamoohSlashWrappers.js` - Accepts studyStatsStore as parameter
- `services/study/index.js` - Added `setStudyStatsStore()` for late binding
- `services/study/sessionManager.js` - Uses injected instance
- `services/study/afkChecker.js` - Uses injected instance

---

## Phase 5: Move Hardcoded IDs to Config ⏸️ (Deferred)

### Problem
Discord IDs hardcoded in `services/study/config.js`.

### Status
Deferred - may be addressed in a future refactoring cycle.

### Planned Solution (for future implementation)
Move to environment variables:
```javascript
// services/study/config.js
export const STUDY_CHANNEL_ID = process.env.STUDY_CHANNEL_ID;
export const STUDY_ROLE_ID = process.env.STUDY_ROLE_ID;
export const TAMOOH_ROLE_ID = process.env.TAMOOH_ROLE_ID;
export const OWNER_ID = process.env.OWNER_ID;
```

---

## Additional Fixes

### Timer Persistence for Session Recovery ✅

**Problem:** When sessions were recovered after bot restart, `loadPersistedSessions` reconstructed them with empty timer Maps. No timeout callbacks were scheduled, allowing users to answer timed questions after the configured limit.

**Solution:** Added timer state persistence to SessionStore.

**Changes Made:**

**Modified: `services/SessionStore.js`**
- Added `question_start_time` and `question_timer_secs` columns
- Added migration for existing databases
- Updated save/load/update methods to include timer state

**Modified: `services/SessionManager.js`**
- `startTimer()` - Persists timer metadata (start time + duration)
- `clearTimer()` - Clears persisted timer state
- `loadPersistedSessions()` - Handles expired timers on recovery
- Added `getRemainingTimerSecs()` - Calculates remaining time
- Added `_persistTimerState()` - Helper for persistence

**Modified: `services/questionService.js`**
- Added `getTimerSecs()` helper to use timer override if set
- All question types support `timerOverrideSecs` for resumed sessions

**Modified: `handlers/buttonHandlers.js`**
- `handleResumeButton()` handles three scenarios:
  1. Timer expired during restart → marks question as timed out
  2. Timer expired while waiting to resume → marks as timed out
  3. Timer still active → resumes with remaining time

---

## Verification Checklist

### Phase 1 ✅
- [ ] Run `/quiz start` - complete a quiz
- [ ] Verify MCQ answers work (buttonHandlers)
- [ ] Verify code submission works (modalHandlers)

### Phase 2 ✅
- [ ] Run `!violations` and `/tamooh violations` - compare output
- [ ] Run `!insights` and `/tamooh insights` - compare output
- [ ] Run `!reset_period` and `/tamooh reset_period` - verify both work

### Phase 3 ✅
- [ ] Start a quiz, restart the bot mid-quiz
- [ ] Verify session recovers and quiz can continue
- [ ] Check `data/sessions.db` contains session data

### Phase 4 ✅
- [ ] Run all study commands
- [ ] Verify leaderboards work
- [ ] Verify admin commands work

### Timer Persistence ✅
- [ ] Start a quiz, restart bot mid-question with active timer
- [ ] Verify timer resumes with remaining time on resume
- [ ] Verify expired timers are marked as timed out

---

## Files Summary

### New Files Created (4)
| File | Purpose |
|------|---------|
| `handlers/quizFlow.js` | Quiz progression logic |
| `utils/adminUtils.js` | Shared admin utilities |
| `utils/statsEmbedBuilder.js` | Discord embed builders |
| `services/SessionStore.js` | SQLite session persistence |

### Files Modified (12)
| File | Changes |
|------|---------|
| `handlers/quizHandlers.js` | Import from quizFlow.js |
| `handlers/buttonHandlers.js` | Import from quizFlow.js, timer resume handling |
| `handlers/modalHandlers.js` | Import from quizFlow.js |
| `handlers/adminCommandHandlers.js` | Use shared utilities (-55% lines), DI |
| `handlers/tamoohSlashWrappers.js` | Use shared utilities (-70% lines), DI |
| `handlers/leaderboardHandlers.js` | StudyStatsStore dependency injection |
| `services/SessionManager.js` | Persistence, timer state management |
| `services/SessionStore.js` | Timer columns for persistence |
| `services/StudyStatsStore.js` | Removed singleton export |
| `services/questionService.js` | Timer override support |
| `services/study/sessionManager.js` | StudyStatsStore injection |
| `services/study/afkChecker.js` | StudyStatsStore injection |
| `index.js` | Initialize persistence, instantiate StudyStatsStore |

### Files Pending Modification (Phase 5, Deferred)
- `services/study/config.js` - Move hardcoded IDs to env vars
- `.env.example` - Document new variables

---

## Rollback Strategy

Each phase is independent. If issues arise:
1. Revert the specific phase's changes via git
2. Keep working phases intact
3. Debug and retry failed phase

---

## Impact Summary

| Metric | Before | After |
|--------|--------|-------|
| Admin handler lines | 963 | 363 (-62%) |
| Circular dependencies | 1 | 0 |
| Session persistence | None | SQLite |
| Quiz recovery on restart | Lost | Recovered |
| Timer recovery on restart | Lost | Recovered |
| Singleton dependencies | 1 (StudyStatsStore) | 0 |

---

*Last updated: January 2026*
