// "Recover from backups" on the Changed Jobs page: what it puts back.
//
// A stale save wrote an old cached contactLocalFields over the stored one and
// the page's hides and snoozes were gone (see settingsKeyStale.test.mjs for
// the fix). The backups still held them. Recovery fills blanks only, takes
// the newest backup's value, and leaves out a snooze that has run out.
//
// Run: node scripts/changedJobsRecovery.test.mjs
import { register } from 'node:module';
register('./stubs/loader.mjs', import.meta.url);
const { recoverChangedJobsFlags } = await import('../src/utils/changedJobsRecovery.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

const NOW = Date.parse('2026-11-13T12:00:00Z');
const current = {
  contactLocalFields: {
    keep: { _companyOverride: 'Acme', _changedJobsSnoozeUntil: '2027-05-01T00:00:00.000Z' },
    z: { _reachedOut: true },
  },
};
const newer = { label: 'browser', data: { contactLocalFields: {
  a: { _changedJobsHidden: true, _changedJobsHiddenAt: '2026-11-10T00:00:00Z' },
  keep: { _changedJobsSnoozeUntil: '2027-02-01T00:00:00.000Z', _newCompany: 'Globex' },
  s: { _changedJobsSnoozeUntil: '2027-03-01T00:00:00.000Z' },
} } };
const older = { label: 'cloud', data: { contactLocalFields: {
  s: { _changedJobsSnoozeUntil: '2026-12-01T00:00:00.000Z' },
  gone: { _changedJobsSnoozeUntil: '2026-10-01T00:00:00.000Z' },
  r: { _reachedOut: true, _reachedOutAt: '2026-11-01T00:00:00Z' },
} } };

const { patch, found } = recoverChangedJobsFlags(current, [newer, older], NOW);
ok(patch.a._changedJobsHidden === true && patch.a._changedJobsHiddenAt, 'a lost hide comes back, with when it was hidden');
ok(patch.s._changedJobsSnoozeUntil === '2027-03-01T00:00:00.000Z', 'a lost snooze comes back from the newest backup that holds one');
ok(!patch.gone, 'a snooze that has already run out is not put back');
ok(patch.r._reachedOut === true, 'a lost Reached Out comes back');
ok(patch.keep._changedJobsSnoozeUntil === '2027-05-01T00:00:00.000Z', 'a snooze the contact has now is left as it is');
ok(patch.keep._companyOverride === 'Acme' && patch.keep._newCompany === 'Globex', 'blanks are filled beside what the contact has');
ok(patch.z._reachedOut === true, 'contacts no backup mentions are kept');
ok(found.length === 4, 'it reports each flag it puts back');
ok(found.find(x => x.id === 's').from === 'browser', 'and which backup it came from');

const none = recoverChangedJobsFlags({ contactLocalFields: { a: { _changedJobsHidden: true } } }, [newer].map(s => ({ ...s, data: { contactLocalFields: { a: s.data.contactLocalFields.a } } })), NOW);
ok(none.patch === null && none.found.length === 0, 'nothing missing: nothing to save');
ok(recoverChangedJobsFlags({}, [{ data: {} }], NOW).patch === null, 'backups without the map are skipped');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
