// Where the Services Pricing estimator's working scenario lives between
// visits.
//
// The rate card is in settings and syncs across devices; this is the other
// half of that page — which services are ticked, the counts they're priced
// against, the deal size, which opp the numbers came from, and which rows
// the import pinned to the top. It used to die with the view, so stepping
// over to Opps for a figure, or reloading the page, threw an imported deal
// away and the import had to be done again.
//
// Kept in localStorage rather than settings: it's a working estimate on one
// machine, not shared data, and pushing a scratch calculation into the
// synced settings document on every tick would hand every other device a
// half-built deal. The trade is that an estimate doesn't follow you to
// another browser — Import opp rebuilds it there in one click.
//
// Scoped by uid, the way the IndexedDB stores are, so two people signing in
// on the same browser don't inherit each other's deal. Without a uid — the
// tab rendered outside the AuthProvider, in a test or a harness — nothing
// is read or written at all.

const KEY_PREFIX = 'services-pricing:estimate';

/** The localStorage key for one user, or '' when there's no user to scope to. */
export function pricingEstimateKey(uid) {
  return uid ? `${KEY_PREFIX}:${uid}` : '';
}

const asString = (v) => (typeof v === 'string' ? v : '');
const asStringList = (v) => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()) : []);

// A count or a deal size: a real, non-negative number, or null for "not
// answered". Everything read back out of storage is checked this way rather
// than trusted — a record half-written by a closing tab, or edited by hand,
// would otherwise reach the estimator as NaN and price the whole deal at
// nothing.
const asCount = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

// Units typed against a service for this estimate, keyed by service name.
// Same rules as a count: a real, non-negative number or nothing at all.
function normalizeServiceUnits(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [name, value] of Object.entries(raw)) {
    const n = asCount(value);
    if (n !== null && String(name).trim()) out[name] = n;
  }
  return out;
}

function normalizeCounts(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [unit, value] of Object.entries(raw)) {
    const n = asCount(value);
    // A blank box is the same as never having answered, so it's dropped
    // rather than stored as an empty string to be re-read as one.
    if (n !== null) out[unit] = n;
  }
  return out;
}

// What the last import managed, as the note under the bar reads it back.
// Every field is rebuilt to the shape that note renders — it maps over the
// lists and calls toLocaleString on the filled values — so a malformed
// record comes back as no import rather than as a crash on mount.
function normalizeImport(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const account = asString(raw.account).trim();
  // Nothing to say without the account: the note leads with its name.
  if (!account) return null;
  const filled = (Array.isArray(raw.filled) ? raw.filled : [])
    .filter(f => f && typeof f === 'object' && asCount(f.value) !== null)
    .map(f => ({
      unit: asString(f.unit),
      label: asString(f.label),
      value: asCount(f.value),
      source: asString(f.source),
    }));
  return {
    account,
    // Which opp this estimate came from, so it can be saved back to it
    // after a reload without importing it again.
    id: asString(raw.id),
    stage: asString(raw.stage),
    company: asString(raw.company),
    services: asCount(raw.services) ?? 0,
    unmatchedTokens: asStringList(raw.unmatchedTokens),
    filled,
    dealSizeSource: asString(raw.dealSizeSource),
    missing: asStringList(raw.missing),
    noPrice: asStringList(raw.noPrice),
  };
}

/** True when there's nothing worth remembering — an untouched estimator. */
export function isEmptyEstimate(estimate) {
  if (!estimate) return true;
  const scenario = estimate.scenario || {};
  return (scenario.services || []).length === 0
    && Object.keys(scenario.counts || {}).length === 0
    && Object.keys(scenario.serviceUnits || {}).length === 0
    && (scenario.dealSize === '' || scenario.dealSize == null)
    && !estimate.oppImport
    && (estimate.pinned || []).length === 0;
}

/**
 * Rebuild a saved estimate into exactly the shape the tab renders, or null
 * when there's nothing usable in it. Pure, so the round trip can be pinned
 * by a test without a browser.
 */
export function normalizeEstimate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const scenarioRaw = (raw.scenario && typeof raw.scenario === 'object') ? raw.scenario : {};
  const dealSize = asCount(scenarioRaw.dealSize);
  const pinned = asStringList(raw.pinned);
  const estimate = {
    scenario: {
      services: asStringList(scenarioRaw.services),
      counts: normalizeCounts(scenarioRaw.counts),
      serviceUnits: normalizeServiceUnits(scenarioRaw.serviceUnits),
      dealSize: dealSize === null ? '' : dealSize,
    },
    // Null rather than an empty list: the tab reads it as "nothing is
    // pinned" and skips the whole grouping pass.
    pinned: pinned.length ? pinned : null,
    oppImport: normalizeImport(raw.oppImport),
  };
  return isEmptyEstimate(estimate) ? null : estimate;
}

/** The estimate this user left behind, or null if there isn't a usable one. */
export function loadPricingEstimate(uid) {
  const key = pricingEstimateKey(uid);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? normalizeEstimate(JSON.parse(raw)) : null;
  } catch {
    // Storage blocked, or a record that isn't JSON any more. An estimate
    // that can't be read back is a lost estimate, not a broken page.
    return null;
  }
}

/** Remember this estimate, or forget the stored one once it's empty. */
export function savePricingEstimate(uid, estimate) {
  const key = pricingEstimateKey(uid);
  if (!key) return;
  const normalized = normalizeEstimate(estimate);
  try {
    // An emptied estimator leaves nothing behind rather than an empty
    // record, so Clear scope still reads as cleared on the next visit.
    if (normalized) localStorage.setItem(key, JSON.stringify(normalized));
    else localStorage.removeItem(key);
  } catch { /* storage full or blocked: the estimate just won't survive */ }
}
