// Assertion tests for the tag-audit queue's pure rules. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/tagAuditQueue.test.mjs
//
// Only `auditablePeople` and `isAuditableId` are exercised here: the storage
// half is localStorage + a window event, which needs a browser. What matters
// on this side is WHICH contacts a Tagged-row list hands to the audit —
// getting that wrong either spends calls on contacts HubSpot has never seen
// or quietly leaves out the ones the step is flagging.
import { auditablePeople, isAuditableId } from '../src/utils/tagAuditQueue.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// --- which ids can be audited at all --------------------------------------
eq(isAuditableId('101'), true, 'a HubSpot id is auditable');
eq(isAuditableId('local-1757000000-abc'), false, 'a locally-created contact has no history to read');
eq(isAuditableId(''), false, 'and neither has nothing');
eq(isAuditableId(null), false, 'nor null');

// --- who a Tagged-row list hands over -------------------------------------
{
  const people = [
    { id: '1', name: 'Ada', email: 'ada@example.com', done: false, contact: { id: '101' } },
    { id: '2', name: 'Brice', email: 'brice@example.com', done: false, contact: { vid: '102' } },
    { id: '3', name: 'Cleo', email: 'cleo@example.com', done: true, contact: { id: '103' } },
    // rosterTagCoverage leaves `id` null for a row with no HubSpot record
    // behind it (an imported name), and carries no contact to fall back on.
    { id: null, name: 'Dev', email: 'dev@example.com', done: false, contact: null },
    { id: '5', name: 'Eve', email: 'eve@example.com', done: false, contact: { id: 'local-42' } },
  ];
  const out = auditablePeople(people);
  eq(out.map(c => c.id), ['101', '102'],
    'the contacts the step flags, by their HubSpot id — vid included');
  eq(out[0], { id: '101', name: 'Ada', email: 'ada@example.com' },
    'each carrying enough to name them before anything is called');
  eq(out.map(c => c.name).includes('Cleo'), false, 'a fully-tagged contact is not flagged, so it is not queued');
  eq(out.map(c => c.name).includes('Dev'), false, 'nor is a row with no HubSpot record behind it');
  eq(out.map(c => c.name).includes('Eve'), false, 'nor a locally-created contact');
  eq(auditablePeople([]), [], 'an empty list queues nothing');
  eq(auditablePeople(null), [], 'and no list at all is not a crash');
}

// A roster whose contacts are all answered has nothing to audit from here —
// the button that reads this is disabled rather than queueing an empty set.
eq(auditablePeople([{ id: '1', done: true, contact: { id: '101' } }]), [],
  'a finished roster hands over nobody');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
