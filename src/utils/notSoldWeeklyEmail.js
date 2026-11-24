// The "Not Sold last week" email: the opps that were lost in the seven days
// before the day it sends, as a table in the email body.
//
// The rows are the Not Sold half of the "closed in the last 7 days" table
// under Opps > New Opps (utils/recentlyClosedOpps.js), read by the same
// rules: Stage is Not Sold, the opp has a BFO Opportunity Name, and its
// Close Date falls in the window. The window differs in one way. The table
// on the page counts today, because it is looked at during the day; a
// weekly email leaves today out and covers the seven whole days before it.
// Sent every Monday that is the Monday to Sunday just ended, and whichever
// day it is sent on, back to back sends never report a deal twice and never
// skip one.
//
// Pure (records in, rows and HTML out), so the cron, the send-now route and
// scripts/notSoldWeeklyEmail.test.mjs share it. Imports carry extensions so
// it loads under plain Node.

import { daysSinceClose } from './recentlyClosedOpps.js';
import { parseDateMs } from './oppsMetrics.js';
import { bfoFieldMissing } from './bfoFields.js';
import { buildDigestTableHtml, buildDigestEmailHtml, DIGEST_HEADER_STYLE } from './newOppsDigestEmail.js';

export const NOT_SOLD_WEEKLY_DAYS = 7;
export const NOT_SOLD_WEEKLY_DEFAULTS = { subject: 'Not Sold Opportunities - Last Week', message: '' };

const dayLabel = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
// Local midnight `back` calendar days before the day of `ms`.
const daysBefore = (ms, back) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime(); };

/** The window's first and last day (local midnights) for a send at `nowMs`. */
export function notSoldWeekWindow(nowMs = Date.now(), days = NOT_SOLD_WEEKLY_DAYS) {
  return { start: daysBefore(nowMs, days), end: daysBefore(nowMs, 1) };
}

/** "Nov 16, 2026 – Nov 22, 2026": the days the email covers. */
export function notSoldWeekLabel(nowMs = Date.now(), days = NOT_SOLD_WEEKLY_DAYS) {
  const { start, end } = notSoldWeekWindow(nowMs, days);
  return `${dayLabel(start)} – ${dayLabel(end)}`;
}

/**
 * The opps marked Not Sold in the window, newest close first, then by
 * account. Each carries `_daysAgo` (1 is yesterday).
 */
export function notSoldLastWeek(records, { days = NOT_SOLD_WEEKLY_DAYS, nowMs = Date.now() } = {}) {
  const rows = [];
  for (const r of (Array.isArray(records) ? records : [])) {
    if (!r || typeof r !== 'object') continue;
    if (String(r['Stage'] ?? '').trim() !== 'Not Sold') continue;
    // 'BFO Link' is the stored key of the BFO Opportunity Name.
    if (bfoFieldMissing(r['BFO Link'])) continue;
    const ago = daysSinceClose(r, nowMs);
    if (ago === null || ago < 1 || ago > days) continue;
    rows.push({ ...r, _daysAgo: ago });
  }
  rows.sort((a, b) => a._daysAgo - b._daysAgo
    || String(a['Account'] || '').localeCompare(String(b['Account'] || '')));
  return rows;
}

const closeDateText = (r) => {
  const ms = parseDateMs(r?.['Close Date']);
  return ms === null ? String(r?.['Close Date'] ?? '') : dayLabel(ms);
};

// The emailed columns, in order. 'BFO Address' renders as a "BFO Link"
// hyperlink (buildDigestTableHtml).
export const NOT_SOLD_WEEKLY_COLUMNS = [
  { key: 'Account', label: 'Account' },
  { key: 'Scope', label: 'Scope' },
  { key: 'Source', label: 'Source' },
  { key: 'Quoted Amount', label: 'Deal Size', align: 'right', nowrap: true },
  { key: 'Close Date', label: 'Close Date', nowrap: true, value: closeDateText },
  { key: 'Reason Not Sold', label: 'Reason Not Sold' },
  { key: 'Competition', label: 'Competition' },
  { key: 'Loss Notes', label: 'Loss Notes' },
  { key: 'BFO Address', label: 'BFO Link', nowrap: true },
];

/** The email body: optional intro, the days covered, then the table. */
export function buildNotSoldWeeklyEmailHtml(rows, { message = '', nowMs = Date.now() } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const count = `${list.length} opp${list.length === 1 ? '' : 's'} marked Not Sold`;
  const period = `<p style="color:#000000;font-size:13px;margin:0 0 12px"><b>${notSoldWeekLabel(nowMs)}</b>${list.length ? ` - ${count}` : ''}</p>`;
  const table = buildDigestTableHtml(list, NOT_SOLD_WEEKLY_COLUMNS, 'No opportunities were marked Not Sold last week.', {
    headStyle: DIGEST_HEADER_STYLE,
    fit: true,
  });
  return buildDigestEmailHtml(`${period}${table}`, { message });
}
