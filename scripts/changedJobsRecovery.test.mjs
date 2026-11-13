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
const { recoverChangedJobsFlags, COMPANY_PIN_FLAG } = await import('../src/utils/changedJobsRecovery.js');

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

// ── Company pins (Recover company mappings on the contacts pages) ─────
{
  const cur = { contactLocalFields: { m: { _companyOverride: 'Current Co' }, u: { _reachedOut: true } } };
  const backup = { label: 'b', data: { contactLocalFields: {
    u: { _companyOverride: 'Mid-America Apartment Communities' },
    m: { _companyOverride: 'Older Co' },
    x: { _companyOverride: 'Not An Account' },
    y: { _companyOverride: 'Mapletree Investments', _changedJobsHidden: true },
  } } };
  const accounts = new Set(['mid-america apartment communities', 'mapletree investments']);
  const allowId = (id, e) => id !== 'y' && accounts.has(String(e._companyOverride).toLowerCase());
  const { patch, found } = recoverChangedJobsFlags(cur, [backup], NOW, { flags: [COMPANY_PIN_FLAG], allowId });
  ok(patch.u._companyOverride === 'Mid-America Apartment Communities' && patch.u._reachedOut, 'a lost company pin comes back beside the contact\'s other fields');
  ok(patch.m._companyOverride === 'Current Co', 'a contact with a pin now keeps it');
  ok(!patch.x, 'a pin to a company that is none of your accounts is not offered');
  ok(!patch.y, 'a contact the page does not allow (mapped now) is skipped');
  ok(found.length === 1 && found[0].value === 'Mid-America Apartment Communities', 'and only the one pin is reported');
  ok(!('_changedJobsHidden' in (patch.y || {})), 'only the Company flag is touched');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
