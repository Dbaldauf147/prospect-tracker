// Assertion tests for the call summariser's normalisation layer. Plain
// Node — no test framework (the project has none). Run:
//   node scripts/callSummary.test.mjs
//
// The route's own Claude call can't be tested here, and its prompt is
// prose. What CAN go wrong deterministically is everything around it:
// the model returning a meeting type outside the vocabulary, an owner
// the page expects as null arriving as "", a long transcript clipped
// from the wrong end. Those are what this pins.
import {
  clipTranscript, normalizeSummary, attendeeContext, MEETING_TYPES,
} from '../api/call-summary.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
function ok(value, name) { eq(!!value, true, name); }

// --- meeting type: a closed vocabulary ---------------------------------
// The page renders this as a label. A type outside the set would show as
// a category that doesn't exist, so it has to become '' — which the page
// renders as no label at all.
{
  for (const type of MEETING_TYPES) {
    eq(normalizeSummary({ meeting_type: type }).meetingType, type, `"${type}" is a valid meeting type`);
  }
  eq(normalizeSummary({ meeting_type: 'Sales' }).meetingType, 'sales', 'the meeting type is lower-cased');
  eq(normalizeSummary({ meeting_type: '  internal  ' }).meetingType, 'internal', 'surrounding whitespace is trimmed');
  eq(normalizeSummary({ meeting_type: 'prospect' }).meetingType, '', 'a near-miss type is dropped rather than stored');
  eq(normalizeSummary({ meeting_type: '' }).meetingType, '', 'an explicitly unclear type stays empty');
  eq(normalizeSummary({}).meetingType, '', 'an absent type is empty');
  eq(normalizeSummary({ meeting_type: null }).meetingType, '', 'a null type is empty');
}

// --- follow-ups: unstated owner and due are null -----------------------
// The page checks these before rendering, and the push script writes the
// same shape. "" would render an empty owner suffix.
{
  const out = normalizeSummary({
    follow_ups: [
      { text: 'Send the revised quote', owner: 'Dan', due: 'Friday' },
      { text: 'Confirm the site list', owner: '', due: null },
      { text: '   ' },
      { owner: 'Dan' },
      'a bare string is not an object',
    ],
  });
  eq(out.followUps.length, 2, 'text-less and non-object follow-ups are dropped');
  eq(out.followUps[0], { text: 'Send the revised quote', owner: 'Dan', due: 'Friday' }, 'a full follow-up survives');
  eq(out.followUps[1], { text: 'Confirm the site list', owner: null, due: null }, 'empty owner and due become null');
}

// --- sentiment ---------------------------------------------------------
{
  eq(normalizeSummary({ sentiment: 'Cautious' }).sentiment, 'cautious', 'sentiment is lower-cased');
  eq(normalizeSummary({ sentiment: 'thrilled' }).sentiment, '', 'an off-vocabulary sentiment is dropped');
  eq(normalizeSummary({}).sentiment, '', 'an absent sentiment is empty');
}

// --- lists are bounded and cleaned -------------------------------------
{
  const many = Array.from({ length: 30 }, (_, i) => `item ${i}`);
  const out = normalizeSummary({ key_items: many, risks: many });
  eq(out.keyItems.length, 12, 'key items are capped at 12');
  eq(out.risks.length, 8, 'risks are capped at 8');

  const messy = normalizeSummary({ key_items: ['  spaced  ', '', null, { text: 'from an object' }, 42] });
  eq(messy.keyItems, ['spaced', 'from an object'], 'blank, null, and non-text items are dropped');

  eq(normalizeSummary({ key_items: 'not an array' }).keyItems, [], 'a non-array key_items is empty, not a crash');
  eq(normalizeSummary({ follow_ups: 'not an array' }).followUps, [], 'a non-array follow_ups is empty, not a crash');
}

// --- a garbled response still produces a usable object -----------------
// The route's contract with the page is that these fields always exist.
{
  const out = normalizeSummary(null);
  eq(out, {
    meetingType: '', summary: '', keyItems: [], followUps: [],
    nextSteps: '', sentiment: '', risks: [],
  }, 'a null parse yields the empty shape rather than throwing');
}

// --- clipping keeps both ends --------------------------------------
// The tail of a long call is where the commitments are, so an
// over-length transcript must not simply be truncated at the front.
{
  const short = 'A: hello there, this is a normal length transcript.';
  eq(clipTranscript(short), { text: short, clipped: false }, 'a short transcript is untouched');
  eq(clipTranscript('').clipped, false, 'an empty transcript is not marked clipped');

  const head = 'OPENING-MARKER ';
  const tail = ' CLOSING-MARKER';
  const long = head + 'x'.repeat(200000) + tail;
  const out = clipTranscript(long);

  ok(out.clipped, 'an over-length transcript is marked clipped');
  ok(out.text.includes('OPENING-MARKER'), 'the opening survives clipping');
  ok(out.text.includes('CLOSING-MARKER'), 'the close survives clipping — that is where commitments land');
  ok(out.text.includes('middle of the call omitted'), 'the gap is marked in the text the model reads');
  ok(out.text.length < long.length, 'the clipped transcript is shorter than the original');
}

// --- attendee context: domains are the signal --------------------------
// This line is what lets the model tell an internal meeting from a
// client one; machine speaker labels ("A"/"B") carry no such signal.
{
  eq(attendeeContext([], null), '', 'no attendees produces no context line');
  eq(attendeeContext(null, null), '', 'a null attendee list produces no context line');
  eq(attendeeContext([{ name: 'No Email' }], null), '', 'attendees without emails produce no context line');

  const internal = attendeeContext(
    [{ email: 'me@schneider.com' }, { email: 'colleague@schneider.com' }],
    { email: 'me@schneider.com' },
  );
  ok(internal.includes("everyone shares the organiser's domain"), 'an all-colleague meeting is called out as internal');
  ok(!internal.includes('external'), 'an internal meeting mentions no external domains');

  const external = attendeeContext(
    [{ email: 'me@schneider.com' }, { email: 'Dana@Acme.com' }],
    { email: 'me@schneider.com' },
  );
  ok(external.includes('1 external domain: acme.com'), 'an external domain is named and counted');
  ok(external.includes('the organiser is @schneider.com'), "the organiser's own domain is stated");
  ok(external.includes('acme.com'), 'domains are lower-cased so casing does not split them');

  const twoSided = attendeeContext(
    [{ email: 'a@acme.com' }, { email: 'b@beta.io' }, { email: 'me@schneider.com' }],
    { email: 'me@schneider.com' },
  );
  ok(twoSided.includes('2 external domains'), 'multiple external domains are pluralised and counted');

  // No owner: everything reads as external, which is the safe default —
  // it makes the model justify calling a meeting internal.
  const noOwner = attendeeContext([{ email: 'a@acme.com' }], null);
  ok(noOwner.includes('1 external domain'), 'with no known organiser, attendees count as external');
  ok(!noOwner.includes('the organiser is'), 'no organiser domain is claimed when none is known');

  // Duplicate addresses on the same domain must not inflate the count —
  // a six-person meeting from one company is still one external side.
  const deduped = attendeeContext(
    [{ email: 'a@acme.com' }, { email: 'b@acme.com' }, { email: 'c@ACME.com' }],
    { email: 'me@schneider.com' },
  );
  ok(deduped.includes('1 external domain:'), 'several people from one company count as one domain');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
