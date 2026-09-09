// Assertion tests for the PE firms behind step 6 of the Prospecting ladder.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/peFirmOutreach.test.mjs
//
// The step lists PE relationships that have started and have nothing on
// them, so three rules decide the list and all three are easy to get
// quietly wrong:
//
//   1. Which stages count. A Lead hasn't been opened and a Not Sold has
//      answered; everything between them is a live relationship. A firm
//      with no stage stored reads as Lead — the same reading the PE
//      Portfolio board gives it — so an unstaged firm is never counted as a
//      relationship nobody is working.
//   2. What "has an opp in flight" means. Not just opps on the firm's own
//      account: an OPEN opp on any of its portfolio companies is the
//      relationship working, and missing that would put a busy firm on a
//      list of silent ones. Closed ones are the mirror image: a firm whose
//      every deal has landed or died has nothing in flight, and dropping it
//      for deals that closed years ago hides exactly the relationship this
//      step exists to ring.
//   3. Not knowing yet. Prospects and opps load separately, and an empty
//      list before the opps arrive would clear the step (and the sidebar's
//      dot) on work that hasn't been looked at.
import { collectPeFirmsToWork, isWorkablePeStage, peFirmStage } from '../src/utils/peFirmOutreach.js';
import { accountMatchesCompany, peFirmOppRows, peOwnerMatchesFirm } from '../src/utils/peFirmOpps.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const firm = (company, peStage, over = {}) => ({
  id: company.toLowerCase().replace(/\s+/g, '-'), company, type: 'Private Equity', peStage, ...over,
});
const pc = (company, peOwner, over = {}) => ({
  id: company.toLowerCase().replace(/\s+/g, '-'), company, type: 'Prospect', peOwner, ...over,
});
const opp = (account, stage = 'Qualifying') => ({ Account: account, Stage: stage });
const names = (rows) => rows.map(r => r.firm);

// --- which stages are on the list ---------------------------------------
check('a blank stage reads as Lead', peFirmStage(''), 'Lead');
check('so does something unrecognised', peFirmStage('Warm'), 'Lead');
check('a real stage is itself', peFirmStage('Piloting'), 'Piloting');
check('the three live stages are workable',
  ['Discovery', 'Piloting', 'Existing Partnership'].map(isWorkablePeStage), [true, true, true]);
check('Lead and Not Sold are not',
  ['Lead', 'Not Sold', ''].map(isWorkablePeStage), [false, false, false]);

{
  const prospects = [
    firm('Alder Capital', 'Lead'),
    firm('Birchwood Partners', 'Discovery'),
    firm('Cedar Point Equity', 'Piloting'),
    firm('Dunmore Holdings', 'Existing Partnership'),
    firm('Elmridge Capital', 'Not Sold'),
    firm('Fernbank Group', ''),
    { id: 'not-pe', company: 'Granite Foods', type: 'Prospect', peStage: 'Discovery' },
  ];
  const rows = collectPeFirmsToWork(prospects, []);
  // Furthest along first: an Existing Partnership with nothing on it is a
  // louder silence than a firm still in Discovery.
  check('only live relationships, most advanced first',
    names(rows), ['Dunmore Holdings', 'Cedar Point Equity', 'Birchwood Partners']);
  check('and each row carries its stage', rows.map(r => r.stage),
    ['Existing Partnership', 'Piloting', 'Discovery']);
}

// --- what disqualifies a firm -------------------------------------------
{
  const prospects = [
    firm('Birchwood Partners', 'Discovery'),
    firm('Cedar Point Equity', 'Piloting'),
    firm('Dunmore Holdings', 'Existing Partnership'),
    pc('Harbor Foods', 'Cedar Point Equity'),
    pc('Ironworks Mfg', 'Dunmore Holdings'),
  ];
  // An opp on the firm's own account.
  check('an opp on the firm takes it off the list',
    names(collectPeFirmsToWork(prospects, [opp('Birchwood Partners')])),
    ['Dunmore Holdings', 'Cedar Point Equity']);
  // An opp on one of its portfolio companies is the relationship working.
  check('so does one on a portfolio company',
    names(collectPeFirmsToWork(prospects, [opp('Harbor Foods')])),
    ['Dunmore Holdings', 'Birchwood Partners']);
  // Closed deals are not something in flight — the firm stays listed.
  check('a closed opp on a PC leaves the firm on the list',
    names(collectPeFirmsToWork(prospects, [opp('Ironworks Mfg', 'Not Sold')])),
    ['Dunmore Holdings', 'Cedar Point Equity', 'Birchwood Partners']);
  check('every closed stage reads the same way',
    ['Sold', 'Not Sold', 'Closed', 'Lost'].map(st =>
      names(collectPeFirmsToWork(prospects, [opp('Birchwood Partners', st)])).includes('Birchwood Partners')),
    [true, true, true, true]);
  // ...but one open deal anywhere still takes the firm off it, however many
  // closed ones sit beside it.
  check('an open opp alongside closed ones still disqualifies',
    names(collectPeFirmsToWork(prospects, [
      opp('Ironworks Mfg', 'Sold'), opp('Ironworks Mfg', 'Qualifying'),
    ])),
    ['Cedar Point Equity', 'Birchwood Partners']);
  // The row says why a firm with a history is nonetheless silent.
  check('the row counts the closed deals behind it',
    collectPeFirmsToWork(prospects, [opp('Ironworks Mfg', 'Sold'), opp('Dunmore Holdings', 'Lost')])
      .map(r => [r.firm, r.closedCount]),
    [['Dunmore Holdings', 2], ['Cedar Point Equity', 0], ['Birchwood Partners', 0]]);
  // Spreadsheet debris is not an opportunity.
  check('an invalid stage is not an opp',
    names(collectPeFirmsToWork(prospects, [opp('Birchwood Partners', '#N/A')])),
    ['Dunmore Holdings', 'Cedar Point Equity', 'Birchwood Partners']);
  // A different company that merely shares a word is not this firm's opp.
  check('a one-word overlap is not a match',
    names(collectPeFirmsToWork(prospects, [opp('Harbor Bank')])),
    ['Dunmore Holdings', 'Cedar Point Equity', 'Birchwood Partners']);

  check('the row counts the portfolio companies it can talk about',
    collectPeFirmsToWork(prospects, []).map(r => [r.firm, r.pcCount]),
    [['Dunmore Holdings', 1], ['Cedar Point Equity', 1], ['Birchwood Partners', 0]]);
}

