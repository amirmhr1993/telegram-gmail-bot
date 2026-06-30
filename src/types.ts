/**
 * TypeScript interfaces for the Telegram Gmail bot.
 */

// ── Cloudflare Worker Environment ──────────────────────────────────────────

export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  GMAIL_CLIENT_ID: string;
  GMAIL_CLIENT_SECRET: string;
  GMAIL_REFRESH_TOKEN: string;
  EMAIL_BOT_KV: KVNamespace;
}

// ── Telegram API Types ─────────────────────────────────────────────────────

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
  message_id: number;
  from: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export type InlineKeyboardMarkup = {
  inline_keyboard: InlineKeyboardButton[][];
};

// ── Gmail API Types ────────────────────────────────────────────────────────

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload: GmailPayload;
  internalDate: string;
}

export interface GmailPayload {
  mimeType: string;
  filename: string;
  headers: GmailHeader[];
  body: GmailBody;
  parts?: GmailPayload[];
}

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailBody {
  size: number;
  data?: string;
}

export interface GmailListResponse {
  messages?: { id: string; threadId: string }[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

// ── Parsed Email ───────────────────────────────────────────────────────────

export interface ParsedEmail {
  id: string;
  threadId: string;
  senderName: string;
  senderEmail: string;
  subject: string;
  date: string;
  body: string;
  snippet: string;
  isStarred: boolean;
  isImportant: boolean;
  hasCalendar: boolean;
  calendarDetails: CalendarDetails;
}

export interface CalendarDetails {
  title: string;
  date: string;
  time: string;
  location: string;
  organizer: string;
  description: string;
}

// ── Conversation State ─────────────────────────────────────────────────────

export type ConversationAction =
  | "reply_body"
  | "forward_email"
  | "delete_confirm";

export interface ConversationState {
  action: ConversationAction;
  msgId?: string;
  threadId?: string;
  to?: string;
  subject?: string;
  timestamp: number;
}

// ── Email List Cache ───────────────────────────────────────────────────────

export interface EmailListPage {
  emails: ParsedEmail[];
  nextPageToken: string | null;
  page: number;
}
