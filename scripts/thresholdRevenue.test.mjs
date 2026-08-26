// Assertion tests for which revenue figure the corporate-compliance
// screening tests its thresholds against. Plain Node — no test framework
// (the project has none). Run:
//   node scripts/thresholdRevenue.test.mjs
//
// The failure this guards is the one that shipped: a $1.2B manufacturer
// owned by a private-equity firm whose own management-company revenue is
// $35M was screened on the $35M and ruled out of SB 253 / SB 261 — mandates
// that plainly apply. Either figure can trigger a mandate, so the larger is
// the test subject.
import { pickThresholdRevenue, deriveRegulationVerdict } from '../src/data/corporateComplianceScreening.js';

let pass = 0, fail = 0;
const ok = (c, n) => (c ? (pass += 1, console.log('PASS ', n)) : (fail += 1, console.log('FAIL ', n)));
const eq = (a, b, n) => ok(JSON.stringify(a) === JSON.stringify(b), `${n} (got ${JSON.stringify(a)})`);

// --- the reported case ------------------------------------------------------
eq(
  pickThresholdRevenue({ own: '$1.2B', parent: '$35M', parentName: 'Pritzker Private Capital' }),
  { label: '$1.2B', entity: '', source: 'own' },
  'C.H. Guenther: own $1.2B beats the PE owner’s $35M',
);
eq(
  pickThresholdRevenue({ own: '$1.2B', parent: '$35B', parentName: 'Pritzker Private Capital' }),
  { label: '$35B', entity: 'Pritzker Private Capital', source: 'parent' },
  'a genuinely larger parent is still the test subject',
);

// --- no parent, or one nobody has researched --------------------------------
eq(pickThresholdRevenue({ own: '$1.2B' }), { label: '$1.2B', entity: '', source: 'own' },
  'no parent recorded: the company’s own figure');
eq(pickThresholdRevenue({ own: '$1.2B', parent: '', parentName: 'Holdco' }),
  { label: '$1.2B', entity: '', source: 'own' },
  'parent recorded but unresearched: falls back to the company’s own');
eq(pickThresholdRevenue({ own: '', parent: '$4B', parentName: 'Holdco' }),
  { label: '$4B', entity: 'Holdco', source: 'parent' },
  'company’s own unknown: the parent’s figure carries the screening');
eq(pickThresholdRevenue({}), { label: '', entity: '', source: 'none' },
  'nothing researched at all');

// --- ties and unreadable figures --------------------------------------------
eq(pickThresholdRevenue({ own: '$2B', parent: '$2,000,000,000', parentName: 'Holdco' }),
  { label: '$2B', entity: '', source: 'own' },
  'a tie reads as the company’s own — same number, simpler basis');
eq(pickThresholdRevenue({ own: 'private', parent: '$4B', parentName: 'Holdco' }),
  { label: '$4B', entity: 'Holdco', source: 'parent' },
  'an unreadable own figure loses to a readable parent');
eq(pickThresholdRevenue({ own: '$1.2B', parent: 'not disclosed', parentName: 'Holdco' }),
  { label: '$1.2B', entity: '', source: 'own' },
  'an unreadable parent figure loses to a readable own');
eq(pickThresholdRevenue({ own: 'private', parent: 'not disclosed', parentName: 'Holdco' }),
  { label: 'not disclosed', entity: 'Holdco', source: 'parent' },
  'neither readable: the consolidated group is still the named entity');

// --- what the verdict does with it ------------------------------------------
// The end-to-end shape of the bug: SB 253's $1B threshold against the two
// figures, with California answered Yes.
const SB253 = { revenueThresholdUsd: 1e9 };
{
  const picked = pickThresholdRevenue({ own: '$1.2B', parent: '$35M', parentName: 'Pritzker Private Capital' });
  const v = deriveRegulationVerdict(SB253, {
    revenueUsd: 1.2e9,
    revenueLabel: picked.label,
    revenueEntity: picked.entity,
    doingBusiness: 'Yes',
  });
  ok(v?.verdict === 'Yes', 'SB 253 applies on the company’s own $1.2B');
  ok((v?.basis || '').includes('$1.2B') && !(v?.basis || '').includes('parent:'),
    'the basis quotes the company’s own figure, unattributed to a parent');
}
{
  const picked = pickThresholdRevenue({ own: '$120M', parent: '$35B', parentName: 'Holdco' });
  const v = deriveRegulationVerdict(SB253, {
    revenueUsd: 35e9,
    revenueLabel: picked.label,
    revenueEntity: picked.entity,
    doingBusiness: 'Yes',
  });
  ok(v?.verdict === 'Yes', 'SB 253 applies on the parent’s $35B');
  ok((v?.basis || '').includes('parent: Holdco'), 'the basis says whose number cleared the bar');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
