// Building an Option's Alternative Fee schedule out of the Automated Fee
// Names its cost rows already carry.
//
// The Pricing page has two halves: cost lines up top, each tagged with an
// Automated Fee Name, and the fee schedule underneath that the customer
// actually gets billed from. A name with no row beneath it prices nothing —
// its cost sits outside every margin on the page — so the schedule has to be
// typed out one row at a time before any of the numbers mean anything. This
// turns the names into that schedule in one pass.
//
// Two rules do all the work here, and both exist to stop the same failure —
// the same cost being charged for twice, or not at all:
//
//   Bucketing. A schedule row derives its fee from the costs sharing its
//   name AND its type bucket: a Recurring row pulls the monthly and Rolled
//   costs, a Setup / One Time row pulls the upfront ones. Setup and One Time
//   are ONE bucket (both pull the same costs), so a name that carries both
//   still gets a single upfront row — two would each claim the whole upfront
//   markup and double the fee. A name carrying upfront AND recurring costs
//   does get two rows, because one row can only ever derive one of the two.
//
//   Claiming. A name the schedule already has a row for is left alone, per
//   bucket. A row with no type picked yet claims every bucket of its name:
//   it's the user's own placeholder, and the moment they pick a type on it,
//   a sibling row built next to it would be pricing the same costs twice.
//   So does a row whose name carries a default Type — that fee is one row,
//   and the row the schedule has is it.
//
// Fee and Fee Start Month are deliberately left blank on every row built
// here. Both derive from the costs carrying the name, and a written-in value
// would freeze what should keep following them.
//
// The exception to "the costs decide" is the per-fee defaults the user saves
// on the Linked To page: a fee told it is Recurring is Recurring, whatever
// its costs are typed as. See feeDefaults below.
//
// Lives outside PricingView.jsx so the bucketing and claiming can be
// asserted directly — see scripts/altFeeAutoBuild.test.mjs. Getting it wrong
// is quiet: the schedule still renders, it just prices the deal wrongly.

// The two buckets a fee derives from. '' is neither — an untyped schedule
// row, or a cost whose Type is something this page doesn't price.
export const ALT_FEE_UPFRONT = 'upfront';
export const ALT_FEE_RECURRING = 'recurring';

// Which bucket a COST row's Type (the pricing table's Type column) prices
// into. Rolled variants bill monthly across the term, so they belong with
// Recurring — which is the bucket the auto-fee calc already pulls them into.
export function altFeeBucketForCostType(type) {
  const s = String(type || '').trim();
  if (!s) return '';
  if (/recurring/i.test(s) || /\brolled\b/i.test(s)) return ALT_FEE_RECURRING;
  if (/^(setup|one\s*time)$/i.test(s)) return ALT_FEE_UPFRONT;
  return '';
}

// Which bucket a SCHEDULE row's Type (the fee table's three-value dropdown)
// derives from. Same buckets, narrower vocabulary — the schedule has no
// Rolled types.
export function altFeeBucketForScheduleType(type) {
  const s = String(type || '').trim();
  if (!s) return '';
  if (/recurring/i.test(s)) return ALT_FEE_RECURRING;
  if (/^(setup|one\s*time)$/i.test(s)) return ALT_FEE_UPFRONT;
  return '';
}

// Unit Count to pair with a unit — the same fill the schedule's own Unit
// dropdown does when you pick Per Site / Per Account. Anything else (Fixed,
// Per Meter, blank) counts as one until the user says otherwise.
export function altFeeUnitCount(unit, { siteCount, accountCount } = {}) {
  if (unit === 'Per Site' && typeof siteCount === 'number' && siteCount > 0) return siteCount;
  if (unit === 'Per Account' && typeof accountCount === 'number' && accountCount > 0) return accountCount;
  return 1;
}

// Key a per-fee default by its Automated Fee Name. Matching is
// case-insensitive and ignores surrounding whitespace, the same way every
// other Linked To lookup on the page is.
export function feeDefaultKey(name) {
  return String(name || '').trim().toLowerCase();
}

const BUCKET_RANK = { [ALT_FEE_UPFRONT]: 0, [ALT_FEE_RECURRING]: 1, '': 2 };

