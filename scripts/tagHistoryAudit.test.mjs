// Assertion tests for the dans_tags history audit. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/tagHistoryAudit.test.mjs
//
// What this has to get right, because a restore will be built on it:
//
//   1. Only report tags that are STILL missing. A contact whose tags were
//      cleared and then re-added by hand has lost nothing, and listing them
//      would have a restore write duplicates.
//   2. Date the loss to the most recent write that took them, not the first.
//      Blaming an older edit points the investigation at the wrong action.
//   3. Never mistake a spelling for a loss: this dataset carries both
//      "Efficiency / Renewables" and "Efficiency/Renewables".
import { auditTagHistory, summarizeTagAudit, tagAuditCsv, splitTags } from '../src/utils/tagHistoryAudit.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const v = (value, timestamp, sourceType = 'INTEGRATION', sourceId = 'app') => ({ value, timestamp, sourceType, sourceId });

// --- reading the string ---------------------------------------------------
eq(splitTags('A;B ; C'), ['A', 'B', 'C'], 'tags split on ; and trim');
eq(splitTags(''), [], 'an empty string is no tags');
eq(splitTags(null), [], 'and neither is nothing at all');

// --- one contact, one wipe ------------------------------------------------
{
  const r = auditTagHistory({
    id: '1', name: 'Ada', email: 'ada@example.com',
    current: 'Dan Key Target',
    history: [
      v('Dan Key Target', '2026-09-09T14:02:00Z'),
      v('Dan Key Target;Efficiency/Renewables;Procurement', '2026-08-01T10:00:00Z'),
    ],
  });
  eq(r.lost, true, 'a version carrying tags the contact no longer has is a loss');
  eq(r.removed, ['Efficiency/Renewables', 'Procurement'], 'and the loss names what went');
  eq(r.restoreTo, 'Dan Key Target;Efficiency/Renewables;Procurement', 'restoring keeps what they carry now and adds back what went');
  eq(r.at, '2026-09-09T14:02:00Z', 'dated by the write that took them');
  eq([r.sourceType, r.sourceId], ['INTEGRATION', 'app'], 'and attributed to whatever made that write');
}

// --- a contact who is fine ------------------------------------------------
{
  const r = auditTagHistory({
    id: '2', current: 'A;B',
    history: [v('A;B', '2026-09-09T14:02:00Z'), v('A', '2026-08-01T10:00:00Z')],
  });
  eq(r.lost, false, 'a contact who only ever gained tags has lost nothing');
  eq(auditTagHistory({ id: '3', current: 'A', history: [v('A', '2026-09-01T00:00:00Z')] }).lost, false,
    'nor has one with a single version to their name');
  eq(auditTagHistory({}).lost, false, 'and an empty entry is not a casualty');
}

// --- re-added by hand since -----------------------------------------------
{
  const r = auditTagHistory({
    id: '4', current: 'A;B',
    history: [
      v('A;B', '2026-09-09T15:00:00Z'),   // put back
      v('A', '2026-09-09T14:02:00Z'),     // the wipe
      v('A;B', '2026-08-01T10:00:00Z'),
    ],
  });
  eq(r.lost, false, 'a tag taken and then re-added is not still lost');
}

// --- two wipes: the most recent one is the one to report ------------------
{
  const r = auditTagHistory({
    id: '5', current: 'A',
    history: [
      v('A', '2026-09-09T14:02:00Z', 'INTEGRATION', 'events-bulk'),
      v('A;C', '2026-09-05T09:00:00Z'),
      v('A;B;C', '2026-07-01T09:00:00Z'),
    ],
  });
  eq(r.removed, ['C'], 'the newest removal is the one reported');
  eq(r.at, '2026-09-09T14:02:00Z', 'with its own timestamp');
  eq(r.sourceId, 'events-bulk', 'and its own source, which is what the investigation follows');
}

// --- spelling is not a loss -----------------------------------------------
{
  const r = auditTagHistory({
    id: '6', current: 'Efficiency/Renewables',
    history: [
      v('Efficiency/Renewables', '2026-09-09T14:02:00Z'),
      v('Efficiency / Renewables', '2026-08-01T10:00:00Z'),
    ],
  });
  eq(r.lost, false, 'the same tag written another way is the same tag');
}

// --- the incident, across contacts ----------------------------------------
{
  const s = summarizeTagAudit([
    { id: '1', name: 'Ada', current: '', history: [v('', '2026-09-09T14:02:00Z', 'INTEGRATION', 'app'), v('A;B', '2026-08-01T10:00:00Z')] },
    { id: '2', name: 'Brice', current: 'A', history: [v('A', '2026-09-09T14:07:00Z', 'INTEGRATION', 'app'), v('A;B;C;D', '2026-08-01T10:00:00Z')] },
    { id: '3', name: 'Cleo', current: 'A;B', history: [v('A;B', '2026-09-01T10:00:00Z')] },
  ]);
  eq(s.examined, 3, 'every contact handed over is examined');
  eq(s.lostCount, 2, 'and only the ones that lost tags are reported');
  eq(s.tagsLost, 5, 'the tags themselves are counted too');
  eq(s.rows.map(r => r.name), ['Brice', 'Ada'], 'worst hit first');
  eq(s.byHour, [{ hour: '2026-09-09 14', count: 2 }], 'a bulk wipe lands as one spike');
  eq(s.bySource, [{ source: 'INTEGRATION:app', count: 2 }], 'from one source');
  eq([s.firstAt, s.lastAt], ['2026-09-09T14:02:00Z', '2026-09-09T14:07:00Z'], 'and inside one window');
  eq(summarizeTagAudit([]).lostCount, 0, 'nothing examined, nothing lost');
  eq(summarizeTagAudit(null).examined, 0, 'and no rows at all is not a crash');

  // The copy taken before anything is written back.
  const csv = tagAuditCsv(s.rows).split('\n');
  eq(csv[0].startsWith('Contact ID,Name,Email,Tags now,Tags before,Lost,Restore to'), true, 'the CSV leads with what was lost');
  eq(csv.length, 3, 'one row per casualty, plus the header');
  eq(csv[1].includes('A;B;C;D'), true, 'carrying the value to restore');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
