// The status Opps suggests for an account, and the opps behind it
// (src/utils/oppStatusSuggestion.js). Run: node scripts/oppStatusSuggestion.test.mjs
import { register } from 'node:module';
register('./stubs/loader.mjs', import.meta.url);
const { oppStageBucket, suggestedStatusFromCounts, oppsBehindSuggestion, suggestionOppsTable, suggestionAccountFor } = await import('../src/utils/oppStatusSuggestion.js');
const { computeIssues } = await import('../src/utils/clientIssues.js');

let passed = 0, failed = 0;
function ok(c, n) { if (c) { passed++; console.log(`PASS  ${n}`); } else { failed++; console.log(`FAIL  ${n}`); } }

ok(oppStageBucket('Sold') === 'sold' && oppStageBucket('closed won') === 'sold', 'sold stages');
ok(oppStageBucket('Not Sold') === 'notSold' && oppStageBucket('Lost - Not Sold') === 'notSold', 'not sold stages');
ok(oppStageBucket('Proposal') === 'active', 'an open stage is active');
ok(oppStageBucket('') === null && oppStageBucket('#N/A') === null && oppStageBucket('Closed') === null, 'blank, error and Closed stages count for nothing');
ok(suggestedStatusFromCounts({ sold: 1, active: 2, notSold: 3 }) === 'Client', 'sold wins');
ok(suggestedStatusFromCounts({ active: 2, notSold: 3 }) === 'Qualifying', 'then open');
ok(suggestedStatusFromCounts({ notSold: 3 }) === 'Lost - Not Sold', 'then not sold');
ok(suggestedStatusFromCounts({}) === '', 'nothing to go on');

const records = [
  { _id: 5, Account: 'Nuveen', Scope: 'Utility Bill Management', Stage: 'Not Sold', 'Quoted Amount': '$120,000', 'Close Date': '2026-03-02', 'Reason Not Sold': 'Price', Source: 'Inbound' },
  { _id: 9, Account: 'nuveen ', Scope: 'ESG Reporting', Stage: 'Not Sold' },
  { _id: 11, Account: 'Nuveen', Scope: 'Junk', Stage: '#N/A' },
  { _id: 2, Account: 'Acme', Scope: 'A', Stage: 'Sold' },
  { _id: 3, Account: 'Acme', Scope: 'B', Stage: 'Proposal' },
];
const lost = oppsBehindSuggestion(records, ['', 'NUVEEN'], 'Lost - Not Sold');
ok(suggestionAccountFor(records, ['Nuveen']) === 'nuveen', 'account found by exact name');
ok(lost.opps.length === 2 && lost.otherCount === 0 && lost.account === 'Nuveen', 'the Not Sold opps, any case, error-stage opp left out');
ok(/All 2 opps/.test(lost.reason), `reason says why (${lost.reason})`);
const client = oppsBehindSuggestion(records, ['acme'], 'Client');
ok(client.opps.length === 1 && client.opps[0]._id === 2 && client.otherCount === 1, 'Client: the sold opp, the open one counted as other');
ok(oppsBehindSuggestion(records, ['Missing Co'], 'Client').opps.length === 0, 'no opps found: empty');
ok(oppsBehindSuggestion(records, ['Missing Co', 'Acme'], 'Qualifying').opps[0]._id === 3, 'falls through to the next account name');

// The flag's Opps account reaches the popup, which lists the opps.
const prospects = [{ id: 'p1', company: 'Nuveen (TIAA)', status: 'Hold Off' }];
const issues = computeIssues({ prospects, myAccountsFlags: [{ id: 'p1', company: 'Nuveen (TIAA)', kind: 'status', status: 'Hold Off', suggestedStatus: 'Lost - Not Sold', oppsAccount: 'nuveen' }] });
const row = issues.find(i => i.id === 'status-mismatch:p1');
ok(row?.resolve?.oppsAccount === 'nuveen', 'issue row carries the Opps account');
const spec = { table: suggestionOppsTable(row.resolve, prospects[0], records, new Map([[5, 3], [9, 4]])) };
ok(spec.table?.rows.length === 2 && spec.table.rows[0].number === '#3' && spec.table.rows[0].reason === 'Price', 'popup table lists the opps with their Opp # and reason');
ok(spec.table.rows[1].quoted === '-', 'a blank cell shows a hyphen');
ok(/under the Opps account "Nuveen"/.test(spec.table.caption), 'caption names the Opps account when it differs from the company');
ok(spec.table.columns.some(c => c.key === 'reason'), 'Reason Not Sold column for a Lost suggestion');
const none = suggestionOppsTable(row.resolve, prospects[0], [], new Map());
ok(none.rows.length === 0 && /still loading/.test(none.caption), 'no opps loaded: no rows, and the caption says so');

// A flag raised before oppsAccount existed, on a company whose Opps account
// is spelled differently: found by the same fuzzy match My Accounts uses.
const fuzzy = [{ _id: 1, Account: 'Nuveen Real Estate', Scope: 'X', Stage: 'Not Sold' }, { _id: 2, Account: 'Other Co', Scope: 'Y', Stage: 'Sold' }];
const old = { kind: 'accountStatus', suggestedStatus: 'Lost - Not Sold', oppsAccount: '' };
const viaFuzzy = suggestionOppsTable(old, { id: 'p9', company: 'Nuveen' }, fuzzy, new Map());
ok(viaFuzzy.rows.length === 1 && /under the Opps account "Nuveen Real Estate"/.test(viaFuzzy.caption), `fuzzy name match finds the opps (${viaFuzzy.caption})`);
const viaDivision = suggestionOppsTable(old, { id: 'p9', company: 'TIAA' }, [{ _id: 1, Account: 'Churchill', Stage: 'Not Sold' }], new Map(), ['Churchill']);
ok(viaDivision.rows.length === 1, 'a division name finds the opps');
const gone = suggestionOppsTable(old, { id: 'p9', company: 'Zzz Holdings' }, fuzzy, new Map());
ok(gone.rows.length === 0 && /No opps on the Opps tab match/.test(gone.caption), 'nothing matches: says so');
ok(!/—/.test(JSON.stringify(spec.table)), 'no em dash');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
