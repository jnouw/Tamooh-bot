# Qimah Quiz Bot (Tamooh Bot)

A Discord bot for the Qimah student community at KSU.

## Project Location
`/opt/qimah/Discord/qimah-quiz-bot`

## Tech Stack
- **Runtime:** Node.js with ES Modules
- **Framework:** discord.js v14
- **Database:** SQLite (better-sqlite3)
- **Config:** dotenv for environment variables

## Key Systems

### Quiz System
- MCQ, Find Error, Predict Output, Coding challenges
- Located in `handlers/quiz*.js` and `services/quiz/`

### Study System (Tamooh)
- Pomodoro sessions, voice tracking, giveaways
- Located in `services/study/`
- Stats stored in SQLite via `StudyStatsStore.js`

### Verification System
- Email verification with n8n webhooks
- Located in `handlers/verifyHandlers.js` and `services/VerificationStore.js`

### JTC (Join-to-Create) Voice Rooms
- Dynamic voice channel creation
- Located in `services/jtc/`

### Section Swap Matchmaking
- Student section swap coordination
- Located in `handlers/swapHandlers.js` and `services/swap/`

## Important Files
- `config.js` - All configuration constants
- `index.js` - Main entry point, event routing
- `register-commands.js` - Slash command registration

## Conventions
- Bilingual UI (Arabic/English) for user-facing messages
- Use `logger` from `utils/logger.js` for logging
- Admin checks via `isAdmin()` from `utils/adminUtils.js`
- Role IDs in `services/study/config.js` or main `config.js`

## Environment Variables
See `.env.example` for required variables.

## Commands
- `npm start` - Run the bot
- `node register-commands.js` - Register slash commands
