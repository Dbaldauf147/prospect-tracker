// Assertion tests for the links saved against an opp. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/oppLinks.test.mjs
//
// The rules worth pinning: a stored list survives odd shapes rather than
// vanishing, a pasted bare host still opens, and a `javascript:` URL never
// becomes an href — the popup renders whatever is typed into it, so that
// last one is the difference between a link box and an XSS hole.
import {
  readOppLinks, isBlankLink, countOppLinks, linkHref,
} from '../src/utils/oppLinks.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// --- reading ---------------------------------------------------------
check('no links', readOppLinks({}), []);
check('not an array', readOppLinks({ _links: 'https://acme.com' }), []);
check('no opp at all', readOppLinks(undefined), []);
check('the normal shape', readOppLinks({ _links: [{ url: 'https://acme.com', label: 'RFP' }] }),
  [{ url: 'https://acme.com', label: 'RFP' }]);
check('trims', readOppLinks({ _links: [{ url: '  https://acme.com  ', label: ' RFP ' }] }),
  [{ url: 'https://acme.com', label: 'RFP' }]);
check('a bare string row', readOppLinks({ _links: ['https://acme.com'] }),
  [{ url: 'https://acme.com', label: '' }]);
check('other key spellings', readOppLinks({ _links: [{ href: 'https://acme.com', name: 'RFP' }] }),
  [{ url: 'https://acme.com', label: 'RFP' }]);
// One bad row must not take the good ones with it.
check('junk rows are dropped, the rest kept', readOppLinks({
  _links: [null, { url: 'https://a.com' }, 42, { url: '', label: '' }, { label: 'no url yet' }],
}), [{ url: 'https://a.com', label: '' }, { url: '', label: 'no url yet' }]);
check('stored order is kept', readOppLinks({ _links: [{ url: 'b.com' }, { url: 'a.com' }] }),
  [{ url: 'b.com', label: '' }, { url: 'a.com', label: '' }]);

// --- counting --------------------------------------------------------
check('an empty form row is blank', isBlankLink({ url: '', label: '  ' }), true);
check('a label alone is not blank', isBlankLink({ url: '', label: 'RFP' }), false);
check('count skips the empty seed row', countOppLinks([{ url: 'a.com', label: '' }, { url: '', label: '' }]), 1);
check('count of nothing', countOppLinks(undefined), 0);

// --- hrefs -----------------------------------------------------------
check('https passes through', linkHref('https://acme.com/x'), 'https://acme.com/x');
check('http passes through', linkHref('http://acme.com'), 'http://acme.com');
check('a pasted bare host gets https', linkHref('acme.com/docs'), 'https://acme.com/docs');
check('www. too', linkHref('www.acme.com'), 'https://www.acme.com');
check('a typed word is not a site', linkHref('follow up with Dan'), '');
check('nothing typed', linkHref('   '), '');
// The one that matters: no scheme we don't hand to the browser.
check('javascript: is refused', linkHref('javascript:alert(1)'), '');
check('JaVaScRiPt: too', linkHref('JaVaScRiPt:alert(1)'), '');
check('data: is refused', linkHref('data:text/html,<script>x</script>'), '');
check('mailto: is refused', linkHref('mailto:dan@acme.com'), '');
check('file: is refused', linkHref('file:///etc/passwd'), '');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
