/**
 * Gmail API service layer.
 * Uses OAuth2 with a refresh token to obtain short-lived access tokens.
 */

import type { Env, GmailListResponse, GmailMessage, GmailProfile, GmailHistoryResponse, ParsedEmail } from "./types";
import { extractCalendarDetails } from "./calendar";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

// ── Auth: refresh access token ─────────────────────────────────────────────

let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

export async function getAccessToken(env: Env): Promise<string> {
  // Return cached token if it still has >60s left
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedAccessToken;
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail token refresh failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  cachedAccessToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return cachedAccessToken;
}

// ── Generic Gmail request ──────────────────────────────────────────────────

async function gmailRequest<T>(
  env: Env,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken(env);
  const res = await fetch(`${GMAIL_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers as Record<string, string>),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail API error [${path}] (${res.status}): ${text}`);
  }

  return res.json() as Promise<T>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function decodeBody(payload: GmailMessage["payload"]): string {
  // Try to get plain text from body data
  if (payload.body?.data) {
    return base64UrlDecode(payload.body.data);
  }

  const parts = payload.parts ?? [];

  // Prefer text/plain, fall back to text/html
  for (const mime of ["text/plain", "text/html"]) {
    for (const part of parts) {
      if (part.mimeType === mime && part.body?.data) {
        return base64UrlDecode(part.body.data);
      }
    }
  }

  // Recurse into nested parts
  for (const part of parts) {
    const result = decodeBody(part);
    if (result) return result;
  }

  return "";
}

