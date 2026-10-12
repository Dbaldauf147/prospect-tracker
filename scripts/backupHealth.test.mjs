// The cloud-backup health check behind the site's warning banner
// (api/_lib/backupHealth.js).
//
// The rules worth pinning: billing off reads as billing (the October 2026
// outage's exact error), any other storage failure is still a failure, a
// nightly backup more than a day and a half old means the cron stopped,
// manual backups don't count as the cron running, and the probe object
// sits outside the backup prefix the list and the prune read.
//
// Run: node scripts/backupHealth.test.mjs
import { assessBackupHealth, fixLinks, probeObjectName, projectIdFromKey, STALE_HOURS } from '../api/_lib/backupHealth.js';

let passed = 0, failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n  expected ${e}\n  actual   ${a}`); }
}

const now = Date.parse('2026-10-12T20:00:00Z');
const nightly = (iso) => ({ name: `prospect-tracker-backup-u1-${iso.slice(0, 10)}.json`, createdTime: iso });

const fresh = assessBackupHealth({ files: [nightly('2026-10-12T11:02:00Z'), nightly('2026-10-11T11:01:00Z')], now });
check('a backup from this morning is healthy', [fresh.ok, fresh.problem, fresh.newestAt], [true, '', '2026-10-12T11:02:00.000Z']);

const billing = assessBackupHealth({
  files: [nightly('2026-10-12T11:02:00Z')],
  probeError: 'GCS download 403: The billing account for the owning project is disabled in state closed',
  now,
});
check('the closed-billing 403 reads as billing', [billing.ok, billing.problem], [false, 'billing']);
check('and says so in plain words, no em dash', [/billing/i.test(billing.detail), billing.detail.includes('—')], [true, false]);

check('another storage failure is still a failure',
  assessBackupHealth({ files: [nightly('2026-10-12T11:02:00Z')], probeError: 'GCS upload 404: bucket not found', now }).problem, 'storage');
check('a listing failure counts too', assessBackupHealth({ listError: 'GCS list 500: boom', now }).problem, 'storage');

const stale = assessBackupHealth({ files: [nightly('2026-10-09T11:00:00Z')], now });
check('a 3-day-old newest backup means the nightly stopped', [stale.ok, stale.problem, /3 days ago/.test(stale.detail)], [false, 'stale', true]);
const edge = new Date(now - (STALE_HOURS - 1) * 3600000).toISOString();
check('just inside the window is fine', assessBackupHealth({ files: [nightly(edge)], now }).ok, true);

const manualOnly = assessBackupHealth({
  files: [{ name: 'prospect-tracker-backup-u1-manual-2026-10-12T19-00-00.json', createdTime: '2026-10-12T19:00:00Z' }, nightly('2026-10-05T11:00:00Z')],
  now,
});
check('a manual backup does not stand in for the nightly one', manualOnly.problem, 'stale');
check('no backups at all is a problem', assessBackupHealth({ files: [], now }).problem, 'none');
check('not configured says so', assessBackupHealth({ configured: false }).problem, 'not-configured');

check('the probe lives outside the backup prefix', probeObjectName('u1').startsWith('prospect-tracker-backup-u1-'), false);

const key = JSON.stringify({ project_id: 'tracker-3161a', client_email: 'x@y' });
check('project id from a JSON key', projectIdFromKey(key), 'tracker-3161a');
check('project id from a base64 key', projectIdFromKey(Buffer.from(key).toString('base64')), 'tracker-3161a');
check('a bad key gives no project', projectIdFromKey('not json'), '');
check('links point at the project billing and bucket', fixLinks('tracker-3161a', 'my-bucket'), {
  billing: 'https://console.cloud.google.com/billing/linkedaccount?project=tracker-3161a',
  storage: 'https://console.cloud.google.com/storage/browser/my-bucket?project=tracker-3161a',
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
