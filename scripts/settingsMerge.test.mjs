// Assertion tests for the cross-device settings merge. Plain Node — no
// test framework (the project has none). Run:
//   node scripts/settingsMerge.test.mjs
import { autoMergeValue, mergeTablePrefs, mergeSettingsKey, foldWriteResult } from '../src/utils/settingsMerge.js';

let passed = 0, failed = 0;
// Key order is an artifact of which side seeded the spread, not part of
// the contract — compare with keys sorted so assertions don't depend on it.
function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])]));
  }
  return v;
}
function eq(actual, expected, name) {
  const a = JSON.stringify(stable(actual)), e = JSON.stringify(stable(expected));
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// --- Snapshot arrays: a narrowed selection must not be widened back ----
// The regression this file was added for. `days` is the weekday set of a
// "No Further Action Today" clear schedule. Narrowing it on one device
// while another still holds the wider set used to merge to the union, so
// the days just switched off kept clearing the column.
{
  const ours = { check: { enabled: true, days: [1, 3], time: '06:00', lastRunAt: 500 } };
  const remote = { check: { enabled: true, days: [1, 2, 3, 4, 5], time: '06:00', lastRunAt: 400 } };
  eq(autoMergeValue(ours, remote, 'nfatSchedules').check.days, [1, 3], 'narrowed days stay narrowed');
}
{
  // …and widening propagates just as directly.
  const ours = { check: { days: [1, 2, 3, 4, 5] } };
  const remote = { check: { days: [1, 3] } };
  eq(autoMergeValue(ours, remote, 'nfatSchedules').check.days, [1, 2, 3, 4, 5], 'widened days stay widened');
}
{
  // Every sibling field already resolved ours-wins; days now matches.
  const ours = { check: { enabled: false, days: [2], time: '09:30', lastRunAt: 900 } };
  const remote = { check: { enabled: true, days: [1, 2, 3, 4, 5], time: '06:00', lastRunAt: 100 } };
  eq(autoMergeValue(ours, remote, 'nfatSchedules').check,
    { enabled: false, days: [2], time: '09:30', lastRunAt: 900 },
    'whole schedule resolves ours-wins');
}
{
  // A type only the other device configured still flows through.
  const ours = { check: { enabled: true, days: [1] } };
  const remote = { check: { enabled: true, days: [1, 2] }, x: { enabled: true, days: [5] } };
  eq(autoMergeValue(ours, remote, 'nfatSchedules'),
    { check: { enabled: true, days: [1] }, x: { enabled: true, days: [5] } },
    'remote-only schedule type survives');
}
{
  // The rule is keyed on the property name, so it applies at any depth
  // and not to arrays that merely look similar.
  eq(autoMergeValue([1, 3], [1, 2, 3], 'days'), [1, 3], 'days snapshot applies at top level');
  eq(autoMergeValue([1, 3], [1, 2, 3], 'hiddenServices'), [1, 3, 2], 'other primitive arrays still union');
  eq(autoMergeValue([1, 3], [1, 2, 3]), [1, 3, 2], 'no key given falls back to union');
}

// --- Existing behaviour that must not regress -------------------------
eq(autoMergeValue(undefined, ['a'], 'k'), ['a'], 'undefined ours takes remote');
eq(autoMergeValue(['a'], undefined, 'k'), ['a'], 'undefined remote keeps ours');
eq(autoMergeValue('mine', 'theirs', 'k'), 'mine', 'scalars resolve ours-wins');
eq(autoMergeValue(['A', 'b'], ['B', 'c'], 'customTypes'), ['A', 'b', 'c'],
  'primitive union dedupes case-insensitively, our order first');
eq(
  autoMergeValue([{ id: 1, v: 'ours' }], [{ id: 1, v: 'theirs' }, { id: 2, v: 'remote-only' }], 'rows'),
  [{ id: 1, v: 'ours' }, { id: 2, v: 'remote-only' }],
  'id-keyed arrays union with ours winning on a shared id',
);
eq(
  autoMergeValue({ a: 1, shared: 'ours' }, { b: 2, shared: 'theirs' }, 'obj'),
  { b: 2, a: 1, shared: 'ours' },
  'objects merge recursively, ours wins on overlap',
);
eq(autoMergeValue([{ id: 1 }, 'loose'], [{ id: 2 }], 'mixed'), [{ id: 1 }, 'loose'],
  'mixed arrays resolve ours-wins');

// --- tablePrefs keeps its own carve-out --------------------------------
eq(
  mergeTablePrefs({ opps2: { visible: ['A'] } }, { opps2: { visible: ['A', 'B'] }, deals: { visible: ['X'] } }),
  { opps2: { visible: ['A'] }, deals: { visible: ['X'] } },
  'hidden column stays hidden; untouched table flows through',
);
eq(
  mergeSettingsKey('tablePrefs', { opps2: { visible: ['A'] } }, { opps2: { visible: ['A', 'B'] } }),
  { opps2: { visible: ['A'] } },
  'mergeSettingsKey routes tablePrefs to its own rule',
);
eq(
  mergeSettingsKey('nfatSchedules', { check: { days: [1] } }, { check: { days: [1, 2] } }),
  { check: { days: [1] } },
  'mergeSettingsKey passes the key through for snapshot arrays',
);

// --- A click made while a save was in flight is not undone by it -------
// The regression this was added for: the contact popup's tag table saves on
// every click, each save takes a round trip, and the completed save used to
// rebuild local state from the snapshot it had STARTED with — so a tag
// answered while the previous save was in the air quietly un-answered itself
// a second later.
{
  const beforeSave = { contactTagReview: { 1: { ESG: 'yes' } }, theme: 'dark' };
  // The write goes out, then the user answers another tag.
  const nowHolding = { contactTagReview: { 1: { ESG: 'yes' }, 2: { EU: 'no' } }, theme: 'dark' };
  const folded = foldWriteResult(beforeSave, beforeSave, nowHolding);
  eq(folded.contactTagReview, nowHolding.contactTagReview,
    'the answer clicked mid-save survives the save settling');
  eq(folded.theme, 'dark', 'untouched keys are left alone');
}
{
  // A key the write itself carried, plus a remote change to another key:
  // both land, and neither wipes the other.
  const snapshot = { a: 1, b: 1 };
  const current = { a: 1, b: 1 };
  const base = { a: 2, b: 1, c: 'from-other-device' };
  eq(foldWriteResult(base, snapshot, current), { a: 2, b: 1, c: 'from-other-device' },
    'with nothing changed mid-write, the write result stands');
}
{
  // _lastWriteAt is the caller's to stamp — never carried over from the
  // in-flight local state, which holds the PREVIOUS write's timestamp.
  const folded = foldWriteResult({ x: 1, _lastWriteAt: 20 }, { _lastWriteAt: 5 }, { x: 1, _lastWriteAt: 10 });
  eq(folded._lastWriteAt, 20, 'the write\'s own timestamp survives the fold');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
