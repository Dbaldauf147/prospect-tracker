// Assertion tests for the Pricing Basis vocabulary — the built-in list, and
// what happens to a list the user has edited when a new basis ships. Plain
// Node — no test framework (the project has none). Run:
//   node scripts/pricingBases.test.mjs
//
// The rule worth pinning is the one that cuts both ways. A saved list is
// the user's own vocabulary, so a basis they deleted must not creep back
// in; but a basis that didn't exist when they saved is one they never had
// the chance to keep, and leaving it out would mean the only way to see a
// new default is Reset to defaults — which throws their own bases away.
// The version stamp is what tells those two apart, so it's what these
// tests are really about.
import {
  PRICING_BASES, PRICING_BASES_VERSION, pricingBasesTopUp, normalizePricingBases,
  resolvePricingBases, pricingUnits, basisFor, estimateService, rateSentence, unitNoun,
} from '../src/utils/servicePricing.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const keysOf = list => (list || []).map(b => b.key);

// ── The two newest bases, and the counts they ask for ─────────────────
{
  check('per project ships as a per-unit basis', basisFor('per_project'),
    { key: 'per_project', label: 'Per project', kind: 'unit', unit: 'projects', unitLabel: 'Projects' });
  check('per equipment ships as a per-unit basis', basisFor('per_equipment'),
    { key: 'per_equipment', label: 'Per equipment', kind: 'unit', unit: 'equipment', unitLabel: 'Equipment' });
  check('both bring a count box with them',
    pricingUnits(PRICING_BASES).map(u => u.unit).filter(u => u === 'projects' || u === 'equipment'),
    ['projects', 'equipment']);
  check('% of deal size stays last', keysOf(PRICING_BASES).at(-1), 'pct_deal');
}

// ── They price like any other per-unit basis ──────────────────────────
{
  const meta = { serviceType: 'Project', years: '1 year' };
  const perProject = estimateService({
    entry: { basis: 'per_project', rate: 15000 }, meta, counts: { projects: 3 }, dealSize: '',
  });
  check('three projects at $15,000', [perProject.fee, perProject.units], [45000, 3]);

  const perEquipment = estimateService({
    entry: { basis: 'per_equipment', rate: 250, minFee: 5000 }, meta, counts: { equipment: 12 }, dealSize: '',
  });
  check('a thin equipment count is floored by the min fee', perEquipment.fee, 5000);

  const noCount = estimateService({
    entry: { basis: 'per_equipment', rate: 250 }, meta, counts: {}, dealSize: '',
  });
  check('no equipment count says so rather than guessing', [noCount.fee, noCount.note], [0, 'No equipment entered']);
}

// ── Topping a saved list up to the current version ────────────────────
{
  // A list saved before either of them existed: the built-ins as they were.
  const oldList = PRICING_BASES
    .filter(b => b.key !== 'per_project' && b.key !== 'per_equipment')
    .map(({ key, label, kind, unit, unitLabel }) => ({ key, label, kind, unit, unitLabel }));

  check('no saved list, nothing to do', pricingBasesTopUp({ pricingBases: null }), null);
  check('a list already at this version is left alone',
    pricingBasesTopUp({ pricingBases: oldList, pricingBasesVersion: PRICING_BASES_VERSION }), null);

  const topped = pricingBasesTopUp({ pricingBases: oldList });
  check('an unstamped list gets the new bases, on the end',
    keysOf(topped.pricingBases).slice(-2), ['per_project', 'per_equipment']);
  check('and is stamped so it only happens once', topped.pricingBasesVersion, PRICING_BASES_VERSION);
  check('running it again does nothing',
    pricingBasesTopUp({ pricingBases: topped.pricingBases, pricingBasesVersion: topped.pricingBasesVersion }), null);

  // The half-way case: one of the two was added by hand already.
  const halfWay = [...oldList, { key: 'per_project', label: 'Per project', kind: 'unit', unit: 'projects', unitLabel: 'Projects' }];
  check('a basis the user already added isn’t duplicated',
    keysOf(pricingBasesTopUp({ pricingBases: halfWay }).pricingBases).filter(k => k === 'per_project').length, 1);

  // The rule that matters: their edits are theirs.
  const edited = [
    ...oldList.filter(b => b.key !== 'per_mwh'),
    { key: 'per_truck', label: 'Per truck', kind: 'unit', unit: 'trucks', unitLabel: 'Trucks' },
  ];
  const after = keysOf(pricingBasesTopUp({ pricingBases: edited }).pricingBases);
  check('a deleted basis stays deleted', after.includes('per_mwh'), false);
  check('their own basis survives, in place', after.includes('per_truck'), true);
  check('only the new ones are added', after.filter(k => k === 'per_project' || k === 'per_equipment'),
    ['per_project', 'per_equipment']);

  // A stamp from a version that no longer exists shouldn't strand a list.
  check('a stamp older than the additions still tops up',
    keysOf(pricingBasesTopUp({ pricingBases: oldList, pricingBasesVersion: 1 }).pricingBases).slice(-2),
    ['per_project', 'per_equipment']);
}

