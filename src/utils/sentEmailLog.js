// A compact copy of the emails in the Activity tab's HubSpot feed, kept in
// IndexedDB so other pages can ask "has this been sent?".
//
// The feed itself is saved to localStorage, and a real one does not fit:
// with ten thousand emails it runs past the ~5MB quota and the save is
// dropped (ActivityView's saveCache says so in the console and carries on).
// So a page that read the feed from there, as Draft Emails' green Sent pills
// did, found nothing for exactly the people who send the most.
//
// This keeps only what a "was it sent" question needs: subject, recipients,
// sender, direction and time, for each email. It lives in IndexedDB, where
// the relationship touch index already went for the same reason. Rows keep
// HubSpot's own field names, so sentPerActivity reads this log and the full
// feed the same way.
import { dbGet, dbPut, getDbUserId } from './db.js';

// An existing store, under a key of its own: adding a store means an
// IndexedDB version upgrade, which another open tab can block.
const STORE = 'relationship-touches';
const KEY = 'sent-email-log';
const FIELDS = ['hs_email_subject', 'hs_email_to_email', 'hs_email_from_email', 'hs_email_direction', 'hs_timestamp'];

// Announced once the log is on disk. The Activity tab's own
// `hubspot-activity-cache-updated` fires before the write lands.
export const SENT_EMAIL_LOG_EVENT = 'sent-email-log-updated';

/** The feed's emails cut down to the fields above: { v, fetchedAt, emails }. */
export function buildSentEmailLog(feed) {
  const emails = [];
  for (const e of Array.isArray(feed?.emails) ? feed.emails : []) {
    if (!e || !e.hs_timestamp) continue;
    const row = {};
    for (const f of FIELDS) if (e[f]) row[f] = String(e[f]);
    emails.push(row);
  }
  return { v: 1, fetchedAt: feed?.fetchedAt || '', emails };
}

/** Write the log for the signed-in user. Never throws: it is a convenience copy. */
export async function saveSentEmailLog(feed) {
  if (!getDbUserId()) return false;
  try {
    await dbPut(STORE, buildSentEmailLog(feed), KEY);
    try { window.dispatchEvent(new CustomEvent(SENT_EMAIL_LOG_EVENT)); } catch { /* no window */ }
    return true;
  } catch (err) {
    console.warn('Sent email log write skipped:', err?.message || err);
    return false;
  }
}

/** The stored log, or null when there is none (or nobody is signed in yet). */
export async function loadSentEmailLog() {
  if (!getDbUserId()) return null;
  try {
    const log = await dbGet(STORE, KEY);
    return log?.v === 1 && Array.isArray(log.emails) ? log : null;
  } catch {
    return null;
  }
}
