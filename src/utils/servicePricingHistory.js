// A day-by-day record of how far through the rate card the services are:
// of the tracked services (the ones that count toward a company's % of
// services explored), how many carry a rate and how many are marked no fee.
// Read on Dropdowns > Service Pricing History.
//
// The card keeps no edit history, so the share can't be worked out for a
// past day. It is written while the app is open (useServicePricingRecorder
// in App, and the subtab itself) and the chart fills in from there.
//
// What a row holds (keyed by the local day, YYYY-MM-DD):
//
//   total, priced, noFee, answered, answeredPct, pricedPct
//   at        wall-clock ms of the reading
//   seeded    true on the one day backfilled from the first reading
//
// The latest reading of a day wins. Stored in localStorage under the
// user's key and mirrored to Firestore, merged day by day.

import { buildServiceRows } from './serviceRows.js';
import { estimateScope, getServicePricing, pricingCoverage, resolvePricingBases } from './servicePricing.js';
import { exploredCountTest } from './serviceCategoriesStore.js';
import { userLsGet, userLsSet } from './userLs.js';
import { mergeDayHistories, registerMirroredKey, queueMirrorPush } from './localMirrorSync.js';

export const SERVICE_PRICING_HISTORY_KEY = 'service-pricing-history';
export const SERVICE_PRICING_HISTORY_EVENT = 'service-pricing-history-changed';

registerMirroredKey(SERVICE_PRICING_HISTORY_KEY, SERVICE_PRICING_HISTORY_EVENT, { merge: mergeDayHistories });

export const SERVICE_PRICING_MAX_DAYS = 1000;

// The coverage the Services Pricing subtab's progress bar shows, worked out
// from settings alone: the same rows (Solutions list less hidden services),
// the same tracked test, and priced / no fee read off the card with no deal
// scenario, which is how the subtab reads it too (a per-site rate with no
// site count is still priced).
export function servicePricingCoverage(settings) {
  const hidden = new Set(settings?.hiddenServices || []);
  const rows = buildServiceRows(settings).filter(r => !hidden.has(r.name));
  const counts = exploredCountTest(settings);
  const tracked = rows.filter(r => counts(r.name));
  const { lines } = estimateScope({
    rows: tracked,
    services: tracked.map(r => r.name),
    pricing: getServicePricing(settings),
    counts: {},
    bases: resolvePricingBases(settings),
    serviceUnits: {},
  });
  const byName = new Map(lines.map(l => [l.name, l]));
  return pricingCoverage(tracked.map(r => byName.get(r.name)));
}

export function readingFromCoverage(c) {
  if (!c || !(c.total > 0)) return null;
  const { total, priced, noFee, answered, answeredPct, pricedPct } = c;
  return { total, priced, noFee, answered, answeredPct, pricedPct };
}

export function parseServicePricingHistory(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch { return {}; }
}

const FIELDS = ['total', 'priced', 'noFee', 'answered', 'answeredPct', 'pricedPct'];
function sameReading(a, b) {
  return !!a && !!b && FIELDS.every(f => a[f] === b[f]);
}

export function previousDay(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  const dt = new Date(y, m - 1, d - 1);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

// The history with `reading` under `day`, oldest days past the cap dropped.
// The same object back when nothing changes, so the caller can skip a write.
// While no real (not seeded) earlier day is on record, the reading is also
// written as the day before, so the chart starts with a line rather than a
// lone dot, and that seed keeps following the day's reading until a real
// earlier day exists.
export function withServicePricingReading(history, day, reading, now = Date.now()) {
  const prev = (history && typeof history === 'object') ? history : {};
  if (!day || !reading) return prev;
  const seedYesterday = !Object.keys(prev).some(k => k < day && !prev[k]?.seeded);
  const yesterday = previousDay(day);
  if (sameReading(prev[day], reading) && (!seedYesterday || sameReading(prev[yesterday], reading))) return prev;
  const next = { ...prev, [day]: { ...reading, at: now } };
  if (seedYesterday) next[yesterday] = { ...reading, seeded: true, at: now };
  const keys = Object.keys(next).sort();
  if (keys.length <= SERVICE_PRICING_MAX_DAYS) return next;
  const out = {};
  for (const k of keys.slice(keys.length - SERVICE_PRICING_MAX_DAYS)) out[k] = next[k];
  return out;
}

export function recordServicePricing(day, coverage, now = Date.now()) {
  const reading = readingFromCoverage(coverage);
  if (!day || !reading) return false;
  const history = parseServicePricingHistory(userLsGet(SERVICE_PRICING_HISTORY_KEY));
  const next = withServicePricingReading(history, day, reading, now);
  if (next === history) return false;
  try {
    userLsSet(SERVICE_PRICING_HISTORY_KEY, JSON.stringify(next));
    queueMirrorPush(SERVICE_PRICING_HISTORY_KEY);
    window.dispatchEvent(new CustomEvent(SERVICE_PRICING_HISTORY_EVENT));
    return true;
  } catch { return false; }
}

// --- reading it back as an external store ------------------------------------

const EVENTS = [SERVICE_PRICING_HISTORY_EVENT, 'storage'];

export function subscribeServicePricingHistory(onChange) {
  EVENTS.forEach(e => window.addEventListener(e, onChange));
  return () => EVENTS.forEach(e => window.removeEventListener(e, onChange));
}

export function servicePricingHistorySnapshot() {
  return userLsGet(SERVICE_PRICING_HISTORY_KEY) || '';
}

// Every recorded day, oldest first, as chart / table rows.
export function servicePricingHistoryRows(history) {
  const h = history || {};
  return Object.keys(h).sort().map(iso => ({ iso, ...h[iso] }));
}