function base64UrlDecode(data: string): string {
  // Convert base64url to base64
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  // Add padding
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  // Decode as UTF-8 (atob gives Latin-1, need TextDecoder for proper Unicode)
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

function base64UrlEncode(text: string): string {
  // Encode string as UTF-8 bytes first, then base64url
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function extractHeader(headers: { name: string; value: string }[], name: string): string {
  const h = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

function parseDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr || "Unknown";
  }
}

function parseSender(raw: string): { name: string; email: string } {
  const match = raw.match(/(.?)\s*<(.+?)>/);
  if (match) {
    return { name: match[1].trim().replace(/"/g, ""), email: match[2] };
  }
  return { name: raw, email: raw };
}

function hasCalendarAttachment(payload: GmailMessage["payload"]): boolean {
  const parts = payload.parts ?? [];
  for (const part of parts) {
    if (part.filename?.toLowerCase().endsWith(".ics")) return true;
    if (hasCalendarAttachment(part)) return true;
  }
  return false;
}

function calendarKeywords(body: string): boolean {
  const lower = body.toLowerCase();
  return ["invitation", "calendar", "meeting invite", "rsvp", "event"].some(
    (kw) => lower.includes(kw),
  );
}

// ── Parse a raw Gmail message into ParsedEmail ─────────────────────────────

function parseMessage(msg: GmailMessage): ParsedEmail {
  const headers = msg.payload?.headers ?? [];
  const senderRaw = extractHeader(headers, "From");
  const subject = extractHeader(headers, "Subject") || "(no subject)";
  const dateStr = extractHeader(headers, "Date");

  const { name, email } = parseSender(senderRaw);
  const body = decodeBody(msg.payload);
  const labels = msg.labelIds ?? [];
  const isStarred = labels.includes("STARRED");
  const isImportant = labels.includes("IMPORTANT");

  const hasCal = hasCalendarAttachment(msg.payload) || calendarKeywords(body);
  const calDetails = hasCal ? extractCalendarDetails(body) : undefined;

  return {
    id: msg.id,
    threadId: msg.threadId,
    senderName: name,
    senderEmail: email,
    subject,
    date: parseDate(dateStr),
    body,
    snippet: msg.snippet ?? "",
    isStarred,
    isImportant,
    hasCalendar: hasCal,
    calendarDetails: calDetails ?? {
      title: "",
      date: "",
      time: "",
      location: "",
      organizer: "",
      description: "",
    },
  };
}

// ── History ID: lightweight change detection ────────────────────────────────

/**
 * Get the current Gmail profile with historyId.
 * Single lightweight API call — no message data fetched.
 */
export async function getProfile(env: Env): Promise<GmailProfile> {
  return gmailRequest<GmailProfile>(env, "/users/me/profile");
}

/**
 * Fetch new messages added since a given historyId.
 * Returns only message IDs of newly added messages (not full emails).
 */
export async function getNewMessageIds(
  env: Env,
  startHistoryId: string,
): Promise<{ messageIds: string[]; newHistoryId: string }> {
  const profile = await getProfile(env);

  // If historyId hasn't changed, nothing new
  if (profile.historyId === startHistoryId) {
    return { messageIds: [], newHistoryId: profile.historyId };
  }

  const res = await gmailRequest<GmailHistoryResponse>(
    env,
    `/users/me/history?startHistoryId=${startHistoryId}&historyTypes=messageAdded&labelId=INBOX`,
  );

  const messageIds: string[] = [];
  for (const record of res.history ?? []) {
    for (const added of record.messagesAdded ?? []) {
      // Only include messages that are still in INBOX
      if (added.message.labelIds?.includes("INBOX")) {
        messageIds.push(added.message.id);
      }
    }
  }

  return { messageIds, newHistoryId: res.historyId ?? profile.historyId };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch emails matching a query with FULL body (for summariser).
 * Used by cron to get complete email content.
 */
export async function fetchFull(
  env: Env,
  query: string,
  maxResults = 10,
): Promise<ParsedEmail[]> {
  const list = await gmailRequest<GmailListResponse>(
    env,
    `/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`,
  );

  const messages = list.messages ?? [];
  const results: ParsedEmail[] = [];

  for (const meta of messages) {
    try {
      const msg = await gmailRequest<GmailMessage>(
        env,
        `/users/me/messages/${meta.id}?format=full`,
      );
      results.push(parseMessage(msg));
    } catch (err) {
      console.error(`Failed to fetch message ${meta.id}:`, err);
    }
  }

  return results;
}

export async function listEmails(
  env: Env,
  query = "",
  maxResults = 10,
  pageToken?: string,
): Promise<{
  emails: ParsedEmail[];
  nextPageToken: string | null;
  resultSizeEstimate: number;
}> {
  let path = `/users/me/messages?maxResults=${maxResults}`;
  if (query) path += `&q=${encodeURIComponent(query)}`;
  if (pageToken) path += `&pageToken=${encodeURIComponent(pageToken)}`;

  const list = await gmailRequest<GmailListResponse>(env, path);
  const messages = list.messages ?? [];
  const emails: ParsedEmail[] = [];

  for (const meta of messages) {
    try {
      const msg = await gmailRequest<GmailMessage>(
        env,
        `/users/me/messages/${meta.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      );
      // Minimal parse for list view
      const headers = msg.payload?.headers ?? [];
      const senderRaw = extractHeader(headers, "From");
      const subject = extractHeader(headers, "Subject") || "(no subject)";
      const dateStr = extractHeader(headers, "Date");
      const { name, email } = parseSender(senderRaw);
      const labels = msg.labelIds ?? [];

      emails.push({
        id: msg.id,
        threadId: msg.threadId,
        senderName: name,
        senderEmail: email,
        subject,
        date: parseDate(dateStr),
        body: "",
        snippet: msg.snippet ?? "",
        isStarred: labels.includes("STARRED"),
        isImportant: labels.includes("IMPORTANT"),
        hasCalendar: false,
        calendarDetails: {
          title: "",
          date: "",
          time: "",
          location: "",
          organizer: "",
          description: "",
        },
      });
    } catch (err) {
      console.error(`Failed to fetch message ${meta.id}:`, err);
    }
  }

  return {
    emails,
    nextPageToken: list.nextPageToken ?? null,
    resultSizeEstimate: list.resultSizeEstimate ?? 0,
  };
}

export async function getMessage(
  env: Env,
  msgId: string,
): Promise<ParsedEmail | null> {
  try {
    const msg = await gmailRequest<GmailMessage>(
      env,
      `/users/me/messages/${msgId}?format=full`,
    );
    return parseMessage(msg);
  } catch (err) {
    console.error(`Failed to get message ${msgId}:`, err);
    return null;
  }
}

export async function sendReply(
  env: Env,
  threadId: string,
  to: string,
  subject: string,
  body: string,
): Promise<boolean> {
  const subj = subject.startsWith("Re:") ? subject : `Re: ${subject}`;
  const raw = [
    `To: ${to}`,
    `Subject: ${subj}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ].join("\r\n");

  const encoded = base64UrlEncode(raw);

  try {
    await gmailRequest(env, "/users/me/messages/send", {
      method: "POST",
      body: JSON.stringify({ raw: encoded, threadId }),
      headers: { "Content-Type": "application/json" },
    });
    return true;
  } catch (err) {
    console.error("Send reply failed:", err);
    return false;
  }
}

export async function forwardEmail(
  env: Env,
  msgId: string,
  to: string,
): Promise<boolean> {
  try {
    // Fetch the full parsed message to get clean content
    const msg = await gmailRequest<GmailMessage>(
      env,
      `/users/me/messages/${msgId}?format=full`,
    );
    const parsed = parseMessage(msg);

    // Build a clean forward message
    const body = [
      "---------- Forwarded message ----------",
      `From: ${parsed.senderName} <${parsed.senderEmail}>`,
      `Subject: ${parsed.subject}`,
      `Date: ${parsed.date}`,
      "",
      parsed.body || parsed.snippet || "(no content)",
    ].join("\r\n");

    const raw = [
      `To: ${to}`,
      `Subject: Fwd: ${parsed.subject}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      body,
    ].join("\r\n");

    const encoded = base64UrlEncode(raw);

    await gmailRequest(env, "/users/me/messages/send", {
      method: "POST",
      body: JSON.stringify({ raw: encoded }),
      headers: { "Content-Type": "application/json" },
    });
    return true;
  } catch (err) {
    console.error("Forward failed:", err);
    return false;
  }
}

export async function toggleStar(
  env: Env,
  msgId: string,
  isStarred: boolean,
): Promise<boolean> {
  try {
    const body: Record<string, unknown> = isStarred
      ? { removeLabelIds: ["STARRED"] }
      : { addLabelIds: ["STARRED"] };

    await gmailRequest(env, `/users/me/messages/${msgId}/modify`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
    return true;
  } catch (err) {
    console.error("Toggle star failed:", err);
    return false;
  }
}

export async function trashMessage(
  env: Env,
  msgId: string,
): Promise<boolean> {
  try {
    await gmailRequest(env, `/users/me/messages/${msgId}/trash`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    return true;
  } catch (err) {
    console.error("Trash failed:", err);
    return false;
  }
}

export async function sendRsvp(
  env: Env,
  threadId: string,
  to: string,
  subject: string,
  accept: boolean,
): Promise<boolean> {
  const body = accept
    ? "Thank you for the invitation. I accept."
    : "Thank you for the invitation. I am unable to attend.";
  return sendReply(env, threadId, to, subject, body);
}

/**
 * Mark a message as read by removing the UNREAD label.
 */
export async function markAsRead(env: Env, msgId: string): Promise<boolean> {
  try {
    await gmailRequest(env, `/users/me/messages/${msgId}/modify`, {
      method: "POST",
      body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
      headers: { "Content-Type": "application/json" },
    });
    return true;
  } catch (err) {
    console.error("Mark as read failed:", err);
    return false;
  }
}

/**
 * Toggle the IMPORTANT label on a message.
 */
export async function toggleImportant(
  env: Env,
  msgId: string,
  isImportant: boolean,
): Promise<boolean> {
  try {
    const body: Record<string, unknown> = isImportant
      ? { removeLabelIds: ["IMPORTANT"] }
      : { addLabelIds: ["IMPORTANT"] };

    await gmailRequest(env, `/users/me/messages/${msgId}/modify`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
    return true;
  } catch (err) {
    console.error("Toggle important failed:", err);
    return false;
  }
}
