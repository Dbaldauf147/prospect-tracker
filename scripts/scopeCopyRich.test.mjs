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

// ---- the categories run across the page, not down it ------------------------

// One long column is what a dozen categories used to paste as. These pin the
// layout that replaced it: a table, because Outlook renders with Word's
// engine and ignores CSS column-count.

const cat = (n, size = 1) => ({
  category: `Category ${n}`,
  items: Array.from({ length: size }, (_, i) => ({ label: `Service ${n}.${i + 1}` })),
});
const cols = (html) => {
  const first = html.match(/<tr>.*?<\/tr>/)?.[0] || '';
  return (first.match(/<td /g) || []).length;
};
const rows = (html) => (html.match(/<tr>/g) || []).length;

{
  // One category is a list, not a layout.
  const one = scopeCopyHtml([cat(1)], []);
  eq(one.includes('<table'), false, 'a single category pastes as a plain list, with no table around it');

  eq(cols(scopeCopyHtml([cat(1), cat(2)], [])), 2, 'two categories go side by side');
  eq(cols(scopeCopyHtml([cat(1), cat(2), cat(3), cat(4)], [])), 2,
    'and four stay at two, so they land as a tidy 2x2 rather than three and a straggler');
  eq(rows(scopeCopyHtml([cat(1), cat(2), cat(3), cat(4)], [])), 2, 'which is two rows of two');
  eq(cols(scopeCopyHtml([cat(1), cat(2), cat(3), cat(4), cat(5)], [])), 3, 'five categories open a third column');

  // Capped, or the cells get narrower than the names they hold.
  const many = scopeCopyHtml(Array.from({ length: 12 }, (_, i) => cat(i + 1)), []);
  eq(cols(many), 3, 'twelve categories still use three columns, not twelve');
  eq(rows(many), 4, 'wrapping onto four rows');
}

{
  // Order is the board's: across, then down. The person ticking the services
  // read them in that order.
  const html = scopeCopyHtml([cat(1), cat(2), cat(3), cat(4), cat(5)], []);
  const seen = (html.match(/Category \d/g) || []);
  eq(seen, ['Category 1', 'Category 2', 'Category 3', 'Category 4', 'Category 5'],
    'the categories keep board order, running across each row before wrapping');
}

{
  // A ragged last row keeps its empty cells, or the one category left over
  // stretches the full width and reads as though it spans the columns above.
  const html = scopeCopyHtml([cat(1), cat(2), cat(3)], []);
  const last = html.match(/<tr>(?:(?!<tr>).)*<\/tr>\s*<\/table>/)?.[0] || '';
  eq((last.match(/<td /g) || []).length, 2, 'the short last row is padded out to the full column count');
  eq(/<td [^>]*>\s*<\/td>/.test(last), true, 'with a cell that is genuinely empty');
}

{
  // Percentages, so the paste sizes itself to whatever it lands in rather
  // than carrying one document's width into all of them.
  const html = scopeCopyHtml([cat(1), cat(2), cat(3), cat(4), cat(5)], []);
  eq(html.includes('width="33%"'), true, 'a third each across three columns');
  eq(/<table[^>]*width="100%"/.test(html), true, 'and the table fills its container');
  eq(/width\s*[:=]\s*"?\d+px/.test(html), false, 'and no width anywhere is pinned in pixels');
  eq((html.match(/valign="top"/g) || []).length, cols(html) * rows(html),
    'every cell is top-aligned, so a short category does not float beside a long one');
}

{
  // The commodity line is about the whole scope, so it stays above the
  // columns rather than becoming one of them.
  const html = scopeCopyHtml([cat(1), cat(2)], ['Electric']);
  eq(html.indexOf('Commodities:') < html.indexOf('<table'), true, 'commodities lead, outside the table');
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
