// Assertion tests for the recap write-back. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/pushGranolaRecap.test.mjs
//
// The parts under test are the pure ones: recap JSON -> the document
// written to callRecordings. That mapping is where a mistake is
// expensive and invisible — a wrong record id writes a second document
// the page shows as a duplicate call, and a patch that includes a field
// the recap didn't mention blanks data a Granola sync already stored.
import {
  recordIdFor, patchFromRecap, documentFor, notesBlock,
} from './pushGranolaRecap.mjs';
import {
  docIdFor, emptyRecord, summaryForOpp, mergeIntoNotes, oppLabel,
} from '../src/utils/callRecordShape.js';
// The push script keeps its own copy of the meeting-type vocabulary (it
// must not import an API route, which pulls in auth and rate limiting).
// Importing the route's list HERE is what stops the two from drifting.
import { MEETING_TYPES } from '../api/call-summary.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
function ok(value, name) { eq(!!value, true, name); }

const NOW = '2026-08-05T12:00:00.000Z';

// --- record id: one Granola note is always one record ------------------
// The page stores Granola calls under "granola:<noteId>" (the prefix
// api/granola-calls.js applies). If this script derived a different id,
// pushing a recap for a note that was already synced would create a
// SECOND record rather than updating the synced one.
{
  eq(recordIdFor('not_abc'), 'granola:not_abc', 'a bare note id gets the granola: prefix');
  eq(recordIdFor('granola:not_abc'), 'granola:not_abc', 'an already-prefixed id is left alone');
  eq(recordIdFor('  not_abc  '), 'granola:not_abc', 'surrounding whitespace is trimmed');
  eq(docIdFor(recordIdFor('not_abc')), 'granola%3Anot_abc', 'the document id is the encoded record id');
}

// --- patch: only what the recap actually carries ------------------------
{
  const patch = patchFromRecap({
    noteId: 'granola:not_abc',
    name: 'Acme — pricing review',
    recordedAt: '2026-08-04T15:00:00.000Z',
    company: 'Acme Corp',
    oppId: '42',
    summary: 'Walked through option B pricing.',
  }, NOW);

  eq(patch.source, 'granola', 'source marks the record as a Granola call');
  eq(patch.granolaNoteId, 'not_abc', 'the stored note id has no granola: prefix');
  eq(patch.summarizedAt, NOW, 'the summary is stamped');
  eq('transcript' in patch, false, 'no transcript in the recap means no transcript field');
  eq('granolaSummary' in patch, false, "an absent granolaSummary does not blank Granola's own notes");
  eq('attendees' in patch, false, 'absent attendees are left as stored');
}

// A recap that DOES carry a transcript brings the transcript fields with
// it, so transcript search on the page works on a pushed recap too.
{
  const patch = patchFromRecap({
    noteId: 'not_abc', summary: 'x', transcript: 'A: hello\nB: hi',
  }, NOW);
  eq(patch.transcript, 'A: hello\nB: hi', 'the transcript is stored');
  eq(patch.transcriptStatus, 'completed', 'a stored transcript is marked complete');
  eq(patch.transcribedAt, NOW, 'the transcript is stamped');
}

// --- follow-ups: never invent an owner or a due date -------------------
// The recap format says owner/due are omitted when nobody stated them.
// They must land as null, not "", because that is what /api/call-summary
// writes and what the page's conditional rendering checks.
{
  const patch = patchFromRecap({
    noteId: 'not_abc',
    summary: 'x',
    followUps: [
      { text: 'Send the revised quote', owner: 'Dan', due: 'Friday' },
      { text: 'Confirm the site list' },
      { text: '  ', owner: 'Nobody' },
      'Chase the utility data',
      { owner: 'Dan' },
    ],
  }, NOW);

  eq(patch.followUps.length, 3, 'empty and text-less follow-ups are dropped');
  eq(patch.followUps[0], { text: 'Send the revised quote', owner: 'Dan', due: 'Friday' }, 'a full follow-up survives intact');
  eq(patch.followUps[1], { text: 'Confirm the site list', owner: null, due: null }, 'unstated owner and due are null, not empty strings');
  eq(patch.followUps[2], { text: 'Chase the utility data', owner: null, due: null }, 'a bare string becomes an unowned follow-up');
}

