// The leased/owned split on the Utility Lookup page.
//
// What these pin is the rule the whole feature turns on: an owner is sized
// on the BUILDING, a tenant on the PREMISES AND THE METERS IT HOLDS — and
// the corollary that an UNKNOWN tenure is sized as an owner, so a portfolio
// that never mapped the column is never quietly shrunk.

import {
  TENURE, TENURE_OPTIONS, CLASS,
  isLeasedTenure, leaseClassFor, defaultLeaseClass, factorsFor,
  estimateSizeFt2, estimateConsumptionForTenure,
  accountsForTenure, accountTotalForTenure, equipmentForTenure,
  tenureEstimateNote,
} from '../src/utils/ownershipEstimates.js';
import { estimateConsumption, propertyTypeAccountTotal, propertyTypeEquipment } from '../src/data/propertyTypeEstimates.js';
import { tenureCoverage, isLeasedUtilityRow, ownershipScopeStats, scopeSitesByOwnership } from '../src/components/SitesView/ownershipScope.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const OFFICE = 'Office - High-Rise';       // suite by default
const QSR = 'Restaurant (Quick-Service)';  // whole building by default

// ── Which values are a lease ──────────────────────────────────────────
{
  check('the four canonical values', TENURE_OPTIONS,
    ['Owned', 'Leased', 'Leased – Suite', 'Leased – Whole Building']);
  check('every leased variant is a lease',
    [TENURE.LEASED, TENURE.SUITE, TENURE.WHOLE].map(isLeasedTenure), [true, true, true]);
  check('owned is not, and neither is anything the upload could not place',
    [TENURE.OWNED, 'Owned/Leased', 'TBD', '', null, undefined].map(isLeasedTenure),
    [false, false, false, false, false, false]);
}

// ── Resolving a bare "Leased" to a class ──────────────────────────────
{
  check('an office suite is the default for office', defaultLeaseClass(OFFICE), CLASS.SUITE);
  check('a standalone restaurant is a whole building', defaultLeaseClass(QSR), CLASS.WHOLE);
  check('a type nobody named falls to whole building, which moves the estimate least',
    defaultLeaseClass('Refrigerated Warehouse'), CLASS.WHOLE);
  check('an unrecognized type still answers rather than throwing',
    defaultLeaseClass('Something Nobody Mapped'), CLASS.WHOLE);

  // A row that says which kind of lease outranks the type's default.
  check('a suite value wins over the type default', leaseClassFor(TENURE.SUITE, QSR), CLASS.SUITE);
  check('and a whole-building value does too', leaseClassFor(TENURE.WHOLE, OFFICE), CLASS.WHOLE);

  // The rule that matters most.
  check('a blank tenure is estimated as owned', leaseClassFor(null, OFFICE), CLASS.OWNED);
  check('so is one the upload could not place', leaseClassFor('Owned/Leased', OFFICE), CLASS.OWNED);
  check('and so is Owned itself', leaseClassFor(TENURE.OWNED, OFFICE), CLASS.OWNED);
}

// ── Square footage ────────────────────────────────────────────────────
{
  // A size the row supplies is used as typed under every tenure: on a suite
  // row it is already the leased premises.
  check('a stated size is used as typed, owned', estimateSizeFt2(TENURE.OWNED, OFFICE, 38000), 38000);
  check('and on a suite, unapportioned', estimateSizeFt2(TENURE.SUITE, OFFICE, 38000), 38000);

  // The fallback is where they part company.
  check('an owned row with no size falls back to the whole reference building',
    estimateSizeFt2(TENURE.OWNED, OFFICE, null), 500000);
  check('a suite falls back to a floor or two, not a tower',
    estimateSizeFt2(TENURE.SUITE, OFFICE, null), 60000);
  check('a whole-building lease legitimately falls back to the full building',
    estimateSizeFt2(TENURE.WHOLE, OFFICE, null), 500000);
  check('a type with no reference profile has no fallback to give',
    estimateSizeFt2(TENURE.OWNED, 'Land', null), null);
}

