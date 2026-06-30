/**
 * Telegram Bot API helpers.
 * All functions take the bot token and make direct HTTP calls to the Telegram API.
 */

import type {
  InlineKeyboardMarkup,
  TelegramUpdate,
} from "./types";

const TELEGRAM_API = "https://api.telegram.org";

// ── Generic request helper ─────────────────────────────────────────────────

async function tgRequest<T>(
  token: string,
  method: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const url = `${TELEGRAM_API}/bot${token}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!json.ok) {
    throw new Error(`Telegram API error [${method}]: ${json.description ?? "unknown"}`);
  }
  return json.result;
}

// ── Send message ───────────────────────────────────────────────────────────

export async function sendMessage(
  token: string,
  chatId: number | string,
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
): Promise<{ message_id: number }> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  };
  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }
  return tgRequest(token, "sendMessage", body);
}

// ── Edit message text ──────────────────────────────────────────────────────

export async function editMessageText(
  token: string,
  chatId: number | string,
  messageId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
): Promise<boolean> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
  };
  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }
  return tgRequest(token, "editMessageText", body);
}

// ── Edit message reply markup (buttons only) ───────────────────────────────

export async function editMessageReplyMarkup(
  token: string,
  chatId: number | string,
  messageId: number,
  replyMarkup: InlineKeyboardMarkup,
): Promise<boolean> {
  return tgRequest(token, "editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup,
  });
}

// ── Answer callback query ──────────────────────────────────────────────────

export async function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string,
  showAlert = false,
): Promise<boolean> {
  const body: Record<string, unknown> = {
    callback_query_id: callbackQueryId,
  };
  if (text) body.text = text;
  if (showAlert) body.show_alert = showAlert;
  return tgRequest(token, "answerCallbackQuery", body);
}

// ── Delete message ─────────────────────────────────────────────────────────

export async function deleteMessage(
  token: string,
  chatId: number | string,
  messageId: number,
): Promise<boolean> {
  return tgRequest(token, "deleteMessage", {
    chat_id: chatId,
    message_id: messageId,
  });
}

// ── Parse update from request body ─────────────────────────────────────────

export async function parseUpdate(request: Request): Promise<TelegramUpdate> {
  return request.json() as Promise<TelegramUpdate>;
}

// ── Set bot menu button (shows commands list) ──────────────────────────────

export async function setChatMenuButton(
  token: string,
  chatId: number | string,
): Promise<boolean> {
  return tgRequest(token, "setChatMenuButton", {
    chat_id: chatId,
    menu_button: { type: "commands" },
  });
}

// ── Set bot commands ───────────────────────────────────────────────────────

export async function setMyCommands(token: string): Promise<boolean> {
  return tgRequest(token, "setMyCommands", {
    commands: [
      { command: "list5", description: "Show last 5 emails" },
      { command: "search", description: "Search emails (e.g. /search from:amazon)" },
      { command: "cancel", description: "Cancel current action" },
      { command: "start", description: "Show help message" },
    ],
  });
}
