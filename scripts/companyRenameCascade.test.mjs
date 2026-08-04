// Assertion tests for the company-rename cascade plan. Plain Node.
// Run:  node scripts/companyRenameCascade.test.mjs
//
// The interesting case is a rename that only changes capitalisation
// ("iberconsa" → "Iberconsa"). Every reference in the plan stores the company
// name as text and renders it, so the cascade has to carry a case-only change
// — the page shows the stored string, not the company record's.
import {
  buildCompanyRenamePlan, planHasWork, summarizeRenamePlan, accountMatchesCompany,
} from '../src/utils/companyRenameCascade.js';

let pass = 0, fail = 0;
const ok = (c, n) => c ? (pass++, console.log('PASS ', n)) : (fail++, console.log('FAIL ', n));
const eq = (a, b, n) => ok(JSON.stringify(a) === JSON.stringify(b), `${n} (got ${JSON.stringify(a)})`);

const opps = [
  { _id: 'o1', Account: 'iberconsa' },
  { _id: 'o2', Account: 'Iberconsa' },
  { _id: 'o3', Account: 'Some Other Co' },
];

// --- case-only rename ------------------------------------------------------
{
  const plan = buildCompanyRenamePlan({
    oldName: 'iberconsa',
    newName: 'Iberconsa',
    prospects: [
      { id: 'p2', company: 'Portfolio Co', peOwner: 'iberconsa' },
      { id: 'p3', company: 'PE Firm', portfolioCompanies: [{ companyName: 'iberconsa' }] },
    ],
    currentProspectId: 'p1',
    settings: {
      events: [{ id: 'e1', attendees: [{ name: 'A', company: 'iberconsa' }, { name: 'B', company: 'Elsewhere' }] }],
    },
    oppsRecords: opps,
  });
  ok(planHasWork(plan), 'case-only rename: plan has work');
  eq(plan.oppIds, ['o1', 'o2'], 'case-only rename: both opps repointed');
  eq(plan.counts.peOwner, 1, 'case-only rename: PE Owner rewritten');
  eq(plan.peOwnerUpdates[0].peOwner, 'Iberconsa', 'case-only rename: PE Owner takes the new casing');
  eq(plan.counts.portfolio, 1, 'case-only rename: portfolio-list entry rewritten');
  eq(plan.portfolioUpdates[0].portfolioCompanies[0].companyName, 'Iberconsa', 'case-only rename: portfolio entry casing');
  eq(plan.counts.eventAttendees, 1, 'case-only rename: event attendee rewritten');
  eq(plan.events[0].attendees[0].company, 'Iberconsa', 'case-only rename: attendee casing');
  ok(summarizeRenamePlan(plan).length > 0, 'case-only rename: summary lines produced');
}

// A lowercased-key store has nothing to move when only the casing changed —
// and must not write-then-delete the one key, which would drop the entry.
{
  const plan = buildCompanyRenamePlan({
    oldName: 'iberconsa',
    newName: 'Iberconsa',
    prospects: [],
    settings: {
      dismissedPortfolioGuesses: { ra: { iberconsa: true }, target: {} },
      savedPortfolioMappings: { iberconsa: { starred: true } },
    },
    oppsRecords: [],
  });
  eq(plan.dismissed, null, 'case-only rename: dismissed key left alone');
  eq(plan.savedPortfolioMappings, null, 'case-only rename: saved mapping key left alone');
}

// --- identical name is still a no-op --------------------------------------
{
  const plan = buildCompanyRenamePlan({
    oldName: 'Iberconsa', newName: 'Iberconsa', prospects: [], settings: {}, oppsRecords: opps,
  });
  ok(!planHasWork(plan), 'identical name: no work');
  eq(plan.counts.opps, 0, 'identical name: no opps repointed');
}
{
  const plan = buildCompanyRenamePlan({
    oldName: '  Iberconsa  ', newName: 'Iberconsa', prospects: [], settings: {}, oppsRecords: opps,
  });
  ok(!planHasWork(plan), 'whitespace-only difference: no work');
}

// --- a substantive rename still behaves ------------------------------------
{
  const plan = buildCompanyRenamePlan({
    oldName: 'iberconsa',
    newName: 'Iberconsa Group',
    prospects: [],
    settings: { dismissedPortfolioGuesses: { ra: { iberconsa: true }, target: {} } },
    oppsRecords: opps,
  });
  eq(plan.oppIds, ['o1', 'o2'], 'substantive rename: opps repointed');
  ok(plan.dismissed && plan.dismissed.ra['iberconsa group'] === true, 'substantive rename: dismissed key moved');
  ok(plan.dismissed && plan.dismissed.ra.iberconsa === undefined, 'substantive rename: old dismissed key dropped');
}

// --- the matcher the opps leg uses -----------------------------------------
ok(accountMatchesCompany('iberconsa', 'Iberconsa'), 'matcher: case-insensitive');
ok(accountMatchesCompany('Iberconsa', 'Iberconsa Inc.'), 'matcher: ignores a corporate suffix');
ok(!accountMatchesCompany('Iberconsa', 'Some Other Co'), 'matcher: unrelated names do not match');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
