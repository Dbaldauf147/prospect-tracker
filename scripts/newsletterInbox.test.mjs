// Trade newsletters as a deal source, read out of the app's own mailbox.
//
// Two things are under test and they matter for different reasons.
//
// The extractor, because it decides whether this source works at all: both
// newsletters lay an item out as a link with the news in the text around
// it, and a parser that took the anchor's own text would keep "Blackstone"
// and throw away "acquired Acme Facilities".
//
// The gates, because this code can read a mailbox. It may open exactly one
// label and, inside it, may only read senders on an allow-list. Those two
// rules are the whole basis on which it is safe to point at a real inbox,
// so they are tested like a lock, not like a filter.
import {
  extractHeadlines, isAllowedSender, sourceNameFor, labelName, senderList,
  fetchNewsletterItems, DEFAULT_LABEL,
} from '../api/_lib/newsletterInbox.js';
import { classifyHeadline } from '../api/_lib/dealHeadline.js';
import { nameVariants } from '../api/_lib/newsFeeds.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
const ok = (c, name) => eq(!!c, true, name);

// ---- Who may be read -----------------------------------------------------
{
  const allow = ['pehub.com', 'axios.com'];
  ok(isAllowedSender('wire@pehub.com', allow), 'sender: an allow-listed domain is read');
  ok(isAllowedSender('Pro.Rata@AXIOS.COM', allow), 'sender: case does not matter');
  ok(isAllowedSender('news@mail.pehub.com', allow), 'sender: a subdomain of an allowed domain counts');
  eq(isAllowedSender('someone@gmail.com', allow), false, 'sender: ordinary mail in the label is still not read');
  eq(isAllowedSender('phisher@pehub.com.evil.net', allow), false,
    'sender: a lookalike domain does not slip past the suffix test');
  eq(isAllowedSender('', allow), false, 'sender: a missing address is not allowed');
  eq(isAllowedSender('not-an-address', allow), false, 'sender: junk is not allowed');

  eq(labelName(), DEFAULT_LABEL, 'label: defaults to the dedicated label, never INBOX');
  ok(senderList().includes('pehub.com'), 'senders: PE Hub is allowed out of the box');
  ok(senderList().includes('axios.com'), 'senders: and Axios');
}

{
  eq(sourceNameFor('wire@pehub.com'), 'PE Hub Wire', 'source: PE Hub is named in the email');
  eq(sourceNameFor('prorata@axios.com'), 'Axios Pro Rata', 'source: so is Axios');
  eq(sourceNameFor('x@unknown.test', 'Some Digest'), 'Some Digest', 'source: anything else keeps its own name');
}

// ---- Pulling headlines out of a newsletter -------------------------------
// The Axios shape: the anchor is the company, the sentence around it is the
// story. Keeping only the anchor text would keep the name and lose the news.
const AXIOS = `
<p>🥊 <b><a href="https://link.axios.com/x1">Blackstone</a></b> acquired
  <a href="https://link.axios.com/x2">Acme Facilities</a>, a Texas-based provider of
  industrial services, from Carlyle for $450 million.</p>
<p>💰 <a href="https://link.axios.com/y1">Warburg Pincus</a> sold Sigma Health to
  <a href="https://link.axios.com/y2">KKR</a> for $1.1 billion.</p>
<p><a href="https://link.axios.com/u">Unsubscribe</a> | <a href="https://axios.com/privacy">Privacy policy</a></p>
<div>&copy; 2026 Axios Media. All rights reserved.</div>`;

// The PE Hub shape: the anchor is the headline.
const PEHUB = `
<td><a href="https://www.pehub.com/story-1">CD&amp;R-backed Foo Corp acquires Bar Industrial Services</a></td>
<td><a href="https://www.pehub.com/story-2">Apollo to acquire Sample Terminals in $620m deal</a></td>
<td><a href="https://twitter.com/pehub">Follow us on Twitter</a></td>
<td><a href="https://www.pehub.com/unsubscribe">Unsubscribe from this newsletter</a></td>`;

{
  const a = extractHeadlines(AXIOS);
  eq(a.length, 2, 'extract: two stories out of the Axios body');
  ok(a[0].title.startsWith('Blackstone acquired Acme Facilities'),
    'extract: the sentence around the link is the headline, not the link text');
  eq(a[0].link, 'https://link.axios.com/x1', 'extract: and it keeps a real link');
  // Tag-stripping leaves a gap before punctuation, and that gap lands in
  // the middle of a company name when the target is read off it.
  ok(!a[0].title.includes(' ,'), 'extract: no stray space before punctuation');
  ok(!a[0].title.startsWith('🥊'), 'extract: the decorative glyph is dropped');

  const p = extractHeadlines(PEHUB);
  eq(p.length, 2, 'extract: two stories out of the PE Hub body');
  eq(p[0].title, 'CD&R-backed Foo Corp acquires Bar Industrial Services',
    'extract: an anchor that IS the headline is taken whole, entities decoded');

  // Chrome is never news, however deal-shaped the words around it.
  const all = [...a, ...p].map(h => h.title.toLowerCase()).join(' ');
  eq(/unsubscribe|privacy policy|follow us|all rights reserved/.test(all), false,
    'extract: footer and social chrome is dropped');
  eq(extractHeadlines('').length, 0, 'extract: an empty body yields nothing');
  eq(extractHeadlines('<p>No links here at all, just prose about deals.</p>').length, 0,
    'extract: a block with no link yields nothing, since a deal needs a source');
}

