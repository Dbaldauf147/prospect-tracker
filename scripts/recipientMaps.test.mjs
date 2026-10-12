// The contact popup's To Also / CC maps (src/utils/recipientMaps.js).
//
// The rules worth pinning: a save sets one contact's entry on the LATEST
// settings, never on a copy the popup holds; a whole-map save that would
// drop other contacts is refused; and recovery only fills contacts that
// have nothing now, from the newest backup that has something.
//
// Run: node scripts/recipientMaps.test.mjs
import { setRecipients, recipientMapSaver, recoverRecipientMaps, rekeyOrphanRecipients, describeRecipientSearch } from '../src/utils/recipientMaps.js';

let passed = 0, failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n  expected ${e}\n  actual   ${a}`); }
}

check('set one entry, tidied and de-duplicated',
  setRecipients({ 'a@x.com': ['b@x.com'] }, 'c@x.com', [' d@x.com ', 'd@x.com', '']),
  { 'a@x.com': ['b@x.com'], 'c@x.com': ['d@x.com'] });
check('an empty list removes the entry', setRecipients({ 'a@x.com': ['b@x.com'] }, 'a@x.com', []), {});
check('no email changes nothing', setRecipients({ 'a@x.com': ['b'] }, '  ', ['z']), { 'a@x.com': ['b'] });

// A fake updateSettings holding "the latest settings".
function fakeStore(initial) {
  const store = { s: initial, writes: 0 };
  store.update = (fnOrObj) => {
    const out = typeof fnOrObj === 'function' ? fnOrObj(store.s) : fnOrObj;
    if (!out) return;
    store.writes += 1;
    store.s = { ...store.s, ...out };
  };
  return store;
}

const st = fakeStore({ ccMap: { 'a@x.com': ['b@x.com'], 'z@x.com': ['y@x.com'] } });
const saveCc = recipientMapSaver(st.update, 'ccMap');
saveCc('c@x.com', ['d@x.com']);
check('per-entry save keeps every other contact', st.s.ccMap, { 'a@x.com': ['b@x.com'], 'z@x.com': ['y@x.com'], 'c@x.com': ['d@x.com'] });
// The bug: a popup that opened with an empty copy saves "its" map.
saveCc({ 'c@x.com': ['d@x.com'] });
check('a whole-map save that drops other contacts is refused', [st.writes, Object.keys(st.s.ccMap).length], [1, 3]);
saveCc({ 'a@x.com': ['b@x.com'], 'c@x.com': ['d@x.com'] });
check('a whole-map save dropping just one contact still goes through', Object.keys(st.s.ccMap), ['a@x.com', 'c@x.com']);

const current = { ccMap: { 'keep@x.com': ['now@x.com'] }, toAlsoMap: {} };
const sources = [
  { label: 'newest', data: { ccMap: { 'Lost@x.com': ['new@x.com'], 'keep@x.com': ['old@x.com'] }, toAlsoMap: { 'lost@x.com': ['t@x.com'] } } },
  { label: 'older', data: { ccMap: { 'lost@x.com': ['older@x.com'], 'gone@x.com': ['g@x.com'] } } },
  { label: 'no maps', data: {} },
];
const rec = recoverRecipientMaps(current, sources);
check('recovery fills only contacts with nothing now, newest backup first', rec.patch, {
  toAlsoMap: { 'lost@x.com': ['t@x.com'] },
  ccMap: { 'keep@x.com': ['now@x.com'], 'Lost@x.com': ['new@x.com'], 'gone@x.com': ['g@x.com'] },
});
check('recovery says where each came from', rec.found.map(f => `${f.key}:${f.email}:${f.from}`),
  ['toAlsoMap:lost@x.com:newest', 'ccMap:Lost@x.com:newest', 'ccMap:gone@x.com:older']);
check('nothing lost, nothing to do', recoverRecipientMaps({ ccMap: { 'a@x.com': ['b'] } }, [{ data: { ccMap: { 'a@x.com': ['c'] } } }]).found, []);

// A contact whose email changed: its lists stayed under the old address.
const people = [{ id: '1', email: 'pat@new.com' }, { vid: 2, email: 'sam@x.com' }];
const orphaned = { ccMap: { 'PAT@old.com': ['boss@x.com'], 'sam@x.com': ['a@x.com'], 'nobody@x.com': ['z@x.com'] }, toAlsoMap: {} };
const rk = rekeyOrphanRecipients(orphaned, people, { 1: 'pat@old.com; pat@older.com' });
check('an old-email list moves to the current email; unknown ones stay put', rk.patch,
  { ccMap: { 'sam@x.com': ['a@x.com'], 'nobody@x.com': ['z@x.com'], 'pat@new.com': ['boss@x.com'] } });
check('the move is reported', rk.moved, [{ key: 'ccMap', from: 'PAT@old.com', to: 'pat@new.com' }]);
check('a current email that has its own list is not overwritten',
  rekeyOrphanRecipients({ ccMap: { 'pat@old.com': ['b'], 'pat@new.com': ['c'] } }, people, { 1: 'pat@old.com' }).moved, []);

const d = describeRecipientSearch(orphaned, [{ label: 'big', data: { ccMap: { a: ['1'], b: ['2'] } } }, { label: 'small', data: { ccMap: { a: ['1'] } } }], people);
check('the report counts lists now, the unmatched ones, and the most a backup held',
  [d.now.ccMap, d.most.ccMap, d.searched], [{ total: 3, unmatched: 2 }, { count: 2, label: 'big' }, 2]);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
