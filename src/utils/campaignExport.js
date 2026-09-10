// Take an email campaign out of the app as a spreadsheet.
//
// The Email Campaign tab knows things nothing else does — who was actually
// emailed, who bounced, who replied, who followed a link, who is coming to
// the event — and until now the only way to get any of it out was to read it
// off the screen. Two files come out of here:
//
//   the open campaign   one row per contact, the whole roster with its
//                       send / delivery / reply / tracking / RSVP detail
//   every campaign      one row per saved campaign, the Saved Campaigns
//                       table plus the dates it was saved and refreshed
//
// The row builders are pure — campaign in, cells out — so the shape of the
// file is pinned by scripts/campaignExport.test.mjs rather than by clicking
// the button. Only `downloadCsv` touches the DOM.
import { campaignSendStats, isCampaignActive, campaignOutreachLabel } from './campaignOutreach.js';
import { stripDashes } from './exportSanitize.js';
import { campaignSubjects } from './campaignSubjects.js';
import { campaignEventUrl } from './campaignEventLink.js';
import { followUpInfo, followUpLabel } from './campaignFollowUp.js';

// One CSV cell. Quoted only where it has to be, doubled quotes inside.
export function csvCell(v) {
  const s = (v === null || v === undefined) ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Header row + data rows → the finished file. CRLF line endings: Excel reads
// either, but a bare \n confuses a few older Windows tools and nothing is
// gained by risking it.
export function toCsv(headers, rows) {
  return [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
}

// Dates go out ISO-first (YYYY-MM-DD, plus the time where we have one that
// matters) so a spreadsheet sorts them as dates instead of as the "Sep 8,
// 2026" text the table prints. Anything unparseable becomes an empty cell —
// a blank sorts and filters cleanly, "-" does not.
export function csvDate(d) {
  if (!d) return '';
  const t = new Date(d);
  return isNaN(t) ? '' : t.toISOString().slice(0, 10);
}

export function csvDateTime(d) {
  if (!d) return '';
  const t = new Date(d);
  if (isNaN(t)) return '';
  return t.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

// Where a contact sits in the send/reply lifecycle, in the words the Status
// column uses. The table reads this too, so the file and the screen can't
// drift apart. Order matters: a reply outranks everything, and a bounce
// outranks an auto-responder because a bounce means nothing arrived at all.
export function contactStatusLabel(c) {
  if (c?.replied) return 'Replied';
  if (c?.bounced) return 'Bounced';
  if (c?.outOfOffice) return 'Out of Office';
  if (c?.sentDate) return 'No Reply';
  return 'Not Sent';
}

// The RSVP as a person would write it, not as it is stored.
const EVENT_STATUS_LABEL = { going: 'Going', 'not-going': 'Not going', maybe: 'Maybe' };
export function eventStatusLabel(v) {
  return EVENT_STATUS_LABEL[v] || '';
}

export const CAMPAIGN_CONTACT_HEADERS = [
  'Campaign', 'Subjects', 'Sent To', 'Name', 'Company', 'Recipients',
  'Sent Date', 'First Sent', 'Sends', 'Follow-up', 'Delivery', 'Status',
  'Clicks', 'First Click', 'Last Click',
  'Replied By', 'Reply Date', 'Bounce Date', 'Out of Office Date',
  'Event Status',
];

/**
 * One contact's row.
 *
 * `delivery` is the campaign's own delivery verdict (already as its label)
 * and `tracking` the joined click record, both passed in by the view because
 * it already computes them
 * (they need the whole tracking collection, which has no business in here).
 * A contact with no tracking record leaves those three cells empty rather than
 * printing zeros: "nobody was watching" and "watched, never clicked" are
 * different answers and a 0 would flatten them into one.
 *
 * Image loads used to lead these columns and no longer do, for the same reason
 * they were dropped from the screen: the pixel fires for messages nobody
 * opened and stays silent for people who read every word, so the column was
 * noise sitting next to a number that means something. The pixel still travels
 * with the mail and still backs the Delivery cell.
 *
 * The two timestamps only go out alongside a non-zero count. The hook's
 * `lastClickAt` is the RAW last click, so a send whose only click was a
 * security gateway's link scan carries a time but counts zero — on screen a
 * tooltip explains that, in a spreadsheet it just reads as a contradiction.
 */
export function campaignContactRow(c, { campaign = {}, delivery = '', tracking = null } = {}) {
  const followUp = followUpInfo(c);
  return [
    campaignOutreachLabel(campaign),
    // Every line the campaign matches on, so a row's send can be traced back
    // to the campaign that claims it even when that campaign runs several.
    campaignSubjects(campaign).join(' | '),
    c?.email || '',
    c?.name || '',
    c?.company || '',
    c?.recipientCount || 1,
    csvDate(c?.sentDate),
    // How many emails this address has had under the campaign's subject lines
    // and whether any of them was a chase — the Follow-up column, in the two
    // forms a spreadsheet can filter on. All three stay blank where the answer
    // isn't known (never sent, or a snapshot saved before it was counted)
    // rather than printing a 1 nobody counted.
    followUp.known ? csvDate(followUp.firstSentDate) : '',
    followUp.known ? followUp.sendCount : '',
    followUpLabel(c),
    delivery,
    contactStatusLabel(c),
    tracking ? tracking.clickCount : '',
    tracking && tracking.clickCount ? csvDateTime(tracking.firstClickAt) : '',
    tracking && tracking.clickCount ? csvDateTime(tracking.lastClickAt) : '',
    c?.repliedBy || '',
    c?.replied ? csvDate(c?.replyDate) : '',
    c?.bounced ? csvDate(c?.bounceDate) : '',
    c?.outOfOffice ? csvDate(c?.oooDate) : '',
    eventStatusLabel(c?.eventStatus),
  ];
}

/**
 * The open campaign's roster as a CSV file.
 *
 * `contacts` is passed separately from the campaign so the export follows
 * whatever order the table is currently sorted into — what you see is what
 * you get — while every column comes along regardless of which ones are
 * hidden: this is the data, not a screenshot.
 */
export function campaignContactsCsv(campaign, contacts, { deliveryFor, trackingFor } = {}) {
  const rows = (contacts || []).map(c => campaignContactRow(c, {
    campaign: campaign || {},
    delivery: deliveryFor ? deliveryFor(c) : '',
    tracking: trackingFor ? trackingFor(c) : null,
  }));
  return toCsv(CAMPAIGN_CONTACT_HEADERS, rows);
}

export const CAMPAIGN_SUMMARY_HEADERS = [
  'Campaign', 'Subjects', 'Contacts', 'Sent', '% Sent', 'Left to Send',
  'Replies', 'Response Rate %', 'Status', 'Saved', 'Last Refreshed',
  // Last, so every column that was here keeps its place — the tests and
  // anybody's saved spreadsheet formula both read these by position.
  'Event Link',
];

// One saved campaign's row: the Saved Campaigns table's own figures, read
// through campaignSendStats so the percentages match to the decimal.
export function campaignSummaryRow(c, nowMs = Date.now()) {
  const { sent, total, remaining, pct } = campaignSendStats(c);
  return [
    campaignOutreachLabel(c),
    campaignSubjects(c).join(' | '),
    total,
    sent,
    pct,
    remaining,
    Number(c?.uniqueRepliers) || 0,
    Number(c?.responseRate) || 0,
    isCampaignActive(c, nowMs) ? 'Active' : 'Inactive',
    csvDate(c?.savedAt),
    csvDate(c?.refreshedAt),
    // As typed, not as displayed: a spreadsheet wants the address it can
    // click, not the shortened label the screen shows.
    campaignEventUrl(c),
  ];
}

export function campaignsSummaryCsv(campaigns, nowMs = Date.now()) {
  const rows = (Array.isArray(campaigns) ? campaigns : [])
    .filter(c => c && typeof c === 'object')
    .map(c => campaignSummaryRow(c, nowMs));
  return toCsv(CAMPAIGN_SUMMARY_HEADERS, rows);
}

// A filename that survives every filesystem: the campaign's own name with the
// characters that don't travel replaced, trimmed to something readable, and
// stamped with the day it was pulled.
export function csvFilename(name, date = new Date()) {
  const stamp = isNaN(date) ? '' : new Date(date).toISOString().slice(0, 10);
  const safe = String(name || 'export')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'export';
  return stripDashes(`${safe}${stamp ? ` ${stamp}` : ''}.csv`);
}

// Hand the file to the browser. The only part of this module that needs a DOM;
// the BOM is what makes Excel open a UTF-8 CSV as UTF-8 rather than mangling
// every accented name in it.
export function downloadCsv(filename, csv) {
  const blob = new Blob(['\uFEFF' + stripDashes(csv)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
