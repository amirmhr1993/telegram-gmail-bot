# Telegram Gmail Bot — Cloudflare Workers

A Telegram bot that lets you manage your Gmail directly from Telegram. Built on Cloudflare Workers with KV storage.

[English](#english) | [فارسی](#فارسی)

---

<a id="english"></a>
## English

### Features

- List your latest emails with inline action buttons
- Search emails using Gmail search syntax
- Reply, forward, star, mark important, or delete emails
- Accept/decline calendar invitations
- Automatic notifications for new unread emails (every 2 minutes)
- Paginated email listing

### Commands

| Command | Description |
|---------|-------------|
| `/start` or `/help` | Show welcome message and available commands |
| `/list5` | Show last 5 emails |
| `/search <query>` | Search emails (Gmail syntax) |
| `/cancel` | Cancel current action |

**Search examples:**
```
/search from:amazon
/search subject:invoice
/search is:unread
/search has:attachment
/search newer_than:7d
/search label:work
```

### How to Get API Keys

#### 1. Telegram Bot Token (via @BotFather)

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Choose a display name (e.g. `Gmail Bot`)
4. Choose a username ending in `bot` (e.g. `my_gmail_bot`)
5. Copy the **bot token** (e.g. `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`)

#### 2. Telegram Chat ID (via @userinfobot)

1. Open Telegram and search for **@userinfobot**
2. Send any message to it
3. It replies with your **Chat ID** (a number like `123456789`)

#### 3. Gmail OAuth Credentials (Google Cloud Console)

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

#### 4. Gmail Refresh Token (OAuth Playground)

1. Go to [OAuth Playground](https://developers.google.com/oauthplayground/)
2. Click the gear icon (⚙️) in the top right
3. Check **Use your own OAuth credentials**
4. Enter your **Client ID** and **Client Secret**
5. Select these scopes:
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/calendar`
6. Click **Authorize APIs**
7. Sign in with your Google account and grant permission
8. Click **Exchange authorization code for tokens**
9. Copy the **Refresh token**

> **Important:** Save the refresh token immediately — it's only shown once.

### Deployment

#### Prerequisites

- Node.js installed
- A Cloudflare account

#### Steps

1. **Install Wrangler CLI**
   ```bash
   npm install -g wrangler
   ```

2. **Login to Cloudflare**
   ```bash
   wrangler login
   ```

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Create KV namespace**
   ```bash
   wrangler kv namespace create EMAIL_BOT_KV
   ```
   Copy the `id` from the output and paste it into `wrangler.toml`:
   ```toml
   [[kv_namespaces]]
   binding = "EMAIL_BOT_KV"
   id = "your-kv-id-here"
   ```

5. **Set secrets**
   ```bash
   wrangler secret put TELEGRAM_BOT_TOKEN
   wrangler secret put TELEGRAM_CHAT_ID
   wrangler secret put GMAIL_CLIENT_ID
   wrangler secret put GMAIL_CLIENT_SECRET
   wrangler secret put GMAIL_REFRESH_TOKEN
   ```

6. **Deploy**
   ```bash
   wrangler deploy
   ```

7. **Set Telegram webhook** (replace `{TOKEN}` and `{WORKER_URL}`)
   ```bash
   curl "https://api.telegram.org/bot{TOKEN}/setWebhook?url=https://{WORKER_URL}/webhook"
   ```

### Troubleshooting

| Issue | Fix |
|-------|-----|
| Bot doesn't respond | Check webhook: `curl https://api.telegram.org/bot{TOKEN}/getWebhookInfo` |
| "Webhook already set" | Remove old: `curl https://api.telegram.org/bot{TOKEN}/deleteWebhook` |
| Cron not firing | Run `wrangler tail` for logs, verify cron in `wrangler.toml` |
| Gmail auth errors | Re-generate refresh token via OAuth Playground |
| KV errors | Verify KV namespace ID matches in `wrangler.toml` |

### Architecture

```
Telegram → Cloudflare Worker (/webhook)
                ├── Parse update
                ├── Route to handler
                ├── Call Gmail API (OAuth2 refresh)
                ├── Update KV state
                └── Reply to Telegram

Cron (*/2 * * * *) → Cloudflare Worker (scheduled)
                ├── Fetch unread from Gmail
                ├── Send new emails to Telegram
                └── Mark as read
```

### License

MIT

---

<a id="فارسی"></a>
## فارسی

### امکانات

- مشاهده آخرین ایمیل‌ها با دکمه‌های عملیاتی
- جستجوی ایمیل با استفاده از سنتاکس جستجوی Gmail
- پاسخ، انتقال، ستاره‌دار کردن، مهم نشان دادن یا حذف ایمیل‌ها
- پذیرش یا رد دعوت‌نامه‌های تقویم
- اعلان خودکار برای ایمیل‌های خوانده‌نشده (هر ۲ دقیقه)
- صفحه‌بندی لیست ایمیل‌ها

### دستورات

| دستور | توضیح |
|-------|-------|
| `/start` یا `/help` | نمایش پیام خوش‌آمدگویی و دستورات موجود |
| `/list5` | نمایش ۵ ایمیل آخر |
| `/search <query>` | جستجوی ایمیل (سنتاکس Gmail) |
| `/cancel` | لغو عملیات جاری |

**مثال‌های جستجو:**
```
/search from:amazon
/search subject:invoice
/search is:unread
/search has:attachment
/search newer_than:7d
/search label:work
```

### نحوه دریافت کلیدهای API

#### ۱. توکن ربات تلگرام (از طریق @BotFather)

1. تلگرام را باز کنید و **@BotFather** را جستجو کنید
2. `/newbot` را ارسال کنید
3. یک نام نمایشی انتخاب کنید (مثلاً `Gmail Bot`)
4. یک نام کاربری با پسوند `bot` انتخاب کنید (مثلاً `my_gmail_bot`)
5. **توکن ربات** را کپی کنید (مثلاً `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`)

#### ۲. شناسه چت تلگرام (از طریق @userinfobot)

1. تلگرام را باز کنید و **@userinfobot** را جستجو کنید
2. هر پیامی برایش ارسال کنید
3. **شناسه چت شما** را برمی‌گرداند (عددی مانند `123456789`)

#### ۳. احراز هویت Gmail (کنسول Google Cloud)

1. به [کنسول Google Cloud](https://console.cloud.google.com/) بروید
2. یک پروژه جدید بسازید (مثلاً `telegram-gmail-bot`)
3. به **APIs & Services → Library** بروید
4. **Gmail API** و **Google Calendar API** را فعال کنید
5. به **APIs & Services → Credentials** بروید
6. **Create Credentials** → **OAuth client ID** را بزنید
7. اگر خواسته شد، ابتدا **OAuth consent screen** را تنظیم کنید:
   - **External** را انتخاب کنید
   - نام اپلیکیشن و ایمیل خود را وارد کنید
   - اسکوپ‌ها را اضافه کنید: `gmail.modify`، `gmail.readonly`، `gmail.send`، `calendar`
   - حساب Google خود را به عنوان کاربر تست اضافه کنید
8. کلاینت OAuth را بسازید:
   - نوع اپلیکیشن: **Web application**
   - نام: `telegram-gmail-bot`
   - Authorized redirect URIs: `https://developers.google.com/oauthplayground` را اضافه کنید
9. **Client ID** و **Client Secret** را کپی کنید

#### ۴. توکن رفرش Gmail (OAuth Playground)

1. به [OAuth Playground](https://developers.google.com/oauthplayground/) بروید
2. روی آیکون چرخ‌دنده (⚙️) در بالا سمت راست کلیک کنید
3. **Use your own OAuth credentials** را تیک بزنید
4. **Client ID** و **Client Secret** خود را وارد کنید
5. این اسکوپ‌ها را انتخاب کنید:
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/calendar`
6. **Authorize APIs** را بزنید
7. با حساب Google خود وارد شوید و اجازه دهید
8. **Exchange authorization code for tokens** را بزنید
9. **Refresh token** را کپی کنید

> **مهم:** توکن رفرش را فوراً ذخیره کنید — فقط یک بار نمایش داده می‌شود.

### استقرار

#### پیش‌نیازها

- Node.js نصب شده باشد
- یک حساب Cloudflare داشته باشید

#### مراحل

1. **نصب Wrangler CLI**
   ```bash
   npm install -g wrangler
   ```

2. **ورود به Cloudflare**
   ```bash
   wrangler login
   ```

3. **نصب وابستگی‌ها**
   ```bash
   npm install
   ```

4. **ساخت فضای KV**
   ```bash
   wrangler kv namespace create EMAIL_BOT_KV
   ```
   `id` خروجی را کپی کنید و در `wrangler.toml` قرار دهید:
   ```toml
   [[kv_namespaces]]
   binding = "EMAIL_BOT_KV"
   id = "your-kv-id-here"
   ```

5. **تنظیم رازها (secrets)**
   ```bash
   wrangler secret put TELEGRAM_BOT_TOKEN
   wrangler secret put TELEGRAM_CHAT_ID
   wrangler secret put GMAIL_CLIENT_ID
   wrangler secret put GMAIL_CLIENT_SECRET
   wrangler secret put GMAIL_REFRESH_TOKEN
   ```

6. **استقرار**
   ```bash
   wrangler deploy
   ```

7. **تنظیم وب‌هوک تلگرام** (جایگزین `{TOKEN}` و `{WORKER_URL}` شوید)
   ```bash
   curl "https://api.telegram.org/bot{TOKEN}/setWebhook?url=https://{WORKER_URL}/webhook"
   ```

### عیب‌یابی

| مشکل | راه‌حل |
|------|--------|
| ربات پاسخ نمی‌دهد | وب‌هوک را بررسی کنید: `curl https://api.telegram.org/bot{TOKEN}/getWebhookInfo` |
| "Webhook already set" | وب‌هوک قدیمی را حذف کنید: `curl https://api.telegram.org/bot{TOKEN}/deleteWebhook` |
| Cron اجرا نمی‌شود | `wrangler tail` را برای لاگ‌ها اجرا کنید، cron را در `wrangler.toml` بررسی کنید |
| خطاهای احراز هویت Gmail | توکن رفرش را دوباره از OAuth Playground بسازید |
| خطاهای KV | مطمئن شوید شناسه فضای KV در `wrangler.toml` درست است |

### معماری

```
تلگرام → Cloudflare Worker (/webhook)
                ├── تحلیل آپدیت
                ├── مسیریابی به هندلر
                ├── فراخوانی Gmail API (احراز هویت OAuth2)
                ├── به‌روزرسانی وضعیت KV
                └── پاسخ به تلگرام

Cron (*/2 * * * *) → Cloudflare Worker (scheduled)
                ├── دریافت ایمیل‌های خوانده‌نشده از Gmail
                ├── ارسال ایمیل‌های جدید به تلگرام
                └── علامت‌گذاری به عنوان خوانده شده
```

### مجوز

MIT
