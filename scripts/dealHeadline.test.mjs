// The rules that read an acquisition out of a headline, with no model.
//
// This is the whole digest's accuracy now, so it is tested as a corpus
// rather than a handful of shapes. The cases below are written the way the
// trade press actually writes them — the same deal appears four ways, the
// firm appears on both sides of the verb, and the near-misses (fund
// closes, rumours, exits, minority stakes) are the ones that would turn a
// useful digest into noise nobody reads.
//
// The standard is precision in what it CLAIMS. A headline the rules cannot
// place is an `unsure`, which the email lists for the reader — never a
// deal, and never silently dropped.
import { classifyHeadline, stripPublisher, __testing } from '../api/_lib/dealHeadline.js';
import { nameVariants } from '../api/_lib/newsFeeds.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
const ok = (c, name) => eq(!!c, true, name);

const read = (company, title, isPe = true) =>
  classifyHeadline({ title }, { company, isPe }, nameVariants(company));
const verdict = (r) => (r.deal ? 'deal' : r.skip ? `skip:${r.skip}` : 'unsure');

// ---- Publisher suffix ----------------------------------------------------
// Google News appends " - Publisher" to every title. Left on, it lands in
// the target: a company called "Acme Facilities - Reuters".
{
  eq(stripPublisher('Blackstone acquires Acme - Reuters'), 'Blackstone acquires Acme', 'strip: the trailing publisher comes off');
  eq(stripPublisher('Blackstone acquires Acme'), 'Blackstone acquires Acme', 'strip: a title without one is untouched');
  eq(stripPublisher('Rolls-Royce sells unit - FT'), 'Rolls-Royce sells unit', 'strip: a hyphenated name is not mistaken for a suffix');
}

// ---- The firm is buying --------------------------------------------------
// Same deal, the ways the press writes it. All five must land as a deal
// with the same target.
{
  const forms = [
    'Blackstone acquires Acme Facilities Services',
    'Blackstone to acquire Acme Facilities Services',
    'Blackstone agrees to acquire Acme Facilities Services',
    'Blackstone completes acquisition of Acme Facilities Services',
    'Blackstone buys Acme Facilities Services',
    'Blackstone snaps up Acme Facilities Services',
  ];
  for (const t of forms) {
    const r = read('Blackstone', t);
    eq(verdict(r), 'deal', `buying: "${t.slice(0, 46)}…" is a deal`);
    if (r.deal) eq(r.deal.target, 'Acme Facilities Services', `buying: and the target is right`);
  }
}

{
  // The reverse shape, where the firm sits to the right of the verb.
  const r = read('Blackstone', 'Acme Facilities acquired by Blackstone');
  eq(verdict(r), 'deal', 'reverse: "acquired by <firm>" is the firm buying');
  eq(r.deal.target, 'Acme Facilities', 'reverse: the left side is the target');
}

// ---- The firm is NOT buying ----------------------------------------------
// Each of these contains an acquisition verb and the firm's name, and each
// means the opposite of a purchase. Getting any of them wrong puts a deal
// in the email that never happened.
{
  const cases = [
    ['Blackstone acquired by rival in shock deal', 'the firm is the target'],
    ['Blackstone to be acquired by a consortium', 'the firm is the target'],
    ['Blackstone sells Gamma Logistics to Apollo', 'the firm is selling'],
    ['Blackstone agrees to sell Gamma Logistics to Apollo', 'the firm is selling'],
    ['Blackstone exits stake in Sigma', 'exit'],
    ['Blackstone divests its stake in Sigma', 'exit'],
    ['Blackstone closes $20bn real estate fund', 'fund raise'],
    ['Blackstone raises $12 billion for new fund', 'fund raise'],
    ['Blackstone explores sale of Gamma Logistics', 'unconfirmed'],
    ['Blackstone nears deal to buy Acme', 'unconfirmed'],
    ['Blackstone in talks to acquire Acme', 'unconfirmed'],
    ['Blackstone reportedly weighing bid for Acme', 'unconfirmed'],
    ['Blackstone takes minority stake in Delta', 'minority'],
    ['Blackstone names new head of credit', 'not an acquisition'],
    ['Blackstone reports record quarterly earnings', 'not an acquisition'],
  ];
  for (const [title, reason] of cases) {
    eq(verdict(read('Blackstone', title)), `skip:${reason}`, `not buying: "${title.slice(0, 44)}…"`);
  }
}

// ---- Three parties -------------------------------------------------------
// "A sells B to C" is the shape a two-sided split gets wrong in the worst
// available way: the span "sells … to" puts the SELLER on the left, so a
// naive read records Apollo as the thing Blackstone bought.
{
  const t = 'Blackstone sells Gamma Logistics to Apollo Global Management';
  const buyer = read('Apollo Global Management', t);
  eq(verdict(buyer), 'deal', 'three parties: the buyer gets the deal');
  eq(buyer.deal.target, 'Gamma Logistics', 'three parties: the target is the thing sold, not the seller');
  eq(buyer.deal.buyer, 'Apollo Global Management', 'three parties: and the buyer is the buyer');

  eq(verdict(read('Blackstone', t)), 'skip:the firm is selling', 'three parties: the seller gets nothing');
  eq(verdict(read('Gamma Logistics', t, false)), 'skip:the firm is the target',
    'three parties: the thing sold is not buying anything');
  eq(verdict(read('Ara Partners', t)), 'skip:a sale between other parties',
    'three parties: a firm mentioned nowhere in it gets nothing');
}

