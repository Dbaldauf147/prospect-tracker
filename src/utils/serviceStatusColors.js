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
export const SERVICE_BUCKETS = [
  { key: 'sold', label: 'Sold', color: '#166534', bg: '#DCFCE7' },
  { key: 'inProgress', label: 'In progress', color: '#854D0E', bg: '#FEF9C3' },
  { key: 'notSold', label: 'Not sold', color: '#991B1B', bg: '#FEE2E2' },
  { key: 'na', label: 'N/A', color: '#94A3B8', bg: '#F1F5F9' },
  { key: 'none', label: 'Not explored', color: '#94A3B8', bg: '#FFFFFF' },
];

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
