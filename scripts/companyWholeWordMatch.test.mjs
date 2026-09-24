// Company-name fuzzy matching must only treat one name as "inside" another
// on whole-word boundaries. Stripping punctuation turns "S&P Global" into
// "sp global", which sits inside "wsp global" mid-word; that let an opp
// filed under WSP Global pull S&P Global onto My Accounts. Run:
//   node scripts/companyWholeWordMatch.test.mjs
import { buildCompanyIndex, findMatchesInIndex, findStrictMatchesInIndex, containsWholeWords } from '../src/utils/companyIndex.js';
import { companiesMatch } from '../src/utils/listFlags.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  if (actual === expected) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${expected}\n        got      ${actual}`); }
}
const loose = (q, s) => findMatchesInIndex(buildCompanyIndex([s]), q).has(s);
const strict = (q, s) => findStrictMatchesInIndex(buildCompanyIndex([s]), q).has(s);

// ── The bug ───────────────────────────────────────────────────────────
eq(loose('s&p global', 'wsp global'), false, 'S&P Global does not match a WSP Global opp (loose)');
eq(loose('wsp global', 's&p global'), false, 'nor the other way round');
eq(strict('s&p global', 'wsp global'), false, 'nor via the strict matcher');
eq(companiesMatch('S&P Global', 'WSP Global'), false, 'nor via companiesMatch');

// ── Real containment still matches ────────────────────────────────────
eq(loose('bank of america', 'bank of america holdings'), true, 'extra trailing word still matches');
eq(strict('bank of america', 'bank of america holdings'), true, 'and via the strict matcher');
eq(loose('s&p global', 's&p global inc.'), true, 'S&P Global matches itself with a suffix');
eq(companiesMatch('Blue Owl Capital', 'Blue Owl Capital Group'), true, 'companiesMatch keeps whole-word containment');
eq(companiesMatch('WSP Global', 'WSP Global Inc'), true, 'WSP Global matches itself with a suffix');

// ── The helper itself ─────────────────────────────────────────────────
eq(containsWholeWords('wsp global', 'sp global'), false, 'mid-word start is rejected');
eq(containsWholeWords('prologistics', 'prologis'), false, 'mid-word end is rejected');
eq(containsWholeWords('xsp global sp global', 'sp global'), true, 'a later whole-word hit still counts');
eq(containsWholeWords('at&t inc', 'at&t'), true, 'punctuation inside the name is fine');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
