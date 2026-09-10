// Assertion tests for a campaign's event link.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/campaignEventLink.test.mjs
//
// The rules worth pinning: a pasted address without a scheme still links, an
// address with a scheme we don't hand to the browser never does (and is still
// shown), and clearing the field leaves no key behind.
import {
  campaignEventUrl, eventLinkHref, eventLinkLabel, withEventUrl, sameEventUrl,
} from '../src/utils/campaignEventLink.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// --- reading a campaign ----------------------------------------------
check('the stored link, trimmed', campaignEventUrl({ eventUrl: '  https://acme.com/q4  ' }), 'https://acme.com/q4');
check('a campaign with no event', campaignEventUrl({ title: 'No event here' }), '');
check('nothing in, nothing out', campaignEventUrl(null), '');
check('a non-string is not a link', campaignEventUrl({ eventUrl: 42 }), '');

// --- what is safe to click -------------------------------------------
check('https goes through', eventLinkHref('https://acme.com/q4-briefing'), 'https://acme.com/q4-briefing');
check('http goes through', eventLinkHref('http://acme.com/q4'), 'http://acme.com/q4');
// People paste addresses out of the browser bar and out of email, and half of
// those arrive without their scheme.
check('a bare host is assumed https', eventLinkHref('www.eventbrite.com/e/12345'), 'https://www.eventbrite.com/e/12345');
check('javascript: is never clickable', eventLinkHref('javascript:alert(1)'), '');
check('mailto: is not an event page', eventLinkHref('mailto:events@acme.com'), '');
check('a word in the wrong box is not a link', eventLinkHref('ask Dan for the invite'), '');
check('a campaign works as well as a string', eventLinkHref({ eventUrl: 'acme.com/q4' }), 'https://acme.com/q4');
check('no link, no href', eventLinkHref({}), '');

// --- what it reads as -------------------------------------------------
check('host plus the tail of the path',
  eventLinkLabel('https://www.eventbrite.com/e/q4-energy-briefing-12345?aff=email'),
  'eventbrite.com/q4 energy briefing 12345');
check('a bare domain is its own label', eventLinkLabel('https://acme.com'), 'acme.com');
check('a scheme-less address is labelled as if linked', eventLinkLabel('acme.com/q4'), 'acme.com/q4');
// Refused, but the user still needs to see what they typed to fix it.
check('an unlinkable address is still shown', eventLinkLabel('javascript:alert(1)'), 'javascript:alert(1)');
check('nothing to show', eventLinkLabel({}), '');

// --- writing a campaign ----------------------------------------------
check('the link is stored trimmed',
  withEventUrl({ title: 'Q4 briefing' }, '  https://acme.com/q4 '),
  { title: 'Q4 briefing', eventUrl: 'https://acme.com/q4' });
check('clearing removes the key rather than storing ""',
  withEventUrl({ title: 'Q4 briefing', eventUrl: 'https://acme.com/q4' }, '   '),
  { title: 'Q4 briefing' });
check('nothing else on the campaign is touched',
  withEventUrl({ title: 'T', subjects: ['A'], contacts: [] }, 'acme.com'),
  { title: 'T', subjects: ['A'], contacts: [], eventUrl: 'acme.com' });
check('a missing campaign still returns one', withEventUrl(null, 'acme.com'), { eventUrl: 'acme.com' });

// --- did the edit change anything? ------------------------------------
check('same link, whitespace aside', sameEventUrl({ eventUrl: 'https://acme.com/q4' }, ' https://acme.com/q4 '), true);
check('a different link', sameEventUrl({ eventUrl: 'https://acme.com/q4' }, 'https://acme.com/q3'), false);
check('blank against absent', sameEventUrl({}, '   '), true);
// The href is normalized for display, never in storage: what the user typed is
// what is saved, so these two are genuinely different values.
check('adding a scheme is a change', sameEventUrl({ eventUrl: 'acme.com' }, 'https://acme.com'), false);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