// The schedule rows this Option's Automated Fee Names imply, minus the ones
// the schedule already carries.
//
//   costs         one entry per cost line on the Option:
//                 { name, type, unit, cost, passThrough }
//                 — name is its Automated Fee Name, type its effective Type,
//                 unit the saved Linked To unit for its (Line Item, Type)
//                 pair, cost its effective cost, passThrough whether it bills
//                 at face value.
//   existingRows  the Option's current schedule rows.
//   feeDefaults   the per-fee defaults saved on the Linked To page, keyed by
//                 feeDefaultKey: { type, unit }. A default Type is the fee's
//                 own answer to which costs it prices, so it REPLACES the
//                 bucketing the cost types imply — every cost carrying the
//                 name lands in that one bucket and the name gets exactly one
//                 row. A default Unit pre-fills the row over the unit its
//                 costs carry.
//
// Only costs carrying both a name and an actual cost count: a name with no
// money behind it derives no fee, so a row for it would just be a blank line
// in the schedule. Rows come back in the order their names first appear in
// the cost table (upfront before recurring within a name), so the built
// schedule reads down in the same order as the costs above it.
export function buildAltFeeRowsFromAutomatedNames({
  costs = [],
  existingRows = [],
  feeDefaults = {},
  siteCount,
  accountCount,
} = {}) {
  const defaultsFor = (name) => feeDefaults?.[feeDefaultKey(name)] || null;
  const defaultTypeFor = (name) => String(defaultsFor(name)?.type || '').trim();
  const claimedBuckets = new Set(); // `${name}|${bucket}` the schedule already prices
  const claimedNames = new Set();   // names whose row hasn't been typed yet
  for (const row of existingRows) {
    const name = String(row?.altItem || '').trim().toLowerCase();
    if (!name) continue;
    const bucket = altFeeBucketForScheduleType(row?.type);
    // A fee with a default Type is ONE row by definition, so whatever row
    // the schedule already carries for that name claims every bucket of it
    // — the type on that row is the default's to set, and a row built
    // beside it would price the same costs a second time.
    if (!bucket || defaultTypeFor(name)) claimedNames.add(name);
    else claimedBuckets.add(`${name}|${bucket}`);
  }

  const groups = new Map();
  costs.forEach((c, idx) => {
    const name = String(c?.name || '').trim();
    if (!name) return;
    const cost = Number(c?.cost);
    if (!Number.isFinite(cost) || cost <= 0) return;
    const lower = name.toLowerCase();
    if (claimedNames.has(lower)) return;
    const defType = defaultTypeFor(name);
    const bucket = defType
      ? altFeeBucketForScheduleType(defType)
      : altFeeBucketForCostType(c?.type);
    const key = `${lower}|${bucket}`;
    if (claimedBuckets.has(key)) return;
    let group = groups.get(key);
    if (!group) {
      group = { name, bucket, order: idx, unit: '', anySetup: false, allPassThrough: true };
      groups.set(key, group);
    }
    // First non-empty saved unit wins; the rest of the group follows it
    // rather than the schedule guessing per row.
    if (!group.unit) group.unit = String(c?.unit || '').trim();
    if (/^setup/i.test(String(c?.type || '').trim())) group.anySetup = true;
    if (!c?.passThrough) group.allPassThrough = false;
  });

  // A name's buckets stay together, in the order the name first shows up.
  const nameOrder = new Map();
  for (const group of groups.values()) {
    const k = group.name.toLowerCase();
    const prev = nameOrder.get(k);
    if (prev === undefined || group.order < prev) nameOrder.set(k, group.order);
  }

  return [...groups.values()]
    .sort((a, b) => {
      const oa = nameOrder.get(a.name.toLowerCase());
      const ob = nameOrder.get(b.name.toLowerCase());
      if (oa !== ob) return oa - ob;
      return BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket];
    })
    .map((group) => {
      // Setup and One Time price identically here; the label follows what
      // the costs are actually called, so the row reads like them.
      const def = defaultsFor(group.name);
      const type = String(def?.type || '').trim() || (group.bucket === ALT_FEE_RECURRING
        ? 'Recurring (monthly)'
        : group.bucket === ALT_FEE_UPFRONT
        ? (group.anySetup ? 'Setup' : 'One Time')
        : '');
      const unit = String(def?.unit || '').trim() || group.unit || '';
      return {
        altItem: group.name,
        type,
        fee: null,
        unit,
        unitCount: altFeeUnitCount(unit, { siteCount, accountCount }),
        startMonth: null,
        // Every cost behind this fee bills at face value, so the fee does
        // too — otherwise it would show a margin the deal doesn't earn.
        passThrough: group.allPassThrough,
      };
    });
}

