// Assertion tests for what a failed prospects load tells the reader.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/prospectsLoadError.test.mjs
//
// The bug behind this: subscribeToProspects logged a failed listener and
// returned, so `loading` stayed true and the app sat on "Loading
// prospects..." forever — no roster, no error, and nothing on screen for
// the person looking at it to report. The load now ends on the failure
// and shows it, and which sentence it shows matters: a permission-denied
// and an unreachable database need completely different next steps from
// the reader, and Firestore's own text says neither in plain words.
import { explainProspectsLoadError, PROSPECTS_LOAD_ERROR_LINES as L } from '../src/utils/prospectsLoadError.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  if (actual === expected) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`); }
}

// ── The two failures worth naming ──────────────────────────────────────
{
  // Firestore's own wording, verbatim — the string the rules produce.
  eq(explainProspectsLoadError('Missing or insufficient permissions.'), L.PERMISSION,
    'a rules rejection reads as an account problem');
  eq(explainProspectsLoadError('FirebaseError: [code=permission-denied]: Missing or insufficient permissions.'), L.PERMISSION,
    'the same wrapped in a FirebaseError');
  eq(explainProspectsLoadError('Failed to get document because the client is offline.'), L.OFFLINE,
    'an offline client reads as a connection problem');
  eq(explainProspectsLoadError('[code=unavailable]: The service is currently unavailable.'), L.OFFLINE,
    'an unavailable backend reads as a connection problem');
  eq(explainProspectsLoadError('TypeError: Failed to fetch'), L.OFFLINE,
    'a blocked request — the extension case — reads as a connection problem');
}

// ── Everything else falls back rather than guessing ─────────────────────
{
  eq(explainProspectsLoadError('[code=internal]: an internal error occurred'), L.UNKNOWN,
    'an unrecognised error gets the generic line');
  // The raw message is always printed under the sentence, so an empty or
  // missing one must still produce a sentence rather than blank space.
  eq(explainProspectsLoadError(''), L.UNKNOWN, 'an empty message still gets a sentence');
  eq(explainProspectsLoadError(null), L.UNKNOWN, 'a null message still gets a sentence');
  eq(explainProspectsLoadError(undefined), L.UNKNOWN, 'an undefined message still gets a sentence');
  // Case must not decide the answer: the SDK varies it across codepaths.
  eq(explainProspectsLoadError('MISSING OR INSUFFICIENT PERMISSIONS'), L.PERMISSION,
    'matching ignores case');
}

// ── The three lines stay distinct ──────────────────────────────────────
{
  // A copy-paste that collapsed two of them would make the panel useless
  // while every test above still passed.
  eq(new Set([L.PERMISSION, L.OFFLINE, L.UNKNOWN]).size, 3, 'the three explanations differ');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
