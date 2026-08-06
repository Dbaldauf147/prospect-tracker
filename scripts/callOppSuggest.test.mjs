// Assertion tests for the call → opportunity suggester. Plain Node — no
// test framework (the project has none). Run:
//   node scripts/callOppSuggest.test.mjs
//
// The bar here is not "finds the match" but "doesn't offer a wrong one":
// every suggestion is one click from tagging a call's summary onto a
// deal, so a plausible-but-wrong candidate costs more than none at all.
import { suggestOppsForCall, callSignals } from '../src/utils/callOppSuggest.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
function ok(value, name) { eq(!!value, true, name); }

const opp = (id, account, over = {}) => ({ _id: id, Account: account, Stage: 'Quoting', ...over });

const OPPS = [
  opp('o1', 'MassMutual Financial Group'),
  opp('o2', 'Ettinger Engineering'),
  opp('o3', 'Kenco Logistics', { Notes: 'Their sister company MassMutual runs the same RFP cycle.' }),
  opp('o4', 'Acme Industrial'),
];

const names = (out) => out.map(c => c.opp.Account);

// --- what a call's title actually says ----------------------------------
{
  const s = callSignals({ name: 'New Client Connect - Ettinger Engineering' });
  eq(s.tokens, ['ettinger', 'engineering'], 'meeting furniture is stripped from the title');
  eq(callSignals({ name: 'Dan & Keith Weekly 1:1' }).tokens, ['keith'],
    'a two-person internal sync leaves almost nothing to match on');
  eq(callSignals({ name: 'Finance CS&P Monthly Deal Brainstorm' }).tokens, ['finance'],
    'short initialisms are dropped: they collide across a book of business');
}

// --- the case this exists for -------------------------------------------
{
  const out = suggestOppsForCall({ name: 'MassMutual / Schneider intro' }, OPPS);
  eq(names(out)[0], 'MassMutual Financial Group', 'the account named in the title comes first');
  ok(out[0].reasons.some(r => r.includes('account name')), 'and says why');
  // The whole account name ("MassMutual Financial Group") is not in the
  // title, so this is the token path rather than the phrase one — worth
  // pinning, since it is how most real titles match.
  ok(out[0].reasons.some(r => r.includes('massmutual')), 'naming the word that matched');
  const exact = suggestOppsForCall({ name: 'MassMutual Financial Group — quarterly review' }, OPPS);
  ok(exact[0].reasons.some(r => r.includes('call title')), 'a title carrying the whole account name says so');
  // The Kenco opp mentions MassMutual in its notes — worth offering, but
  // never ahead of the account that IS MassMutual.
  eq(names(out).includes('Kenco Logistics'), true, 'an opp whose notes mention it is offered too');
  ok(out[0].score > out[names(out).indexOf('Kenco Logistics')].score, 'but ranks below the real account');
  ok(out.find(c => c.opp._id === 'o3').reasons.some(r => r.includes('notes')), 'and is labelled as a notes match');
}

// --- a call already linked to a company ---------------------------------
{
  const out = suggestOppsForCall({ name: 'Weekly check-in', company: 'Kenco Logistics, LLC' }, OPPS);
  eq(names(out)[0], 'Kenco Logistics', 'the call’s own company wins, whatever the title says');
  ok(out[0].reasons.some(r => r.includes('same account')), 'and is labelled as such');
  eq(out[0].score, 100, 'at the top of the scale');
}

// --- attendees carry the signal when the title has none -----------------
{
  const call = {
    name: 'Intro call',
    owner: { email: 'dan@se.com' },
    attendees: [
      { name: 'Dan', email: 'dan@se.com' },
      { name: 'Rita Chen', email: 'rita@ettinger.com' },
    ],
  };
  const out = suggestOppsForCall(call, OPPS);
  eq(names(out), ['Ettinger Engineering'], 'an attendee’s email domain finds the account');
  ok(out[0].reasons.some(r => r.includes('email domain')), 'and says where it came from');
}

// --- what must NOT be suggested -----------------------------------------
{
  eq(suggestOppsForCall({ name: 'Dan & Keith Weekly 1:1' }, OPPS), [], 'an internal 1:1 matches nothing');
  eq(suggestOppsForCall({ name: 'Finance CS&P Monthly Deal Brainstorm' }, OPPS), [],
    'nor does an internal brainstorm');
  eq(suggestOppsForCall({ name: 'Untitled Granola note' }, OPPS), [], 'nor an untitled note');
  eq(suggestOppsForCall({ name: '' }, OPPS), [], 'a call with no name at all suggests nothing');

  // A personal inbox says nothing about which company someone is from.
  const freemail = suggestOppsForCall({
    name: 'Intro call',
    owner: { email: 'dan@se.com' },
    attendees: [{ email: 'someone@gmail.com' }],
  }, OPPS);
  eq(freemail, [], 'a gmail address is not a company');

  // The owner's own domain is the user's employer, not the prospect's.
  const ownSide = suggestOppsForCall({
    name: 'Internal review',
    owner: { email: 'dan@acme.com' },
    attendees: [{ email: 'colleague@acme.com' }],
  }, [opp('o9', 'Acme Industrial')]);
  eq(ownSide, [], 'colleagues on the user’s own domain never suggest an account');
}

// --- a partial word is not a match --------------------------------------
{
  const out = suggestOppsForCall({ name: 'Mass transit study' }, [opp('o1', 'MassMutual Financial Group')]);
  eq(out, [], '“Mass” does not match “MassMutual”');
}

// --- ranking and limits --------------------------------------------------
{
  const many = [
    opp('a', 'Ettinger Engineering'),
    opp('b', 'Ettinger Engineering', { Scope: 'Lighting' }),
    opp('c', 'Ettinger Holdings'),
    opp('d', 'Ettinger Engineering', { Scope: 'Solar' }),
    opp('e', 'Ettinger Engineering', { Scope: 'Gas' }),
    opp('f', 'Ettinger Engineering', { Scope: 'Power' }),
  ];
  const out = suggestOppsForCall({ name: 'Ettinger Engineering — quarterly' }, many);
  eq(out.length, 4, 'the list is capped rather than dumping every opp on the account');
  eq(suggestOppsForCall({ name: 'Ettinger Engineering — quarterly' }, many, { limit: 2 }).length, 2,
    'and the cap is the caller’s to set');
}

// --- junk in, no crash ---------------------------------------------------
{
  eq(suggestOppsForCall(null, OPPS), [], 'no call, no suggestions');
  eq(suggestOppsForCall({ name: 'MassMutual' }, null), [], 'no opps, no suggestions');
  eq(suggestOppsForCall({ name: 'MassMutual' }, [null, {}, { _id: '' }]), [], 'unusable opp rows are skipped');
  eq(suggestOppsForCall({ name: 'MassMutual' }, [{ _id: 'x' }]), [], 'an opp with no account or notes is skipped');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
