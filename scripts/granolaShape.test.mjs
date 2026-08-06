// Assertion tests for the sentence shown when a Granola sync ran clean
// and imported nothing. Plain Node — no test framework. Run:
//   node scripts/granolaShape.test.mjs
//
// The branches matter more than the prose: pointing at a renamed
// response envelope when the real problem is a renamed id field sends
// someone off debugging the wrong thing, and the whole reason this
// sentence exists is that the two used to be indistinguishable.
import { diagnoseEmptySync, describeMissingKey, describeGranolaConnection } from '../src/utils/granolaShape.js';

let passed = 0, failed = 0;
function ok(actual, name) {
  if (actual) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// Granola genuinely had nothing for this window. "Already up to date" is
// the right answer, so there is nothing to add.
{
  eq(diagnoseEmptySync({ bodyKeys: ['data'], rowsFrom: 'data', rowCount: 0, missingIds: 0 }), '',
    'a readable but empty page says nothing');
  eq(diagnoseEmptySync(null), '', 'no shape at all says nothing');
  eq(diagnoseEmptySync(undefined), '', 'a missing shape is not a throw');
}

// The note id renamed. Every row was dropped for having no key, which is
// the single most misleading failure — the sync "succeeds" every time.
{
  const msg = diagnoseEmptySync({ bodyKeys: ['data'], rowsFrom: 'data', rowCount: 12, missingIds: 12 });
  ok(msg.includes('12 notes'), 'the count of notes Granola actually sent is quoted');
  ok(/renamed the field/i.test(msg), 'and it points at a renamed id field');
  ok(!/response shape/i.test(msg), 'without also blaming the envelope, which was fine');

  eq(diagnoseEmptySync({ bodyKeys: [], rowsFrom: 'data', rowCount: 1, missingIds: 1 }).includes('1 note,'), true,
    'a single note is not pluralised');
}

// The envelope changed: nothing in the reply looked like a list of notes.
// Naming the keys it DID send is what makes the new one findable.
{
  const msg = diagnoseEmptySync({ bodyKeys: ['documents', 'total'], rowsFrom: null, rowCount: 0, missingIds: 0 });
  ok(/nothing in its reply looked like a list of notes/i.test(msg), 'it says the envelope was unreadable');
  ok(msg.includes('documents, total'), 'and names the keys that did arrive');

  const empty = diagnoseEmptySync({ bodyKeys: [], rowsFrom: null, rowCount: 0, missingIds: 0 });
  ok(/reply was empty/i.test(empty), 'a reply with no keys at all says so rather than listing nothing');
}

// A partial drop is worth reporting even though the sync did import
// something — some calls are silently missing, which is its own bug.
{
  const msg = diagnoseEmptySync({ bodyKeys: ['data'], rowsFrom: 'data', rowCount: 10, missingIds: 3 });
  ok(msg.includes('3 of 10'), 'a partial drop reports how many of how many');
  ok(!/renamed the field/i.test(msg), 'and does not claim the id field was renamed outright');
}

// Precedence: an unreadable envelope and unkeyable rows cannot both be
// true, but a shape that claims both must lead with the rows — they are
// the concrete evidence, and the envelope key is a guess beside them.
{
  const msg = diagnoseEmptySync({ bodyKeys: ['x'], rowsFrom: null, rowCount: 4, missingIds: 4 });
  ok(/renamed the field/i.test(msg), 'unkeyable rows win over an unrecognised envelope');
}

// ---- the connection line -----------------------------------------------
//
// Four states that used to render identically as "0 meetings". The
// branch matters far more than the wording: telling someone their key
// was rejected when the deployment has no key at all sends them to
// re-issue a key that would never have been read.

// Nothing asked yet: say nothing, rather than implying a verdict.
eq(describeGranolaConnection(null), null, 'no answer yet is not a state to report');
ok(describeGranolaConnection(null, { checking: true }), 'but a check in flight is worth saying');
eq(
  describeGranolaConnection(null, { checking: true }).retry, false,
  'a check already running does not offer to run another',
);

// No key. The commonest real state, and the only one a redeploy fixes.
{
  const line = describeGranolaConnection({
    configured: false, ok: false,
    hint: { environment: 'production', commit: 'abc1234', granolaVars: [] },
  });
  ok(/no API key/i.test(line.headline), 'a missing key says so in the headline');
  ok(/production/.test(line.detail), 'and the detail names the deployment that answered');
  ok(/GRANOLA_API_KEY/.test(line.detail), 'and the variable to set');
  eq(line.retry, false, 'checking again cannot write a variable, so it is not offered');
}

// A key that exists but is empty is a re-paste, not a re-scope: the
// hint's wording has to survive being embedded here.
{
  const line = describeGranolaConnection({
    configured: false, ok: false,
    hint: { environment: 'production', commit: '', granolaVars: ['GRANOLA_API_KEY'] },
  });
  ok(/is empty/i.test(line.detail), 'an empty key keeps its own diagnosis');
}

// A key Granola refuses. Different fix, different colour, and the retry
// is worth offering because a 429 clears on its own.
{
  const line = describeGranolaConnection({ configured: true, ok: false, error: 'Granola rejected the API key.' });
  ok(/rejected/i.test(line.headline), 'a refused key is not a missing one');
  eq(line.detail, 'Granola rejected the API key.', "Granola's own words are passed through");
  eq(line.retry, true, 'and asking again is worth offering');
}

// Refused with nothing said. The line still has to mean something.
{
  const line = describeGranolaConnection({ configured: true, ok: false, error: '' });
  ok(line.detail.length > 0, 'a silent refusal still gets a sentence');
}

// A live key. Worth stating outright: it rules the connection out as the
// reason the panel is empty, which is the whole question being asked.
{
  const line = describeGranolaConnection({ configured: true, ok: true, error: '' });
  ok(/connected/i.test(line.headline), 'a working connection says so');
  eq(line.retry, false, 'nothing to retry when it works');
  ok(/summaris/i.test(line.detail), 'and it warns that a just-ended meeting may not be here yet');
}

// A timed-out probe learned nothing, and must not be reported as either
// a missing key or a refused one.
{
  const line = describeGranolaConnection({ configured: true, ok: false, timedOut: true, error: 'took too long' });
  ok(/couldn't check/i.test(line.headline), 'a timeout is an unknown, not a verdict');
  ok(!/rejected/i.test(line.headline), 'and specifically not a rejection');
  eq(line.retry, true, 'a timeout is exactly the case worth retrying');
}

// timedOut wins even when the payload also looks unconfigured, since the
// probe never got far enough to know.
{
  const line = describeGranolaConnection({ configured: false, ok: false, timedOut: true });
  ok(/couldn't check/i.test(line.headline), 'an unknown outranks a guess at the cause');
}

// Every state paints itself: the panel spreads these straight onto style.
for (const status of [
  { configured: false, ok: false },
  { configured: true, ok: false, error: 'x' },
  { configured: true, ok: true },
  { configured: true, ok: false, timedOut: true },
]) {
  const line = describeGranolaConnection(status);
  ok(line.background && line.color && line.border, `every state carries its own colours (${JSON.stringify(status)})`);
}

// describeMissingKey survived the move with its branches intact.
ok(
  /GRANOLA_API_BASE is an optional override/.test(
    describeMissingKey({ environment: 'production', granolaVars: ['GRANOLA_API_BASE'] }),
  ),
  'the key-in-the-wrong-variable case still names the mistake',
);
eq(describeMissingKey(null), '', 'no hint, nothing to say');


console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
