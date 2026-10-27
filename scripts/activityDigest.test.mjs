// Assertion tests for the activity digest (api/_lib/activityDigest.js) and
// the backup endpoint's activity-files / activity-digest actions. Plain
// Node, no framework. Run:
//   node scripts/activityDigest.test.mjs
//
// What has to hold:
//   * each email, meeting, note, call and task becomes one line per contact
//     it is linked to: when, what kind (sent vs received for emails), and
//     a subject (a note's first words stand in for one),
//   * an activity linked to no contact is skipped,
//   * activity-files answers the newest COMPLETE backup's activity part
//     files only, never contacts or companies, and never an unfinished run,
//   * activity-digest only reads activity part files inside the backup
//     folder.
import { digestRecords, describeActivity } from '../api/_lib/activityDigest.js';
import { handlerForTests as handler } from '../api/hubspot-backup.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const T = Date.parse('2026-10-21T15:00:00Z');
const link = (...ids) => ({ contacts: ids.map(id => ({ id, types: [] })) });

// ── describeActivity / digestRecords ─────────────────────────────────────
eq(describeActivity('emails', { properties: { hs_email_direction: 'INCOMING_EMAIL', hs_email_subject: 'Re: pilot' } }),
  { kind: 'Email received', subject: 'Re: pilot' }, 'an incoming email reads as received');
eq(describeActivity('emails', { properties: { hs_email_direction: 'EMAIL' } }),
  { kind: 'Email sent', subject: '(no subject)' }, 'an outgoing email with no subject');
eq(describeActivity('notes', { properties: { hs_note_body: '<p>Spoke with&nbsp;Jane about <b>meters</b></p>' } }),
  { kind: 'Note', subject: 'Spoke with Jane about meters' }, "a note's first words stand in for a subject, HTML stripped");
eq(describeActivity('meetings', { properties: { hs_meeting_title: 'Portfolio review' } }).kind, 'Meeting', 'meetings');
eq(describeActivity('emails', { properties: { hs_email_subject: 'x'.repeat(300) } }).subject.length, 120, 'long subjects are cut');
eq(digestRecords('emails', [
  { id: '1', properties: { hs_timestamp: '2026-10-21T15:00:00Z', hs_email_subject: 'Hello' }, associations: link('11', '12') },
  { id: '2', properties: { hs_timestamp: String(T) }, associations: {} },
  { id: '3', createdAt: '2026-10-20T00:00:00Z', properties: { hs_email_subject: 'Old' }, associations: link('11') },
]), [
  ['11', T, 'Email sent', 'Hello'], ['12', T, 'Email sent', 'Hello'], ['11', Date.parse('2026-10-20T00:00:00Z'), 'Email sent', 'Old'],
], 'one line per linked contact; unlinked skipped; createdAt when no timestamp');

// ── endpoint ─────────────────────────────────────────────────────────────
{
  process.env.HUBSPOT_ACCESS_TOKEN = 't';
  process.env.BACKUP_GCS_BUCKET = 'b';
  const done = 'hubspot-backup/111/2026-10-27T15-14-51Z/';
  const later = 'hubspot-backup/111/2026-10-28T09-00-00Z/'; // unfinished, newer
  const files = {
    [`${done}manifest.json`]: JSON.stringify({ complete: true, rows: [] }),
    [`${done}schema.json`]: '{}',
    [`${done}contacts-0001.json`]: JSON.stringify({ records: [] }),
    [`${done}emails-0001.json`]: JSON.stringify({ records: [{ id: '9', properties: { hs_timestamp: String(T), hs_email_subject: 'Hi' }, associations: link('11') }] }),
    [`${done}emails-0002.json`]: JSON.stringify({ records: [] }),
    [`${done}meetings-0001.json`]: JSON.stringify({ records: [] }),
    [`${later}emails-0001.json`]: JSON.stringify({ records: [] }),
  };
  const gcs = {
    listBackupObjects: async ({ prefix }) => Object.keys(files).filter(n => n.startsWith(prefix)).map(name => ({ name, size: files[name].length })),
    downloadGcsObject: async ({ name }) => { if (!(name in files)) throw new Error('404'); return files[name]; },
    uploadJsonToGcs: async () => { throw new Error('nothing should be written'); },
  };
  const get = async (query, email = 'baldaufdan@gmail.com') => {
    const res = { statusCode: 200, body: null, status(c) { res.statusCode = c; return res; }, json(b) { res.body = b; return res; } };
    await handler({ method: 'GET', query, body: {} }, res, { email }, { gcs });
    return res;
  };

  const list = await get({ action: 'activity-files' });
  eq([list.body.runId, list.body.files], ['2026-10-27T15-14-51Z', [`${done}emails-0001.json`, `${done}emails-0002.json`, `${done}meetings-0001.json`]],
    'activity-files: the newest complete run, activity parts only');

  const dig = await get({ action: 'activity-digest', name: `${done}emails-0001.json` });
  eq(dig.body.entries, [['11', T, 'Email sent', 'Hi']], 'activity-digest boils one file down');

  eq((await get({ action: 'activity-digest', name: `${done}contacts-0001.json` })).statusCode, 400, 'a contacts file is refused');
  eq((await get({ action: 'activity-digest', name: `prospect-tracker-backup-x-2026.json` })).statusCode, 400, 'a file outside the HubSpot backups is refused');
  eq((await get({ action: 'activity-digest', name: `hubspot-backup/111/../../emails-0001.json` })).statusCode, 400, 'a path that climbs out is refused');
  eq((await get({ action: 'activity-files' }, 'someone@else.com')).statusCode, 403, 'admin only');

  delete files[`${done}manifest.json`];
  eq((await get({ action: 'activity-files' })).statusCode, 404, 'no complete backup: a clear 404');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
