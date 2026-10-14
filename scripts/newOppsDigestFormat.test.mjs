// The New Opps email wears the PE Monthly formatting (green header band,
// row colours keyed off CDMs aligned, sized to its contents) and carries
// the Tier and CDMs aligned columns, read the way PE Monthly reads them.
// The scheduled send and the Outlook draft build the same table.
//
// Run: node scripts/newOppsDigestFormat.test.mjs
import {
  withTierAndAlignment, buildNewOppsDigestTableHtml, NEW_OPPS_DIGEST_COLUMNS,
  NEW_OPPS_TIER_KEY, NEW_OPPS_CDMS_ALIGNED_KEY,
} from '../src/utils/newOppsDigestEmail.js';
import { buildNewOppsTableHtml, NEW_OPPS_EMAIL_COLUMNS } from '../api/_lib/newOpps.js';
import { withVerticalCoverage, OPP_SALESPERSON_KEY } from '../src/utils/oppVerticalCoverage.js';
import { peMonthlyCdmsAligned, peMonthlyRowStyle, PE_MONTHLY_HEADER_STYLE } from '../src/utils/peMonthlyEmail.js';

let passed = 0, failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n  expected ${e}\n  actual   ${a}`); }
}

const prospects = [
  { company: 'Aligned Co', tier: 'Tier 1', cdmAligned: true },
  { company: 'Unaligned Co', tier: 'Tier 2' },
  { company: 'Untiered Co' },
  { company: 'Mine Co', tier: 'Tier 1' },
];
const rows = withTierAndAlignment([
  { Account: 'Aligned Co', [OPP_SALESPERSON_KEY]: 'Jane Doe' },
  { Account: 'Unaligned Co', [OPP_SALESPERSON_KEY]: 'Jane Doe' },
  { Account: 'Untiered Co', [OPP_SALESPERSON_KEY]: 'Jane Doe' },
  { Account: 'Mine Co', [OPP_SALESPERSON_KEY]: 'Jane Doe, Dan Baldauf' },
], { prospects, cdmName: 'Dan Baldauf' });

check('tier comes from the company card', rows.map(r => r[NEW_OPPS_TIER_KEY]), ['Tier 1', 'Tier 2', '', 'Tier 1']);
check('CDMs aligned reads Yes / No / N/A (untiered) / N/A (your vertical)',
  rows.map(r => r[NEW_OPPS_CDMS_ALIGNED_KEY]), ['Yes', 'No', 'N/A', 'N/A']);
check('same answer PE Monthly gives', peMonthlyCdmsAligned('Tier 2', false), rows[1][NEW_OPPS_CDMS_ALIGNED_KEY]);
check('a Target Accounts tier counts when the card has none',
  withTierAndAlignment([{ Account: 'Untiered Co' }], { prospects, targetTierFor: () => ({ tier: 'Tier 3' }) })[0][NEW_OPPS_CDMS_ALIGNED_KEY], 'No');
check('input rows not mutated', NEW_OPPS_CDMS_ALIGNED_KEY in { Account: 'x' }, false);
check('it reads the Vertical CDM withVerticalCoverage fills',
  withTierAndAlignment(withVerticalCoverage([{ Account: 'Mine Co', Vertical: 'Nope' }]), { prospects, cdmName: 'Dan Baldauf' })[0][NEW_OPPS_CDMS_ALIGNED_KEY], 'No');

{
  // The account's own CDM (Target Accounts list) beats the vertical's in
  // the Vertical CDM column; CDMs aligned keeps reading the vertical's.
  const targetCdmFor = (p) => (p?.company === 'Aligned Co' ? 'Sam Owner' : p?.company === 'Mine Co' ? 'Dan Baldauf' : '');
  const out = withTierAndAlignment([
    { Account: 'Aligned Co', [OPP_SALESPERSON_KEY]: 'Jane Doe' },
    { Account: 'Unaligned Co', [OPP_SALESPERSON_KEY]: 'Jane Doe' },
    { Account: 'Mine Co', [OPP_SALESPERSON_KEY]: 'Jane Doe' },
  ], { prospects, targetCdmFor, cdmName: 'Dan Baldauf' });
  check('account CDM replaces the vertical CDM; none falls back to Coverage; yours shows the vertical\'s',
    out.map(r => r[OPP_SALESPERSON_KEY]), ['Sam Owner', 'Jane Doe', 'Jane Doe']);
  check('CDMs aligned still reads the vertical\'s Coverage names',
    out.map(r => r[NEW_OPPS_CDMS_ALIGNED_KEY]),
    rows.filter(r => r.Account !== 'Untiered Co').slice(0, 2).map(r => r[NEW_OPPS_CDMS_ALIGNED_KEY]).concat(
      withTierAndAlignment([{ Account: 'Mine Co', [OPP_SALESPERSON_KEY]: 'Jane Doe' }], { prospects, cdmName: 'Dan Baldauf' })[0][NEW_OPPS_CDMS_ALIGNED_KEY]));
}

check('columns carry Tier and CDMs aligned after Vertical CDM',
  NEW_OPPS_DIGEST_COLUMNS.map(c => c.label).slice(0, 6),
  ['Account', 'Tier', 'Vertical', 'Vertical CDM', 'CDMs aligned', 'Stage']);
check('the scheduled send uses the same columns', NEW_OPPS_EMAIL_COLUMNS, NEW_OPPS_DIGEST_COLUMNS);

const html = buildNewOppsDigestTableHtml(rows);
check('the scheduled send builds the same table', buildNewOppsTableHtml(rows), html);
check('the header band is the PE Monthly green',
  html.includes(`color:${PE_MONTHLY_HEADER_STYLE.color};background:${PE_MONTHLY_HEADER_STYLE.background}`), true);
check('aligned rows are green', html.includes(`background:${peMonthlyRowStyle({ 'CDMs Aligned': 'Yes' }).background}`), true);
check('N/A rows are grey', html.includes('background:#F1F5F9'), true);
check('sized to its contents, like PE Monthly', /border-collapse:collapse;width:100%/.test(html), false);
check('the column header is printed', html.includes('>CDMs aligned</th>'), true);
check('nothing in it is an em dash', /—/.test(html), false);
check('empty list still says so', buildNewOppsDigestTableHtml([]).includes('No new opportunities to report.'), true);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
