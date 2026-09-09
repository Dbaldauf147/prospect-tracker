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
//   2. What "has an opp" means. Not just opps on the firm's own account:
//      an opp on any of its portfolio companies is the relationship
//      working, and missing that would put a busy firm on a list of silent
//      ones. Closed opps count too — the question is whether anything has
//      ever been opened here.
//   3. Not knowing yet. Prospects and opps load separately, and an empty
//      list before the opps arrive would clear the step (and the sidebar's
//      dot) on work that hasn't been looked at.
import { collectPeFirmsToWork, isWorkablePeStage, peFirmStage } from '../src/utils/peFirmOutreach.js';
import { accountMatchesCompany, peFirmOppRows } from '../src/utils/peFirmOpps.js';

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
  // Closed deals still count: something has been opened here.
  check('a closed opp still counts as having one',
    names(collectPeFirmsToWork(prospects, [opp('Ironworks Mfg', 'Not Sold')])),
    ['Cedar Point Equity', 'Birchwood Partners']);
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

// --- not knowing yet -----------------------------------------------------
check('no prospects yet is null, not an empty list', collectPeFirmsToWork(null, []), null);
check('no opps yet is null too', collectPeFirmsToWork([], null), null);
check('both loaded and nothing to chase is an empty list', collectPeFirmsToWork([], []), []);

// --- the matcher this all rests on --------------------------------------
// Shared with the PE Portfolio table's PE Opps column, so a firm reading
// 0/0 there is exactly a firm listed here.
check('an exact name matches', accountMatchesCompany('Harbor Foods', 'harbor foods'), true);
check('a suffix is not a difference', accountMatchesCompany('Harbor Foods', 'Harbor Foods, Inc.'), true);
check('a longer account containing the phrase matches',
  accountMatchesCompany('Harbor Foods', 'Harbor Foods Northeast'), true);
check('a single shared word does not', accountMatchesCompany('Origin', 'Origin Bank'), false);
check('an opp with no account is dropped',
  peFirmOppRows(['Harbor Foods'], [{ Account: '', Stage: 'Qualifying' }]).length, 0);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