// --- sentiment: a closed vocabulary ------------------------------------
// The page styles the sentiment chip off these four values, so anything
// else has to become '' rather than render as an unknown label.
{
  eq(patchFromRecap({ noteId: 'n', summary: 'x', sentiment: 'Cautious' }, NOW).sentiment, 'cautious', 'sentiment is lower-cased');
  eq(patchFromRecap({ noteId: 'n', summary: 'x', sentiment: 'thrilled' }, NOW).sentiment, '', 'an off-vocabulary sentiment is dropped');
  eq(patchFromRecap({ noteId: 'n', summary: 'x' }, NOW).sentiment, '', 'an absent sentiment is empty');
}

// --- meeting type: the same vocabulary as the app's summariser ---------
// A recap filed here and one produced by the page's Summarize button end
// up in the same field on the same record, so they must agree on what
// the valid values are. If these drift, the page renders a label for a
// category it does not have.
{
  for (const type of MEETING_TYPES) {
    eq(patchFromRecap({ noteId: 'n', summary: 'x', meetingType: type }, NOW).meetingType, type, `"${type}" survives the push`);
  }
  eq(patchFromRecap({ noteId: 'n', summary: 'x', meetingType: 'Client' }, NOW).meetingType, 'client', 'the meeting type is lower-cased');
  eq(patchFromRecap({ noteId: 'n', summary: 'x', meetingType: 'prospect' }, NOW).meetingType, '', 'an off-vocabulary type is dropped');
  eq(patchFromRecap({ noteId: 'n', summary: 'x' }, NOW).meetingType, '', 'an absent type is empty');
}

// --- lists are bounded --------------------------------------------------
{
  const many = Array.from({ length: 30 }, (_, i) => `item ${i}`);
  const patch = patchFromRecap({ noteId: 'n', summary: 'x', keyItems: many, risks: many }, NOW);
  eq(patch.keyItems.length, 12, 'key items are capped at 12');
  eq(patch.risks.length, 8, 'risks are capped at 8');
}

// --- document: a re-push updates rather than replaces ------------------
// The push must not destroy what a Granola sync stored (attendees, the
// transcript, Granola's own notes) or re-date a record it is updating.
{
  const recordId = recordIdFor('not_abc');
  const current = {
    ...emptyRecord(recordId),
    createdAt: '2026-07-01T00:00:00.000Z',
    granolaSummary: "Granola's own notes",
    transcript: 'A: hello',
    attendees: [{ name: 'Dana Reid', email: 'dana@acme.com' }],
    prospectId: 'p1',
  };
  const patch = patchFromRecap({ noteId: 'not_abc', summary: 'Our recap.' }, NOW);
  const next = documentFor(recordId, current, patch, NOW);

  eq(next.createdAt, '2026-07-01T00:00:00.000Z', 'createdAt is preserved across a re-push');
  eq(next.updatedAt, NOW, 'updatedAt moves to now');
  eq(next.granolaSummary, "Granola's own notes", "Granola's own notes survive the push");
  eq(next.transcript, 'A: hello', 'a previously synced transcript survives the push');
  eq(next.attendees.length, 1, 'synced attendees survive the push');
  eq(next.summary, 'Our recap.', 'the summary is the one just written');
  ok(next.prospectId === '', 'an untagged recap clears a stale prospect tag rather than half-tagging');

  // Every field the page reads must exist on the document, even unset:
  // the store writes the full record every time so a document never
  // carries a stale field from an older version of the page.
  const missing = Object.keys(emptyRecord(recordId)).filter(k => !(k in next));
  eq(missing, [], 'the document carries every field of the record shape');
}

// A first push, with nothing stored, creates the record.
{
  const recordId = recordIdFor('not_new');
  const next = documentFor(recordId, null, patchFromRecap({ noteId: 'not_new', summary: 'x' }, NOW), NOW);
  eq(next.createdAt, NOW, 'a first push stamps createdAt');
  eq(next.id, 'granola:not_new', 'the record carries its id');
}

