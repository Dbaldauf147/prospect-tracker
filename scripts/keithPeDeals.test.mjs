// Assertion tests for the "PE overlap deals" list on the Keith agenda.
//   node scripts/keithPeDeals.test.mjs
import { buildPeOverlapDeals, isPeOpp, oppStageNumber, peOwnerAndVertical, ownerFromAccountName, accountTier, accountTargetCdm } from '../src/utils/keithPeDeals.js';
import { buildTargetCdmResolver, buildTargetTierResolver } from '../src/utils/targetTier.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

check('Private Equity type is PE', isPeOpp({ Type: 'Private Equity' }), true);
check('Portfolio Company type is PE', isPeOpp({ Type: ' portfolio company ' }), true);
check('a PE Owner makes it a portfolio company deal', isPeOpp({ Type: 'Owner Operator', 'PE Owner': 'Blackstone' }), true);
check('anything else is not', isPeOpp({ Type: 'Owner Operator', 'PE Owner': '' }), false);

check('Lead is Stage 3', oppStageNumber({ Stage: 'Lead' }), 3);
check('Quoting is Stage 4', oppStageNumber({ Stage: 'Quoting' }), 4);
check('Contracting is Stage 5', oppStageNumber({ Stage: 'Contracting' }), 5);
check('Agreement Sent is Stage 6', oppStageNumber({ Stage: 'Agreement Sent' }), 6);
check('Not Started is before Stage 3', oppStageNumber({ Stage: 'Not Started' }), null);
check('Sold is closed', oppStageNumber({ Stage: 'Sold' }), null);

const records = [
  { _id: 1, Account: 'Alpha', Type: 'Private Equity', Stage: 'Lead', 'Quoted Amount': 10 },
  { _id: 2, Account: 'Beta', Type: 'Portfolio Company', Stage: 'Quoted', 'Quoted Amount': 5 },
  { _id: 3, Account: 'Gamma', Type: 'Portfolio Company', Stage: 'Quoted', 'Quoted Amount': 50 },
  { _id: 4, Account: 'Delta', Type: 'Private Equity', Stage: 'Not Started' },
  { _id: 5, Account: 'Eps', Type: 'Private Equity', Stage: 'Sold' },
  { _id: 6, Account: 'Zeta', Type: 'Owner Operator', Stage: 'Agreement Sent' },
  { _id: 7, Account: 'Eta', Type: '', 'PE Owner': 'KKR', Stage: 'Agreement Sent' },
];
const deals = buildPeOverlapDeals(records, { parseAmount: v => (v == null ? null : Number(v)), fmtAmount: n => `$${n}` });
check('only PE at Stage 3+, furthest first, then biggest', deals.map(d => d.name), ['Eta', 'Gamma', 'Beta', 'Alpha']);
check('stage label', deals[1].stageLabel, 'Stage 5 · Quoted');
check('amount label', [deals[0].amountLabel, deals[1].amountLabel], ['', '$50']);

// --- PE owner and vertical ------------------------------------------------
const prospects = [
  { company: 'Vibrantz Technology Inc', type: 'Portfolio Company', peOwner: 'American Securities' },
  { company: 'Platinum Equity', type: 'Private Equity' },
  { company: 'KKR', type: 'Private Equity', portfolioCompanies: [{ companyName: 'Kensing Solutions', sector: 'Chemicals' }] },
];
check('the opp\'s own PE Owner wins',
  peOwnerAndVertical({ Account: 'Vibrantz Technology', 'PE Owner': 'Lone Star' }, prospects).peOwner, 'Lone Star');
check('else the matched company\'s PE Owner',
  peOwnerAndVertical({ Account: 'Vibrantz Technology' }, prospects).peOwner, 'American Securities');
check('else the firm whose portfolio names it, with its sector as the vertical',
  peOwnerAndVertical({ Account: 'Kensing Solutions' }, prospects),
  { peOwner: 'KKR', vertical: 'Chemicals', verticalFrom: 'portfolio', verticalFromOpp: false });
check('the opp\'s own vertical beats the sector',
  peOwnerAndVertical({ Account: 'Kensing Solutions', Vertical: 'Specialty Chem' }, prospects),
  { peOwner: 'KKR', vertical: 'Specialty Chem', verticalFrom: 'opp', verticalFromOpp: true });
check('else the firm named in the account', ownerFromAccountName('Oxea (a SVP co.)'), 'SVP');
check('longer form', ownerFromAccountName('Solenis (a Platinum Equity Co.)'), 'Platinum Equity');
check('no parenthetical, no owner', ownerFromAccountName('Peranel'), '');
check('a PE firm is its own owner',
  peOwnerAndVertical({ Account: 'Platinum Equity', Type: 'Private Equity' }, prospects).peOwner, 'Platinum Equity');
check('unknown stays blank',
  peOwnerAndVertical({ Account: 'Peranel', Type: 'Portfolio Company' }, prospects),
  { peOwner: '', vertical: '', verticalFrom: '', verticalFromOpp: false });
check('deals carry owner and vertical',
  buildPeOverlapDeals([{ _id: 9, Account: 'Kensing Solutions', Type: 'Portfolio Company', Stage: 'Quoting' }], { prospects })
    .map(d => [d.peOwner, d.vertical]), [['KKR', 'Chemicals']]);