// ---- The extractor feeds the same classifier -----------------------------
// The point of all of this: a newsletter sentence has to survive into a
// deal with the target and the price read off it.
{
  const [first, second] = extractHeadlines(AXIOS);
  const read = (company, h) => classifyHeadline({ title: h.title }, { company, isPe: true }, nameVariants(company));

  const bx = read('Blackstone', first);
  ok(bx.deal, 'pipeline: the Axios sentence becomes a deal');
  eq(bx.deal.target, 'Acme Facilities', 'pipeline: with the target read out of the sentence');
  eq(bx.deal.value, '$450M', 'pipeline: and the price');

  // A newsletter is one body of text offered to every tracked firm, so a
  // story about one must not surface under the others.
  eq(read('Apollo Global Management', first).skip, 'not about this firm',
    'pipeline: another firm does not inherit this story');

  // The firm on the selling side of a sale is not buying anything.
  eq(read('Warburg Pincus', second).skip, 'the firm is selling',
    'pipeline: a sale is credited to the buyer, not the seller');
}

// ---- Reading the label ---------------------------------------------------
// fetchNewsletterItems is driven through its `connect` seam, so the rules
// are testable without a mailbox.
const msg = (from, date, html, name = '') => ({ from, fromName: name, date: Date.parse(date), html });
const fakeConnect = (messages, opts = {}) => async ({ label }) => {
  if (opts.missingLabel) throw new Error(`Mailbox doesn't exist: ${label}`);
  opts.opened?.push(label);
  return {
    async *messages() { for (const m of messages) yield m; },
    async close() { opts.closed && (opts.closed.value = true); },
  };
};

const SINCE = Date.parse('2026-09-01T00:00:00Z');
const UNTIL = Date.parse('2026-09-14T00:00:00Z');

{
  const opened = [];
  const closed = { value: false };
  const { items, error, configured } = await fetchNewsletterItems(SINCE, UNTIL, {
    user: 'app@example.com', pass: 'secret', label: 'deal-news',
    allowed: ['pehub.com', 'axios.com'],
    connect: fakeConnect([
      msg('prorata@axios.com', '2026-09-09T11:00:00Z', AXIOS),
      msg('wire@pehub.com', '2026-09-10T11:00:00Z', PEHUB),
      // In the label, but not a sender we read.
      msg('colleague@se.com', '2026-09-11T11:00:00Z', '<p><a href="https://x.test/a">A private note about an acquisition of something</a></p>'),
      // An allowed sender, but outside the digest window.
      msg('wire@pehub.com', '2026-08-01T11:00:00Z', PEHUB),
    ], { opened, closed }),
  });

  eq(error, null, 'read: a healthy mailbox is not an error');
  eq(configured, true, 'read: and reports itself configured');
  eq(opened, ['deal-news'], 'read: exactly one label is opened');
  eq(items.length, 4, 'read: both allowed newsletters in the window are read');
  eq(items.every(i => /Axios Pro Rata|PE Hub Wire/.test(i.source)), true, 'read: each item knows its source');
  eq(items.some(i => /private note/i.test(i.title)), false,
    'read: mail from a sender that is not allow-listed is never read, even inside the label');
  eq(items.every(i => i.publishedAt >= SINCE && i.publishedAt <= UNTIL), true,
    'read: nothing outside the window comes through');
  eq(closed.value, true, 'read: the connection is closed afterwards');
}

{
  // Newsletters add to the feeds; they are not load-bearing. Every way this
  // can fail has to come back as a source the digest goes without.
  const noLabel = await fetchNewsletterItems(SINCE, UNTIL, {
    user: 'app@example.com', pass: 'secret',
    connect: fakeConnect([], { missingLabel: true }),
  });
  eq(noLabel.items.length, 0, 'failure: a missing label yields no items');
  ok(/not found|unavailable/i.test(noLabel.error), 'failure: and says so, rather than throwing');

  const notSet = await fetchNewsletterItems(SINCE, UNTIL, { user: '', pass: '' });
  eq(notSet.configured, false, 'failure: no mailbox configured is not a failure, just unconfigured');
  eq(notSet.error, null, 'failure: and is silent about it');

  // A connection that dies mid-read keeps what it already had.
  const partial = await fetchNewsletterItems(SINCE, UNTIL, {
    user: 'app@example.com', pass: 'secret', allowed: ['axios.com'],
    connect: async () => ({
      async *messages() {
        yield msg('prorata@axios.com', '2026-09-09T11:00:00Z', AXIOS);
        throw new Error('connection reset');
      },
      async close() {},
    }),
  });
  eq(partial.items.length, 2, 'failure: headlines read before the drop are kept');
  ok(/stopped early/i.test(partial.error), 'failure: and the partial read is admitted');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
