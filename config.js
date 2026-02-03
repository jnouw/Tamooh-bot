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

  // Verification System
  VERIFY: {
    // Role assigned when user verifies
    ROLE_ID: process.env.VERIFIED_ROLE_ID || null,

    // Channel where verify embed is posted (optional, can use any channel)
    CHANNEL_ID: process.env.VERIFY_CHANNEL_ID || null,

    // Channel to log new member applications
    APPLICATION_LOG_CHANNEL_ID: process.env.APPLICATION_LOG_CHANNEL_ID || null,

    // Channel to log successful verifications
    VERIFICATION_LOG_CHANNEL_ID: process.env.VERIFICATION_LOG_CHANNEL_ID || null,

    // OAuth URL for Qimah members (optional - remove button if not set)
    OAUTH_URL: process.env.VERIFY_OAUTH_URL || null,

    // n8n webhook URL for sending verification emails
    EMAIL_WEBHOOK_URL: process.env.VERIFY_EMAIL_WEBHOOK_URL || null,

    // Allowed university email domains
    ALLOWED_EMAIL_DOMAINS: (process.env.VERIFY_ALLOWED_DOMAINS || 'stu.ksu.edu.sa').split(',').map(d => d.trim()),

    // Verification code expiry (minutes)
    CODE_EXPIRY_MINUTES: 15,

    // Rate limiting: max verification attempts per hour
    MAX_ATTEMPTS_PER_HOUR: 3,

    // Embed customization
    EMBED_TITLE: '🔐 التحقق من الحساب',
    EMBED_DESCRIPTION: 'للوصول إلى السيرفر، يجب التحقق من أنك طالب جامعي.\nVerify your university email to access the server.',
    EMBED_COLOR: 0x1E6649,  // Qimah green

    // Button labels
    BUTTON_EMAIL: '📧 التحقق بالإيميل الجامعي',
    BUTTON_QIMAH: '🔗 أنا عضو في Qimah',
    BUTTON_ENTER_CODE: '🔢 إدخال الكود',
  },

  // Section Swap Matchmaking
  SWAP: {
    // Required: Channel ID where match threads will be created
    MATCHES_CHANNEL_ID: process.env.SWAP_MATCHES_CHANNEL_ID || null,

    // Optional: Restrict /swap add to users with this role
    STUDENT_ROLE_ID: process.env.SWAP_STUDENT_ROLE_ID || null,

    // Allow 3-way swap cycles (default: false, can be changed via admin command)
    ALLOW_THREE_WAY: false,

    // Minutes before a pending match expires if not all confirmed
    CONFIRM_TIMEOUT_MINUTES: 120,

    // Days before an open request expires
    REQUEST_EXPIRY_DAYS: 7,

    // Rate limiting: milliseconds between /swap add commands per user
    ADD_COOLDOWN_MS: 30000,

    // Max open requests per user per (campus, course)
    MAX_REQUESTS_PER_USER_COURSE: 3,

    // Background job interval for checking expired matches/requests
    EXPIRY_CHECK_INTERVAL_MS: 60000,

    // Valid campus values
    VALID_CAMPUSES: ['F', 'M'],
  },

  // JTC (Join-to-Create) Voice System
  JTC: {
    // Voice channel users join to create their own room
    CREATOR_CHANNEL_ID: process.env.JTC_CREATOR_CHANNEL_ID || null,

    // Category where JTC rooms will be created
    CATEGORY_ID: process.env.JTC_CATEGORY_ID || null,

    // Text channel for the control panel (optional)
    CONTROLS_CHANNEL_ID: process.env.JTC_CONTROLS_CHANNEL_ID || null,

    // Milliseconds before deleting empty room
    EMPTY_ROOM_TIMEOUT_MS: 30000,

    // Cooldown between button clicks (ms)
    BUTTON_COOLDOWN_MS: 2000,
  },
};