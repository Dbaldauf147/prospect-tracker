// The coverage boards (Client Campaigns, Pipeline coverage, ...) must join
// opps to a company exactly as its company popup does.
// Plain Node:  node scripts/coverageCompaniesMatch.test.mjs
import assert from 'node:assert/strict';
import { coverageCompaniesMatch } from '../src/utils/serviceCoverage.js';
import { companiesMatch } from '../src/utils/companyRoster.js';

// A note about the owner in brackets is not the owner's opp.
assert.equal(coverageCompaniesMatch('Rehlko (a Platinum Equity Co.)', 'Platinum Equity'), false);
assert.equal(coverageCompaniesMatch('Platinum Equity', 'Platinum Equity'), true);
assert.equal(coverageCompaniesMatch('The Blackstone Group L.P.', 'Blackstone'), companiesMatch('The Blackstone Group L.P.', 'Blackstone'));
for (const [a, b] of [['Jones Lang LaSalle (JLL)', 'JLL'], ['Acme Inc.', 'ACME'], ['CBRE', 'CBRE Investment Management']]) {
  assert.equal(coverageCompaniesMatch(a, b), companiesMatch(a, b), `${a} / ${b}`);
}
console.log('coverageCompaniesMatch: all assertions passed');
