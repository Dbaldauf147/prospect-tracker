// Changed Jobs Contacts page — same layout / interactions as the Key
// Contacts page, but the selector keeps only HubSpot contacts that have
// either the "Left" tag or a Company text of "Changed Jobs" (the value
// the contact modal auto-applies when the Left tag is added). Either
// signal qualifies, so contacts that were marked Left manually before
// the auto-flow existed still show up.
//
// Unlike the other contact rosters, this one doesn't drop Schneider
// Electric coworkers wholesale — a coworker tagged Left has moved on and
// is worth chasing at their new employer, so the Left tag overrides the
// coworker exclusion here.

import { useCallback } from 'react';
import { KeyContactsView } from '../KeyContactsView/KeyContactsView';

const SCHNEIDER_COMPANY_RE = /\bschneider\s*electric\b/i;
const SCHNEIDER_DOMAIN_RE = /(^|\.)(se\.com|schneider-electric\.com|schneider\.com)$/i;
function isSchneiderContact(c) {
  if (SCHNEIDER_COMPANY_RE.test(String(c.company || ''))) return true;
  const email = String(c.email || '').toLowerCase().trim();
  const at = email.lastIndexOf('@');
  if (at >= 0) {
    const domain = email.slice(at + 1).trim();
    if (SCHNEIDER_DOMAIN_RE.test(domain)) return true;
  }
  return false;
}

function isChangedJobs(c) {
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

export function ChangedJobsContactsView({ prospects = [], onSelectProspect, settings, updateSettings, updateSettingsPath, cdmName }) {
  const selector = useCallback((c) => isChangedJobs(c), []);

  return (
    <KeyContactsView
      prospects={prospects}
      onSelectProspect={onSelectProspect}
      settings={settings}
      updateSettings={updateSettings}
      updateSettingsPath={updateSettingsPath}
      cdmName={cdmName}
      storagePrefix="changed-jobs-contacts"
      pageTitle="Changed Jobs"
      showNewCompanyEmail
      showReachedOut
      pageSubtitle={
        <>HubSpot contacts who have changed jobs: either tagged <code>Left</code> or with their Company set to <code>Changed Jobs</code>. Use this to find people you want to chase down at their new employer. Map their <strong>New Company</strong> and (if that company's email format is known), the <strong>Expected Email</strong> column predicts their new address. Use the <strong>Reached Out</strong> toggle to track who you've contacted, and <strong>Hide</strong> (far right of each row) to drop anyone you're done with. Toggle <strong>All Contacts</strong> for a flat name-by-name table or <strong>By Company</strong> to roll them up.</>
      }
      emptyTitle="No Changed Jobs contacts found"
      emptyDetail={
        <>Nobody currently has the <code>Left</code> tag or a Company of <code>Changed Jobs</code>. Mark a contact's <code>Left</code> tag in the contact modal: the app will automatically set their Company to <code>Changed Jobs</code> so they show up here.</>
      }
      contactSelector={selector}
    />
  );
}
