// "Last Searched" on a company's targets: the day somebody last looked for
// the company's sustainability targets. Stored on the company record as
// `targetsSearchedAt: 'YYYY-MM-DD'` (one date per company, like
// targetsReachedOut). Set by hand on the company popup's Targets tab, and
// stamped with today whenever a Search web link is opened there or targets
// are pasted in. Shown as a column on Prospecting > Targets.
//
// Pure (scripts/targetsSearched.test.mjs).
import { hasTargetValues } from './companyTargets.js';

export const TARGETS_SEARCHED_FIELD = 'targetsSearchedAt';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The stored date, or '' when there is none (or it isn't a date). */
export function targetsSearchedAt(p) {
  const v = String(p?.[TARGETS_SEARCHED_FIELD] || '').trim();
  return DAY_RE.test(v) ? v : '';
}

/** Today (or `d`) as a local 'YYYY-MM-DD'. */
export function localToday(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'Nov 18, 2026', or '' with no date. */
export function fmtSearched(day) {
  return day ? new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

// One-time backfill, Nov 18 2026: Dan asked that every company with targets
// already logged read as searched that day. Fixed to the date asked for, so a
// browser that first loads tomorrow still writes the 18th. Recorded in
// settings.backfillPassesDone[TARGETS_SEARCHED_BACKFILL_FLAG] (App.jsx).
export const TARGETS_SEARCHED_BACKFILL_FLAG = 'targets-searched-2026-11-18';
export const TARGETS_SEARCHED_BACKFILL_DAY = '2026-11-18';

/** The companies the backfill dates: targets logged, no Last Searched yet. */
export function targetsSearchedBackfill(prospects, day = TARGETS_SEARCHED_BACKFILL_DAY) {
  const out = [];
  for (const p of prospects || []) {
    if (!p?.id || targetsSearchedAt(p) || !hasTargetValues(p.climateTargets)) continue;
    out.push({ id: p.id, company: p.company || '', patch: { [TARGETS_SEARCHED_FIELD]: day } });
  }
  return out;
}
