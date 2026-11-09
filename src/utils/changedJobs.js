// Who belongs on the Changed Jobs page, and which of them are former
// Schneider Electric coworkers. Pure and dependency-free so the page and
// the server (the monthly Changed Jobs email) answer the same way.

const SCHNEIDER_COMPANY_RE = /\bschneider\s*electric\b/i;
const SCHNEIDER_DOMAIN_RE = /(^|\.)(se\.com|schneider-electric\.com|schneider\.com)$/i;
export function isSchneiderContact(c) {
  if (SCHNEIDER_COMPANY_RE.test(String(c.company || ''))) return true;
  const email = String(c.email || '').toLowerCase().trim();
  const at = email.lastIndexOf('@');
  if (at >= 0) {
    const domain = email.slice(at + 1).trim();
    if (SCHNEIDER_DOMAIN_RE.test(domain)) return true;
  }
  return false;
}

export function isChangedJobs(c) {
  const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
  if (tags.includes('hide')) return false;
  // The Left tag comes before the coworker check, not after it: someone
  // tagged Left has left wherever they were, Schneider Electric included,
  // and a former coworker landing at a new employer is exactly the kind of
  // person this page exists to chase. Everyone still at Schneider stays out
  // — an @se.com address or a Schneider Company only means "coworker" while
  // the contact hasn't been marked as having left.
  if (tags.includes('left')) return true;
  if (isSchneiderContact(c)) return false;
  const company = String(c.company || '').trim().toLowerCase();
  if (company === 'changed jobs') return true;
  return false;
}

// Snooze, set from the Changed Jobs page's Reached Out column: the contact
// leaves Other contacts / Schneider Electric for the Snoozed subtab (and
// the monthly email) until the date passes, then comes back on its own.
// Stored per contact as contactLocalFields[id]._changedJobsSnoozeUntil, an
// ISO timestamp.

export const SNOOZE_MONTH_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 18, 24];

/** The moment `months` calendar months after `fromMs`, clamped to the
 *  month's last day (Jan 31 + 1 month is Feb 28/29, not Mar 3). */
export function snoozeUntilIso(fromMs, months) {
  const d = new Date(fromMs);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + Number(months));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString();
}

/** The snooze-until time in ms if it is still in the future, else null. */
export function activeSnoozeMs(local, nowMs = Date.now()) {
  const t = local?._changedJobsSnoozeUntil ? new Date(local._changedJobsSnoozeUntil).getTime() : NaN;
  return Number.isFinite(t) && t > nowMs ? t : null;
}