// --- the reported case ---------------------------------------------------
// A firm past Lead whose PE Opps column reads 0/7: seven deals on its
// portfolio companies, every one of them closed, nothing open. It belongs
// on this list — the old "any opp ever" rule dropped it.
{
  const pcs = ['Alpha Pack', 'Beta Mills', 'Gamma Foods', 'Delta Plastics', 'Epsilon Labs', 'Zeta Coatings', 'Eta Resins'];
  const prospects = [
    firm('Northgate Private Capital', 'Existing Partnership'),
    ...pcs.map(c => pc(c, 'Northgate Private Capital')),
  ];
  const closed = ['Sold', 'Not Sold', 'Lost', 'Closed', 'Sold', 'Lost', 'Not Sold'];
  const rows = collectPeFirmsToWork(prospects, pcs.map((c, i) => opp(c, closed[i])));
  check('a firm reading 0/7 is listed', names(rows), ['Northgate Private Capital']);
  check('and says how much history it has', rows.map(r => [r.pcCount, r.closedCount]), [[7, 7]]);
}

// --- the two names a firm goes by ---------------------------------------
//
// The firm record and its portfolio companies are typed in different places
// and rarely agree to the character: "Clayton, Dubilier & Rice (CDR)" on the
// firm, `PE Owner: Clayton, Dubilier & Rice` on the company. Keyed exactly,
// neither found the other — so CD&R read as having no portfolio, no opps,
// and a place on this list while an opp on Pursuit Aerospace was open.
{
  const CDR = 'Clayton, Dubilier & Rice (CDR)';
  check('a shorter owner still names the firm',
    peOwnerMatchesFirm('Clayton, Dubilier & Rice', CDR), true);
  check('and a longer one does too',
    peOwnerMatchesFirm('Clayton, Dubilier & Rice (CDR) LLC', CDR), true);
  check('a different firm does not', peOwnerMatchesFirm('Blackstone', CDR), false);

  const pursuit = pc('Pursuit Aerospace (a Clayton, Dubilier & Rice co.)', 'Clayton, Dubilier & Rice');
  const live = [opp('Pursuit Aerospace', 'Qualifying')];
  check('an open opp on a portfolio company keeps the firm off the list',
    names(collectPeFirmsToWork([firm(CDR, 'Discovery'), pursuit], live)), []);
  check('and with nothing open the firm is on it',
    names(collectPeFirmsToWork([firm(CDR, 'Discovery'), pursuit], [])), [CDR]);

  // The other half of a portfolio: a company mapped on the firm's own
  // Portfolio Companies list that nobody has given a PE Owner.
  const mappedOnly = firm(CDR, 'Discovery');
  mappedOnly.portfolioCompanies = [{ companyName: 'Pursuit Aerospace' }];
  check('a mapped company counts even with no PE Owner anywhere',
    names(collectPeFirmsToWork([mappedOnly], live)), []);
  check('and it counts toward what there is to talk about',
    collectPeFirmsToWork([mappedOnly], [])[0].pcCount, 1);
  // A company on both lists is one company, not two.
  check('the two halves are de-duplicated',
    collectPeFirmsToWork([mappedOnly, pc('Pursuit Aerospace', CDR)], [])[0].pcCount, 1);
  // The closed-history count still reads over both halves.
  check('a closed opp on a mapped company still counts as history',
    collectPeFirmsToWork([mappedOnly], [opp('Pursuit Aerospace', 'Not Sold')])[0].closedCount, 1);
}

// --- not knowing yet -----------------------------------------------------
check('no prospects yet is null, not an empty list', collectPeFirmsToWork(null, []), null);
check('no opps yet is null too', collectPeFirmsToWork([], null), null);
check('both loaded and nothing to chase is an empty list', collectPeFirmsToWork([], []), []);

// --- the matcher this all rests on --------------------------------------
// Shared with the PE Portfolio table's PE Opps column, which prints
// open/total — so a firm reading 0/anything there is exactly a firm listed
// here, whether that's 0/0 or 0/7.
check('an exact name matches', accountMatchesCompany('Harbor Foods', 'harbor foods'), true);
check('a suffix is not a difference', accountMatchesCompany('Harbor Foods', 'Harbor Foods, Inc.'), true);
check('a longer account containing the phrase matches',
  accountMatchesCompany('Harbor Foods', 'Harbor Foods Northeast'), true);
check('a single shared word does not', accountMatchesCompany('Origin', 'Origin Bank'), false);
check('an opp with no account is dropped',
  peFirmOppRows(['Harbor Foods'], [{ Account: '', Stage: 'Qualifying' }]).length, 0);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
