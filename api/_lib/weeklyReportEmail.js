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
// nothing, so the tab's "Preview email" renders the exact bytes this
// sends rather than a lookalike.

import { sendEmail } from './mailer.js';
import { renderWeeklyReportHtml } from './weeklyReportEmailHtml.js';

export {
  renderWeeklyReportHtml, narrativeHtml, freshnessNote,
} from './weeklyReportEmailHtml.js';

// The funnel picture travels as an attachment the message carries, not as
// a link out to one. Outlook and Gmail both block a remote image until the
// reader asks for it — the "prevented automatic download of pictures"
// banner — and a chart nobody clicks to see is a chart nobody sees. An
// attachment referenced by Content-ID is part of the message and renders
// without asking. (Same arrangement as the oil-price digest's chart.)
const FUNNEL_CID = 'weekly-report-funnel@prospect-tracker';

// The snapshot stores the PNG as a data URL, which is what the tab's
// preview renders directly; a sent message needs the bytes instead.
export function funnelAttachment(snapshot) {
  const src = String(snapshot?.funnelImage?.src || '');
  const base64 = src.startsWith('data:image/png;base64,')
    ? src.slice('data:image/png;base64,'.length)
    : '';
  if (!base64) return null;
  return {
    filename: 'pipeline-funnel.png',
    content: Buffer.from(base64, 'base64'),
    cid: FUNNEL_CID,
    contentType: 'image/png',
  };
}

export async function sendWeeklyReportEmail({ to, subject, message, snapshot, replyTo }) {
  const attachment = funnelAttachment(snapshot);
  const html = renderWeeklyReportHtml(snapshot, {
    message,
    funnelImageSrc: attachment ? `cid:${FUNNEL_CID}` : '',
  });
  const label = snapshot?.periodLabel ? ` — ${snapshot.periodLabel}` : '';
  return sendEmail({
    to,
    subject: String(subject || `Weekly Report${label}`).slice(0, 300),
    html,
    attachments: attachment ? [attachment] : undefined,
    replyTo,
  });
}
