// Assertion tests for the "most recent call" stamp an opp carries. Plain
// Node — no test framework (the project has none). Run:
//   node scripts/lastCallOnOpp.test.mjs
//
// The one that matters: the newest CALL has to win, not the newest
// write. Calls are transcribed and tagged long after they happen, so a
// batch of old ones tagged in one sitting would otherwise leave the opp
// claiming whichever was tagged last as the most recent conversation.
import {
  lastCallStamp, shouldReplaceLastCall, withLastCallStamp, clearLastCallPatch,
  lastCallOn, describeCallAge, LAST_CALL_FIELDS,
} from '../src/utils/lastCallOnOpp.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
function ok(value, name) { eq(!!value, true, name); }

const call = (over = {}) => ({
  id: 'granola:not_abc',
  name: 'Renewal call — Acme Corp',
  recordedAt: '2026-08-05T15:00:00.000Z',
  granolaUrl: 'https://notes.granola.ai/d/not_abc',
  summary: 'Talked through the renewal and the March expiry.\n\nThey want two term options.',
  ...over,
});

// --- the stamp -----------------------------------------------------------
{
  const s = lastCallStamp(call());
  eq(s._lastCallId, 'granola:not_abc', 'the recording id travels, so the stamp can be matched later');
  eq(s._lastCallName, 'Renewal call — Acme Corp', 'so does the call name');
  eq(s._lastCallAt, '2026-08-05T15:00:00.000Z', 'and when the call happened');
  eq(s._lastCallUrl, 'https://notes.granola.ai/d/not_abc', 'and the link back to the note');
  eq(s._lastCallGist, 'Talked through the renewal and the March expiry.',
    'the gist is the summary’s first paragraph, not the whole thing');
  eq(Object.keys(s).sort(), [...LAST_CALL_FIELDS].sort(), 'the stamp writes exactly the declared fields');
}

{
  eq(lastCallStamp({ name: 'No id' }), null, 'a call with no id cannot be stamped');
  eq(lastCallStamp(null), null, 'no record, no stamp');
  eq(lastCallStamp(call({ name: '' }))._lastCallName, 'Untitled call', 'an unnamed call still reads as something');
  eq(lastCallStamp(call({ summary: '', granolaSummary: 'Granola’s own note.' }))._lastCallGist,
    'Granola’s own note.', 'Granola’s note stands in when our summariser hasn’t run');
  eq(lastCallStamp(call({ summary: '', granolaSummary: '' }))._lastCallGist, '',
    'a call with no summary at all has no gist');

  const long = lastCallStamp(call({ summary: 'x'.repeat(500) }));
  ok(long._lastCallGist.length <= 300, 'a long gist is clipped, so an opp row is not a second copy of the summary');
  ok(long._lastCallGist.endsWith('…'), 'and says it was clipped');
}

// --- which call wins -----------------------------------------------------
{
  const opp = { _lastCallId: 'granola:aug', _lastCallAt: '2026-08-05T15:00:00.000Z' };

  ok(shouldReplaceLastCall({}, lastCallStamp(call())), 'an opp with no stamp takes the first one');
  ok(!shouldReplaceLastCall(opp, lastCallStamp(call({ id: 'granola:jan', recordedAt: '2026-01-09T15:00:00.000Z' }))),
    'an older call tagged today does not become the most recent conversation');
  ok(shouldReplaceLastCall(opp, lastCallStamp(call({ id: 'granola:sep', recordedAt: '2026-09-01T15:00:00.000Z' }))),
    'a newer call does');
  ok(shouldReplaceLastCall(opp, lastCallStamp(call({ id: 'granola:aug' }))),
    'the same call always wins against itself, so a re-summarise refreshes the gist');
  ok(!shouldReplaceLastCall(opp, lastCallStamp(call({ id: 'granola:x', recordedAt: null }))),
    'an undated call cannot displace a dated one');
  ok(shouldReplaceLastCall({ _lastCallId: 'granola:x', _lastCallAt: null }, lastCallStamp(call({ id: 'granola:y' }))),
    'but a dated call displaces an undated one');
  ok(!shouldReplaceLastCall(opp, null), 'no stamp replaces nothing');
}

{
  const opp = { _lastCallId: 'granola:sep', _lastCallAt: '2026-09-01T15:00:00.000Z' };
  const patch = withLastCallStamp({ 'Next Steps': 'a\nb' }, opp, call());
  eq(Object.keys(patch), ['Next Steps'], 'an older call leaves the patch exactly as it was');

  const winning = withLastCallStamp({ 'Next Steps': 'a\nb' }, {}, call());
  ok(winning['Next Steps'] === 'a\nb', 'the caller’s own fields survive the merge');
  eq(winning._lastCallId, 'granola:not_abc', 'and the stamp rides along in the same write');
}

// --- taking it off again -------------------------------------------------
{
  const opp = { _lastCallId: 'granola:not_abc', _lastCallAt: '2026-08-05T15:00:00.000Z', _lastCallName: 'Renewal call' };
  const patch = clearLastCallPatch(opp, 'granola:not_abc');
  eq(patch._lastCallId, '', 'untagging the stamped call blanks the stamp');
  eq(patch._lastCallAt, null, 'including its date');
  eq(clearLastCallPatch(opp, 'granola:other'), null,
    'untagging a different call says nothing about this one');
  eq(clearLastCallPatch(opp, ''), null, 'no recording id, nothing to clear');
  eq(clearLastCallPatch({}, 'granola:not_abc'), null, 'an opp with no stamp has nothing to clear');
}

// --- reading it back -----------------------------------------------------
{
  const opp = {
    _lastCallId: 'granola:not_abc',
    _lastCallName: 'Renewal call — Acme Corp',
    _lastCallAt: '2026-08-05T15:00:00.000Z',
    _lastCallUrl: 'https://notes.granola.ai/d/not_abc',
    _lastCallGist: 'Talked through the renewal.',
  };
  const read = lastCallOn(opp);
  eq(read.name, 'Renewal call — Acme Corp', 'the popup reads the name back');
  ok(read.atMs > 0, 'and a sortable timestamp');
  eq(lastCallOn({}), null, 'an opp that never had a call mapped reads as nothing to show');
  eq(lastCallOn(null), null, 'and so does no opp at all');
  // A stamp written before the id was carried still renders.
  ok(lastCallOn({ _lastCallName: 'Old stamp' }), 'a name alone is still worth showing');
}

// --- how long ago --------------------------------------------------------
{
  const now = Date.parse('2026-08-10T12:00:00.000Z');
  eq(describeCallAge(Date.parse('2026-08-10T09:00:00.000Z'), now), 'today', 'a call this morning is today');
  eq(describeCallAge(Date.parse('2026-08-09T12:00:00.000Z'), now), 'yesterday', 'a day back is yesterday');
  eq(describeCallAge(Date.parse('2026-08-05T12:00:00.000Z'), now), '5 days ago', 'further back counts days');
  eq(describeCallAge(Date.parse('2026-08-11T12:00:00.000Z'), now), 'tomorrow',
    'a call dated ahead reads as ahead, not as negative days');
  eq(describeCallAge(Date.parse('2026-08-13T12:00:00.000Z'), now), 'in 3 days', 'and further ahead too');
  eq(describeCallAge(null, now), '', 'no date, nothing said');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