// The Vertical set on the company popup.
{
  const withVertical = [
    { company: 'Kensing Solutions', type: 'Portfolio Company', vertical: 'Industrials' },
    ...prospects,
  ];
  check('the company popup\'s vertical beats the portfolio sector',
    peOwnerAndVertical({ Account: 'Kensing Solutions' }, withVertical),
    { peOwner: 'KKR', vertical: 'Industrials', verticalFrom: 'company', verticalFromOpp: false });
  check('the opp\'s own vertical still beats the popup',
    peOwnerAndVertical({ Account: 'Kensing Solutions', Vertical: 'Specialty Chem' }, withVertical).vertical, 'Specialty Chem');
  check('a company with no portfolio entry gets its popup vertical too',
    peOwnerAndVertical({ Account: 'Vibrantz Technology' }, [{ ...prospects[0], vertical: 'Chemicals' }]),
    { peOwner: 'American Securities', vertical: 'Chemicals', verticalFrom: 'company', verticalFromOpp: false });
  check('and the deal list picks it up',
    buildPeOverlapDeals([{ _id: 10, Account: 'Kensing Solutions', Type: 'Portfolio Company', Stage: 'Quoting' }], { prospects: withVertical })
      .map(d => d.vertical), ['Industrials']);
}

// Tier: the company's own, the Targets list over an imported one, and the
// Targets list alone for an account with no company record.
{
  const tiered = [
    { company: 'Chosen Co', tier: 'Tier 1' },
    { company: 'Imported Co', tier: 'Tier 3', tierSource: 'import' },
    { company: 'Dash Co', tier: '-' },
  ];
  const targets = { 'chosen co': 'Tier 2', 'imported co': 'Tier 2', 'no record co': 'Tier 1' };
  const targetTierFor = (p) => ({ tier: targets[String(p?.company || '').toLowerCase()] || '' });
  check('company tier, no targets list', accountTier({ Account: 'Chosen Co' }, tiered), 'Tier 1');
  check('a tier somebody chose beats the targets list', accountTier({ Account: 'Chosen Co' }, tiered, targetTierFor), 'Tier 1');
  check('the targets list beats an imported tier', accountTier({ Account: 'Imported Co' }, tiered, targetTierFor), 'Tier 2');
  check('"-" is no tier', accountTier({ Account: 'Dash Co' }, tiered), '');
  check('no company record, tiered by the targets list', accountTier({ Account: 'No Record Co' }, tiered, targetTierFor), 'Tier 1');
  check('nothing anywhere', accountTier({ Account: 'Nobody' }, tiered, targetTierFor), '');
  const d = buildPeOverlapDeals([{ _id: 't1', Account: 'Imported Co', Type: 'Portfolio Company', Stage: 'Quoted' }], { prospects: tiered, targetTierFor });
  check('the deal carries its tier', d[0]?.tier, 'Tier 2');
}

// CDM from the Target Accounts list: every rep's rows, mapped, exact or fuzzy.
{
  const data = { sheetNames: ['S'], sheets: { S: { records: [
    { Account: 'Acme Corp', Tier: 'Tier 1', CDM: 'Sara Rahme' },
    { Account: 'Beta Holdings', Tier: 'Tier 2', 'Account Owner': 'Jen Debias' },
    { Account: 'Gamma', Tier: 'Tier 3', CDM: '' },
  ] } } };
  const cdmFor = buildTargetCdmResolver({ targetAccountsData: data, settings: { targetMap: { p9: ['Acme Corp'] } } });
  check('exact name', accountTargetCdm({ Account: 'Acme Corp' }, [], cdmFor), 'Sara Rahme');
  check('owner column read too', accountTargetCdm({ Account: 'Beta Holdings' }, [], cdmFor), 'Jen Debias');
  check('mapped on My Accounts', accountTargetCdm({ Account: 'Acme Renamed' }, [{ id: 'p9', company: 'Acme Renamed' }], cdmFor), 'Sara Rahme');
  check('blank CDM is no CDM', accountTargetCdm({ Account: 'Gamma' }, [], cdmFor), '');
  check('not on the list', accountTargetCdm({ Account: 'Nobody' }, [], cdmFor), '');
  check('no list', accountTargetCdm({ Account: 'Acme Corp' }, [], null), '');
  const d = buildPeOverlapDeals([{ _id: 'c1', Account: 'Acme Corp', Type: 'Portfolio Company', Stage: 'Quoted' }], { targetCdmFor: cdmFor });
  check('the deal carries the CDM', d[0]?.targetCdm, 'Sara Rahme');
}

// Tier for another pod's account: the all-reps fallback.
{
  const data = { sheetNames: ['S'], sheets: { S: { records: [
    { Account: 'Mine Co', Tier: 'Tier 2', CDM: 'Dan Baldauf' },
    { Account: 'Their Co', Tier: 'Tier 1', CDM: 'Sara Rahme' },
  ] } } };
  const scoped = buildTargetTierResolver({ targetAccountsData: data, cdmName: 'Dan Baldauf', settings: {} });
  const wide = buildTargetTierResolver({ targetAccountsData: data, cdmName: 'Dan Baldauf', settings: {}, includeAllReps: true });
  check('scoped resolver keeps to this CDM', scoped({ company: 'Their Co' }).tier, '');
  check('all-reps resolver finds another pod\'s tier', wide({ company: 'Their Co' }).tier, 'Tier 1');
  check('this CDM\'s rows still first', wide({ company: 'Mine Co' }).tier, 'Tier 2');
  check('import defers to the other pod\'s list tier', accountTier({ Account: 'Their Co' }, [{ company: 'Their Co', tier: 'Tier 3', tierSource: 'import' }], wide), 'Tier 1');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
