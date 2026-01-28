# n8n Verification Workflows Setup

This document explains how to set up the Discord verification workflows in n8n.

## Overview

The verification system supports two methods:

### Method 1: University Email Verification (Primary)
For all university students - verifies via university email address.

**Flow:**
```
User clicks "التحقق بالإيميل الجامعي" in Discord
         ↓
Modal appears for email + name input
         ↓
Discord bot sends webhook to n8n
         ↓
n8n sends verification email with 6-digit code
         ↓
User clicks "إدخال الكود" and enters code
         ↓
Bot verifies code and assigns role
```

### Method 2: Qimah OAuth (Optional)
For existing Qimah members - verifies via Qimah website OAuth.

**Flow:**
```
User clicks "أنا عضو في Qimah" in Discord
         ↓
Opens qimah.net/my-account/?action=qimah-discord-connect
         ↓
User logs in and connects Discord via OAuth
         ↓
qimah-profile sends webhook to n8n
         ↓
n8n verifies signature and assigns role
         ↓
User receives DM confirmation
```

## Prerequisites

1. **n8n** running and accessible at `hooks.qimah.net`
2. **Discord Bot** with `Manage Roles` permission
3. **SMTP credentials** for sending verification emails
4. **qimah-profile** WordPress plugin (optional, for Qimah OAuth method)

---

## Email Verification Workflow Setup

### Step 1: Import the Email Workflow

1. Open n8n at `https://qimah-299.tail0e7957.ts.net` (or your n8n URL)
2. Go to **Workflows** → **Import from File**
3. Select `email-verification-workflow.json` from this folder
4. Click **Import**

### Step 2: Configure SMTP Credentials

1. In n8n, go to **Settings** → **Credentials**
2. Create a new **SMTP** credential:
   - **Host**: Your SMTP server (e.g., `smtp.gmail.com`, `smtp.sendgrid.net`)
   - **Port**: 587 (TLS) or 465 (SSL)
   - **User**: Your SMTP username
   - **Password**: Your SMTP password or app password
   - **SSL/TLS**: Enable based on your provider
3. Update the "Send Verification Email" node to use this credential

### Step 3: Customize Email Template (Optional)

The workflow includes a bilingual (Arabic/English) HTML email template. To customize:
1. Open the workflow
2. Click on the "Send Verification Email" node
3. Edit the HTML template as needed
4. The template uses these variables:
   - `{{ $json.body.name }}` - User's name
   - `{{ $json.body.email }}` - User's email
   - `{{ $json.body.code }}` - 6-digit verification code
   - `{{ $json.body.discord_username }}` - Discord username

### Step 4: Activate the Workflow

1. Open the imported workflow
2. Click **Activate** (toggle in top-right)
3. Note the webhook URL: `https://hooks.qimah.net/webhook/send-verification-email`

### Step 5: Configure the Discord Bot

Add these to your `.env` file:

```bash
# Verification System
VERIFIED_ROLE_ID=your_verified_role_id
VERIFY_CHANNEL_ID=your_verify_channel_id
APPLICATION_LOG_CHANNEL_ID=your_log_channel_id
VERIFICATION_LOG_CHANNEL_ID=your_verification_log_channel_id

# Email verification webhook (n8n)
VERIFY_EMAIL_WEBHOOK_URL=https://hooks.qimah.net/webhook/send-verification-email

# Allowed email domains (comma-separated)
VERIFY_ALLOWED_DOMAINS=stu.ksu.edu.sa

# Optional: Qimah OAuth URL (remove to disable Qimah member button)
VERIFY_OAUTH_URL=https://qimah.net/my-account/?action=qimah-discord-connect
```

Then re-register commands:
```bash
npm run register
```

---

## Qimah OAuth Workflow Setup (Optional)

If you want to allow Qimah members to verify via OAuth:

### Step 1: Import the OAuth Workflow

1. Go to **Workflows** → **Import from File**
2. Select `discord-verification-workflow.json` from this folder
3. Click **Import**

### Step 2: Configure n8n Environment Variables

In n8n, go to **Settings** → **Environment Variables** and add:

