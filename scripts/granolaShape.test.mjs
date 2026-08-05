// Assertion tests for the sentence shown when a Granola sync ran clean
// and imported nothing. Plain Node — no test framework. Run:
//   node scripts/granolaShape.test.mjs
//
// The branches matter more than the prose: pointing at a renamed
// response envelope when the real problem is a renamed id field sends
// someone off debugging the wrong thing, and the whole reason this
// sentence exists is that the two used to be indistinguishable.
import { diagnoseEmptySync } from '../src/utils/granolaShape.js';

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
