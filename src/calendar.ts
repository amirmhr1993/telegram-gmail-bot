/**
 * Calendar invite detection and ICS parsing.
 * Detects .ics attachments and calendar keywords, extracts event details.
 */

import type { CalendarDetails } from "./types";

const EMPTY_CALENDAR: CalendarDetails = {
  title: "",
  date: "",
  time: "",
  location: "",
  organizer: "",
  description: "",
};

/**
 * Extract calendar event details from an email body.
 * Tries ICS parsing first, falls back to regex patterns.
 */
export function extractCalendarDetails(body: string): CalendarDetails {
  if (!body) return EMPTY_CALENDAR;

  // Check if the body contains ICS data inline
  if (body.includes("BEGIN:VCALENDAR")) {
    return parseIcsContent(body);
  }

  return extractFromText(body);
}

/**
 * Parse an ICS (iCalendar) content string.
 */
export function parseIcsContent(icsData: string): CalendarDetails {
  const details = { ...EMPTY_CALENDAR };

  // Extract VEVENT block
  const eventMatch = icsData.match(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/);
  if (!eventMatch) return details;

  const event = eventMatch[1];

  // Summary / Title
  const summaryMatch = event.match(/SUMMARY:(.+)/);
  if (summaryMatch) {
    details.title = unescapeIcs(summaryMatch[1].trim());
  }

  // Date/Time — parse DTSTART
  const dtStartMatch = event.match(/DTSTART(?:;[^:]*)?:([^\r\n]+)/);
  if (dtStartMatch) {
    const parsed = parseIcsDateTime(dtStartMatch[1].trim());
    details.date = parsed.date;
    details.time = parsed.time;
  }

  // Location
  const locationMatch = event.match(/LOCATION:(.+)/);
  if (locationMatch) {
    details.location = unescapeIcs(locationMatch[1].trim());
  }

  // Organizer
  const organizerMatch = event.match(/ORGANIZER[^:]*:(.+)/);
  if (organizerMatch) {
    details.organizer = unescapeIcs(organizerMatch[1].trim());
  }

  // Description
  const descMatch = event.match(/DESCRIPTION:(.+)/);
  if (descMatch) {
    details.description = unescapeIcs(descMatch[1].trim()).slice(0, 200);
  }

  return details;
}

/**
 * Parse an ICS datetime string like "20260115T143000Z" or "20260115".
 */
function parseIcsDateTime(dt: string): { date: string; time: string } {
  // Format: YYYYMMDD or YYYYMMDDTHHmmssZ or YYYYMMDDTHHmmss
  const match = dt.match(
    /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(?:Z)?$/,
  );

  if (!match) return { date: dt, time: "" };

  const [, year, month, day, hour, minute] = match;
  const date = `${year}-${month}-${day}`;
  const time = hour ? `${hour}:${minute}` : "";

  return { date, time };
}

/**
 * Unescape ICS text values.
 */
function unescapeIcs(text: string): string {
  return text
    .replace(/\\n/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\\\/g, "\\")
    .replace(/\\;/g, ";");
}

/**
 * Fallback: extract calendar details from plain text using regex patterns.
 */
function extractFromText(body: string): CalendarDetails {
  const details = { ...EMPTY_CALENDAR };
  const lines = body.split(/\r?\n/);

  const patterns: Record<keyof CalendarDetails, RegExp[]> = {
    title: [
      /(?:Subject|Event|Summary|What)\s*:\s*(.+)/i,
    ],
    date: [
      /(?:Date|When)\s*:\s*(.+)/i,
    ],
    time: [
      /(?:Time)\s*:\s*(.+)/i,
    ],
    location: [
      /(?:Location|Where|Place)\s*:\s*(.+)/i,
    ],
    organizer: [
      /(?:Organizer|Organised by|From)\s*:\s*(.+)/i,
    ],
    description: [
      /(?:Description|Details|Notes)\s*:\s*(.+)/i,
    ],
  };

  for (const line of lines) {
    const trimmed = line.trim();
    for (const [key, pats] of Object.entries(patterns) as [
      keyof CalendarDetails,
      RegExp[],
    ][]) {
      if (details[key]) continue;
      for (const pat of pats) {
        const m = trimmed.match(pat);
        if (m) {
          details[key] = m[1].trim();
          break;
        }
      }
    }
  }

  return details;
}

/**
 * Check if an email is a calendar invite.
 */
export function isCalendarInvite(body: string, filename?: string): boolean {
  if (filename?.toLowerCase().endsWith(".ics")) return true;
  if (body.includes("BEGIN:VCALENDAR")) return true;

  const lower = body.toLowerCase();
  return ["invitation", "calendar", "meeting invite", "rsvp", "event"].some(
    (kw) => lower.includes(kw),
  );
}