// ---- PE shapes -----------------------------------------------------------
{
  // An add-on: the buyer of record is the portfolio company, the firm is
  // named as sponsor. It counts, and it counts as an add-on.
  const r = read('Clayton, Dubilier & Rice (CD&R)', 'CD&R-backed Foo Corp acquires Bar Industrial Services');
  eq(verdict(r), 'deal', 'PE: a sponsored add-on counts');
  eq(r.deal.dealType, 'Add-on', 'PE: and is labelled an add-on, not a platform');
  eq(r.deal.target, 'Bar Industrial Services', 'PE: with the portfolio company’s purchase as the target');
  eq(r.deal.buyer, 'CD&R-backed Foo Corp', 'PE: and the portfolio company as the buyer of record');

  // The alias is how the press writes this firm; the full name never
  // appears. Matching only the tracked string would find nothing.
  ok(read('Clayton, Dubilier & Rice (CD&R)', 'CD&R to acquire Widget Co').deal,
    'PE: the bracketed acronym matches on its own');
  ok(read('Clayton, Dubilier & Rice (CD&R)', 'Clayton Dubilier and Rice to buy Widget Co').deal,
    'PE: and so does the name written out longhand');

  const tp = read('Blackstone', 'Blackstone to take Omega Corp private in $3bn deal');
  eq(tp.deal.dealType, 'Take-private', 'PE: a take-private is labelled as one');
  eq(tp.deal.target, 'Omega Corp', 'PE: without the adjective hanging off the target');

  const direct = read('Blackstone', 'Blackstone acquires Zeta Holdings');
  eq(direct.deal.dealType, 'Platform', 'PE: a firm buying directly is a platform');
  eq(read('Acme Corp', 'Acme Corp acquires Zeta Holdings', false).deal.dealType, 'Acquisition',
    'PE: an operating company buying directly is just an acquisition');
}

// ---- Where a name stops --------------------------------------------------
// Without these the target of "acquires Acme for $450M" is recorded as a
// company called "Acme for $450M".
{
  const tail = (t) => read('Blackstone', t).deal?.target;
  eq(tail('Blackstone acquires Acme Facilities for $450M'), 'Acme Facilities', 'tail: a price is not part of the name');
  eq(tail('Blackstone acquires Acme Facilities in a $450 million deal'), 'Acme Facilities', 'tail: nor is a deal clause');
  eq(tail('Blackstone acquires Acme Facilities from Carlyle'), 'Acme Facilities', 'tail: nor is the seller');
  eq(tail('Blackstone acquires Acme Facilities to expand its industrial platform'), 'Acme Facilities', 'tail: nor the rationale');
  eq(tail('Blackstone acquires Acme Facilities, the Texas-based servicer'), 'Acme Facilities', 'tail: nor the apposition');
}

// ---- Deal values ---------------------------------------------------------
// Outlets write the same number half a dozen ways; the email shows one.
{
  const v = __testing.dealValue;
  eq(v('bought for $450M'), '$450M', 'value: $450M');
  eq(v('bought for $450 million'), '$450M', 'value: spelled-out million');
  eq(v('in a $3bn deal'), '$3B', 'value: bn');
  eq(v('in a $1.2 billion deal'), '$1.2B', 'value: spelled-out billion');
  eq(v('for €300m'), '€300M', 'value: a euro figure keeps its symbol');
  eq(v('no price disclosed'), '', 'value: an undisclosed price is empty, not zero');
}

// ---- Nothing is claimed that cannot be read ------------------------------
// The third answer is what makes rules safe here. These are real deal news
// in shapes the rules do not read, and every one must come back unsure —
// listed for the reader, never asserted as a deal and never dropped.
{
  const loose = [
    ['Ara Partners', 'Ara Partners invests in Green Cement Co'],
    ['Blackstone', 'Blackstone backs management buyout of Delta Services'],
    ['Bain Capital', 'Bain Capital named preferred bidder in Epsilon acquisition'],
    ['Warburg Pincus', 'Warburg Pincus and a co-investor complete Sigma buyout'],
  ];
  for (const [company, t] of loose) {
    eq(verdict(read(company, t)), 'unsure', `unsure: "${t.slice(0, 44)}…" is surfaced, not claimed`);
  }

  // And a headline with no deal in it at all is skipped outright, so the
  // unsure list stays short enough to actually read.
  eq(verdict(read('Blackstone', 'Why Blackstone is winning the race for industrial assets')),
    'skip:not deal news', 'unsure: an opinion piece is not a headline to check');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
