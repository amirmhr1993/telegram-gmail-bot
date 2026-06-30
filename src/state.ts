/**
 * KV-based conversation state management.
 */

import type { ConversationState, EmailListPage, Env } from "./types";

const STATE_PREFIX = "conv_";
const PAGE_PREFIX = "page_";
const LAST_CHECK_KEY = "last_check_ts";
const STATE_TTL = 600; // 10 minutes

// ── Conversation state ─────────────────────────────────────────────────────

export async function getState(
  env: Env,
  chatId: number,
): Promise<ConversationState | null> {
  const key = `${STATE_PREFIX}${chatId}`;
  const data = await env.EMAIL_BOT_KV.get(key, { type: "json" });
  if (!data) return null;

  const state = data as ConversationState;

  if (Date.now() - state.timestamp > STATE_TTL * 1000) {
    await env.EMAIL_BOT_KV.delete(key);
    return null;
  }

  return state;
}

export async function setState(
  env: Env,
  chatId: number,
  state: ConversationState,
): Promise<void> {
  const key = `${STATE_PREFIX}${chatId}`;
  await env.EMAIL_BOT_KV.put(key, JSON.stringify(state), {
    expirationTtl: STATE_TTL,
  });
}

export async function clearState(
  env: Env,
  chatId: number,
): Promise<void> {
  const key = `${STATE_PREFIX}${chatId}`;
  await env.EMAIL_BOT_KV.delete(key);
}

// ── Email list pages ───────────────────────────────────────────────────────

export async function saveEmailPage(
  env: Env,
  chatId: number,
  page: EmailListPage,
): Promise<void> {
  const key = `${PAGE_PREFIX}${chatId}_${page.page}`;
  await env.EMAIL_BOT_KV.put(key, JSON.stringify(page), {
    expirationTtl: STATE_TTL,
  });
}

export async function getEmailPage(
  env: Env,
  chatId: number,
  page: number,
): Promise<EmailListPage | null> {
  const key = `${PAGE_PREFIX}${chatId}_${page}`;
  const data = await env.EMAIL_BOT_KV.get(key, { type: "json" });
  return (data as EmailListPage) ?? null;
}

// ── Last check timestamp ───────────────────────────────────────────────────
// Stores Unix seconds of when we last successfully checked for new emails.
// Gmail query uses this with newer_than to avoid re-notifying.

export async function getLastCheckTs(env: Env): Promise<number> {
  const raw = await env.EMAIL_BOT_KV.get(LAST_CHECK_KEY);
  return raw ? parseInt(raw, 10) : 0;
}

export async function setLastCheckTs(env: Env, ts: number): Promise<void> {
  await env.EMAIL_BOT_KV.put(LAST_CHECK_KEY, String(ts));
}
