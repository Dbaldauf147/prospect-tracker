// Guards src/firebase.js against shipping the verify skill's inert stub.
//
// The verify recipe swaps src/firebase.js for a stub whose
// auth.onAuthStateChanged never calls back, so a component can render
// headless. Committed by mistake (#2777), it left every user on "Still
// waiting on sign-in" forever. This reads the source rather than importing
// it: the real module initializes Firebase, which needs a browser and keys.
// Plain Node - no test framework. Run: node scripts/firebaseInit.test.mjs
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/firebase.js', import.meta.url), 'utf8');
let failed = 0;
function check(name, ok) {
  if (!ok) { failed += 1; console.error(`FAIL  ${name}`); } else console.log(`PASS  ${name}`);
}
check('initializes the Firebase app', /initializeApp\s*\(/.test(src));
check('auth comes from getAuth', /export const auth\s*=\s*getAuth\(/.test(src));
check('auth is not the inert verify stub', !/onAuthStateChanged:\s*\(\)\s*=>/.test(src));
check('db is not an empty object', !/export const db\s*=\s*\{\s*\}/.test(src));
console.log(`\n${failed ? `${failed} FAILED` : 'All passed'}`);
process.exit(failed ? 1 : 0);
