# Qimah Quiz Bot

A Discord bot for running interactive quizzes and managing study sessions for the Qimah community.

## Features

- **Quiz System**: Multiple quiz modes (MCQ, find-the-error, output prediction, coding challenges)
- **Session Persistence**: Quiz sessions survive bot restarts via SQLite
- **Study Tracking**: Track study hours with AFK detection and gaming activity monitoring
- **Leaderboards**: Competitive rankings with period-based giveaway tickets
- **Section Swap**: Matchmaking system for section exchanges

## Requirements

- Node.js 18+
- Discord Bot Token

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and configure:
   ```bash
   cp .env.example .env
   ```
4. Register slash commands:
   ```bash
   npm run register
   ```
5. Start the bot:
   ```bash
   npm start
   ```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | Yes | Bot token from Discord Developer Portal |
| `CLIENT_ID` | Yes | Application client ID |
| `QIMAH_GUILD_ID` | Yes | Target server ID |
| `STUDY_CHANNEL_ID` | No | Study session channel (has default) |
| `STUDY_LOG_CHANNEL_ID` | No | Study log channel (has default) |
| `VOICE_CATEGORY_ID` | No | Voice channel category (has default) |
| `STUDY_ROLE_ID` | No | Study role ID (has default) |
| `TAMOOH_ROLE_ID` | No | Tamooh role ID (has default) |
| `OWNER_ID` | No | Bot owner user ID (has default) |
| `QIMAH_TEAM_ROLE_ID` | No | Team role ID (has default) |
| `SWAP_MATCHES_CHANNEL_ID` | No | Section swap matches channel |

## Project Structure

```
qimah-quiz-bot/
├── index.js              # Entry point
├── config.js             # Bot configuration
├── handlers/             # Event and interaction handlers
│   ├── quizHandlers.js   # Quiz command handlers
│   ├── quizFlow.js       # Quiz progression logic
│   ├── buttonHandlers.js # Button interaction handlers
│   ├── modalHandlers.js  # Modal submission handlers
│   └── ...
├── services/             # Business logic
│   ├── SessionManager.js # Quiz session management
│   ├── SessionStore.js   # SQLite persistence layer
│   ├── ScoreStore.js     # Score persistence
│   ├── StudyStatsStore.js# Study statistics
│   └── study/            # Study system modules
├── utils/                # Shared utilities
│   ├── adminUtils.js     # Admin helper functions
│   └── statsEmbedBuilder.js # Discord embed builders
├── questions/            # Quiz question banks
└── data/                 # SQLite databases (auto-created)
```

## Architecture

The bot uses dependency injection for testability:

- **SessionManager**: Manages quiz sessions with in-memory cache + SQLite persistence
- **StudyStatsStore**: Tracks study hours and statistics
- **ScoreStore**: Persists quiz scores

Key design decisions:
- Write-through caching for session persistence
- Timer state persisted for crash recovery
- All Discord IDs configurable via environment variables

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start the bot |
| `npm run dev` | Start with file watching |
| `npm run register` | Register slash commands |
| `npm run check` | Verify setup configuration |

## Version History

- **v2.3.0** - Architectural refactoring (session persistence, DI, env config)
- **v2.2.0** - Section swap matchmaking
- **v2.0.0** - Fair play update (period-based tickets, AFK detection)

## License

Private - Qimah Community
