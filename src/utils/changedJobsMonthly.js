// The monthly Changed Jobs email: everyone on the Changed Jobs page's
// "Other contacts" subtab (people who left for an outside company, not
// former Schneider Electric coworkers), minus anyone hidden from the page
// from its Reached Out column and anyone snoozed there (they're on the
// Snoozed subtab until their snooze runs out).
//
// Pure, so the serverless function (api/changed-jobs-monthly.js) and the
// tests build the same list the page shows. Contacts come in as the flat
// HubSpot records the page's cache holds ({ id, firstname, company, ... });
// `settings` is the admin's settings doc, read for contactLocalFields (the
// per-contact Company override, New Company, Reached Out and the hide flag).

import { isChangedJobs, isSchneiderContact, activeSnoozeMs } from './changedJobs.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// The month a run belongs to, in UTC: "2026-12" / "December 2026".
export function monthOf(nowMs) {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return { key: `${y}-${String(m + 1).padStart(2, '0')}`, label: `${MONTHS[m]} ${y}` };
}

const isChangedJobsText = (s) => String(s || '').trim().toLowerCase() === 'changed jobs';

/**
 * Build the month's list. Returns { month, rows, totals } where rows are
 * { id, name, title, email, previousCompany, newCompany, linkedin,
 *   reachedOut, reachedOutAt }, people not yet reached out first.
 */
export function buildChangedJobsMonthly(contacts, settings, { nowMs = Date.now() } = {}) {
  const localFields = settings?.contactLocalFields || {};
  const rows = [];
  let hidden = 0;
  let snoozed = 0;
  for (const base of (contacts || [])) {
    const id = String(base?.id || base?.vid || '');
    const local = localFields[id] || null;
    // The page applies the Company override before its selector, so the
    // email does too.
    const c = local && typeof local._companyOverride === 'string' && local._companyOverride
      ? { ...base, company: local._companyOverride }
      : base;
    if (!isChangedJobs(c) || isSchneiderContact(c)) continue;
    if (local?._changedJobsHidden) { hidden += 1; continue; }
    if (activeSnoozeMs(local, nowMs) != null) { snoozed += 1; continue; }
    // "Changed Jobs" is a marker, not an employer: fall back to what was
    // typed on the contact, and leave it blank if that says the same.
    const previousCompany = [base.company, base.companyText, c.company]
      .map(s => String(s || '').trim())
      .find(s => s && !isChangedJobsText(s)) || '';
    rows.push({
      id,
      name: [c.firstname, c.lastname].filter(Boolean).join(' ') || c.email || 'Unknown',
      title: String(c.jobtitle || '').trim(),
      email: String(c.email || '').trim(),
      previousCompany,
      newCompany: String(local?._newCompany || '').trim(),
      linkedin: String(c.hs_linkedin_url || c.linkedin_url || '').trim(),
      reachedOut: !!local?._reachedOut,
      reachedOutAt: local?._reachedOutAt || '',
    });
  }
  rows.sort((a, b) => (Number(a.reachedOut) - Number(b.reachedOut)) || a.name.localeCompare(b.name));
  const reachedOut = rows.filter(r => r.reachedOut).length;
  return {
    month: monthOf(nowMs),
    rows,
    totals: { total: rows.length, reachedOut, notReachedOut: rows.length - reachedOut, hidden, snoozed },
  };
}
