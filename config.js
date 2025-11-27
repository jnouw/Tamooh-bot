export const CONFIG = {
  // Fixed question counts per mode
  QUESTION_COUNTS: {
    mcq: 8,          // 8 multiple choice questions
    finderror: 3,    // 3 find error questions
    output: 5,       // 5 output prediction questions
    code: 1          // ✅ CHANGED: Only 1 coding challenge per quiz
  },

  // Timing (seconds)
  MIN_TIME_SECONDS: 5,        // Minimum time for non-code questions
  MIN_CODE_TIME_SECONDS: 600, // ✅ CHANGED: Minimum 10 minutes for coding (600s)
  TIMERS: {
    MCQ: 30,                  // 30 seconds per MCQ (matches your questions better)
    FINDERROR: 120,           // 2 minutes total for find error (both steps combined)
    FINDERROR_STEP2: 30,      // 30 seconds for step 2 (pick error type)
    OUTPUT: 60,               // 1 minute for output prediction (matches your questions)
    CODE: 1200                // 20 minutes default for coding challenges
  },

  // Rate limiting
  RATE_LIMIT: {
    ENABLED: true,
    QUIZ_START_COOLDOWN_MS: 10000,     // 10 seconds between quiz starts
    MAX_ACTIVE_SESSIONS_PER_USER: 1,   // Only 1 active quiz per user
  },

  // Session management
  SESSION_TTL_MS: 2 * 60 * 60 * 1000,              // ✅ CHANGED: 2 hours (for longer coding sessions)
  SESSION_CLEANUP_INTERVAL_MS: 10 * 60 * 1000,     // 10 minutes cleanup check
  SESSION_REMOVAL_DELAY_MS: 30000,                 // 30 seconds after finish

  // Thread settings
  THREAD_AUTO_ARCHIVE_MINUTES: 60,
  THREAD_DELETE_ON_SUMMARY: false,  // keep threads by default
  THREAD_DELETE_DELAY_MS: 10000,    // used only if THREAD_DELETE_ON_SUMMARY is true

  // Code grading
  CODE_TIMEOUT_MS: 3000,       // Max time for code EXECUTION (3 seconds)
  MAX_CODE_LENGTH: 5000,       // Max characters in submitted code
  MAX_TEST_TIMEOUT_MS: 5000,   // Upper bound for any single test execution
  MAX_LOOPS: 10,               // Max number of loops allowed in code

  // Validation
  MAX_OUTPUT_LENGTH: 2000,     // Max output length for comparison
  MAX_LINE_NUMBER: 1000,       // Max line number in error finding
  
  // File operations
  BACKUP_SCORES: true,         // Create backups of scores.json
  MAX_BACKUP_FILES: 5,         // Keep last N backups
  ASYNC_FILE_OPS: true,        // Use async file operations

  // Health monitoring
  HEALTH_CHECK_INTERVAL_MS: 60000,  // 1 minute
  LOG_STATS: true,                   // Log periodic statistics
};