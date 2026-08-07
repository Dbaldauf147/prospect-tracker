// The colour a service status is painted, and which outcome bucket it
// falls in.
//
// Three boards render service statuses — the company card's Services
// Explored grid, Opps 2's Scope picker, and the PE Overview services
// report — and a service has to read the same colour in all of them. The
// palette was already copied between the first two; this is the one copy.

import { TRYING_AGAIN, TRYING_AGAIN_COLORS } from './tryingAgain.js';

// Green = won, amber = in flight, blue = quoted, red = lost, slate =
// parked or not applicable.
export const SERVICE_STATUS_COLORS = {
  'Sold': { bg: '#DCFCE7', color: '#166534' },
  'Verbal': { bg: '#DCFCE7', color: '#166534' },
  'Renewal': { bg: '#F1F5F9', color: '#94A3B8' },
  'In Progress': { bg: '#FEF9C3', color: '#854D0E' },
  'Exploring': { bg: '#FEF9C3', color: '#854D0E' },
  'Qualifying': { bg: '#FEF9C3', color: '#854D0E' },
  'Quoting': { bg: '#FEF9C3', color: '#854D0E' },
  'Quoted': { bg: '#DBEAFE', color: '#1E40AF' },
  'Proposed': { bg: '#DBEAFE', color: '#1E40AF' },
  'Lead': { bg: '#FEF9C3', color: '#854D0E' },
  'Not Started': { bg: '#FEF9C3', color: '#854D0E' },
  'Not Sold': { bg: '#FEE2E2', color: '#991B1B' },
  'N/A': { bg: '#F1F5F9', color: '#94A3B8' },
  // Derived rather than picked today, but coloured here too so the status
  // reads purple if it is ever added to the selectable statuses.
  [TRYING_AGAIN]: { bg: TRYING_AGAIN_COLORS.bg, color: TRYING_AGAIN_COLORS.color },
};

/** The chip colours for a status, or an empty object when it has none. */
export function serviceStatusColor(status) {
  return SERVICE_STATUS_COLORS[status] || {};
}

// The outcome a status rolls up to when a report counts them. Deliberately
// coarser than the status list: a report answers "where does this stand",
// and Exploring / Quoting / Verbal are all the same answer to that.
//
// `color` / `bg` paint the on-screen report. `xlsx` paints the Excel
// export's Detail grid, and is NOT the same palette — the export is read
// as a RAG status sheet, so an unexplored service has to stand out as
// work to do (yellow) rather than recede as an empty cell. That pushes
// the in-flight statuses off amber and onto blue, which is the only way
// the two stay tellable apart on the page.
//
// `exportLabel` is the wording in the workbook: "Sold" is internal
// pipeline vocabulary, and a portfolio review reads better as what the
// company actually has today.
export const SERVICE_BUCKETS = [
  { key: 'sold', label: 'Sold', exportLabel: 'Existing service', color: '#166534', bg: '#DCFCE7', xlsx: { bg: 'FFDCFCE7', color: 'FF166534' } },
  { key: 'inProgress', label: 'In progress', color: '#854D0E', bg: '#FEF9C3', xlsx: { bg: 'FFDBEAFE', color: 'FF1E40AF' } },
  { key: 'notSold', label: 'Not sold', color: '#991B1B', bg: '#FEE2E2', xlsx: { bg: 'FFFEE2E2', color: 'FF991B1B' } },
  { key: 'na', label: 'N/A', color: '#94A3B8', bg: '#F1F5F9', xlsx: { bg: 'FFE2E8F0', color: 'FF475569' } },
  { key: 'none', label: 'Not explored', color: '#94A3B8', bg: '#FFFFFF', xlsx: { bg: 'FFFEF9C3', color: 'FF854D0E' } },
];

const BUCKET_BY_KEY = new Map(SERVICE_BUCKETS.map(b => [b.key, b]));

/** A bucket by key, or undefined. */
export function serviceBucket(key) {
  return BUCKET_BY_KEY.get(key);
}

/** How a bucket is named in the Excel export. */
export function bucketExportLabel(bucket) {
  return bucket.exportLabel || bucket.label;
}

/**
 * How one cell of the export's Detail grid reads. An unexplored service
 * says so rather than sitting blank — a blank cell in a status grid is
 * ambiguous between "nothing here" and "nobody filled this in" — and a
 * sold one uses the export's own wording. Every other status is reported
 * verbatim, so the sheet still says Exploring vs Quoting vs Verbal.
 */
export function exportStatusLabel(status) {
  const bucket = serviceStatusBucket(status);
  if (bucket === 'sold' || bucket === 'none') return bucketExportLabel(BUCKET_BY_KEY.get(bucket));
  return String(status || '').trim();
}

/**
 * Which bucket a status falls in. Mirrors how the PE Overview table
 * already splits Services Sold / Not Sold / In Progress, with the two
 * cases those three columns drop — N/A (a deliberate "doesn't apply") and
 * an empty status (never explored) — named rather than lumped together.
 */
export function serviceStatusBucket(status) {
  const s = String(status || '').trim();
  if (!s || s === '-') return 'none';
  if (s === 'Sold') return 'sold';
  if (s === 'Not Sold') return 'notSold';
  if (s.toLowerCase() === 'n/a') return 'na';
  return 'inProgress';
}