// ── Consumption ───────────────────────────────────────────────────────
{
  const owned = estimateConsumptionForTenure(TENURE.OWNED, OFFICE, null);
  const suite = estimateConsumptionForTenure(TENURE.SUITE, OFFICE, null);

  check('an owned estimate is exactly what it was before this existed',
    [owned.electricKwh, owned.gasDth, owned.totalKwh],
    (() => { const e = estimateConsumption(OFFICE, null); return [e.electricKwh, e.gasDth, e.totalKwh]; })());

  // 14,000,000 × 0.12 (the suite's share of the building) × 0.55 (the share
  // of the intensity a tenant pays for).
  check('a suite is scaled by BOTH its floor area and its share of the load',
    suite.electricKwh, Math.round(14_000_000 * 0.12 * 0.55));
  check('gas nearly vanishes, because heating is central and landlord-billed',
    suite.gasDth, Math.round(25_001 * 0.12 * 0.10));
  check('the total is the two added, not the reference total scaled',
    suite.totalKwh, suite.electricKwh + suite.gasKwh);
  check('and it says what it was scaled by', suite.tenureFactors, { electric: 0.55, gas: 0.1 });

  // Both halves are needed: size alone would still bill a suite for its
  // share of the central plant.
  const sizeOnly = estimateConsumption(OFFICE, 60000);
  check('size alone would overstate a suite by the intensity factor',
    suite.electricKwh < sizeOnly.electricKwh, true);

  // A whole-building net lease is close to owned, which is the point of
  // splitting the two leased kinds apart.
  const whole = estimateConsumptionForTenure(TENURE.WHOLE, QSR, null);
  const qsrOwned = estimateConsumptionForTenure(TENURE.OWNED, QSR, null);
  check('a net-lease site keeps all its electric', whole.electricKwh, qsrOwned.electricKwh);
  check('and nearly all its gas', whole.gasDth, Math.round(600 * 0.95));

  // A stated size still drives the scale on a leased row.
  const stated = estimateConsumptionForTenure(TENURE.SUITE, OFFICE, 38000);
  check('a suite with a real size prices off that size',
    stated.electricKwh, Math.round(14_000_000 * (38000 / 500000) * 0.55));

  check('a type with no consumption profile has no estimate under any tenure',
    [estimateConsumptionForTenure(TENURE.SUITE, 'Land', null), estimateConsumptionForTenure(TENURE.OWNED, 'Debt', null)],
    [null, null]);
}

// ── Utility accounts ──────────────────────────────────────────────────
{
  check('an owned site holds the whole account table',
    accountTotalForTenure(TENURE.OWNED, OFFICE), propertyTypeAccountTotal(OFFICE));

  const suite = accountsForTenure(TENURE.SUITE, OFFICE);
  check('a suite holds its electric and nothing else',
    [suite.electric.count, suite.gas.count, suite.water.count, suite.waste.count], [1, 0, 0, 0]);
  check('and the ones it does not hold say whose they are',
    [suite.gas.label, suite.water.label], ['Landlord', 'Landlord']);
  check('a commodity the type never had keeps its own label rather than gaining a landlord',
    suite.steam.label, 'N/A');
  check('so the total collapses to one bill', accountTotalForTenure(TENURE.SUITE, OFFICE), 1);

  const whole = accountsForTenure(TENURE.WHOLE, QSR);
  check('a net-lease site keeps electric, gas and waste',
    [whole.electric.count, whole.gas.count, whole.waste.count], [1, 1, 1]);
  check('and half a water account, which is a real portfolio expectation',
    [whole.water.count, whole.water.label], [0.5, '0.5']);

  check('an unrecognized property type has no account answer under any tenure',
    accountsForTenure(TENURE.SUITE, 'Nope'), null);
}

