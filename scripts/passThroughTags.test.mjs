// Assertion tests for tagging Line Items as pass-through. Plain Node, no test
// framework (the project has none). Run:
//   node scripts/passThroughTags.test.mjs
//
// Tagging a pair bills its CTS at cost on every option, so the failures worth
// pinning are the silent ones: a key built differently from the one the
// Pricing table looks up (tags nothing, looks tagged), and a bare name
// carrying both a Setup and a Recurring cost resolving to whichever came
// first (reprices the half nobody meant to touch).
import {
  passThroughPairKey,
  pairLabel,
  pairLabelShort,
  splitPairLabel,
  collectPassThroughPairs,
  resolvePassThroughDraft,
  pickerSuggestions,
  pairTypes,
} from '../src/utils/passThroughTags.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// ── The key ───────────────────────────────────────────────────────────────
// This is PricingView's linkedToDefaultKey. If the two ever drift, a tag
// written here is a tag the Pricing table never reads.
check('key: lowercased and joined', passThroughPairKey('CCM NAM', 'Setup'), 'ccm nam::setup');
check('key: trims both halves', passThroughPairKey('  CCM NAM ', ' Setup '), 'ccm nam::setup');
check('key: missing type still keys', passThroughPairKey('CCM NAM', ''), 'ccm nam::');
check('key: nothing at all', passThroughPairKey(), '::');

// ── Pair labels ───────────────────────────────────────────────────────────
check('label: pair', pairLabel('CCM NAM', 'Setup'), 'CCM NAM · Setup');
check('label: no type', pairLabel('CCM NAM', ''), 'CCM NAM');

// The Type column sometimes holds a paragraph of fee prose. A label going
// into a sentence clamps it; the table clamps its own cells in CSS.
{
  const prose = 'Fee = 3% of revenue split (min. $2,500 per RFP). Please see email for caveats.';
  const short = pairLabelShort('Demand Side Response', prose);
  check('short label: clamped', short.length < 70, true);
  check('short label: ends in an ellipsis', short.endsWith('…'), true);
  check('short label: keeps the name whole', short.startsWith('Demand Side Response · Fee = 3%'), true);
  check('short label: leaves a short type alone',
    pairLabelShort('CCM NAM', 'Setup'), 'CCM NAM · Setup');
}

// ── Collecting pairs off a workbook ───────────────────────────────────────
const workbook = [
  {
    optionNumber: 1, sheetName: 'Option 1',
    sections: [{ items: [
      { description: 'CCM NAM', type: 'Recurring (monthly)', cts: 3796 },
      { description: 'CCM NAM', type: 'Setup', cts: 9224 },
      { description: 'ENERGY STAR Link (RA)', type: 'Recurring (monthly)', cts: 725.83 },
    ] }],
  },
  {
    optionNumber: 2, sheetName: 'Option 2',
    sections: [{ items: [
      { description: 'CCM NAM', type: 'Recurring (monthly)', cts: 4000 },
      { description: 'Budgets - Commercial Site Level', type: 'Recurring (monthly)', cts: 120 },
    ] }],
  },
];

{
  const pairs = collectPassThroughPairs({
    options: workbook,
    tagged: { 'ccm nam::recurring (monthly)': true },
    activeOptionNumber: 1,
  });
  check('collect: one row per pair, sorted', pairs.all.map(p => pairLabel(p.lineItem, p.type)), [
    'Budgets - Commercial Site Level · Recurring (monthly)',
    'CCM NAM · Recurring (monthly)',
    'CCM NAM · Setup',
    'ENERGY STAR Link (RA) · Recurring (monthly)',
  ]);
  check('collect: tagged split out', pairs.tagged.map(p => p.key), ['ccm nam::recurring (monthly)']);
  check('collect: untagged is the rest', pairs.untagged.length, 3);
  const ccmRec = pairs.all.find(p => p.key === 'ccm nam::recurring (monthly)');
  check('collect: CTS is the active option only', ccmRec.activeCts, 3796);
  check('collect: every option it appears on', ccmRec.options, ['Option 1', 'Option 2']);
  const offOption = pairs.all.find(p => p.key === 'budgets - commercial site level::recurring (monthly)');
  check('collect: no CTS on the active option', offOption.activeCts, null);
}

// A pair tagged against a workbook that has since been swapped out still gets
// a row — otherwise the mapping is invisible and impossible to clear.
{
  const pairs = collectPassThroughPairs({
    options: workbook,
    tagged: { 'supplier charges::one time': true },
    activeOptionNumber: 1,
  });
  const orphan = pairs.tagged[0];
  check('collect: orphaned tag survives', [orphan.lineItem, orphan.type, orphan.reachable],
    ['supplier charges', 'one time', false]);
  check('collect: and stays clearable', pairs.tagged.length, 1);
}

// Two rows of the same pair inside one option are one charge on the Pricing
// table, so they are one row here too, summed.
{
  const pairs = collectPassThroughPairs({
    options: [{ optionNumber: 1, sheetName: 'Option 1', sections: [
      { items: [{ description: 'Meters', type: 'Setup', cts: 100 }] },
      { items: [{ description: 'Meters', type: 'Setup', cts: 250 }] },
    ] }],
    activeOptionNumber: 1,
  });
  check('collect: duplicate pairs sum', pairs.all.length, 1);
  check('collect: ...to the whole charge', pairs.all[0].activeCts, 350);
}