| Variable | Value | Description |
|----------|-------|-------------|
| `QIMAH_WEBHOOK_SECRET` | `your-secret-here` | HMAC secret for signature verification |
| `DISCORD_GUILD_ID` | `1293617158747590656` | Qimah Discord server ID |
| `DISCORD_VERIFIED_ROLE_ID` | `your-role-id` | Role to assign when verified |

### Step 3: Configure Discord Bot Credentials

1. In n8n, go to **Settings** → **Credentials**
2. Create a new **Discord Bot API** credential:
   - **Bot Token**: Your Discord bot token
3. Update the workflow nodes to use this credential:
   - "Assign Verified Role"
   - "Create DM Channel"
   - "Send Verification DM"

### Step 4: Activate the Workflow

1. Open the imported workflow
2. Click **Activate** (toggle in top-right)
3. Note the webhook URL: `https://hooks.qimah.net/webhook/discord-connected`

### Step 5: Configure qimah-profile Webhook

In WordPress admin:

1. Go to **Qimah Profile** → **Webhooks**
2. Create a new webhook subscription:
   - **URL**: `https://hooks.qimah.net/webhook/discord-connected`
   - **Events**: `discord.connected`
   - **Secret**: Same value as `QIMAH_WEBHOOK_SECRET` in n8n

---

## Post the Verify Embed

In Discord, use the admin command:
```
/verify-setup
```

This posts a persistent embed with:
- **"التحقق بالإيميل الجامعي"** - Email verification button
- **"أنا عضو في Qimah"** - Qimah OAuth link (only if `VERIFY_OAUTH_URL` is set)
- **"إدخال الكود"** - Enter code button (for users who already received email)

---

## Testing

### Test Email Verification

1. Click the email verification button in the embed
2. Enter a valid university email and your name
3. Check your email for the verification code
4. Click "إدخال الكود" and enter the 6-digit code
5. Verify the role is assigned

### Test the Email Webhook Directly

```bash
curl -X POST https://hooks.qimah.net/webhook/send-verification-email \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@stu.ksu.edu.sa",
    "name": "Test User",
    "code": "123456",
    "discord_id": "123456789",
    "discord_username": "testuser#1234"
  }'
```

### Verify Commands Work

1. `/verify-setup` - Should post embed (admin only)
2. `/verify-check` - Should show verification status
3. `/verify-check @user` - Should check another user's status

---

## Troubleshooting

### Email not being sent
- Check SMTP credentials are correct
- Verify n8n workflow is activated
- Check n8n execution logs for errors
- Ensure `VERIFY_EMAIL_WEBHOOK_URL` is set correctly in bot's `.env`

### Code not working
- Code expires after 15 minutes
- Only 5 incorrect attempts allowed per code
- Check if user is entering code with spaces

### Rate limit hit
- Users can only request 3 verification emails per hour
- Wait for rate limit to reset (shown in error message)

### Email going to spam
- Configure SPF, DKIM, and DMARC records for your domain
- Use a reputable email service (SendGrid, Mailgun, etc.)
- Avoid spam trigger words in email content

### Role not being assigned
- Verify `VERIFIED_ROLE_ID` is correct
- Check bot has `Manage Roles` permission
- Ensure bot's role is higher than the verified role in server settings

### Member logging not working
- Check `APPLICATION_LOG_CHANNEL_ID` is set correctly
- Verify bot has permission to send messages in that channel

---

## Security Notes

1. **Rate Limiting** - Built-in rate limiting prevents spam (3 requests/hour/user)
2. **Code Expiry** - Verification codes expire after 15 minutes
3. **Attempt Limiting** - Max 5 incorrect code attempts per verification
4. **Email Domain Validation** - Only configured university domains are accepted
5. **One Email Per Account** - Each email can only be used for one Discord account
6. **HTTPS Required** - All webhook URLs must use HTTPS

---

## Workflow Files

| File | Purpose |
|------|---------|
| `email-verification-workflow.json` | Sends verification emails via SMTP |
| `discord-verification-workflow.json` | Handles Qimah OAuth verification |

## Database

The verification system stores data in `data/verification.db`:
- **pending_verifications** - Active verification codes
- **verified_users** - Verified users with email/name
- **rate_limits** - Rate limiting counters
