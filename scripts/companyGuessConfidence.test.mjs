// Assertion tests for the guessed-company match confidence shown in the
// HubSpot review popup. Plain Node, no test framework. Run:
//   node scripts/companyGuessConfidence.test.mjs
import { guessConfidence, confidenceBand } from '../src/utils/companyGuessConfidence.js';
import { groupGuessedCompanies } from '../src/utils/companyGuessIgnore.js';

let passed = 0, failed = 0;
function ok(cond, name, detail = '') {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${detail}`); }
}
const loose = (source, guess) => guessConfidence({ source, guess, match: source.startsWith('@') ? 'domain-loose' : 'name-loose' });

ok(guessConfidence({ source: 'Simpson Housing LLLP', guess: 'Simpson Housing', match: 'name-exact' }) === 100, 'same name bar the suffix is 100');
ok(guessConfidence({ source: '@acme.com', guess: 'Acme Corporation', match: 'domain-known' }) === 95, 'a domain on file is 95');

// Suggestions that account for the whole current name: high, never over 90.
for (const [s, g] of [
  ['Seritage', 'Seritage Growth Properties'],
  ['Skyline', 'SKYLINE CHAMPION CORP'],
  ['Stackinfra', 'Stack Infrastructure'],
  ['Stoneweg Asset Management', 'Stoneweg US'],
  ['ShopCore Properties', 'ShopCore (BX-PC)'],
  ['Sculptor Capital', 'Sculptor Real Estate Advisors'],
  ['@strategichotels.com', 'Strategic Hotels & Resorts'],
  ['@amtrustgroup.com', 'Amtrust Financial'],
]) {
  const pct = loose(s, g);
  ok(pct >= 75 && pct <= 90, `high: ${s} -> ${g}`, `got ${pct}`);
}

// Suggestions that only share a beginning: low.
for (const [s, g] of [
  ['Silvertip Capital', 'Silver Lake'],
  ['St. John the Evangelist', 'St.John Properties'],
  ['@silvertip.com', 'Silver Lake'],
]) {
  const pct = loose(s, g);
  ok(pct < 50, `low: ${s} -> ${g}`, `got ${pct}`);
}

ok(loose('Seritage', 'Seritage') > loose('Seritage', 'Seritage Growth Properties'), 'a fuller match outranks a partial one');
ok(confidenceBand(90) === 'high' && confidenceBand(60) === 'medium' && confidenceBand(22) === 'low', 'bands');

const rows = groupGuessedCompanies([
  { id: '1', company: 'Silvertip Capital', guessedCompany: 'Silver Lake', guessedCompanyMatch: 'name-loose' },
  { id: '2', company: '', email: 'a@acme.com', guessedCompany: 'Acme Corporation', guessedCompanyMatch: 'domain-known' },
]);
ok(rows.every(r => typeof r.confidence === 'number'), 'every review row carries a confidence');
ok(rows.find(r => r.guess === 'Acme Corporation').confidence === 95, 'the row takes the route the guess took');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