// The Type shown is whatever the page resolves (overrides included), not the
// raw sheet value.
{
  const pairs = collectPassThroughPairs({
    options: [{ optionNumber: 1, sheetName: 'Option 1', sections: [
      { items: [{ description: 'Meters', type: 'Setup', cts: 100 }] },
    ] }],
    activeOptionNumber: 1,
    typeOf: () => 'One Time',
  });
  check('collect: typeOf decides the type', pairs.all[0].type, 'One Time');
}

// ── Resolving what was typed ──────────────────────────────────────────────
const pairs = collectPassThroughPairs({ options: workbook, activeOptionNumber: 1 }).all;

check('resolve: nothing typed', resolvePassThroughDraft({ text: '', pairs }).error, 'empty');

// Picked out of the suggestion list: the label carries its own type.
check('resolve: picked a labelled pair',
  resolvePassThroughDraft({ text: 'CCM NAM · Setup', pairs }),
  { ok: true, key: 'ccm nam::setup', lineItem: 'CCM NAM', type: 'Setup', known: true });

// A label's own type wins over a stale Type box — the user picked the pair.
check('resolve: label beats the Type box',
  resolvePassThroughDraft({ text: 'CCM NAM · Setup', type: 'Recurring (monthly)', pairs }).key,
  'ccm nam::setup');

// A name carrying exactly one type needs no further asking.
check('resolve: unambiguous name',
  resolvePassThroughDraft({ text: 'ENERGY STAR Link (RA)', pairs }).key,
  'energy star link (ra)::recurring (monthly)');
check('resolve: name match ignores case',
  resolvePassThroughDraft({ text: '  energy star link (ra) ', pairs }).key,
  'energy star link (ra)::recurring (monthly)');

// The one that must not guess. CCM NAM is Setup AND Recurring, priced
// differently on purpose.
{
  const r = resolvePassThroughDraft({ text: 'CCM NAM', pairs });
  check('resolve: ambiguous name refuses to guess', r.ok, false);
  check('resolve: ...and says which types', [r.error, r.types.sort()],
    ['ambiguous', ['Recurring (monthly)', 'Setup']]);
}
check('resolve: ambiguity settled by the Type box',
  resolvePassThroughDraft({ text: 'CCM NAM', type: 'Setup', pairs }).key, 'ccm nam::setup');

// Free text the workbook has never seen — allowed, but it needs a type, since
// there is nothing to infer one from.
check('resolve: unknown name needs a type',
  resolvePassThroughDraft({ text: 'Supplier charges', pairs }).error, 'need-type');
{
  const r = resolvePassThroughDraft({ text: 'Supplier charges', type: 'One Time', pairs });
  check('resolve: unknown name with a type', [r.ok, r.key, r.known],
    [true, 'supplier charges::one time', false]);
}

// A known name with a type the workbook doesn't carry is still allowed — the
// next upload may well have it — but it is not marked as known.
check('resolve: known name, unknown type',
  resolvePassThroughDraft({ text: 'CCM NAM', type: 'One Time', pairs }).known, true);

// Re-tagging is a no-op worth saying out loud rather than silently applying.
check('resolve: already tagged',
  resolvePassThroughDraft({ text: 'CCM NAM · Setup', pairs, tagged: { 'ccm nam::setup': true } }).error,
  'already-tagged');

// A Line Item whose own name contains the separator resolves by name rather
// than being cut in half at it.
{
  const odd = collectPassThroughPairs({
    options: [{ optionNumber: 1, sheetName: 'O1', sections: [
      { items: [{ description: 'Metering · EU', type: 'Setup', cts: 10 }] },
    ] }],
    activeOptionNumber: 1,
  }).all;
  check('resolve: separator inside a name',
    resolvePassThroughDraft({ text: 'Metering · EU', pairs: odd }).key, 'metering · eu::setup');
  check('resolve: ...and its own label still splits',
    splitPairLabel('Metering · EU · Setup', odd).type, 'Setup');
}

// ── What the picker offers ────────────────────────────────────────────────
// Shortest form that still resolves: a name carrying one type is offered
// bare, a name carrying two is offered per type.
{
  const sugg = pickerSuggestions(pairs);
  check('picker: shortest unambiguous form', sugg.map(s => s.value), [
    'Budgets - Commercial Site Level',
    'CCM NAM · Recurring (monthly)',
    'CCM NAM · Setup',
    'ENERGY STAR Link (RA)',
  ]);
  // Everything offered must resolve back to the pair it came from.
  const roundTrips = sugg.every(s => resolvePassThroughDraft({ text: s.value, pairs }).key === s.key);
  check('picker: every suggestion round-trips', roundTrips, true);
}
{
  // Tagging one half does not make the other half offerable by name — the
  // name still means two things.
  const sugg = pickerSuggestions(pairs, { 'ccm nam::setup': true });
  check('picker: tagged pairs drop out', sugg.map(s => s.value).includes('CCM NAM · Setup'), false);
  check('picker: ...but its sibling keeps the type half',
    sugg.map(s => s.value).includes('CCM NAM · Recurring (monthly)'), true);
}

// ── Type list ─────────────────────────────────────────────────────────────
check('types: distinct and sorted', pairTypes(pairs), ['Recurring (monthly)', 'Setup']);
check('types: blanks dropped', pairTypes([{ type: '' }, { type: 'Setup' }]), ['Setup']);
check('types: case-folded to one entry', pairTypes([{ type: 'Setup' }, { type: 'setup' }]), ['Setup']);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
