// Sends a Weekly Report snapshot as an HTML email.
//
// The report's numbers are computed in the browser, off caches that only
// exist there (the HubSpot activity cache, the Opps 2 and pipeline
// IndexedDB stores, the YOY pins). Rather than reimplement all of that
// server-side — a second copy of the same arithmetic, free to drift from
// what the user actually sees — the Weekly Report tab publishes a snapshot
// of what it rendered, and this module mails that back.
//
// The trade is freshness: a snapshot is only as current as the last time
// the tab was open, so every email states when it was captured and says so
// plainly when that predates the end of the period it covers.
//
// The markup itself lives in ./weeklyReportEmailHtml.js, which imports
// nothing — so the tab's "Preview email" renders the exact bytes this
// sends rather than a lookalike.

import { sendEmail } from './mailer.js';
import { renderWeeklyReportHtml } from './weeklyReportEmailHtml.js';

export {
  renderWeeklyReportHtml, narrativeHtml, freshnessNote,
} from './weeklyReportEmailHtml.js';

export async function sendWeeklyReportEmail({ to, subject, message, snapshot, replyTo }) {
  const html = renderWeeklyReportHtml(snapshot, { message });
  const label = snapshot?.periodLabel ? ` — ${snapshot.periodLabel}` : '';
  return sendEmail({
    to,
    subject: String(subject || `Weekly Report${label}`).slice(0, 300),
    html,
    replyTo,
  });
}
