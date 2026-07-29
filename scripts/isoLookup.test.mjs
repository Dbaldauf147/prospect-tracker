// Assertion tests for the ISO/RTO ZIP lookup. Plain Node — no test framework
// (the project has none). Run:  node scripts/isoLookup.test.mjs
// Imports use explicit .js extensions so this runs the real module + seed
// under plain Node, no loader or bundler required.

import { lookupIsoForZip, backfillIso } from '../src/utils/isoLookup.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
function is(cond, name) { cond ? (passed++, console.log(`PASS  ${name}`)) : (failed++, console.log(`FAIL  ${name}`)); }

// --- One known ZIP per ISO (per the spec's list) ------------------------
eq(lookupIsoForZip('75201'), { iso: 'ERCOT', egrid_subregion: 'ERCT', iso_confidence: 'exact' }, '75201 -> ERCOT');
eq(lookupIsoForZip('94105'), { iso: 'CAISO', egrid_subregion: 'CAMX', iso_confidence: 'exact' }, '94105 -> CAISO');
eq(lookupIsoForZip('10001'), { iso: 'NYISO', egrid_subregion: 'NYCW', iso_confidence: 'exact' }, '10001 -> NYISO');
eq(lookupIsoForZip('02110'), { iso: 'ISO-NE', egrid_subregion: 'NEWE', iso_confidence: 'exact' }, '02110 -> ISO-NE');
eq(lookupIsoForZip('19103'), { iso: 'PJM', egrid_subregion: 'RFCE', iso_confidence: 'exact' }, '19103 -> PJM');
eq(lookupIsoForZip('73101'), { iso: 'SPP', egrid_subregion: 'SPSO', iso_confidence: 'exact' }, '73101 -> SPP');

// 55401 -> MISO, but MROW is flagged, so confidence is "verify".
eq(lookupIsoForZip('55401'), { iso: 'MISO', egrid_subregion: 'MROW', iso_confidence: 'verify' }, '55401 -> MISO (verify)');

// 30301 -> Southeast, not in any ISO (still an "exact" answer, iso is a
// descriptive None string rather than null).
{
  const r = lookupIsoForZip('30301');
  is(r.iso && r.iso.startsWith('None (Southeast'), '30301 -> None (Southeast)');
  is(r.egrid_subregion === 'SRSO' && r.iso_confidence === 'exact', '30301 -> SRSO / exact');
}

// --- Leading-zero ZIP (Excel drops the leading 0) -----------------------
// 2110 (number) should normalize to "02110" -> ISO-NE, same as the string.
eq(lookupIsoForZip(2110), { iso: 'ISO-NE', egrid_subregion: 'NEWE', iso_confidence: 'exact' }, 'leading-zero 2110 -> ISO-NE');

// --- Seam ZIP (straddles two markets) -----------------------------------
// 07401 touches RFCE (PJM) + NYUP (NYISO) -> primary PJM, confidence "seam".
eq(lookupIsoForZip('07401'), { iso: 'PJM', egrid_subregion: 'RFCE', iso_confidence: 'seam' }, '07401 -> PJM (seam)');

// --- Invalid / not-found ZIPs never crash -------------------------------
eq(lookupIsoForZip('abcde'), { iso: null, egrid_subregion: null, iso_confidence: 'unknown' }, 'abcde -> unknown');
eq(lookupIsoForZip(''), { iso: null, egrid_subregion: null, iso_confidence: 'unknown' }, 'empty -> unknown');
eq(lookupIsoForZip(null), { iso: null, egrid_subregion: null, iso_confidence: 'unknown' }, 'null -> unknown');
eq(lookupIsoForZip('00000'), { iso: null, egrid_subregion: null, iso_confidence: 'unknown' }, '00000 (not in crosswalk) -> unknown');

// --- backfillIso: correctness + idempotency -----------------------------
{
  const rows = [
    { company: 'A', zip: '75201' },              // ERCOT / exact
    { company: 'B', zip: '2110' },               // ISO-NE via leading-zero
    { company: 'C', zip: '07401' },              // PJM / seam
    { company: 'D', zip: '55401' },              // MISO / verify
    { company: 'E', zip: 'nope' },               // unknown
  ];
  const first = backfillIso(rows);
  is(first.summary.updated === 5 && first.summary.unchanged === 0, 'backfill: first run updates all 5');
  is(first.rows[0].iso === 'ERCOT' && first.rows[2].iso_confidence === 'seam' && first.rows[3].iso_confidence === 'verify',
    'backfill: stamps correct values');
  is(first.summary.seam === 1 && first.summary.verify === 1 && first.summary.unknown === 1 && first.summary.exact === 2,
    'backfill: confidence tallies');

  // Idempotent: re-running over the stamped rows changes nothing.
  const second = backfillIso(first.rows);
  is(second.summary.updated === 0 && second.summary.unchanged === 5, 'backfill: second run is a no-op (idempotent)');
  is(second.rows[0] === first.rows[0], 'backfill: unchanged rows keep identity');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
