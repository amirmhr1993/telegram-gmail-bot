# Telegram Gmail Bot — Cloudflare Workers Setup

## 1. Create a Telegram Bot via @BotFather

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Choose a name (e.g. `Gmail Bot`)
4. Choose a username ending in `bot` (e.g. `my_gmail_bot`)
5. Copy the **bot token** (e.g. `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`)

## 2. Get Gmail OAuth Credentials from Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (e.g. `telegram-gmail-bot`)
3. Go to **APIs & Services → Library**
4. Enable **Gmail API** and **Google Calendar API**
5. Go to **APIs & Services → Credentials**
6. Click **Create Credentials** → **OAuth client ID**
7. If prompted, configure the **OAuth consent screen** first:
   - Choose **External**
   - Fill in app name and your email
   - Add scopes: `gmail.modify`, `gmail.readonly`, `gmail.send`, `calendar`
   - Add your Google account as a test user
8. Create the OAuth client:
   - Application type: **Web application**
   - Name: `telegram-gmail-bot`
   - Authorized redirect URIs: add `https://developers.google.com/oauthplayground`
9. Copy the **Client ID** and **Client Secret**

## 3. Get Gmail Refresh Token via OAuth Playground

1. Go to [OAuth Playground](https://developers.google.com/oauthplayground/)
2. Click the gear icon (⚙️) in the top right
3. Check **Use your own OAuth credentials**
4. Enter your **Client ID** and **Client Secret**
5. In the left panel, find and select these scopes:
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/calendar`
6. Click **Authorize APIs**
7. Sign in with your Google account and grant permission
8. Click **Exchange authorization code for tokens**
9. Copy the **Refresh token** (the long string under "Refresh token")

> **Important:** Save the refresh token immediately — it's only shown once.

## 4. Install Wrangler CLI and Login

```bash
# Install wrangler globally
npm install -g wrangler

# Login to Cloudflare
wrangler login
```

## 5. Create KV Namespace

```bash
# Create the KV namespace
wrangler kv namespace create EMAIL_BOT_KV
```

This outputs something like:
```
{ binding = "EMAIL_BOT_KV", id = "abc123..." }
```

Copy the `id` value and paste it into `wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "EMAIL_BOT_KV"
id = "abc123..."
```

## 6. Set All Secrets via Wrangler

```bash
wrangler secret put TELEGRAM_BOT_TOKEN
# Paste your bot token from BotFather

wrangler secret put TELEGRAM_CHAT_ID
# Paste your Telegram chat ID (get it from @userinfobot)

wrangler secret put GMAIL_CLIENT_ID
# Paste your Google OAuth client ID

wrangler secret put GMAIL_CLIENT_SECRET
# Paste your Google OAuth client secret

wrangler secret put GMAIL_REFRESH_TOKEN
# Paste your Gmail refresh token
```

### How to get your Telegram Chat ID

1. Open Telegram and search for **@userinfobot**
2. Send any message to it
3. It replies with your **Chat ID** (a number like `123456789`)

## 7. Deploy the Worker

```bash
wrangler deploy
```

This deploys to: `https://telegram-gmail-bot.<your-subdomain>.workers.dev`

## 8. Register Telegram Webhook

Replace `{TOKEN}` with your bot token and `{WORKER_URL}` with your worker URL:

```bash
curl "https://api.telegram.org/bot{TOKEN}/setWebhook?url=https://{WORKER_URL}/webhook"
```

For example:
```bash
curl "https://api.telegram.org/bot123456:ABC-DEF/setWebhook?url=https://telegram-gmail-bot.your-subdomain.workers.dev/webhook"
```

You should see: `{"ok":true,"result":true,"description":"Webhook was set"}`

## 9. Test the Bot

1. Open your bot in Telegram
2. Send `/start`
3. Send `/list5` to see your last 5 emails
4. Tap buttons to reply, forward, star, or delete

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Bot doesn't respond | Check webhook is set: `curl https://api.telegram.org/bot{TOKEN}/getWebhookInfo` |
| "Webhook already set" | Remove old webhook first: `curl https://api.telegram.org/bot{TOKEN}/deleteWebhook` |
| Cron not firing | Check `wrangler tail` for logs, verify cron schedule in wrangler.toml |
| Gmail auth errors | Re-generate refresh token via OAuth Playground |
| KV errors | Verify KV namespace ID matches in wrangler.toml |

## Architecture

```
Telegram → Cloudflare Worker (/webhook)
                ├── Parse update
                ├── Route to handler
                ├── Call Gmail API (OAuth2 refresh)
                ├── Update KV state
                └── Reply to Telegram

Cron (*/1 * * * *) → Cloudflare Worker (scheduled)
                ├── Fetch unread from Gmail
                ├── Compare with last_email_id in KV
                ├── Send new emails to Telegram
                └── Mark as read
```
