// Whether the cloud backups are working, for the banner the site shows when
// they aren't (src/components/BackupHealthBanner.jsx).
//
// The nightly backup writes to a Google Cloud Storage bucket. When the
// billing account behind that bucket's project closed, every download came
// back 403 ("The billing account for the owning project is disabled") and
// nobody knew until a restore needed one. Two checks, so that can't go
// unnoticed again:
//
//   - A probe: write a tiny object, read it back. Billing, permissions and
//     a deleted bucket all fail here, the moment it happens.
//   - The newest nightly backup's age. The probe passing doesn't mean the
//     cron is running, so a backup older than STALE_HOURS is a problem too.
//
// Pure apart from the probe the handler runs, so it loads under plain Node
// (scripts/backupHealth.test.mjs).

// Nightly at 11:00 UTC, so a healthy newest backup is at most a day old.
// A day and a half leaves room for a slow run without crying wolf.
export const STALE_HOURS = 36;

// Where the probe object lives: outside the backup name prefix, so the
// backups list and the nightly retention prune never see it.
export const probeObjectName = (uid) => `prospect-tracker-health/${uid}.json`;

/** The project the service account (and so the bucket) belongs to. */
export function projectIdFromKey(raw) {
  try {
    const s = String(raw || '').trim();
    if (!s) return '';
    const json = s.startsWith('{') ? s : Buffer.from(s, 'base64').toString('utf8');
    return String(JSON.parse(json)?.project_id || '');
  } catch {
    return '';
  }
}

/** Links to the pages that fix it: the project's billing, and the bucket. */
export function fixLinks(projectId, bucket) {
  const q = projectId ? `?project=${encodeURIComponent(projectId)}` : '';
  return {
    billing: `https://console.cloud.google.com/billing/linkedaccount${q}`,
    storage: bucket
      ? `https://console.cloud.google.com/storage/browser/${encodeURIComponent(bucket)}${q}`
      : `https://console.cloud.google.com/storage/browser${q}`,
  };
}

// A probe error that is about billing, so the banner can say "billing"
// rather than make the reader decode a GCS status line.
const isBillingError = (msg) => /billing/i.test(String(msg || ''));

const ageText = (ms) => {
  const hours = ms / 3600000;
  const days = Math.floor(hours / 24);
  return days >= 1 ? `${days} day${days === 1 ? '' : 's'}` : `${Math.max(1, Math.round(hours))} hours`;
};

// Why the nightly backup is missing, from the job's own records, appended
// to the stale / none verdicts. `cron` is backupCron/latest (the last time
// the scheduled job started, written by api/daily-backup.js); `run` is this
// user's backupRuns doc. Either may be null: the run log only exists once
// the fan-out version of the job has run, and says nothing until then.
//
// Never returns '' for a stale backup: a banner that says the nightly
// stopped and gives no reason leaves nobody able to tell "it hasn't run
// yet" from "it ran and skipped you" from "Vercel isn't calling it". `uid`
// is the account asking, for the cases where its run record doesn't exist.
export function nightlyCause({ cron = null, run = null, newest = null, uid = '', now = Date.now() } = {}) {
  const who = String(run?.uid || uid || '');
  const cronAt = Date.parse(cron?.startedAt || '');
  if (Number.isFinite(cronAt) && (now - cronAt) / 3600000 > STALE_HOURS) {
    return ` The scheduled job itself last started ${ageText(now - cronAt)} ago, so Vercel is not running the cron.`;
  }
  const mine = (cron?.results || []).find(r => r && who && r.uid === who);
  if (mine?.status === 'error' && mine.error) return ` Last night's run failed for this account: ${String(mine.error).slice(0, 200)}`;
  if (run?.lastStatus === 'error' && run.lastError) return ` The last attempt failed: ${String(run.lastError).slice(0, 200)}`;
  const attemptAt = Date.parse(run?.lastAttemptAt || '');
  if (Number.isFinite(attemptAt) && (newest == null || attemptAt > newest + 3600000)) {
    return ` The last attempt started ${ageText(now - attemptAt)} ago and never finished, most likely cut off at the time limit.`;
  }
  if (!Number.isFinite(cronAt)) {
    return ' The nightly job has not recorded a run yet. It runs each day at 11:00 UTC; use Check again after that.';
  }
  if (mine?.status === 'skipped-empty') return " Last night's run found nothing to back up for this account.";
  if (!cron?.finishedAt) {
    return ` The nightly job started ${ageText(now - cronAt)} ago and has not finished.`;
  }
  if (Array.isArray(cron?.results) && !mine) {
    return ` The nightly job ran ${ageText(now - cronAt)} ago but did not include this account (it backed up ${cron.results.length} other${cron.results.length === 1 ? '' : 's'}).`;
  }
  return ` The nightly job last ran ${ageText(now - cronAt)} ago without saving a nightly file for this account.`;
}

/**
 * The verdict: { ok, problem, detail, newestAt }.
 *   problem: '' | 'not-configured' | 'billing' | 'storage' | 'stale' | 'none'
 * `files` is the user's backups ({ name, createdTime }), `probeError` the
 * probe's failure message ('' when it passed), `listError` the listing's.
 */
export function assessBackupHealth({ configured = true, files = [], probeError = '', listError = '', cron = null, run = null, uid = '', now = Date.now() } = {}) {
  if (!configured) {
    return { ok: false, problem: 'not-configured', detail: 'Cloud backups are not set up (BACKUP_GCS_BUCKET is missing).', newestAt: null };
  }
  const failure = probeError || listError;
  if (failure) {
    return {
      ok: false,
      problem: isBillingError(failure) ? 'billing' : 'storage',
      detail: isBillingError(failure)
        ? 'Google Cloud billing for the backup project is off, so cloud backups can neither be saved nor read.'
        : `Cloud backup storage is failing: ${String(failure).slice(0, 200)}`,
      newestAt: null,
    };
  }
  // Nightly files only: a manual "back up now" says nothing about the cron.
  const nightly = (files || []).filter(f => f && !/-manual-/.test(String(f.name || '')));
  const times = nightly.map(f => Date.parse(f.createdTime)).filter(Number.isFinite);
  if (!times.length) {
    return { ok: false, problem: 'none', detail: `No nightly cloud backup has been saved yet.${nightlyCause({ cron, run, uid, now })}`, newestAt: null };
  }
  const newest = Math.max(...times);
  const hours = (now - newest) / 3600000;
  if (hours > STALE_HOURS) {
    const days = Math.floor(hours / 24);
    return {
      ok: false,
      problem: 'stale',
      detail: `The last nightly cloud backup was ${days >= 1 ? `${days} day${days === 1 ? '' : 's'}` : `${Math.round(hours)} hours`} ago, so the nightly backup has stopped running.${nightlyCause({ cron, run, newest, uid, now })}`,
      newestAt: new Date(newest).toISOString(),
    };
  }
  return { ok: true, problem: '', detail: '', newestAt: new Date(newest).toISOString() };
}
