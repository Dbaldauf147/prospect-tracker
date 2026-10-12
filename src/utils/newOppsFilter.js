// Which opps are "new": the rule behind Opps > New Opps, the New Opps
// email (api/_lib/newOpps.js) and the Issues tab's missing-vertical check.
// Pure on purpose, so the server imports it as it is.
import { coverageIndex, companyVerticalIndex, oppVerticalCoverage } from './oppVerticalCoverage.js';
//
// Qualification rules (mirror NEW_OPPS_* in OppsView2): an opp shows
// when it has a BFO Opportunity Name, its current Stage is one of these, and
// its combined time across these stages is at most this many days.
export const NEW_OPPS_ACTIVE_STAGES = ['Lead', 'Qualifying', 'Quoting'];
const NEW_OPPS_ACTIVE_STAGES_SET = new Set(NEW_OPPS_ACTIVE_STAGES);
export const NEW_OPPS_MAX_STAGE_AGE_DAYS = 7;

// ---- Date helpers (mirror PEPortfolioView / Opps 2) ---------------------
function parseOppsDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s);
  return Number.isNaN(t) ? null : new Date(t);
}

// Whole calendar days from an ISO/parseable date up to today (>= 0). Mirrors
// OppsView2's daysFromToday negated + floored at zero.
function daysSince(raw) {
  const d = parseOppsDate(raw);
  if (!d) return null;
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today - d) / 86400000));
}

// Combined days an opp has spent across the Lead + Qualifying + Quoting
// stages: historical durations from `_stageHistory` plus the live days-so-far
// when the current Stage is one of those three. Mirrors combinedActiveStageAge
// in OppsView2 so the server filter matches the on-screen list.
export function combinedActiveStageAge(r) {
  let total = 0;
  for (const h of (Array.isArray(r && r._stageHistory) ? r._stageHistory : [])) {
    const s = String(h && h.stage || '').trim();
    if (!NEW_OPPS_ACTIVE_STAGES_SET.has(s)) continue;
    const d = Number(h && h.days);
    if (Number.isFinite(d) && d >= 0) total += d;
  }
  const stage = String(r && r['Stage'] || '').trim();
  if (NEW_OPPS_ACTIVE_STAGES_SET.has(stage)) {
    const since = daysSince((r && r._stageEnteredAt) || (r && r['Start Date']));
    total += since == null ? 0 : since;
  }
  return total;
}

const bfoMissing = (v) => {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === '' || s === '-' || s === '#n/a' || s === 'n/a';
};

// True when an opp qualifies for the New Opps report.
export function qualifiesNewOpp(r) {
  if (!r || typeof r !== 'object') return false;
  const stage = String(r['Stage'] || '').trim();
  if (!NEW_OPPS_ACTIVE_STAGES_SET.has(stage)) return false; // also excludes Not Started
  if (bfoMissing(r['BFO Link'])) return false;
  return combinedActiveStageAge(r) <= NEW_OPPS_MAX_STAGE_AGE_DAYS;
}

// The new opps with no vertical, or with a vertical nobody on Opps >
// Coverage covers (no Vertical CDM): [{ record, vertical }], vertical ''
// when there is none. Filled the way the subtab fills its columns
// (oppVerticalCoverage.js). Feeds the Issues tab.
export function newOppsMissingVertical(records, { settings = null, prospects = [] } = {}) {
  const fresh = (Array.isArray(records) ? records : []).filter(qualifiesNewOpp);
  const ctx = { coverage: coverageIndex(settings), companies: companyVerticalIndex(prospects) };
  const out = [];
  for (const record of fresh) {
    const { vertical, salesperson } = oppVerticalCoverage(record, ctx);
    if (!vertical || !salesperson) out.push({ record, vertical });
  }
  return out;
}
