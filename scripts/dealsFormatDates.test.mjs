// Deal dates read as the calendar day they name, in any timezone.
//
// An Excel serial or a bare "2026-12-31" used to parse as UTC midnight, so
// every US timezone showed the day before (and a Jan 1 term start counted
// as December). This file re-runs itself under several timezones, because
// the bug only shows west of Greenwich and CI runs in UTC.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ZONES = ['UTC', 'America/New_York', 'America/Los_Angeles', 'Pacific/Honolulu', 'Asia/Tokyo', 'Pacific/Kiritimati'];

if (!process.env.DEALS_DATES_TZ_CHILD) {
  let failed = 0;
  for (const tz of ZONES) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, TZ: tz, DEALS_DATES_TZ_CHILD: '1' },
      encoding: 'utf8',
    });
    process.stdout.write(r.stdout);
    if (r.status !== 0) { failed += 1; process.stdout.write(r.stderr); }
  }
  if (failed) { console.error(`${failed} timezone(s) failed`); process.exit(1); }
  console.log(`dealsFormat dates: passed in ${ZONES.length} timezones`);
} else {
  const { asDate, fmtDate } = await import('../src/utils/dealsFormat.js');
  const { contractsSummary } = await import('../src/utils/clientContracts.js');
  const { contractFields } = await import('../src/utils/accountMri.js');
  const tz = process.env.TZ;
  const day = d => [d.getFullYear(), d.getMonth() + 1, d.getDate()];

  assert.deepEqual(day(asDate('2026-12-31')), [2026, 12, 31], `${tz}: ISO day`);
  assert.deepEqual(day(asDate('2025-01-01')), [2025, 1, 1], `${tz}: Jan 1 stays January`);
  assert.equal(asDate('2025-01-01').getHours(), 0, `${tz}: local midnight`);
  assert.deepEqual(day(asDate(46387)), [2026, 12, 31], `${tz}: Excel serial`);
  assert.deepEqual(day(asDate(45658)), [2025, 1, 1], `${tz}: Excel serial Jan 1`);
  assert.equal(asDate(45658.5).getHours(), 12, `${tz}: serial fraction is the time of day`);
  assert.deepEqual(day(asDate('12/31/2026')), [2026, 12, 31], `${tz}: M/D/YYYY`);
  assert.equal(asDate('2026-02-30'), null, `${tz}: an impossible day is not a date`);
  assert.equal(asDate(''), null, `${tz}: blank`);
  assert.equal(asDate('n/a'), null, `${tz}: not a date`);
  assert.equal(fmtDate('2026-12-31'), '12/31/2026', `${tz}: Deals page cell`);
  assert.equal(fmtDate(46387), '12/31/2026', `${tz}: Deals page cell from a serial`);

  // Days to the soonest end count calendar days.
  const now = new Date(2026, 11, 1, 15, 0).getTime();
  assert.equal(contractsSummary([{ 'End Date': '2026-12-31' }], now).soonestEndDays, 30, `${tz}: days to end`);

  assert.equal(
    contractFields([{ 'Agreement Name': 'A', 'Current Term Start Date': 45658, 'End Date': '2026-12-31' }]).contractTerm,
    'Jan 1, 2025 – Dec 31, 2026 (A)',
    `${tz}: Account MRI contract term`,
  );
  console.log(`PASS  ${tz}`);
}