// ── Per site w/ mandate ───────────────────────────────────────────────
// The subset of a portfolio a regulation bites on, priced on its own count.
// The point of it is that it is NOT the site count: a book with 6,176 sites
// and 300 mandated ones prices two completely different deals, so the two
// must never share a box.
{
  check('it ships as a per-unit basis', basisFor('per_site_mandate'),
    { key: 'per_site_mandate', label: 'Per site w/ mandate', kind: 'unit', unit: 'sites_mandate', unitLabel: 'Sites w/ Mandate' });
  check('with a count box of its own, beside Sites rather than inside it',
    pricingUnits(PRICING_BASES).map(u => u.unit).filter(u => u === 'sites' || u === 'sites_mandate'),
    ['sites', 'sites_mandate']);

  const meta = { serviceType: 'Recurring', years: '3 years' };
  const priced = estimateService({
    entry: { basis: 'per_site_mandate', rate: 400 }, meta, counts: { sites_mandate: 300 }, dealSize: '',
  });
  check('300 mandated sites at $400', [priced.fee, priced.units], [120000, 300]);

  // The whole reason it is a separate unit: a site count is not an answer to
  // how many of them carry a mandate, and pricing it as though it were would
  // quote twenty times the deal.
  const sitesOnly = estimateService({
    entry: { basis: 'per_site_mandate', rate: 400 }, meta, counts: { sites: 6176 }, dealSize: '',
  });
  check('a plain site count does not feed it',
    [sitesOnly.fee, sitesOnly.note], [0, 'No sites w/ mandate entered']);

  // How it reads in a sentence. A multi-word unit label is a noun with
  // qualifiers after it, so only the noun loses its plural — "per Sites w/
  // Mandate" read as the label quoted whole rather than as a rate.
  check('the rate reads as a sentence', rateSentence({ basis: 'per_site_mandate', rate: 400 }),
    '$400 per site w/ mandate');
  check('a one-word label is unchanged by that', [unitNoun('Sites'), unitNoun('Equipment')], ['site', 'equipment']);
  check('and an acronym keeps its case', unitNoun('MWh'), 'MWh');

  // It shipped in version 4, so a list saved before that gets it and a list
  // saved after — where leaving it out was a choice — does not.
  const v3List = PRICING_BASES
    .filter(b => b.key !== 'per_site_mandate')
    .map(({ key, label, kind, unit, unitLabel }) => ({ key, label, kind, unit, unitLabel }));
  check('a list saved at v3 gets it, on the end',
    keysOf(pricingBasesTopUp({ pricingBases: v3List, pricingBasesVersion: 3 }).pricingBases).at(-1),
    'per_site_mandate');
  check('and a list already at v4 keeps it out',
    pricingBasesTopUp({ pricingBases: v3List, pricingBasesVersion: 4 }).pricingBases, undefined);
}

// ── Retiring a built-in basis ─────────────────────────────────────────
//
// The top-up only ever added, which is right for a basis the user deleted
// themselves. A built-in that is RETIRED is the other case: nobody chose to
// keep it, and without this it would live on in every saved list forever.
{
  check('per user is gone from the built-ins',
    keysOf(PRICING_BASES).includes('per_user'), false);

  const withUser = [
    ...PRICING_BASES.map(({ key, label, kind, unit, unitLabel }) => ({ key, label, kind, unit, unitLabel })),
    { key: 'per_user', label: 'Per user', kind: 'unit', unit: 'users', unitLabel: 'Users' },
  ];
  const after = pricingBasesTopUp({ pricingBases: withUser, pricingBasesVersion: 4 });
  check('a list saved with it loses it', keysOf(after.pricingBases).includes('per_user'), false);
  check('and keeps everything else, in place',
    keysOf(after.pricingBases), keysOf(PRICING_BASES));
  check('stamped so it only happens once', after.pricingBasesVersion, PRICING_BASES_VERSION);
  check('running it again does nothing',
    pricingBasesTopUp({ pricingBases: after.pricingBases, pricingBasesVersion: after.pricingBasesVersion }), null);

  // Their own basis on the same unit is theirs, not the retired built-in —
  // and a list with nothing to drop is not rewritten at all, only stamped.
  const own = [...withUser.filter(b => b.key !== 'per_user'),
    { key: 'per_seat', label: 'Per seat', kind: 'unit', unit: 'users', unitLabel: 'Users' }];
  check('a list with nothing retired in it is left untouched',
    pricingBasesTopUp({ pricingBases: own, pricingBasesVersion: 4 }).pricingBases, undefined);

  // …and one that does have something to drop keeps their basis through it.
  const bothKinds = [...withUser,
    { key: 'per_seat', label: 'Per seat', kind: 'unit', unit: 'users', unitLabel: 'Users' }];
  const kept = keysOf(pricingBasesTopUp({ pricingBases: bothKinds, pricingBasesVersion: 4 }).pricingBases);
  check('a basis they added themselves survives the retirement beside it',
    [kept.includes('per_seat'), kept.includes('per_user')], [true, false]);
}

// ── Nothing here changes what a saved list means ──────────────────────
{
  check('a junk list falls back to the built-ins',
    keysOf(resolvePricingBases({ pricingBases: [{ label: 'no key' }] })), keysOf(PRICING_BASES));
  check('a per-unit basis with no unit is dropped',
    normalizePricingBases([{ key: 'a', label: 'A', kind: 'unit' }]), null);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
