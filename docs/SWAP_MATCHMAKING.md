# Section Swap Matchmaking

A Discord bot feature to help students find classmates who want to swap sections. The system automatically matches students with compatible swap requests and creates private threads for coordination.

## Overview

The swap matchmaking system supports:
- **2-Way Swaps**: You have section A, want section B. Someone else has section B, wants section A. Perfect match!
- **3-Way Cycles** (optional): Three students form a swap cycle (A→B, B→C, C→A)

## Commands

### For Students

| Command | Description |
|---------|-------------|
| `/swap add` | Create a new swap request |
| `/swap my` | View your open swap requests |
| `/swap cancel` | Cancel one of your requests |
| `/swap help` | Show help information |

### For Admins

| Command | Description |
|---------|-------------|
| `/swap admin settings` | View or update swap settings |
| `/swap admin stats` | View swap statistics |
| `/swap admin purge_expired` | Clean up expired requests and matches |

---

## Student Guide

### Creating a Swap Request

Use `/swap add` with the following parameters:

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| `campus` | Yes | Campus code (F or M) | `F` |
| `course` | Yes | Course code | `CS101` |
| `have_section` | Yes | Your current section | `1120` |
| `want_section` | Yes | Section you want | `1132` |
| `note` | No | Optional note (e.g., availability) | `Available MWF afternoons` |

**Example:**
```
/swap add campus:F course:CS101 have_section:1120 want_section:1132 note:Available afternoons
```

### What Happens After Creating a Request

1. **Match Found**: If someone already has a matching request, you'll be notified immediately and added to a private thread.

2. **No Match Yet**: Your request is saved and will be matched when someone creates a compatible request.

### Viewing Your Requests

Use `/swap my` to see all your open swap requests with their IDs, sections, and age.

### Canceling a Request

Use `/swap cancel id:<request_id>` to cancel a request you no longer need.

---

## Confirmation Flow

When a match is found:

1. **Private Thread Created**: All participants are added to a private thread in the designated matches channel.

2. **Confirm the Swap**: Each participant must type exactly `CONFIRMED` (case-insensitive) in the thread.

3. **Time Limit**: You have **120 minutes** (default) to confirm. If not everyone confirms in time, the match is cancelled and requests are reopened.

4. **All Confirmed**: Once everyone confirms, coordinate your official add/drop with the registrar!

### Important Notes

- Type `CONFIRMED` exactly (no extra text needed)
- The bot will show progress: "User X confirmed (2/2)"
- If you can't complete the swap, let others know in the thread before the timeout

---

## Limits and Rules

| Rule | Default |
|------|---------|
| Max open requests per course | 3 |
| Request expiry | 7 days |
| Confirmation timeout | 120 minutes |
| Rate limit between requests | 30 seconds |

---

## Admin Guide

### Configuration

Set these environment variables before running the bot:

| Variable | Required | Description |
|----------|----------|-------------|
| `SWAP_MATCHES_CHANNEL_ID` | **Yes** | Channel ID where match threads will be created |
| `SWAP_STUDENT_ROLE_ID` | No | If set, only users with this role can create swap requests |

### Updating Settings

Use `/swap admin settings` to view current settings or update them:

```
/swap admin settings allow_three_way:true confirm_timeout_minutes:60 request_expiry_days:14
```

| Setting | Range | Description |
|---------|-------|-------------|
| `allow_three_way` | true/false | Enable 3-way cycle matching |
| `confirm_timeout_minutes` | 5-1440 | Minutes to confirm a match |
| `request_expiry_days` | 1-30 | Days before open requests expire |

### Viewing Statistics

Use `/swap admin stats` to see:
- Request counts by status (open, matched, cancelled, expired)
- Match counts by type and status
- Top courses with most requests

Filter by campus or course:
```
/swap admin stats campus:F course:CS101
```

### Cleaning Up

Use `/swap admin purge_expired` to manually expire old requests and timed-out matches.

---

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

This installs `better-sqlite3` for the swap database.

### 2. Configure Environment

Add to your `.env` file:
```env
# Required: Channel where match threads will be created
SWAP_MATCHES_CHANNEL_ID=1234567890123456789

# Optional: Restrict to users with this role
SWAP_STUDENT_ROLE_ID=1234567890123456789
```

### 3. Register Commands

```bash
npm run register
```

### 4. Start the Bot

```bash
npm start
```

---

## Database

The swap system uses SQLite stored in `data/swaps.db`. Tables:

- `swap_requests`: All swap requests with status tracking
- `swap_matches`: Matched groups with confirmation status
- `swap_match_participants`: Links participants to matches
- `swap_settings`: Per-guild settings

---

## Test Checklist

Use this checklist to verify the feature works correctly:

### Basic Flow
- [ ] Create a swap request (M, CS101, 1120→1132)
- [ ] View the request with `/swap my`
- [ ] Create a reciprocal request from another user to trigger 2-way match
- [ ] Verify private thread is created
- [ ] Confirm from both users and verify match completion

### Timeout Flow
- [ ] Create a matching pair
- [ ] Let the confirmation timeout expire
- [ ] Verify requests are reopened

### 3-Way Cycle (if enabled)
- [ ] Enable 3-way swaps: `/swap admin settings allow_three_way:true`
- [ ] Create three requests forming a cycle: A→B, B→C, C→A
- [ ] Verify 3-way match is created on the third request
- [ ] Confirm from all three users

### Cancellation
- [ ] Create a request and cancel it
- [ ] Verify cancelled requests don't match
- [ ] Cancel a request mid-confirmation and verify match is cancelled

---

## Troubleshooting

### "Swap matches channel not configured"
Set `SWAP_MATCHES_CHANNEL_ID` in your `.env` file.

### "You need the Student role to use this command"
Either remove `SWAP_STUDENT_ROLE_ID` from `.env` or assign the role to the user.

### Thread creation fails
Ensure the bot has:
- `Create Private Threads` permission in the matches channel
- `Send Messages in Threads` permission
- `Manage Threads` permission

### Match not found when expected
- Check both requests have the same campus and course (case-insensitive)
- Verify neither request is expired or cancelled
- Confirm both requests are from different users
