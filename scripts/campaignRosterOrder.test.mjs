// node scripts/campaignRosterOrder.test.mjs
import { orderCampaignRoster } from '../src/utils/campaignRosterOrder.js';

let passed = 0; let failed = 0;
const eq = (got, want, msg) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { passed++; console.log(`  ok  ${msg}`); }
  else { failed++; console.log(`  FAIL ${msg}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
};

const roster = [
  { email: 'a', sentDate: '2026-11-17', company: 'Neuberger' },
  { email: 'b', company: 'Zeta' },
  { email: 'c', sentDate: '2026-11-10', company: 'Apex' },
  { email: 'd', company: 'Acme' },
].map((c, i) => ({ c, i }));
const emails = (l) => l.map(x => x.c.email);

eq(emails(orderCampaignRoster(roster)), ['b', 'd', 'a', 'c'], 'no sort: Not Sent first, roster order within each group');
eq(emails(orderCampaignRoster(roster, c => c.company, 'asc')), ['d', 'b', 'c', 'a'], 'a column sort applies inside each group');
eq(emails(orderCampaignRoster(roster, c => c.company, 'desc')), ['b', 'd', 'a', 'c'], 'descending too, Not Sent still on top');
eq(emails(orderCampaignRoster(roster, c => c.sentDate || '', 'desc')), ['b', 'd', 'a', 'c'], 'sorting by sent date keeps unsent on top');
eq(roster.map(x => x.i), [0, 1, 2, 3], 'the input is not reordered');
eq(orderCampaignRoster(null), [], 'nothing in, nothing out');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
