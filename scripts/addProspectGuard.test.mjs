// Assertion tests for the "does this account already exist?" check that
// runs before one is created. Plain Node — no test framework (the
// project has none). Run:
//   node scripts/addProspectGuard.test.mjs
//
// Both races are timing-dependent and effectively impossible to provoke
// reliably against Firestore, which is exactly why they survived: the
// check read the live subscription's array, and that array is empty
// before the first snapshot and stale for a moment after every write.
// The dependencies are injected so the timing can be driven here.
import { createAddProspectGuard } from '../src/utils/addProspectGuard.js';
// The real key the app injects, so these exercise the wiring as shipped
// rather than a stand-in that happens to be stricter.
import { companyDedupeKey } from '../src/utils/companyKey.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const keyOf = (p) => companyDedupeKey(p?.company);

// A harness that models the real thing: writes land in `store`, but the
// roster only sees them when the test says a snapshot arrived.
function harness({ roster = [], ready = true, readRoster } = {}) {
  const state = { roster: [...roster], created: [], nextId: 1, reads: 0 };
  let resolveReady;
  const readyPromise = ready ? Promise.resolve() : new Promise(r => { resolveReady = r; });
  const guard = createAddProspectGuard({
    keyOf,
    getRoster: () => state.roster,
    whenRosterReady: () => readyPromise,
    readRoster: readRoster ? (...a) => { state.reads++; return readRoster(...a); } : async () => state.roster,
    create: async (record) => {
      const id = `new${state.nextId++}`;
      state.created.push({ id, ...record });
      return id;
    },
  });
  return {
    guard, state,
    snapshot(rows) { state.roster = rows ?? [...state.roster, ...state.created.filter(c => !state.roster.some(r => r.id === c.id))]; guard.noteRoster(state.roster); },
    land() { resolveReady?.(); },
  };
}

// ── Race 1: adding before the roster has loaded ────────────────────────
{
  // The subscription has not delivered. The old check saw [] and created
  // a duplicate of a company that was already there.
  const h = harness({ roster: [], ready: false });
  const p = h.guard.add({ company: 'Prologis' });
  let settled = false;
  p.then(() => { settled = true; });
  await new Promise(r => setTimeout(r, 10));
  eq(settled, false, 'the add waits instead of deciding against an empty roster');

  // The first snapshot lands, and it turns out we already had it.
  h.state.roster = [{ id: 'doc1', company: 'Prologis' }];
  h.land();
  eq(await p, 'doc1', 'once the roster arrives the existing record is returned');
  eq(h.state.created.length, 0, 'and nothing was created');
}

{
  // Same wait, but the company really is new.
  const h = harness({ roster: [], ready: false });
  const p = h.guard.add({ company: 'Blackstone' });
  h.state.roster = [{ id: 'doc1', company: 'Prologis' }];
  h.land();
  eq(await p, 'new1', 'a genuinely new company is still created');
  eq(h.state.created.length, 1, 'exactly once');
}

{
  // The subscription never delivers. Falling back to an authoritative
  // read beats guessing from an empty array.
  const guard = createAddProspectGuard({
    keyOf,
    getRoster: () => [],
    whenRosterReady: () => Promise.reject(new Error('timed out')),
    readRoster: async () => [{ id: 'live1', company: 'Prologis' }],
    create: async () => 'should-not-happen',
  });
  eq(await guard.add({ company: 'Prologis' }), 'live1',
    'when the subscription never lands, an authoritative read still finds the record');
}

// ── Race 2: two adds for the same company before the write echoes ──────
{
  // The bulk "add to Table View" loops call add once per company. Two
  // spellings of one company in one list used to create two accounts,
  // because neither could see the other's write yet.
  const h = harness({ roster: [] });
  const first = await h.guard.add({ company: 'HIG Capital' });
  // No snapshot yet — the roster still does not know about it.
  const second = await h.guard.add({ company: 'HIG Capital' });
  eq(second, first, 'the second add returns the record the first one made');
  eq(h.state.created.length, 1, 'rather than creating a second account');
}

{
  // The same thing without awaiting in between — genuinely concurrent.
  const h = harness({ roster: [] });
  const [a, b, c] = await Promise.all([
    h.guard.add({ company: 'Ventas' }),
    h.guard.add({ company: 'Ventas' }),
    h.guard.add({ company: 'Ventas' }),
  ]);
  eq([a === b, b === c], [true, true], 'three concurrent adds agree on one id');
  eq(h.state.created.length, 1, 'and only one record exists');
}

{
  // Once the roster confirms it, the guard stops remembering it.
  const h = harness({ roster: [] });
  await h.guard.add({ company: 'Ventas' });
  eq(h.guard.pendingKeys().length, 1, 'an unconfirmed creation is remembered');
  h.snapshot();
  eq(h.guard.pendingKeys(), [], 'and forgotten once the roster carries it');
  const again = await h.guard.add({ company: 'Ventas' });
  eq(again, 'new1', 'a later add for it still finds the record, now from the roster');
  eq(h.state.created.length, 1, 'still one record');
}

// ── Failures and edge cases ────────────────────────────────────────────
{
  // A failed write must not leave the key claimed, or the retry would
  // return the same rejection forever instead of writing.
  let attempt = 0;
  const guard = createAddProspectGuard({
    keyOf,
    getRoster: () => [],
    whenRosterReady: async () => {},
    readRoster: async () => [],
    create: async () => { attempt++; if (attempt === 1) throw new Error('offline'); return 'ok1'; },
  });
  let threw = false;
  try { await guard.add({ company: 'Ventas' }); } catch { threw = true; }
  eq(threw, true, 'a failed write is reported, not swallowed');
  eq(guard.pendingKeys(), [], 'and does not stay claimed');
  eq(await guard.add({ company: 'Ventas' }), 'ok1', 'so a retry actually writes');
}

{
  const h = harness({ roster: [{ id: 'doc1', company: 'HIG Capital, LLC' }] });
  eq(await h.guard.add({ company: 'H.I.G. Capital' }), 'doc1',
    'matching uses the shared key, so a spelling variant is not a new account');
}

{
  // No company name: nothing to compare, so it cannot be deduped. Two of
  // them stay two, which is the same thing the old check did.
  const h = harness({ roster: [] });
  await h.guard.add({ company: '' });
  await h.guard.add({});
  eq(h.state.created.length, 2, 'unnamed records are created as asked');
  eq(h.guard.pendingKeys(), [], 'and never claim a key');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
