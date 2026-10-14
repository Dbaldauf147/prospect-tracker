// Assertion tests for utils/emailHrefs.js. Plain Node - no test framework.
// Run:
//   node scripts/emailHrefs.test.mjs
//
// A link typed into the Draft Emails editor without a scheme was saved as a
// relative href and vanished from the downloaded .eml. These pin the repair.

import { absoluteHref, absolutizeLinks } from '../src/utils/emailHrefs.js';

let failures = 0;
function eq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}

eq('a www link gets https', absoluteHref('www.example.com'), 'https://www.example.com');
eq('a bare domain with a path gets https', absoluteHref('example.co.uk/pricing?x=1'), 'https://example.co.uk/pricing?x=1');
eq('a domain with a port gets https', absoluteHref('example.com:8080/x'), 'https://example.com:8080/x');
eq('a protocol-relative link gets https', absoluteHref('//example.com/a'), 'https://example.com/a');
eq('a bare address gets mailto', absoluteHref('dan@example.com'), 'mailto:dan@example.com');
eq('surrounding spaces are trimmed', absoluteHref('  www.example.com '), 'https://www.example.com');
eq('https is left alone', absoluteHref('https://example.com/a'), 'https://example.com/a');
eq('http is left alone', absoluteHref('http://example.com'), 'http://example.com');
eq('mailto is left alone', absoluteHref('mailto:dan@example.com'), 'mailto:dan@example.com');
eq('tel is left alone', absoluteHref('tel:+15551234567'), 'tel:+15551234567');
eq('an anchor is left alone', absoluteHref('#top'), '#top');
eq('a merge field is left alone', absoluteHref('{bookingLink}'), '{bookingLink}');
eq('plain words are left alone', absoluteHref('click here'), 'click here');
eq('empty stays empty', absoluteHref(''), '');

eq('every anchor in a body is repaired',
  absolutizeLinks('<p>See <a href="www.a.com" rel="noopener noreferrer" target="_blank">A</a> and <a href=\'https://b.com\'>B</a></p>'),
  '<p>See <a href="https://www.a.com" rel="noopener noreferrer" target="_blank">A</a> and <a href=\'https://b.com\'>B</a></p>');
eq('non-anchor tags are untouched',
  absolutizeLinks('<img src="www.a.com/x.png">'), '<img src="www.a.com/x.png">');

console.log(failures === 0 ? '\nAll email href tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