// Apply one saved fee default (Type or Unit) to the schedule rows an Option
// already carries. Defaults have to reach the rows that are already there,
// not just the ones built afterwards — the schedule an SIA arrives with, or
// a schedule built before the default was saved, would otherwise sit there
// contradicting the Fee defaults table.
//
//   rows    the Option's current schedule rows.
//   key     the fee name being defaulted, as feeDefaultKey returns it.
//   field   'type' or 'unit'. Anything else is a no-op — Fee Start Month
//           stays derived, so it never writes into a row.
//   value   the default. Empty is a no-op: clearing a default retracts
//           nothing, the same way it leaves already-built rows alone.
//
// Retyping can leave two rows of one name in the same bucket, and two rows
// deriving the same costs bill them twice — so a matching row that would
// duplicate one already kept is dropped. A row carrying a hand-typed fee is
// never dropped: that number is the user's, not something this page derived.
//
// Returns the same array when nothing changed, so callers can skip the state
// write.
export function applyFeeDefaultToRows(rows = [], { key, field, value, siteCount, accountCount } = {}) {
  if (field !== 'type' && field !== 'unit') return rows;
  const v = String(value || '').trim();
  if (!key || !v) return rows;
  let changed = false;
  const out = [];
  const kept = new Set(); // `${key}|${type}` already standing on this Option
  for (const row of rows) {
    if (feeDefaultKey(row?.altItem) !== key) { out.push(row); continue; }
    const updated = { ...row };
    if (field === 'type') {
      updated.type = v;
    } else {
      updated.unit = v;
      updated.unitCount = altFeeUnitCount(v, { siteCount, accountCount });
    }
    const hasManualFee = updated.fee != null && updated.fee !== '';
    const bucketKey = `${key}|${String(updated.type || '').trim().toLowerCase()}`;
    if (field === 'type' && kept.has(bucketKey) && !hasManualFee) { changed = true; continue; }
    kept.add(bucketKey);
    if (updated.type !== row.type || updated.unit !== row.unit || updated.unitCount !== row.unitCount) {
      changed = true;
    }
    out.push(updated);
  }
  return changed ? out : rows;
}

// Bring a whole schedule back in line with the saved fee defaults —
// `altFeesByOption` is the { [optionNumber]: rows } map the page keeps, and
// `options` the workbook's options, for the counts a unit change refills.
//
// Runs when the page hydrates, because a default only reaches rows through
// the moment it was saved: rows that arrived with a later upload, or that a
// build added before the default existed, would otherwise sit there
// contradicting the Fee defaults table — and a stale row of a name is a row
// someone can type a fee into, billing costs the live row already bills.
//
// Returns the same map when nothing moved.
export function reconcileScheduleWithFeeDefaults(altFeesByOption = {}, feeDefaults = {}, options = []) {
  const keys = Object.keys(feeDefaults || {}).filter(k => feeDefaults[k]?.type || feeDefaults[k]?.unit);
  if (keys.length === 0) return altFeesByOption;
  let changed = false;
  const out = {};
  for (const [optNum, rows] of Object.entries(altFeesByOption || {})) {
    const opt = (options || []).find(o => String(o?.optionNumber) === String(optNum));
    const before = rows || [];
    let next = before;
    for (const key of keys) {
      const def = feeDefaults[key];
      const opts = { key, siteCount: opt?.siteCount, accountCount: opt?.accountCount };
      if (def?.type) next = applyFeeDefaultToRows(next, { ...opts, field: 'type', value: def.type });
      if (def?.unit) next = applyFeeDefaultToRows(next, { ...opts, field: 'unit', value: def.unit });
    }
    if (next !== before) changed = true;
    out[optNum] = next;
  }
  return changed ? out : altFeesByOption;
}
