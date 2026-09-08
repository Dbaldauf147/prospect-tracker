// Assertion tests for reading a company brand off an email domain. Plain
// Node — no test framework (the project has none). Run:
//   node scripts/brandFromDomain.test.mjs
//
// This is the fallback under three different "who does this person work
// for" answers: the Suggested Company hints on the contacts pages, the
// email-format predictions, and the Email Campaign tracker's Company
// column, which shows it greyed when HubSpot has no company on the
// contact. All three read a suffix as a brand if the suffix isn't known —
// "mapletree.com.sg" arriving as the company "Com" is what these pin
// against — and a free-mail address must resolve to nothing at all, since
// a personal inbox names no employer.
import { brandFromDomain } from '../src/utils/companyGuess.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  if (actual === expected) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`); }
}

eq(brandFromDomain('svpglobal.com'), 'Svpglobal', 'a plain .com is its own brand');
eq(brandFromDomain('ext.urw.com'), 'Urw', 'a subdomain is not the brand');
eq(brandFromDomain('rer.org'), 'Rer', '.org reads the same way');

// Two-part suffixes: the brand is the label before them, not the "com".
eq(brandFromDomain('acme.co.uk'), 'Acme', 'co.uk');
eq(brandFromDomain('mapletree.com.sg'), 'Mapletree', 'com.sg');
eq(brandFromDomain('example.com.hk'), 'Example', 'com.hk');
eq(brandFromDomain('example.co.za'), 'Example', 'co.za');
eq(brandFromDomain('example.co.kr'), 'Example', 'co.kr');
eq(brandFromDomain('example.org.uk'), 'Example', 'org.uk');
eq(brandFromDomain('sub.example.com.au'), 'Example', 'a subdomain over a two-part suffix');

// A personal inbox names no employer.
eq(brandFromDomain('gmail.com'), '', 'free mail resolves to nothing');
eq(brandFromDomain('outlook.com'), '', 'so does outlook.com');

// Nothing to read.
eq(brandFromDomain(''), '', 'empty in, empty out');
eq(brandFromDomain('localhost'), '', 'a bare host has no brand');
eq(brandFromDomain(null), '', 'null in, empty out');

console.log(failed === 0 ? `\nAll ${passed} brandFromDomain tests passed.` : `\n${failed} test(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
