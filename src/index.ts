/**
 * Main Cloudflare Worker entry point.
 * Handles Telegram webhook (incoming messages + button clicks).
 */

import type { Env, TelegramUpdate, ParsedEmail } from "./types";
import {
  sendMessage,
  editMessageText,
  editMessageReplyMarkup,
  answerCallbackQuery,
  setChatMenuButton,
  setMyCommands,
} from "./telegram";
import {
  listEmails,
  fetchFull,
  getMessage,
  sendReply,
  forwardEmail,
  toggleStar,
  toggleImportant,
  trashMessage,
  sendRsvp,
  markAsRead,
  getProfile,
  getNewMessageIds,
} from "./gmail";
import { summarise } from "./summarizer";
import {
  getState,
  setState,
  clearState,
  saveEmailPage,
  getEmailPage,
  getLastHistoryId,
  setLastHistoryId,
} from "./state";

// ── Formatting helpers ─────────────────────────────────────────────────────

/** Escape special chars for Telegram HTML mode */
function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen - 3) + "...";
}

function formatEmailSummary(em: ParsedEmail, index?: number): string {
  const prefix = index != null ? `<b>${index}.</b> ` : "";
  const flags = [];
  if (em.isStarred) flags.push("⭐");
  if (em.isImportant) flags.push("❗");
  const flagStr = flags.length > 0 ? " " + flags.join("") : "";
  return (
    `${prefix}📧 <b>${esc(truncate(em.subject, 80))}</b>${flagStr}\n` +
    `👤 ${esc(em.senderName)} &lt;${esc(em.senderEmail)}&gt;\n` +
    `🕐 ${esc(em.date)}`
  );
}