// ── Equipment ─────────────────────────────────────────────────────────
{
  check('an owned site carries the full count',
    equipmentForTenure(TENURE.OWNED, OFFICE), propertyTypeEquipment(OFFICE));
  // 85 × 0.08 = 6.8 → 7. A count is a thing you can walk up to.
  check('a suite carries the in-suite kit, rounded to whole assets',
    equipmentForTenure(TENURE.SUITE, OFFICE), 7);
  check('a net-lease site carries most of it', equipmentForTenure(TENURE.WHOLE, QSR), Math.round(10 * 0.85));
  // A type with real equipment must not round away to zero.
  check('a small suite keeps at least the one asset that says it has any',
    equipmentForTenure(TENURE.SUITE, 'Retail - High Street') >= 1, true);
  check('but a real zero stays zero — there is no building on a land parcel',
    equipmentForTenure(TENURE.SUITE, 'Land'), 0);
  check('and an unknown type is null, not zero', equipmentForTenure(TENURE.SUITE, 'Nope'), null);
}

// ── Nothing changes for an owned or unknown row ───────────────────────
{
  // The whole safety argument for the feature, stated once.
  for (const tenure of [TENURE.OWNED, null, '', 'Owned/Leased', 'TBD']) {
    const label = JSON.stringify(tenure);
    check(`consumption is untouched for ${label}`,
      estimateConsumptionForTenure(tenure, OFFICE, 38000).electricKwh,
      estimateConsumption(OFFICE, 38000).electricKwh);
    check(`accounts are untouched for ${label}`,
      accountTotalForTenure(tenure, OFFICE), propertyTypeAccountTotal(OFFICE));
    check(`equipment is untouched for ${label}`,
      equipmentForTenure(tenure, OFFICE), propertyTypeEquipment(OFFICE));
  }
  check('and the factors themselves are all 1', factorsFor(null, OFFICE).electric, 1);
}

// ── The scopes still read every leased kind as leased ─────────────────
{
  const rows = [
    { __ownership__: TENURE.OWNED },
    { __ownership__: TENURE.LEASED },
    { __ownership__: TENURE.SUITE },
    { __ownership__: TENURE.WHOLE },
    { __ownershipRaw__: 'TBD' },
    {},
  ];
  check('every leased variant is leased to the savings and compliance scopes',
    rows.map(isLeasedUtilityRow), [false, true, true, true, false, false]);

  const cov = tenureCoverage(rows);
  check('coverage counts all three as leased', [cov.owned, cov.leased], [1, 3]);
  check('and says how many named the lease shape',
    [cov.leasedTyped, cov.leasedUntyped], [2, 1]);
  check('an unplaceable value is still uploaded, not missing',
    [cov.unplaceable, cov.missing], [1, 1]);

  const sites = [
    { ownership: TENURE.OWNED }, { ownership: TENURE.SUITE },
    { ownership: TENURE.WHOLE }, { ownership: null },
  ];
  const stats = ownershipScopeStats(sites);
  check('the compliance scope counts them the same way',
    [stats.owned, stats.leased, stats.unspecified, stats.screened], [1, 2, 1, 2]);
  check('and drops every leased kind when it is on',
    scopeSitesByOwnership(sites, true).length, 2);
}

// ── The note that explains a shrunken figure ──────────────────────────
{
  check('an owned row needs no explanation', tenureEstimateNote(TENURE.OWNED, OFFICE), '');
  check('a suite says it is sized on the premises',
    tenureEstimateNote(TENURE.SUITE, OFFICE).includes('premises'), true);
  check('a bare Leased says which default it resolved to',
    tenureEstimateNote(TENURE.LEASED, OFFICE).includes('defaults to a suite'), true);
  check('and on a type that defaults the other way, says that instead',
    tenureEstimateNote(TENURE.LEASED, QSR).includes('defaults to a whole building'), true);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
