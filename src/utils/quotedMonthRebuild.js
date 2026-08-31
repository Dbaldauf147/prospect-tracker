// Rebuilding a past Quoted Projections month end out of today's Opps data.
//
// The YOY chart plots five figures a month. Months the app was open for get
// captured live; the rest have to be reconstructed, and a reconstruction is
// only as good as the history behind it. Two questions decide that, and both
// live here so they can be tested without rendering the chart:
//
//   1. What Stage was an opp in at that month end?  Reading today's Stage
//      instead is what made three consecutive months report an identical
//      Agreements Sent figure — every opp currently in "Agreement Sent" was
//      counted into every past month, and every opp that had since been sold
//      out of them. `stageAsOf` answers it from the stage history Opps 2
//      keeps on each row.
//   2. Whose figure is a stored month?  A rebuild may re-derive its own work
//      and fill a gap, but must never overwrite what the user typed.
//      `rebuildOwnsMonth` draws that line.

import { QUOTED_FIELDS } from './quotedProjectionsStore.js';

// Stage-history dates are ISO days ("YYYY-MM-DD"), which Date.parse reads as
// UTC midnight — the same basis as the UTC month ends they're compared
// against. Returns null for anything unparseable.
function histDateMs(raw) {
  if (!raw) return null;
  const t = Date.parse(String(raw));
  return Number.isNaN(t) ? null : t;
}

// Last instant of a "YYYY-MM" month, in UTC. null for a malformed key.
export function monthEndMs(monthKey) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ''));
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]), 0) + 86399999;
}

// The Stage an opp was sitting in at a past moment, read off the stage
// history Opps 2 keeps: `_stageHistory` records each stage as it is LEFT
// (oldest first, with the date it was exited) and `_stageEnteredAt` dates the
// stage the opp sits in now.
//
// Returns { stage, tracked }. `tracked` is false when nothing places the opp
// at that moment — a row that has never moved stage, or one imported before
// the history existed — and `stage` is then today's value: the same guess the
// rebuild made before, and the only one available for that row.
export function stageAsOf(record, atMs) {
  const current = String(record?.Stage || '').trim();
  const hist = Array.isArray(record?._stageHistory) ? record._stageHistory : [];
  for (const h of hist) {
    const exited = histDateMs(h?.exitedAt);
    // Left on or before the cut-off (or undated): the opp had moved on by then.
    if (exited == null || exited <= atMs) continue;
    const stage = String(h?.stage || '').trim();
    if (stage) return { stage, tracked: true };
  }
  // Past every recorded exit: today's stage, provided it was entered by then.
  const entered = histDateMs(record?._stageEnteredAt);
  if (entered != null && entered <= atMs) return { stage: current, tracked: true };
  return { stage: current, tracked: false };
}

// Do two stored Quoted Projections entries plot the same five figures? Used
// to keep a re-derived month from writing (and mirroring) a value identical
// to the one already stored.
export function sameQuotedValues(a, b) {
  if (!a || !b) return false;
  return QUOTED_FIELDS.every(f => (a[f] ?? null) === (b[f] ?? null));
}

// Was an auto-captured month taken at that month's end, or just at whatever
// point the app happened to be open? `_capturedAt` stamps the capture, so an
// entry without one predates the stamp and can't claim to be a month-end
// reading. The comparison is against the start of the last day in UTC, which
// also counts a capture made late on the second-to-last day local time —
// harmless slack for what this decides.
export function capturedAtMonthEnd(saved, monthKey) {
  const at = saved && saved._capturedAt ? Date.parse(String(saved._capturedAt)) : NaN;
  if (Number.isNaN(at)) return false;
  const m = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ''));
  if (!m) return false;
  return at >= Date.UTC(Number(m[1]), Number(m[2]), 0);
}

// Which finished months the rebuild owns — i.e. may (re)derive from the Opps
// data. A month with nothing recorded, one that is itself a rebuild, and an
// auto-capture that wasn't taken at the month end (a mid-month reading
// wearing a month-end label) are all the rebuild's; anything typed through
// "Edit values", and the seeded historical figures, are the user's and stand.
//
// Re-deriving rather than filling once is what lets a correction to the
// reconstruction reach months already stored: the stage-history fix would
// otherwise have left June and July frozen on the figures the old rebuild
// wrote for them.
export function rebuildOwnsMonth(saved, monthKey) {
  if (!saved) return true;
  if (saved._rebuilt) return true;
  if (saved._auto) return !capturedAtMonthEnd(saved, monthKey);
  return false;
}
