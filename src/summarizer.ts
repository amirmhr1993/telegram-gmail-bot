/**
 * Extractive email summariser.
 * No LLM required — picks the most informative sentences up to ~300 words.
 */

const MAX_WORDS = 300;

// Common email keywords that signal important sentences
const KEYWORDS = new Set([
  "please",
  "need",
  "request",
  "confirm",
  "deadline",
  "meeting",
  "important",
  "action",
  "update",
  "summary",
  "attachment",
  "schedule",
  "invoice",
  "payment",
  "review",
  "approve",
  "asap",
  "urgent",
  "follow-up",
  "follow up",
  "response",
  "required",
]);

/**
 * Return a ~300-word extractive summary of the email body.
 */
export function summarise(body: string): string {
  if (!body || !body.trim()) return "(empty email)";

  // Strip HTML tags
  const clean = body
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return "(empty email)";

  // Split into sentences (split on . ! ? followed by space or end)
  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);

  if (sentences.length === 0) {
    return clean.slice(0, MAX_WORDS * 6);
  }

  // Score each sentence
  const scored = sentences.map((sent, idx) => {
    const words = new Set(sent.toLowerCase().split(/\s+/));
    const keywordHits = [...words].filter((w) => KEYWORDS.has(w)).length;

    // Position bonus: middle sentences often carry the main point
    const positionRatio = idx / Math.max(sentences.length - 1, 1);
    const positionBonus = positionRatio > 0.15 && positionRatio < 0.85 ? 1.3 : 1.0;

    // Length penalty: very short sentences are less informative
    const wordCount = words.size;
    const lengthBonus = wordCount > 5 ? 1.0 : 0.5;

    const score = keywordHits * 1.5 + positionBonus + lengthBonus;
    return { score, sent, wordCount };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Greedily pick sentences up to MAX_WORDS
  const picked: string[] = [];
  let totalWords = 0;

  for (const { sent, wordCount } of scored) {
    if (totalWords + wordCount > MAX_WORDS) break;
    picked.push(sent);
    totalWords += wordCount;
  }

  if (picked.length === 0) {
    // Fallback: take first few sentences
    return sentences.slice(0, 5).join(" ");
  }

  return picked.join(" ");
}
