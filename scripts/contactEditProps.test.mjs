// When the contact popup has to take new props.
//
// The popup is memoised, and the comparator used to look at the contact,
// the rosters and a handful of callbacks - not at the saved maps
// themselves. That is not a rendering detail: the popup rewrites those maps
// WHOLE. It copies the one it was handed, puts this contact's entry in the
// copy, and saves the copy. A map it was allowed to keep a stale version of
// is therefore a map from before everything saved since it opened, and
// saving it puts all of that back - the CC address added a minute ago gone,
// the manager unticked back on the list.
//
// Run: node scripts/contactEditProps.test.mjs
import { contactEditPropsEqual, SAVED_STORE_PROPS } from '../src/utils/contactEditProps.js';

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

const noop = () => {};
// One set of props, as the company popup hands them over. Built once and
// spread, because the comparator checks some of these by identity: the
// vocabulary and the callbacks it names are steady between renders unless
// the thing behind them actually moved, and a test that rebuilt them each
// time would report every case as "changed".
const SHARED = {
  contact: { id: '101', dans_tags: 'Decision Maker;ESG' },
  onSave: noop, onClose: noop, onOpenCompany: noop, tagOptions: ['ESG'],
  onSaveNote: noop, onSaveOldEmails: noop, onSaveOldCompany: noop,
  onSaveNickname: noop, onSaveReportsTo: noop,
  companyContacts: [{ id: '101' }, { id: '202' }],
  allContacts: null, emailDomains: ['berkshirepartners.com'], events: [],
};
const base = () => ({ ...SHARED });

// ── Nothing moved ──────────────────────────────────────────────────────
{
  const stores = { ccMap: { 'a@x.com': ['dan@ra.com'] } };
  ok(contactEditPropsEqual({ ...base(), ...stores }, { ...base(), ...stores }),
    'a re-render that changed nothing does not re-render the popup');
}

// ── A store nobody has written ─────────────────────────────────────────
//
// Callers pass `settings.ccMap || {}`, so an untouched store is a fresh
// object every render. Treating that as a change would re-render the popup
// on every keystroke in the page behind it.
{
  ok(contactEditPropsEqual({ ...base(), ccMap: {}, contactNotes: {} }, { ...base(), ccMap: {}, contactNotes: {} }),
    'two empty stores are the same store');
}

// ── Every store the popup writes back ──────────────────────────────────
//
// This is the whole fix: each of these, changed underneath the popup, has
// to reach it before its next save copies the map.
for (const key of SAVED_STORE_PROPS) {
  const prev = { ...base(), [key]: { 101: 'before' } };
  const next = { ...base(), [key]: { 101: 'before', 202: 'after' } };
  ok(!contactEditPropsEqual(prev, next), `a change to ${key} reaches the popup`);
}

// ── The checks that were already there ─────────────────────────────────
{
  const prev = base();
  ok(!contactEditPropsEqual(prev, { ...prev, contact: { id: '202' } }),
    'a different contact re-renders');
  ok(!contactEditPropsEqual(prev, { ...prev, contact: { id: '101', dans_tags: 'Decision Maker' } }),
    'a tag list that came back from a save re-renders');
  ok(!contactEditPropsEqual(prev, { ...prev, companyContacts: [{ id: '101' }] }),
    'a contact leaving the company roster re-renders');
  ok(!contactEditPropsEqual(prev, { ...prev, emailDomains: ['ra.com'] }),
    'a changed email domain re-renders');
  ok(!contactEditPropsEqual(prev, { ...prev, onSaveNote: () => {} }),
    'a rebuilt note saver re-renders');
}

// ── Events ─────────────────────────────────────────────────────────────
{
  const prev = { ...base(), events: [{ id: 'e1', name: 'Economist', attendees: [] }] };
  const joined = { ...base(), events: [{ id: 'e1', name: 'Economist', attendees: [{ contactId: '101' }] }] };
  ok(!contactEditPropsEqual(prev, joined), 'this contact joining an event re-renders the chips');
  const renamed = { ...base(), events: [{ id: 'e1', name: 'Economist - NY', attendees: [] }] };
  ok(!contactEditPropsEqual(prev, renamed), 'an event rename re-renders the chips');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
