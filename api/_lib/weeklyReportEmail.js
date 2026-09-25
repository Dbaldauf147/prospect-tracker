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
import { renderWeeklyReportHtml, freshnessNote } from './weeklyReportEmailHtml.js';

export {
  renderWeeklyReportHtml, narrativeHtml, freshnessNote, staleBannerHtml,
} from './weeklyReportEmailHtml.js';

// The funnel picture travels as an attachment the message carries, not as
// a link out to one. Outlook and Gmail both block a remote image until the
// reader asks for it — the "prevented automatic download of pictures"
// banner — and a chart nobody clicks to see is a chart nobody sees. An
// attachment referenced by Content-ID is part of the message and renders
// without asking. (Same arrangement as the oil-price digest's chart.)
const FUNNEL_CID = 'weekly-report-funnel@prospect-tracker';

const PNG_PREFIX = 'data:image/png;base64,';

const pngBytes = (src) => {
  const s = String(src || '');
  return s.startsWith(PNG_PREFIX) ? Buffer.from(s.slice(PNG_PREFIX.length), 'base64') : null;
};

// The snapshot stores the PNG as a data URL, which is what the tab's
// preview renders directly; a sent message needs the bytes instead.
export function funnelAttachment(snapshot) {
  const content = pngBytes(snapshot?.funnelImage?.src);
  if (!content) return null;
  return {
    filename: 'pipeline-funnel.png',
    content,
    cid: FUNNEL_CID,
    contentType: 'image/png',
  };
}

// The same arrangement for the coverage charts, one attachment each. Their
// ids come from the Progress tab (`contactPct`, `dmPct`) and are what the
// markup looks each picture up by, so a card and its chart cannot be
// paired up wrongly by position.
export function coverageAttachments(snapshot) {
  const charts = Array.isArray(snapshot?.coverage?.charts) ? snapshot.coverage.charts : [];
  const out = [];
  for (const chart of charts) {
    const content = pngBytes(chart?.image?.src);
    const id = String(chart?.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!content || !id) continue;
    out.push({
      id,
      cid: `weekly-report-coverage-${id}@prospect-tracker`,
      filename: `account-coverage-${id}.png`,
      content,
      contentType: 'image/png',
    });
  }
  return out;
}

// The coverage ratio's line chart, as its own attachment.
const COVERAGE_RATIO_CID = 'weekly-report-coverage-ratio@prospect-tracker';

export function coverageRatioAttachment(snapshot) {
  const content = pngBytes(snapshot?.coverageRatio?.image?.src);
  if (!content) return null;
  return {
    filename: 'coverage-ratio.png',
    content,
    cid: COVERAGE_RATIO_CID,
    contentType: 'image/png',
  };
}

// A stale send is marked in the subject as well as in the banner. The
// banner only works on a report someone opens; the tag is what says "these
// are old numbers" from the message list, which is where a weekly report
// that arrives every Monday is mostly read.
export const staleSubject = (subject, fresh) => (
  `${fresh?.stale ? '[Stale] ' : ''}${subject}`.slice(0, 300)
);

export async function sendWeeklyReportEmail({ to, subject, message, snapshot, replyTo }) {
  const attachment = funnelAttachment(snapshot);
  const coverage = coverageAttachments(snapshot);
  const coverageImageSrcs = Object.fromEntries(coverage.map(a => [a.id, `cid:${a.cid}`]));
  const ratio = coverageRatioAttachment(snapshot);
  const html = renderWeeklyReportHtml(snapshot, {
    message,
    funnelImageSrc: attachment ? `cid:${FUNNEL_CID}` : '',
    coverageImageSrcs,
    coverageRatioImageSrc: ratio ? `cid:${ratio.cid}` : '',
  });
  const label = snapshot?.periodLabel ? ` - ${snapshot.periodLabel}` : '';
  // `id` is this module's own bookkeeping for pairing a picture with its
  // card; the mailer wants the file, so it is left behind here.
  const files = [
    ...(attachment ? [attachment] : []),
    ...(ratio ? [ratio] : []),
    ...coverage.map(a => ({ filename: a.filename, content: a.content, cid: a.cid, contentType: a.contentType })),
  ];
  return sendEmail({
    to,
    subject: staleSubject(String(subject || `Weekly Report${label}`), freshnessNote(snapshot)),
    html,
    attachments: files.length ? files : undefined,
    replyTo,
  });
}
