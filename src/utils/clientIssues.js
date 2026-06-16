// Issue detection for the Issues tab. The Issues tab aggregates
// "outstanding items that need to be addressed" across the app; each
// detector below turns one class of problem into a flat issue row.
//
// The Clients-tab "Days Until" computation lives here so the Issues tab
// and the Clients tab agree on what's expired — there's one definition
// of soonest expiration, not two that can drift apart.
import { asDate, fmtDate } from './dealsFormat';
import { matchesCdm } from './cdmMatch';

const MS_PER_DAY = 86400000;

// The Paperwork column doubles as a status field — "Cancelled" / "Expired"
// mark agreements that no longer count regardless of their End Date.
const INACTIVE_STATUSES = new Set(['cancelled', 'canceled', 'expired']);
export function isInactiveAgreement(deal) {
  const status = String(deal?.['Paperwork completed'] || '').trim().toLowerCase();
  return INACTIVE_STATUSES.has(status);
}

export function normClientName(s) {
  return String(s || '').trim().toLowerCase();
}

// Earliest contract End Date across the client's active deals, plus
// integer days from today (negative when the date is already past).
// Cancelled / Expired agreements are skipped; everything else counts
// regardless of whether the date is in the future.
export function soonestExpiration(deals) {
  if (!deals || deals.length === 0) return { date: null, days: null };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  let bestMs = null;
  for (const d of deals) {
    if (isInactiveAgreement(d)) continue;
    const parsed = asDate(d['End Date']);
    if (!parsed) continue;
    const dayStart = new Date(parsed);
    dayStart.setHours(0, 0, 0, 0);
    const ms = dayStart.getTime();
    if (bestMs == null || ms < bestMs) bestMs = ms;
  }
  if (bestMs == null) return { date: null, days: null };
  return { date: new Date(bestMs), days: Math.round((bestMs - todayMs) / MS_PER_DAY) };
}

// Group deals by client, applying the user's source-name → client-name
// remapping (the helper column on the Deals subtab). Mirrors the
// grouping ClientsView uses so both tabs bucket contracts identically.
export function groupDealsByClient(dealsList, clientMap) {
  const map = new Map();
  for (const d of (dealsList || [])) {
    const raw = normClientName(d['Client Name']);
    if (!raw) continue;
    const mapped = clientMap?.[raw];
    const k = mapped ? normClientName(mapped) : raw;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(d);
  }
  return map;
}

function isClientStatus(p) {
  return String(p?.status || '').trim().toLowerCase() === 'client';
}

// Issue #1: a client whose soonest active contract End Date has already
// passed (negative Days Until) on the Clients tab. Untracked clients are
// skipped — the user has explicitly opted them out of expiration tracking,
// which is exactly why the Clients tab blanks their Days Until.
function detectNegativeDaysUntil({ prospects, cdmName, dealsByClient, untrackedMap }) {
  const issues = [];
  for (const p of prospects) {
    if (!matchesCdm(p.cdm, cdmName)) continue;
    if (!isClientStatus(p)) continue;
    const ck = normClientName(p.company);
    if (untrackedMap?.[ck]) continue;
    const next = soonestExpiration(dealsByClient.get(ck) || []);
    if (next.days == null || next.days >= 0) continue;
    const ago = Math.abs(next.days);
    issues.push({
      id: `neg-days:${p.id}`,
      source: 'Clients',
      type: 'Contract expired',
      company: p.company || '—',
      prospectId: p.id,
      daysUntil: next.days,
      expirationDate: next.date,
      detail: next.date
        ? `Soonest contract End Date (${fmtDate(next.date)}) passed ${ago} day${ago === 1 ? '' : 's'} ago`
        : `Soonest contract End Date passed ${ago} day${ago === 1 ? '' : 's'} ago`,
    });
  }
  return issues;
}

// Build the full list of outstanding issues. Each detector contributes
// rows; add more detectors here as new issue classes are mapped.
export function computeIssues({ prospects = [], cdmName, dealsList = [], clientMap = {}, untrackedMap = {} }) {
  const dealsByClient = groupDealsByClient(dealsList, clientMap);
  const issues = [];
  issues.push(...detectNegativeDaysUntil({ prospects, cdmName, dealsByClient, untrackedMap }));
  return issues;
}
