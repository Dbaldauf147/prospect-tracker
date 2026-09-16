// Assertion tests for the HTML half of the Scope picker's Copy button.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/scopeCopyRich.test.mjs
//
// scopeCopyText.test.mjs pins the words. This pins the markup around them,
// where the things that go wrong are different: a heading that is not bold
// in Outlook, bullets that arrive as one paragraph, and a service name
// carrying an ampersand or an angle bracket breaking the paste open.
//
// The pair also has to agree on emptiness. A button that hands the
// clipboard markup for a scope the text half calls empty would paste a
// stray heading into somebody's proposal.
import { scopeCopyHtml } from '../src/utils/scopeCopyRich.js';
import { scopeCopyText } from '../src/utils/scopeCopyText.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
function ok(cond, name) { eq(!!cond, true, name); }

const groups = [
  { category: 'Energy Management', items: [{ label: 'Comp GHG' }, { label: 'Strategic sourcing' }] },
  { category: 'Sustainability', items: [{ label: 'CSRD reporting' }] },
];

// ---- the ordinary case ------------------------------------------------------

{
  const html = scopeCopyHtml(groups, []);
  eq((html.match(/<ul /g) || []).length, 2, 'one list per category');
  eq((html.match(/<li /g) || []).length, 3, 'one item per service');
  ok(html.includes('>Energy Management</div>'), 'the category is a heading of its own');
  ok(html.includes('font-weight:700'), 'and a bold one, so it reads as a heading in Outlook');
  ok(html.includes('font-family:Aptos'), 'styles are inline, since Outlook drops <style> blocks');
  eq(html.indexOf('Energy Management') < html.indexOf('Sustainability'), true,
    'the categories keep the order the board put them in');
  eq(html.indexOf('Comp GHG') < html.indexOf('Strategic sourcing'), true,
    'and so do the services inside one');
}

// ---- commodities lead, as they do in the text ------------------------------

{
  const html = scopeCopyHtml(groups, ['Electric', 'Natural Gas']);
  ok(html.includes('Commodities: Electric, Natural Gas'), 'the commodity line is one line, comma separated');
  eq(html.indexOf('Commodities:') < html.indexOf('Energy Management'), true,
    'and leads, because what the work is about comes before what gets done to it');
  ok(!scopeCopyHtml(groups, ['  ', '']).includes('Commodities:'),
    'a commodity list of blanks prints no line');
  ok(!scopeCopyHtml(groups).includes('Commodities:'), 'and neither does no list at all');
}

// ---- text somebody typed cannot break the paste open -----------------------

{
  const html = scopeCopyHtml([{
    category: 'GHG & Reporting',
    items: [{ label: 'Cat 3, 5, 6, and 7 (part of GHG)' }, { label: '<b>not markup</b>' }],
  }], ['Electric & Gas']);
  ok(html.includes('GHG &amp; Reporting'), 'an ampersand in a category is escaped');
  ok(html.includes('Electric &amp; Gas'), 'and in a commodity');
  ok(html.includes('&lt;b&gt;not markup&lt;/b&gt;'), 'a service name that looks like markup is escaped, not obeyed');
  ok(html.includes('Cat 3, 5, 6, and 7 (part of GHG)'), 'a service name with commas stays one bullet');
}

// ---- a group with no heading still lists its services ----------------------

{
  const html = scopeCopyHtml([{ category: '', items: [{ label: 'Loose service' }] }], []);
  ok(html.includes('<li style="margin:0 0 2px">Loose service</li>'), 'the service is listed');
  ok(!html.includes('font-weight:700'), 'with no empty heading above it');
}

// ---- the two flavours agree on what "nothing to copy" means ----------------

{
  const cases = [
    ['no groups at all', [], []],
    ['groups but no services', [{ category: 'Energy Management', items: [] }], []],
    ['services that are all blank', [{ category: 'Energy Management', items: [{ label: '  ' }] }], []],
    ['commodities and nothing else', [], ['Electric']],
    ['called with nothing', undefined, undefined],
  ];
  for (const [name, g, c] of cases) {
    eq([scopeCopyHtml(g, c) === '', scopeCopyText(g, c) === ''], [true, true],
      `${name}: both flavours copy nothing`);
  }
  // And the other direction: whenever there is text there is markup, so the
  // button never offers one without the other.
  eq([scopeCopyHtml(groups, []) !== '', scopeCopyText(groups, []) !== ''], [true, true],
    'a real scope produces both');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
