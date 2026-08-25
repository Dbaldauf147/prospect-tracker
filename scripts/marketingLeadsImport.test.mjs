// Assertion tests for the shared Marketing Leads import rules. Plain
// Node — no test framework (the project has none). Run:
//   node scripts/marketingLeadsImport.test.mjs
//
// These rules decide which pasted leads reach the Marketing Leads page,
// from either paste that feeds it (the page's own mapping modal and the
// BFO Activity → Leads subtab). The cases that matter most are the ones
// that DROP a lead: a wrong skip is invisible on the page, which is
// exactly how a lead ends up on the Leads subtab and nowhere else.
import {
  autoDetectLeadMapping, leadRowsFromTable, planLeadImport,
  normalizeLeadName, leadNameKey, summariseLeadNames,
} from '../src/utils/marketingLeadsImport.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const names = rows => rows.map(r => r.name);
const lead = (over = {}) => ({ id: over.id || `s_${over.name || 'x'}`, name: '', email: '', status: '', ...over });

// ---- name handling ---------------------------------------------------

eq(normalizeLeadName('Reid, Colleen'), 'Colleen Reid', '"Last, First" flips to "First Last"');
eq(normalizeLeadName('Colleen Reid'), 'Colleen Reid', 'an already-flipped name is left alone');
eq(normalizeLeadName('Reid, Colleen, PhD'), 'Reid, Colleen, PhD', 'a multi-comma name is not mangled');
eq(leadNameKey('Reid, Colleen') === leadNameKey('Colleen Reid'), true,
  'both name orderings collapse to one key');

// ---- header detection ------------------------------------------------

const LEADS_HEADERS = ['Name', 'Company', 'Email', 'Lead Status', 'Created Date', 'Owner'];
eq(autoDetectLeadMapping(LEADS_HEADERS), {
  name: 'Name', email: 'Email', company: 'Company',
  status: 'Lead Status', createdDate: 'Created Date', owner: 'Owner',
}, 'the Salesforce Leads printable headers map onto the lead fields');

eq(autoDetectLeadMapping(['Account Name', 'Sales Stage']).name, undefined,
  'a table with no Name column detects no name mapping');

// ---- table → lead rows -----------------------------------------------

{
  const table = {
    headers: LEADS_HEADERS,
    rows: [
      { Name: 'Reid, Colleen', Company: 'Acme', Email: 'c.reid@acme.com', 'Lead Status': 'Open', 'Created Date': '8/1/2026', Owner: 'Dan' },
      { Name: '', Company: '', Email: '', 'Lead Status': '', 'Created Date': '', Owner: '' },
    ],
  };
  const rows = leadRowsFromTable(table);
  eq(rows.length, 1, 'a row with nothing in any mapped column is dropped');
  eq([rows[0].name, rows[0].company, rows[0].email, rows[0].status], ['Reid, Colleen', 'Acme', 'c.reid@acme.com', 'Open'],
    'mapped columns land on the lead fields (the name flips at import time)');
  eq(rows[0].mappedCompany, '', 'unmapped lead fields are present and blank');
}

// ---- planLeadImport: the skips ---------------------------------------

{
  const saved = [lead({ id: 's1', name: 'Ana Higueras', email: 'ana@x.com' })];
  const incoming = [
    { name: 'Reid, Colleen', email: 'c.reid@acme.com' },
    { name: 'Higueras, Ana', email: 'ana@x.com' },
  ];
  const plan = planLeadImport({ incoming, saved });
  eq(names(plan.additions), ['Colleen Reid'], 'a new lead is added, with the name flipped');
  eq(names(plan.blockedDuplicate), ['Ana Higueras'], 'a lead whose email is already saved is skipped');
  eq(plan.savedAfter, saved, 'nothing is written to the saved leads when no status is promoted');
}

{
  const saved = [lead({ id: 's1', name: 'Colleen Reid', email: 'c.reid@acme.com' })];
  const plan = planLeadImport({
    incoming: [{ name: 'Reid, Colleen', email: 'c.reid@acme.com' }],
    saved, hiddenIds: ['s1'],
  });
  eq(names(plan.additions), [], 'a hidden lead is not resurrected by a fresh paste');
  eq(names(plan.blockedHidden), ['Colleen Reid'], 'and it is reported as hidden, not as a plain duplicate');
}

{
  const plan = planLeadImport({
    incoming: [
      { name: 'Reid, Colleen', email: 'c.reid@acme.com' },
      { name: 'Reid, Colleen', email: 'C.Reid@Acme.com ' },
    ],
    saved: [],
  });
  eq(plan.additions.length, 1, 'one person repeated inside a single paste imports once');
  eq(plan.blockedDuplicate.length, 1, 'the repeat is counted as a duplicate');
}

