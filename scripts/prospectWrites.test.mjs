// Guard: only utils/firestoreSync may address the prospects collection.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/prospectWrites.test.mjs
//
// This exists because the duplicate fix already happened once and did not
// hold. companyDedupeKey and the duplicate collapse were built together,
// and addProspect was routed through them — but the Google Sheets
// importers reached past all of it, minting documents straight into the
// collection and deciding "do we already have this company?" with their
// own lowercased-name comparison. Every spelling variant became a second
// account, carrying none of the first one's id-keyed Target Account /
// divisions / HQ mappings, and the collapse could not merge what it had
// made because it disagreed about what counted as the same company.
//
// Nothing in the codebase stopped that, which is why it stayed broken and
// why a later reader would not notice. So: one module owns the path, and
// this fails the moment another one takes it. If you are here because
// this test is failing, the fix is to call addProspectsIfNew /
// readAllProspects rather than to widen ALLOWED.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../src/', import.meta.url).pathname;

// The only module allowed to name the collection, relative to src/.
const ALLOWED = new Set(['utils/firestoreSync.js']);

// Firestore path builders that reach the prospects collection — the
// shared one and the per-user one. Deliberately matches the CALL, not the
// bare word, so log lines and UI copy that merely say "prospects" are not
// flagged.
const PATTERNS = [
  { re: /collection\(\s*db\s*,\s*['"]prospects['"]/g, what: "collection(db, 'prospects')" },
  { re: /doc\(\s*db\s*,\s*['"]prospects['"]/g, what: "doc(db, 'prospects')" },
  { re: /['"]users['"]\s*,\s*[^,)]+,\s*['"]prospects['"]/g, what: "users/<uid>/prospects" },
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(name)) out.push(full);
  }
  return out;
}

let passed = 0, failed = 0;
const offenders = [];
let scanned = 0;

for (const file of walk(ROOT)) {
  const rel = file.slice(ROOT.length);
  scanned++;
  if (ALLOWED.has(rel)) continue;
  const src = readFileSync(file, 'utf8');
  for (const { re, what } of PATTERNS) {
    re.lastIndex = 0;
    if (re.test(src)) offenders.push(`${rel} uses ${what}`);
  }
}

if (offenders.length === 0) {
  passed++;
  console.log(`PASS  no module outside firestoreSync addresses the prospects collection (${scanned} files scanned)`);
} else {
  failed++;
  console.log('FAIL  a module outside firestoreSync addresses the prospects collection');
  for (const o of offenders) console.log(`        ${o}`);
  console.log('        Use addProspectsIfNew / readAllProspects so the "same company?" rule stays single.');
}

// The guard is only worth anything if it can actually see an offender.
{
  const probe = "const ref = doc(collection(db, 'prospects'));";
  const caught = PATTERNS.some(({ re }) => { re.lastIndex = 0; return re.test(probe); });
  if (caught) { passed++; console.log('PASS  the guard recognises a direct write'); }
  else { failed++; console.log('FAIL  the guard would not recognise a direct write'); }
}
{
  // ...and only useful if it stays quiet about prose.
  const prose = "console.log('Firestore returned', data.length, 'prospects');";
  const quiet = !PATTERNS.some(({ re }) => { re.lastIndex = 0; return re.test(prose); });
  if (quiet) { passed++; console.log('PASS  a log line mentioning prospects is not an offence'); }
  else { failed++; console.log('FAIL  the guard flags prose'); }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
