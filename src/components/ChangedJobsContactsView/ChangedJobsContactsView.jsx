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
//
// Those former coworkers get their own subtab, Schneider Electric, so the
// main list (Other contacts) is only people at outside companies. The two
// subtabs are one page split in two: same selector, same table layout.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyContactsView } from '../KeyContactsView/KeyContactsView';
import { getHubspotCache } from '../../utils/hubspotContactsCache';
import { isChangedJobs, isSchneiderContact } from '../../utils/changedJobs';
import { useAuth } from '../../contexts/AuthContext';
import { MonthlyEmailButton } from './MonthlyEmailButton';


const SUBTABS = [
  { key: 'other', label: 'Other contacts' },
  { key: 'schneider', label: 'Schneider Electric' },
];
const SUBTAB_LS_KEY = 'changed-jobs-contacts:subtab';

export function ChangedJobsContactsView({ prospects = [], onSelectProspect, settings, updateSettings, updateSettingsPath, cdmName }) {
  const { isAdmin } = useAuth() || {};
  const [subtab, setSubtab] = useState(() => {
    try { return localStorage.getItem(SUBTAB_LS_KEY) === 'schneider' ? 'schneider' : 'other'; } catch { return 'other'; }
  });
  const pickSubtab = (key) => {
    setSubtab(key);
    try { localStorage.setItem(SUBTAB_LS_KEY, key); } catch { /* storage blocked */ }
  };
  const schneider = subtab === 'schneider';
  // Contacts hidden from this page from the Reached Out column (a local
  // flag, see KeyContactsView toggleChangedJobsHidden). Off the list unless
  // "Show hidden" is ticked, which shows ONLY them so they're easy to undo.
  const [showHidden, setShowHidden] = useState(false);
  const localFields = settings?.contactLocalFields;
  const isHidden = useCallback(
    (c) => !!localFields?.[String(c?.id || c?.vid || '')]?._changedJobsHidden,
    [localFields],
  );
  const selector = useCallback(
    (c) => isChangedJobs(c) && isSchneiderContact(c) === schneider && isHidden(c) === showHidden,
    [schneider, isHidden, showHidden],
  );

  // How many contacts each subtab holds, for the counts on the pills. Read
  // from the same cached HubSpot contacts the table uses.
  const [contacts, setContacts] = useState([]);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => { getHubspotCache().then(c => { if (!cancelled) setContacts(c?.contacts || []); }).catch(() => {}); };
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, []);
  const counts = useMemo(() => {
    let other = 0;
    let se = 0;
    let hidden = 0;
    for (const c of contacts) {
      if (!isChangedJobs(c)) continue;
      const sec = isSchneiderContact(c);
      if (isHidden(c)) { if (sec === schneider) hidden += 1; continue; }
      if (sec) se += 1; else other += 1;
    }
    return { other, schneider: se, hidden };
  }, [contacts, isHidden, schneider]);

  const pills = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: '0.6rem', flexWrap: 'wrap' }}>
    <div role="tablist" style={{ display: 'flex', gap: 6 }}>
      {SUBTABS.map(t => {
        const on = subtab === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => pickSubtab(t.key)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '0.3rem 0.75rem', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
              fontSize: '0.75rem', fontWeight: 600,
              border: `1px solid ${on ? '#1E293B' : '#CBD5E1'}`,
              background: on ? '#1E293B' : '#fff',
              color: on ? '#fff' : '#475569',
            }}
          >
            {t.label}
            <span style={{
              padding: '0 6px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700,
              background: on ? 'rgba(255,255,255,0.18)' : '#F1F5F9',
              color: on ? '#fff' : '#64748B',
            }}>{counts[t.key]}</span>
          </button>
        );
      })}
    </div>
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', color: '#475569', cursor: 'pointer' }}>
      <input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} />
      <span>Show hidden</span>
      <span
        title="Contacts on this subtab you hid with Hide in the Reached Out column. Tick to list them and Unhide any you want back."
        style={{
          padding: '0 6px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700, minWidth: 18, textAlign: 'center',
          background: counts.hidden > 0 ? '#FEF3C7' : '#F1F5F9',
          color: counts.hidden > 0 ? '#92400E' : '#94A3B8',
          border: '1px solid ' + (counts.hidden > 0 ? '#FCD34D' : '#E2E8F0'),
        }}
      >{counts.hidden}</span>
    </label>
    {/* The monthly email covers Other contacts, so it sits there. */}
    {isAdmin && !schneider && <MonthlyEmailButton />}
    </div>
  );

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
        <>
          HubSpot contacts who have changed jobs: either tagged <code>Left</code> or with their Company set to <code>Changed Jobs</code>. Use this to find people you want to chase down at their new employer. Map their <strong>New Company</strong> and (if that company's email format is known), the <strong>Expected Email</strong> column predicts their new address. Use the <strong>Reached Out</strong> toggle to track who you've contacted. <strong>Hide</strong> next to it takes someone off this page only (tick <strong>Show hidden</strong> to bring them back); <strong>Hide</strong> at the far right of a row tags them Hide in HubSpot, which drops them from every contacts page. Toggle <strong>All Contacts</strong> for a flat name-by-name table or <strong>By Company</strong> to roll them up. <strong>Schneider Electric</strong> holds former coworkers (a Schneider company or address, tagged <code>Left</code>); <strong>Other contacts</strong> is everyone else, and is emailed to you on the 1st of each month.
          {pills}
        </>
      }
      emptyTitle={showHidden ? 'Nobody hidden on this subtab' : schneider ? 'No Schneider Electric contacts have changed jobs' : 'No Changed Jobs contacts found'}
      emptyDetail={showHidden
        ? <>Contacts you hide with <strong>Hide</strong> in the Reached Out column are listed here. Untick <strong>Show hidden</strong> to go back.</>
        : schneider
        ? <>Nobody with a Schneider Electric company or address is tagged <code>Left</code>. Former coworkers show up here once their <code>Left</code> tag is set.</>
        : <>Nobody outside Schneider Electric currently has the <code>Left</code> tag or a Company of <code>Changed Jobs</code>. Mark a contact's <code>Left</code> tag in the contact modal: the app will automatically set their Company to <code>Changed Jobs</code> so they show up here.</>}
      contactSelector={selector}
    />
  );
}