// An email-less lead is the Leads subtab's normal case (the printable
// view often has no Email column), so name matching has to carry it.
{
  const saved = [lead({ id: 's1', name: 'Colleen Reid' })];
  const byName = planLeadImport({ incoming: [{ name: 'Reid, Colleen' }], saved, matchByName: true });
  eq(names(byName.additions), [], 'with matchByName, a saved lead is recognised by name alone');

  const byEmail = planLeadImport({ incoming: [{ name: 'Reid, Colleen' }], saved });
  eq(names(byEmail.additions), ['Colleen Reid'],
    'without matchByName (the Marketing Leads paste), matching stays email-only');
}

{
  // Two different people who share a name: both carry an address, so the
  // addresses are what separate them and both must be kept.
  const saved = [lead({ id: 's1', name: 'John Smith', email: 'john@acme.com' })];
  const plan = planLeadImport({
    incoming: [{ name: 'Smith, John', email: 'jsmith@other.com' }],
    saved, matchByName: true,
  });
  eq(names(plan.additions), ['John Smith'], 'a same-name lead with a different email is still a new lead');
}

{
  // Same name, and the saved copy has no email to tell them apart — treat
  // the incoming one as that lead rather than duplicating the page.
  const saved = [lead({ id: 's1', name: 'John Smith' })];
  const plan = planLeadImport({
    incoming: [{ name: 'Smith, John', email: 'john@acme.com' }],
    saved, matchByName: true,
  });
  eq(names(plan.additions), [], 'a same-name lead saved without an email is matched, not duplicated');
}

// ---- planLeadImport: Working status promotion ------------------------

{
  const saved = [lead({ id: 's1', name: 'Chris Kirk', email: 'chris@x.com', status: 'Closed - Recycle' })];
  const plan = planLeadImport({
    incoming: [{ name: 'Kirk, Chris', email: 'chris@x.com', status: 'Working - Contacted' }],
    saved, promoteWorkingStatus: true,
  });
  eq(plan.statusPromoted, 1, 'a Working duplicate promotes the saved lead');
  eq(plan.savedAfter[0].status, 'Working - Contacted', 'and the saved lead carries the new status');
  eq(plan.savedAfter === saved, false, 'the saved list is copied, never mutated in place');
  eq(saved[0].status, 'Closed - Recycle', 'the original saved row is untouched');
  eq(names(plan.additions), [], 'the duplicate itself is still not imported twice');
}

{
  const saved = [lead({ id: 's1', name: 'Chris Kirk', email: 'chris@x.com', status: 'Working' })];
  const plan = planLeadImport({
    incoming: [{ name: 'Kirk, Chris', email: 'chris@x.com', status: 'Closed - Recycle' }],
    saved, promoteWorkingStatus: true,
  });
  eq(plan.statusPromoted, 0, 'a stale Closed-Recycle copy never overwrites a Working lead');
  eq(plan.savedAfter[0].status, 'Working', 'the Working status stands');
}

{
  // Promotion runs for hidden leads too — the stored status stays true —
  // without unhiding them.
  const saved = [lead({ id: 's1', name: 'Chris Kirk', email: 'chris@x.com', status: 'Closed - Recycle' })];
  const plan = planLeadImport({
    incoming: [{ name: 'Kirk, Chris', email: 'chris@x.com', status: 'Working' }],
    saved, hiddenIds: ['s1'], promoteWorkingStatus: true,
  });
  eq(plan.savedAfter[0].status, 'Working', 'a hidden lead still takes the newer Working status');
  eq(names(plan.blockedHidden), ['Chris Kirk'], 'and stays hidden');
}

{
  const plan = planLeadImport({
    incoming: [
      { name: 'Kirk, Chris', email: 'chris@x.com', status: 'Closed - Recycle' },
      { name: 'Kirk, Chris', email: 'chris@x.com', status: 'Working' },
    ],
    saved: [], promoteWorkingStatus: true,
  });
  eq(plan.additions.length, 1, 'two copies in one paste import once');
  eq(plan.additions[0].status, 'Working', 'and the imported copy takes the Working status');
}

{
  const plan = planLeadImport({
    incoming: [{ name: 'Kirk, Chris', email: 'chris@x.com', status: 'Working' }],
    saved: [lead({ id: 's1', name: 'Chris Kirk', email: 'chris@x.com', status: 'Closed - Recycle' })],
  });
  eq(plan.statusPromoted, 0, 'without promoteWorkingStatus (the Leads subtab), saved leads are left alone');
}

// ---- reporting -------------------------------------------------------

eq(summariseLeadNames([{ name: 'A' }, { name: 'B' }]), 'A, B', 'a short list names everyone');
eq(summariseLeadNames([{ name: 'A' }, { name: 'B' }, { name: 'C' }], 2), 'A, B and 1 more',
  'a long list is capped');
eq(summariseLeadNames([]), '', 'an empty list reports nothing');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
