// Assertion tests for the site-list research prompts in the Prompt Library.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/sitePrompts.test.mjs
//
// These two prompts exist to produce a spreadsheet that the Utility Lookup
// upload can read, and the whole value of the tenure column is that it lands
// on one of the four canonical values: a site list that says "Owned/Leased"
// or "Partial floor" in that column is a site list whose tenure is thrown
// away at import, and nobody finds out until the estimates come back sized
// as if the company owned a tower it rents two floors of.
//
// So the prompts quote the vocabulary, and this pins the quote to the code.
// TENURE_OPTIONS is the list the importer normalizes to and the picklist
// offers; if a fifth value is ever added, or one is reworded, these fail and
// the prompts get updated in the same change rather than silently going on
// asking for the old spelling.
//
// The prompts also tell the researcher what a bare "Leased" will become,
// which is a claim about DEFAULT_LEASE_CLASS. That map is pinned too — not
// word for word, which prose can't be, but by its size and its members, so
// a property type joining or leaving it forces somebody to re-read the
// sentence that describes it.
import { readFileSync } from 'node:fs';
import { TENURE, TENURE_OPTIONS, DEFAULT_LEASE_CLASS, CLASS } from '../src/utils/ownershipEstimates.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// Pull one seed prompt's template-literal body out of the source. Reading the
// component as text rather than importing it keeps this a plain Node test:
// AgentsView is a React module with a page's worth of imports behind it.
const SRC = readFileSync(new URL('../src/components/AgentsView/AgentsView.jsx', import.meta.url), 'utf8');
function promptBody(id) {
  const at = SRC.indexOf(`id: '${id}'`);
  if (at === -1) throw new Error(`no seed prompt with id ${id}`);
  const open = SRC.indexOf('body: `', at) + 'body: `'.length;
  // The first backtick that isn't escaped inside the template closes it.
  let end = open;
  for (;;) {
    end = SRC.indexOf('`', end);
    if (end === -1) throw new Error(`unterminated body for ${id}`);
    if (SRC[end - 1] !== '\\') break;
    end += 1;
  }
  return SRC.slice(open, end);
}

const deepResearch = promptBody('seed-deep-research-site-list');
const bigList = promptBody('seed-big-site-list-python');

// ── The tenure vocabulary, quoted verbatim in both prompts ────────────────
check('vocabulary: the four values are what the importer normalizes to',
  TENURE_OPTIONS, ['Owned', 'Leased', 'Leased – Suite', 'Leased – Whole Building']);

for (const value of TENURE_OPTIONS) {
  check(`deep research quotes "${value}"`, deepResearch.includes(value), true);
  check(`big site list quotes "${value}"`, bigList.includes(value), true);
}

// The two levels are the requirement that was missing; a prompt that lists
// only Owned and Leased is the state this change fixed.
for (const [name, body] of [['deep research', deepResearch], ['big site list', bigList]]) {
  check(`${name}: asks for the lease level, not just the fact of a lease`,
    body.includes(TENURE.SUITE) && body.includes(TENURE.WHOLE), true);
  // Guessing Owned is the one failure mode that is invisible downstream: a
  // blank already estimates as owned, so a guess reads exactly like a fact.
  // One prompt quotes the value, the other bolds it — both are the same rule.
  check(`${name}: says not to default to Owned`, /never default to ["*]{0,2}Owned/i.test(body), true);
}

// ── What a bare "Leased" resolves to ──────────────────────────────────────
// Both prompts tell the researcher this, so the map they describe is pinned.
const suiteDefaults = Object.entries(DEFAULT_LEASE_CLASS)
  .filter(([, cls]) => cls === CLASS.SUITE)
  .map(([type]) => type)
  .sort();

check('default lease class: the types taken by the floor or the unit',
  suiteDefaults,
  [
    'Industrial Flex / R&D', 'Laboratory / R&D', 'Medical Office', 'Mixed Use',
    'Office - High-Rise', 'Office - Mid-Rise', 'Office - Small (Low-Rise)',
    'Office Occupier', 'Retail - Neighborhood Retail', 'Shopping Mall / Retail Center',
  ]);
check('default lease class: everything else is whole-building by fallback',
  Object.values(DEFAULT_LEASE_CLASS).every(c => c === CLASS.SUITE), true);

// The prose in each prompt names that set. Matched on the distinguishing
// word of each member rather than the full label, because the sentence reads
// as English ("offices, laboratories, medical office, industrial flex...")
// and pinning it literally would just pin the prose to itself.
const SUITE_PROSE = ['office', 'laborator', 'medical office', 'industrial flex', 'mixed use', 'mall', 'neighbourhood retail'];
for (const [name, body] of [['deep research', deepResearch], ['big site list', bigList]]) {
  const lower = body.toLowerCase();
  for (const word of SUITE_PROSE) {
    check(`${name}: the bare-Leased default names "${word}"`, lower.includes(word), true);
  }
}

// ── The column has to be findable by the importer ─────────────────────────
// detectColumn matches /^ownership$/i and /^owned\s*\/?\s*leased?$/i among
// others; each prompt names the header it asks for, and it has to be one of
// them or the column is read as an unmapped extra.
check('deep research names a header the upload detects',
  /column named "Ownership"/.test(deepResearch), true);
check('big site list names a header the upload detects',
  /\bOwned \/ Leased\b/.test(bigList), true);

// ── A Suite row is sized on the premises, not the tower ───────────────────
// The estimators halve a suite's load and drop its landlord accounts, but
// they take the square footage on the row at face value — so a building's
// area on a floor tenant's row overstates it however good the tenure is.
for (const [name, body] of [['deep research', deepResearch], ['big site list', bigList]]) {
  check(`${name}: a Suite's square footage is the leased premises`,
    /leased premises/i.test(body), true);
}

if (failed === 0) console.log(`PASS  sitePrompts: ${passed} assertions`);
else { console.error(`\n${failed} failed, ${passed} passed`); process.exit(1); }