function formatFullEmail(em: ParsedEmail): string {
  const flags = [];
  if (em.isStarred) flags.push("⭐ Starred");
  if (em.isImportant) flags.push("❗ Important");
  const flagStr = flags.length > 0 ? `\n🏷 ${flags.join(" · ")}` : "";

  let bodyText = em.body.replace(/<[^>]+>/g, "").trim();
  if (bodyText.length > 3500) {
    bodyText = bodyText.slice(0, 3500) + "\n\n…(truncated)";
  }
  if (!bodyText) bodyText = em.snippet || "(no content)";

  return (
    `📧 <b>${esc(em.subject)}</b>${flagStr}\n` +
    `👤 ${esc(em.senderName)} &lt;${esc(em.senderEmail)}&gt;\n` +
    `🕐 ${esc(em.date)}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    esc(bodyText)
  );
}

function actionKeyboard(msgId: string, isStarred: boolean, isImportant: boolean) {
  const starLabel = isStarred ? "⭐ Starred" : "☆ Star";
  const impLabel = isImportant ? "❗ Important" : "❕ Mark Important";
  return {
    inline_keyboard: [
      [
        { text: "👁 Show", callback_data: `show:${msgId}` },
        { text: "📩 Reply", callback_data: `reply:${msgId}` },
      ],
      [
        { text: "↪️ Forward", callback_data: `forward:${msgId}` },
        { text: impLabel, callback_data: `important:${msgId}` },
      ],
      [
        { text: starLabel, callback_data: `star:${msgId}` },
        { text: "🗑️ Delete", callback_data: `delete:${msgId}` },
      ],
    ],
  };
}

function calendarKeyboard(msgId: string) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Accept", callback_data: `cal_accept:${msgId}` },
        { text: "❌ Decline", callback_data: `cal_decline:${msgId}` },
      ],
    ],
  };
}

function pageKeyboard(page: number, hasNext: boolean) {
  const row: { text: string; callback_data: string }[] = [];
  if (page > 0)
    row.push({ text: "⬅️ Prev", callback_data: `page:${page - 1}` });
  if (hasNext)
    row.push({ text: "Next ➡️", callback_data: `page:${page + 1}` });
  return row.length > 0 ? { inline_keyboard: [row] } : { inline_keyboard: [] };
}

function formatCalendarDetails(em: ParsedEmail): string {
  const cal = em.calendarDetails;
  let text = "";
  if (cal.title) text += `📅 ${esc(cal.title)}\n`;
  if (cal.date) text += `🕐 ${esc(cal.date)}`;
  if (cal.time) text += ` ${esc(cal.time)}`;
  if (cal.date || cal.time) text += "\n";
  if (cal.location) text += `📍 ${esc(cal.location)}\n`;
  if (cal.organizer) text += `👤 ${esc(cal.organizer)}\n`;
  return text;
}

// ── Webhook handler ────────────────────────────────────────────────────────

async function handleWebhook(request: Request, env: Env): Promise<Response> {
  const update = (await request.json()) as TelegramUpdate;

  if (update.callback_query) {
    await handleCallbackQuery(update, env);
  } else if (update.message?.text) {
    await handleMessage(update, env);
  }

  return new Response("ok");
}

// ── Message handler ────────────────────────────────────────────────────────

async function handleMessage(update: TelegramUpdate, env: Env): Promise<void> {
  const msg = update.message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const text = msg.text;

  const state = await getState(env, chatId);

  // Commands always work, even during a conversation
  if (text === "/cancel") {
    await clearState(env, chatId);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "Cancelled.");
    return;
  }

  // If in a conversation and message is NOT a command, handle as input
  if (state && text && !text.startsWith("/")) {
    await handleConversationInput(state, text, chatId, env);
    return;
  }

  if (text === "/start" || text === "/help") {
    await cmdStart(chatId, env);
  } else if (text === "/list5") {
    await cmdList(chatId, 5, env);
  } else if (text?.startsWith("/search ")) {
    const query = text.slice(8).trim();
    if (query) {
      await cmdSearch(chatId, query, env);
    } else {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "Usage: /search &lt;query&gt;\nExample: /search from:amazon");
    }
  } else if (text === "/search") {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      "Usage: /search &lt;query&gt;\n\n" +
        "<b>Search examples:</b>\n" +
        "/search from:amazon\n" +
        "/search subject:invoice\n" +
        "/search wedding invitation\n" +
        "/search is:unread\n" +
        "/search has:attachment\n" +
        "/search newer_than:7d\n" +
        "/search label:work",
    );
  } else {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      "Unknown command. Try /start for help.",
    );
  }
}

// ── Conversation input handler ─────────────────────────────────────────────

async function handleConversationInput(
  state: { action: string; msgId?: string; threadId?: string; to?: string; subject?: string },
  text: string,
  chatId: number,
  env: Env,
): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;

  if (state.action === "reply_body") {
    const success = await sendReply(
      env,
      state.threadId ?? "",
      state.to ?? "",
      state.subject ?? "",
      text,
    );
    if (success) {
      await sendMessage(token, chatId, `✅ Reply sent to ${state.to}`);
    } else {
      await sendMessage(token, chatId, "❌ Failed to send reply. Please try again.");
    }
    await clearState(env, chatId);
  } else if (state.action === "forward_email") {
    const to = text.trim();
    if (!to.includes("@") || !to.includes(".")) {
      await sendMessage(token, chatId, "❌ Invalid email address. Try again or /cancel.");
      return;
    }
    const success = await forwardEmail(env, state.msgId ?? "", to);
    if (success) {
      await sendMessage(token, chatId, `✅ Forwarded to ${to}`);
    } else {
      await sendMessage(token, chatId, "❌ Forward failed. Please try again.");
    }
    await clearState(env, chatId);
  }
}

// ── Callback query handler ─────────────────────────────────────────────────

async function handleCallbackQuery(
  update: TelegramUpdate,
  env: Env,
): Promise<void> {
  const cq = update.callback_query;
  if (!cq) return;

  const data = cq.data ?? "";
  const chatId = cq.message?.chat.id ?? 0;
  const msgId = cq.message?.message_id;
  const token = env.TELEGRAM_BOT_TOKEN;

  const colonIdx = data.indexOf(":");
  const action = colonIdx >= 0 ? data.slice(0, colonIdx) : data;
  const param = colonIdx >= 0 ? data.slice(colonIdx + 1) : "";

  await answerCallbackQuery(token, cq.id);

  // Handle delete confirmation state
  const state = await getState(env, chatId);
  if (state?.action === "delete_confirm") {
    if (action === "confirm_delete") {
      const success = await trashMessage(env, param);
      if (success) {
        await editMessageText(token, chatId, msgId!, "🗑️ Email deleted.");
      } else {
        await editMessageText(token, chatId, msgId!, "❌ Delete failed.");
      }
      await clearState(env, chatId);
      return;
    }
    if (action === "cancel_delete") {
      // Restore the original email view
      const originalMsg = await getMessage(env, state.msgId ?? param);
      if (originalMsg) {
        const text = formatFullEmail(originalMsg);
        const kb = actionKeyboard(originalMsg.id, originalMsg.isStarred, originalMsg.isImportant);
        await editMessageText(token, chatId, msgId!, text, kb);
      } else {
        await editMessageText(token, chatId, msgId!, "Deletion cancelled.");
      }
      await clearState(env, chatId);
      return;
    }
    // Any other button clears stale delete state
    await clearState(env, chatId);
  }

  switch (action) {
    case "show":
      await handleShow(token, chatId, msgId!, param, env);
      break;
    case "reply":
      await handleReply(token, chatId, msgId!, param, env);
      break;
    case "forward":
      await handleForward(token, chatId, msgId!, param, env);
      break;
    case "star":
      await handleStar(token, chatId, msgId!, param, env);
      break;
    case "important":
      await handleImportant(token, chatId, msgId!, param, env);
      break;
    case "delete":
      await handleDeletePrompt(token, chatId, msgId!, param, env);
      break;
    case "cal_accept":
      await handleCalendarRsvp(token, chatId, msgId!, param, true, env);
      break;
    case "cal_decline":
      await handleCalendarRsvp(token, chatId, msgId!, param, false, env);
      break;
    case "page":
      await handlePagination(token, chatId, msgId!, parseInt(param, 10), env);
      break;
    case "cancel_action":
      await handleCancelAction(token, chatId, msgId!, param, env);
      break;
  }
}

// ── Action handlers ────────────────────────────────────────────────────────

async function handleCancelAction(
  token: string,
  chatId: number,
  messageId: number,
  msgId: string,
  env: Env,
): Promise<void> {
  // Clear any active conversation state
  await clearState(env, chatId);

  // Restore the original email view
  const msg = await getMessage(env, msgId);
  if (msg) {
    const text = formatFullEmail(msg);
    const kb = actionKeyboard(msg.id, msg.isStarred, msg.isImportant);
    await editMessageText(token, chatId, messageId, text, kb);
  } else {
    await editMessageText(token, chatId, messageId, "Action cancelled.");
  }
}

async function handleShow(
  token: string,
  chatId: number,
  messageId: number,
  msgId: string,
  env: Env,
): Promise<void> {
  const msg = await getMessage(env, msgId);
  if (!msg) {
    await sendMessage(token, chatId, "❌ Could not fetch email.");
    return;
  }

  const text = formatFullEmail(msg);
  const kb = {
    inline_keyboard: [
      [
        { text: "📩 Reply", callback_data: `reply:${msgId}` },
        { text: "↪️ Forward", callback_data: `forward:${msgId}` },
      ],
      [
        { text: msg.isStarred ? "⭐ Starred" : "☆ Star", callback_data: `star:${msgId}` },
        { text: msg.isImportant ? "❗ Important" : "❕ Mark Important", callback_data: `important:${msgId}` },
      ],
      [
        { text: "🗑️ Delete", callback_data: `delete:${msgId}` },
      ],
    ],
  };

  await editMessageText(token, chatId, messageId, text, kb);
}

async function handleReply(
  token: string,
  chatId: number,
  messageId: number,
  msgId: string,
  env: Env,
): Promise<void> {
  const msg = await getMessage(env, msgId);
  if (!msg) {
    await sendMessage(token, chatId, "❌ Could not fetch email details.");
    return;
  }

  await setState(env, chatId, {
    action: "reply_body",
    msgId,
    threadId: msg.threadId,
    to: msg.senderEmail,
    subject: msg.subject,
    timestamp: Date.now(),
  });

  await editMessageText(
    token,
    chatId,
    messageId,
    `💬 Replying to <b>${esc(msg.senderEmail)}</b>\n✏️ Type your reply:`,
    {
      inline_keyboard: [
        [{ text: "❌ Cancel", callback_data: `cancel_action:${msgId}` }],
      ],
    },
  );
}

async function handleForward(
  token: string,
  chatId: number,
  messageId: number,
  msgId: string,
  env: Env,
): Promise<void> {
  await setState(env, chatId, {
    action: "forward_email",
    msgId,
    timestamp: Date.now(),
  });

  await editMessageText(
    token,
    chatId,
    messageId,
    "↪️ Enter recipient email address to forward to:",
    {
      inline_keyboard: [
        [{ text: "❌ Cancel", callback_data: `cancel_action:${msgId}` }],
      ],
    },
  );
}

async function handleStar(
  token: string,
  chatId: number,
  messageId: number,
  msgId: string,
  env: Env,
): Promise<void> {
  const msg = await getMessage(env, msgId);
  if (!msg) return;

  const success = await toggleStar(env, msgId, msg.isStarred);
  if (success) {
    await editMessageText(token, chatId, messageId, !msg.isStarred ? "⭐ Starred" : "☆ Unstarred");
  }
}

async function handleImportant(
  token: string,
  chatId: number,
  messageId: number,
  msgId: string,
  env: Env,
): Promise<void> {
  const msg = await getMessage(env, msgId);
  if (!msg) return;

  const success = await toggleImportant(env, msgId, msg.isImportant);
  if (success) {
    await editMessageText(token, chatId, messageId, !msg.isImportant ? "❗ Marked Important" : "❕ Unmarked Important");
  }
}

async function handleDeletePrompt(
  token: string,
  chatId: number,
  messageId: number,
  msgId: string,
  env: Env,
): Promise<void> {
  await setState(env, chatId, {
    action: "delete_confirm",
    msgId,
    timestamp: Date.now(),
  });

  await editMessageText(
    token,
    chatId,
    messageId,
    "🗑️ Are you sure you want to delete this email?",
    {
      inline_keyboard: [
        [
          { text: "Yes, Delete ✅", callback_data: `confirm_delete:${msgId}` },
          { text: "Cancel ❌", callback_data: `cancel_delete:${msgId}` },
        ],
      ],
    },
  );
}

async function handleCalendarRsvp(
  token: string,
  chatId: number,
  messageId: number,
  msgId: string,
  accept: boolean,
  env: Env,
): Promise<void> {
  const msg = await getMessage(env, msgId);
  if (!msg) {
    await sendMessage(token, chatId, "❌ Error fetching email.");
    return;
  }

  const success = await sendRsvp(
    env,
    msg.threadId,
    msg.senderEmail,
    msg.subject,
    accept,
  );

  const label = accept ? "✅ RSVP acceptance sent" : "❌ RSVP decline sent";
  if (success) {
    await editMessageText(token, chatId, messageId, `${label} to ${esc(msg.senderEmail)}`);
  } else {
    await sendMessage(token, chatId, "❌ Failed to send RSVP.");
  }
}

async function handlePagination(
  token: string,
  chatId: number,
  messageId: number,
  page: number,
  env: Env,
): Promise<void> {
  const cached = await getEmailPage(env, chatId, page);
  if (!cached) {
    await editMessageText(token, chatId, messageId, "Page expired. Use /list5 or /search");
    return;
  }

  await editMessageText(token, chatId, messageId, "⏳ Loading…");

  const result = await listEmails(
    env,
    "",
    10,
    cached.nextPageToken ?? undefined,
  );

  for (let i = 0; i < result.emails.length; i++) {
    const em = result.emails[i];
    const text = formatEmailSummary(em, i + 1);
    const kb = actionKeyboard(em.id, em.isStarred, em.isImportant);
    await sendMessage(token, chatId, text, kb);
  }

  if (result.emails.length > 0) {
    await saveEmailPage(env, chatId, {
      emails: result.emails,
      nextPageToken: result.nextPageToken,
      page,
    });

    const hasNext = result.nextPageToken != null;
    const kb = pageKeyboard(page, hasNext);
    if (kb.inline_keyboard.length > 0) {
      await sendMessage(token, chatId, `📄 Page ${page + 1}`, kb);
    }
  }
}

// ── Command handlers ───────────────────────────────────────────────────────

async function cmdStart(chatId: number, env: Env): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  await setChatMenuButton(token, chatId);
  await setMyCommands(token);

  await sendMessage(
    token,
    chatId,
      "👋 <b>Telegram Gmail Bot</b>\n\n" +
      "I let you manage your Gmail from Telegram.\n\n" +
      "<b>Commands:</b>\n" +
      "/list5 — last 5 emails\n" +
      "/search &lt;query&gt; — search emails\n" +
      "/cancel — cancel current action\n" +
      "/start — this message\n\n" +
      "<b>Search examples:</b>\n" +
      "/search from:amazon\n" +
      "/search subject:invoice\n" +
      "/search wedding invitation\n" +
      "/search is:unread\n" +
      "/search has:attachment\n\n" +
      "Tap the <b>Menu</b> button ⬇️ to see all commands.",
  );
}

async function cmdList(chatId: number, count: number, env: Env): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  await sendMessage(token, chatId, `⏳ Fetching last ${count} emails…`);

  const result = await listEmails(env, "", count);

  if (result.emails.length === 0) {
    await sendMessage(token, chatId, "📭 No emails found.");
    return;
  }

  for (let i = 0; i < result.emails.length; i++) {
    const em = result.emails[i];
    const text = formatEmailSummary(em, i + 1);
    const kb = actionKeyboard(em.id, em.isStarred, em.isImportant);
    await sendMessage(token, chatId, text, kb);
  }

  await saveEmailPage(env, chatId, {
    emails: result.emails,
    nextPageToken: result.nextPageToken,
    page: 0,
  });

  const hasNext = result.nextPageToken != null;
  const kb = pageKeyboard(0, hasNext);
  if (kb.inline_keyboard.length > 0) {
    await sendMessage(token, chatId, "📄 Page 1", kb);
  }
}

async function cmdSearch(chatId: number, query: string, env: Env): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  await sendMessage(token, chatId, `🔍 Searching: <code>${query}</code>…`);

  const result = await listEmails(env, query, 10);

  if (result.emails.length === 0) {
    await sendMessage(token, chatId, "📭 No emails found matching your search.");
    return;
  }

  for (let i = 0; i < result.emails.length; i++) {
    const em = result.emails[i];
    const text = formatEmailSummary(em, i + 1);
    const kb = actionKeyboard(em.id, em.isStarred, em.isImportant);
    await sendMessage(token, chatId, text, kb);
  }

  await saveEmailPage(env, chatId, {
    emails: result.emails,
    nextPageToken: result.nextPageToken,
    page: 0,
  });

  const hasNext = result.nextPageToken != null;
  const kb = pageKeyboard(0, hasNext);
  if (kb.inline_keyboard.length > 0) {
    await sendMessage(token, chatId, "📄 Page 1", kb);
  }
}

// ── Cron: notify about new emails ──────────────────────────────────────────
//
// Simple approach: query "is:unread", send each email, mark as read.
// Since we mark emails as read immediately after notifying,
// Gmail won't return them again on the next run.

async function handleCron(env: Env): Promise<void> {
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!chatId) return;

  const token = env.TELEGRAM_BOT_TOKEN;

  // Step 1: Check if anything changed via historyId (lightweight call)
  const lastHistoryId = await getLastHistoryId(env);

  let newHistoryId: string;
  let newMessageIds: string[];

  if (lastHistoryId) {
    // Compare historyId — skip entirely if nothing changed
    const result = await getNewMessageIds(env, lastHistoryId);
    newHistoryId = result.newHistoryId;
    newMessageIds = result.messageIds;

    if (newMessageIds.length === 0) {
      console.log(`Cron: no changes (historyId ${lastHistoryId} → ${newHistoryId})`);
      await setLastHistoryId(env, newHistoryId);
      return;
    }

    console.log(`Cron: ${newMessageIds.length} new message(s) since historyId ${lastHistoryId}`);
  } else {
    // First run: get current profile to establish baseline
    const profile = await getProfile(env);
    newHistoryId = profile.historyId;
    newMessageIds = [];

    console.log(`Cron: first run, initialized historyId to ${newHistoryId}`);
    await setLastHistoryId(env, newHistoryId);
    return;
  }

  // Step 2: Fetch full email data for each new message
  for (const msgId of newMessageIds) {
    try {
      const msg = await getMessage(env, msgId);
      if (!msg) continue;

      // Only notify about unread emails
      if (!msg.body && !msg.snippet) continue;

      const summary = summarise(msg.body || msg.snippet);

      let text =
        `📧 <b>${esc(truncate(msg.subject, 80))}</b>\n` +
        `👤 ${esc(msg.senderName)} &lt;${esc(msg.senderEmail)}&gt;\n` +
        `🕐 ${esc(msg.date)}\n\n` +
        `<b>Summary:</b>\n${esc(summary)}`;

      let kb = actionKeyboard(msg.id, msg.isStarred, msg.isImportant);

      if (msg.hasCalendar) {
        const calText = formatCalendarDetails(msg);
        if (calText) {
          text += `\n\n<b>📅 Calendar Invite:</b>\n${calText}`;
        }
        kb = {
          inline_keyboard: [
            ...kb.inline_keyboard,
            [
              { text: "✅ Accept", callback_data: `cal_accept:${msg.id}` },
              { text: "❌ Decline", callback_data: `cal_decline:${msg.id}` },
            ],
          ],
        };
      }

      await sendMessage(token, parseInt(chatId), text, kb);
      console.log(`Notified: ${msg.subject}`);

      // Mark as read after notifying
      await markAsRead(env, msg.id);
    } catch (err) {
      console.error(`Failed to process message ${msgId}:`, err);
    }
  }

  // Step 3: Save the new historyId
  await setLastHistoryId(env, newHistoryId);
}

// ── Worker entry point ─────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/webhook" && request.method === "POST") {
      return handleWebhook(request, env);
    }

    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    console.log("Cron triggered — checking for new emails…");
    await handleCron(env);
  },
};