// --- an oversized recap still saves its summary ------------------------
// withinDocBudget clips the transcript rather than failing the write.
{
  const recordId = recordIdFor('not_big');
  const huge = 'x'.repeat(1_200_000);
  const next = documentFor(recordId, null, patchFromRecap({ noteId: 'not_big', summary: 'Kept.', transcript: huge }, NOW), NOW);
  eq(next.summary, 'Kept.', 'the summary survives a transcript too big to store');
  ok(next.transcript.length < huge.length, 'the transcript is clipped to fit');
  ok(JSON.stringify(next).length < 1_000_000, 'the document fits under the Firestore cap');
}

// --- the Notes block: re-pushing replaces its own block ----------------
// This is the text a user pastes (or the page pushes) into an opp's
// Notes. The marker is what keeps a second push from stacking a
// duplicate block underneath the first.
{
  const recap = {
    noteId: 'not_abc',
    recordedAt: '2026-08-04T15:00:00.000Z',
    summary: 'Walked through option B pricing.',
    keyItems: ['Budget signed off at $400k'],
    followUps: [{ text: 'Send the revised quote', owner: 'Dan', due: 'Friday' }],
  };
  const recordId = recordIdFor(recap.noteId);
  const pasteable = notesBlock(recap, NOW);

  ok(pasteable.startsWith('Call summary: 8/4/2026'), 'the block is dated from the meeting, not from now');
  ok(pasteable.includes('• Send the revised quote: Dan (Friday)'), 'a follow-up carries its owner and due date');
  ok(pasteable.endsWith('[call:granola:not_abc]'), 'the pasteable block ends with its marker');
  eq(pasteable.split('[call:granola:not_abc]').length - 1, 1, 'the pasteable block is marked exactly once');

  // The app's own push path builds the block WITHOUT the marker and lets
  // mergeIntoNotes stamp it. Feeding it a pre-marked block would leave
  // two markers, which is why notesBlock is the paste path only.
  const unmarked = summaryForOpp(patchFromRecap(recap, NOW));
  ok(!unmarked.includes('[call:'), 'the block handed to mergeIntoNotes carries no marker');

  const existing = 'Met them at the trade show in June.';
  const first = mergeIntoNotes(existing, unmarked, recordId);
  ok(first.includes(existing), "the user's own notes are kept");

  const revised = unmarked.replace('option B', 'option C');
  const second = mergeIntoNotes(first, revised, recordId);
  eq(second.split('[call:granola:not_abc]').length - 1, 1, 'a re-push leaves one block, not two');
  ok(second.includes('option C'), 'the re-pushed block is the new one');
  ok(!second.includes('option B'), 'the superseded block is gone');
  ok(second.includes(existing), "the user's own notes survive a re-push");
}

// The interop that makes the paste path safe: a block pasted by hand is
// recognised and REPLACED by a later push from the Call Recordings page,
// rather than the deal ending up with the same call written twice.
{
  const recap = { noteId: 'not_abc', recordedAt: '2026-08-04T15:00:00.000Z', summary: 'Pasted by hand.' };
  const recordId = recordIdFor(recap.noteId);

  const notes = `Met them at the trade show in June.\n\n${notesBlock(recap, NOW)}`;
  const afterAppPush = mergeIntoNotes(
    notes,
    summaryForOpp(patchFromRecap({ ...recap, summary: 'Pushed from the app.' }, NOW)),
    recordId,
  );

  eq(afterAppPush.split('[call:granola:not_abc]').length - 1, 1, 'an app push replaces the hand-pasted block');
  ok(afterAppPush.includes('Pushed from the app.'), 'the app push is what remains');
  ok(!afterAppPush.includes('Pasted by hand.'), 'the hand-pasted copy is superseded, not duplicated');
  ok(afterAppPush.includes('trade show'), "the user's own notes survive either way");
}

// --- opp labels ---------------------------------------------------------
// The label is what the plugin shows when asking which deal a meeting
// belongs to, so it has to stay readable when fields are missing.
{
  eq(oppLabel({ Account: 'Acme Corp', Stage: 'Quoting', Scope: 'Lighting' }), 'Acme Corp · Quoting · Lighting', 'a full opp reads account, stage, scope');
  eq(oppLabel({ Account: 'Acme Corp' }), 'Acme Corp', 'an opp with no stage or scope is just the account');
  eq(oppLabel({ Stage: 'Quoting' }), 'Untitled opp · Quoting', 'a missing account does not produce a leading separator');
  eq(oppLabel(null), '', 'no opp is an empty label');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
