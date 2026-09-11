// Assertion tests for the keys that carry the user's WORK between machines.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/mirroredWorkKeys.test.mjs
//
// The failure this guards against is silent in both directions: a key left
// off the list stays stuck on one laptop with nothing to show for it, and a
// key on the list that no view actually writes through the mirrored writer
// looks synced while never pushing. So the list is checked against the
// codebase itself — every key must still be read or written somewhere, and
// every view that owns one must go through writeWorkKey rather than
// userLsSet / localStorage.setItem.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// localStorage doesn't exist in Node, and the module writes through it.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  key: (i) => [...store.keys()][i],
  get length() { return store.size; },
};

const { MIRRORED_WORK_KEYS, isMirroredWorkKey, writeWorkKey, readWorkKey, clearWorkKey } =
  await import('../src/utils/mirroredWorkKeys.js');

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${b}\n        got      ${a}`); }
}
const ok = (c, name, extra = '') => eq(!!c, true, `${name}${c ? '' : ` — ${extra}`}`);

function allSource() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|jsx)$/.test(p)) out.push([p, readFileSync(p, 'utf8')]);
    }
  };
  walk('src');
  return out;
}
const SOURCE = allSource();
const OWN = 'src/utils/mirroredWorkKeys.js';

// ── the list itself ──────────────────────────────────────────────────────

ok(MIRRORED_WORK_KEYS.length >= 28, 'the whole work list is registered', `${MIRRORED_WORK_KEYS.length}`);
eq(new Set(MIRRORED_WORK_KEYS).size, MIRRORED_WORK_KEYS.length, 'with no key listed twice');

// The areas the user asked for, each spot-checked by a key that must be there.
for (const [key, area] of [
  ['agents-ai-prompt', 'the agent prompts'],
  ['agents-bfo-overrides', 'the agent BFO tag decisions'],
  ['agents-ignored-meetings', 'the agent ignore lists'],
  ['opps2:todo', 'the Opps 2 to-do note'],
  ['utility-lookup:supplier-overrides', 'the Sites supplier decisions'],
  ['vibe-title-presets', 'the Vibe title presets'],
  ['progress:chart-views', 'the Progress saved chart views'],
  ['yoy-hidden-charts', 'the YOY hidden charts'],
  ['dedupe-dismissed', 'the dedupe dismissals'],
  ['target-accounts:blocked-names', 'the blocked account names'],
  ['bulk-contacts-company-rules', 'the bulk-add company rules'],
  ['clients-view:contract-services', 'the contract-services analysis'],
]) {
  ok(isMirroredWorkKey(key), `${area} follow the user`, key);
}

// View state deliberately left OUT: worth nothing on another machine, and
// syncing it would fight the user (a subtab that jumps, a panel that reopens).
for (const key of ['agents-active-subtab', 'contacts-view:active-subtab', 'opps2:todoCollapsed',
                   'master-site-list:show-filters', 'deals-sold-warning-collapsed']) {
  eq(isMirroredWorkKey(key), false, `view state is not mirrored: ${key}`);
}

// ── every key is still real ──────────────────────────────────────────────
//
// A renamed key would leave a registration mirroring a slot nothing reads.
const orphans = MIRRORED_WORK_KEYS.filter(k =>
  !SOURCE.some(([p, src]) => p !== OWN && src.includes(`'${k}'`)));
eq(orphans, [], 'every mirrored key is still used somewhere in the app');

// ── and every owner writes through the mirror ────────────────────────────
//
// The trap: a view keeps calling userLsSet / localStorage.setItem for a key
// on the list. The local copy updates, the cloud copy never hears, and the
// key looks synced while it isn't.
const KEY_CONSTANTS = {
  // key → the constant names views hold it under, so a write via the
  // constant is recognised as a write to that key.
  'agents-ai-prompt': ['AI_PROMPT_STORAGE_KEY'],
  'agents-bfo-overrides': ['OVERRIDE_STORAGE_KEY'],
  'agents-ignored-emails': ['IGNORED_EMAILS_STORAGE_KEY'],
  'agents-ignored-meetings': ['IGNORED_MEETINGS_STORAGE_KEY'],
  'agents-excluded-recipients': ['EXCLUDED_RECIPIENTS_STORAGE_KEY'],
  'agents-hide-activity-on-date': ['HIDE_ACTIVITY_ON_DATE_STORAGE_KEY'],
  'vibe-prospecting-history': ['HISTORY_KEY'],
  'vibe-title-presets': ['TITLE_PRESETS_KEY'],
  'progress:hidden-charts': ['HIDDEN_CHARTS_KEY'],
  'progress:chart-titles': ['CHART_TITLES_KEY'],
  'progress:chart-views': ['CHART_VIEWS_KEY'],
  'progress:chart-pins': ['CHART_PINS_KEY'],
  'yoy-hidden-charts': ['KEY'],
  'dedupe-dismissed': ['DISMISSED_KEY'],
  'target-accounts:blocked-names': ['BLOCKED_KEY'],
  'bulk-contacts-company-rules': ['COMPANY_RULES_KEY'],
  'clients-view:contract-services': ['STORAGE_KEY'],
};

const unmirroredWrites = [];
for (const [path, src] of SOURCE) {
  if (path === OWN) continue;
  for (const key of MIRRORED_WORK_KEYS) {
    const names = [`'${key}'`, ...(KEY_CONSTANTS[key] || [])];
    for (const name of names) {
      // A constant name only counts in the file that defines it as this key.
      if (!name.startsWith("'") && !src.includes(`${name} = '${key}'`)) continue;
      for (const writer of ['userLsSet(', 'localStorage.setItem(']) {
        if (src.includes(`${writer}${name},`)) unmirroredWrites.push(`${path}: ${writer}${name}`);
      }
    }
  }
}
eq(unmirroredWrites, [], 'no mirrored key is still written straight to local storage');

// ── the values people already have ───────────────────────────────────────
//
// Four of these areas used to write straight to localStorage, un-prefixed;
// they read through the user-scoped wrapper now so the mirror has a single
// slot to carry. That is only safe because the wrapper CLAIMS a legacy
// un-prefixed value the first time it's read — otherwise everyone's saved
// chart views, supplier decisions and dedupe dismissals would read as empty
// the moment this shipped.
const { setUserLsUserId } = await import('../src/utils/userLs.js');
setUserLsUserId('user-1');
store.clear();
store.set('progress:chart-views', '{"leads":"quarterly"}');
eq(readWorkKey('progress:chart-views'), '{"leads":"quarterly"}',
  'a value saved before this change is still found');
eq(store.get('u:user-1:progress:chart-views'), '{"leads":"quarterly"}',
  'and is claimed into this user\'s own slot');
eq(store.has('progress:chart-views'), false, 'leaving no un-prefixed copy behind');

// Two accounts on one browser keep their own.
setUserLsUserId('user-2');
eq(readWorkKey('progress:chart-views'), null, 'another account on the same browser sees its own (empty) slot');
setUserLsUserId('user-1');
eq(readWorkKey('progress:chart-views'), '{"leads":"quarterly"}', 'and the first account still has its value');

// ── the writer itself ────────────────────────────────────────────────────

writeWorkKey('dedupe-dismissed', '["a"]');
eq(readWorkKey('dedupe-dismissed'), '["a"]', 'a written value reads back');
clearWorkKey('dedupe-dismissed');
eq(readWorkKey('dedupe-dismissed'), null, 'and a cleared one is gone');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
