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
//
// Fee and Fee Start Month are deliberately left blank on every row built
// here. Both derive from the costs carrying the name, and a written-in value
// would freeze what should keep following them.
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
//
// Only costs carrying both a name and an actual cost count: a name with no
// money behind it derives no fee, so a row for it would just be a blank line
// in the schedule. Rows come back in the order their names first appear in
// the cost table (upfront before recurring within a name), so the built
// schedule reads down in the same order as the costs above it.
export function buildAltFeeRowsFromAutomatedNames({
  costs = [],
  existingRows = [],
  siteCount,
  accountCount,
} = {}) {
  const claimedBuckets = new Set(); // `${name}|${bucket}` the schedule already prices
  const claimedNames = new Set();   // names whose row hasn't been typed yet
  for (const row of existingRows) {
    const name = String(row?.altItem || '').trim().toLowerCase();
    if (!name) continue;
    const bucket = altFeeBucketForScheduleType(row?.type);
    if (!bucket) claimedNames.add(name);
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
    const bucket = altFeeBucketForCostType(c?.type);
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
      const type = group.bucket === ALT_FEE_RECURRING
        ? 'Recurring (monthly)'
        : group.bucket === ALT_FEE_UPFRONT
        ? (group.anySetup ? 'Setup' : 'One Time')
        : '';
      const unit = group.unit || '';
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
