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
//
// A third subtab, Snoozed, holds anyone snoozed from the Reached Out column
// (SE or not) until their snooze runs out; then they're back where they
// were without anybody doing anything.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyContactsView } from '../KeyContactsView/KeyContactsView';
import { getHubspotCache } from '../../utils/hubspotContactsCache';
import { isChangedJobs, isSchneiderContact, activeSnoozeMs } from '../../utils/changedJobs';
import { useAuth } from '../../contexts/AuthContext';
import { MonthlyEmailButton } from './MonthlyEmailButton';
import { findLostChangedJobsFlags, recoverChangedJobsFlags, RECOVERABLE_FLAGS } from '../../utils/changedJobsRecovery';


const SUBTABS = [
  { key: 'other', label: 'Other contacts' },
  { key: 'schneider', label: 'Schneider Electric' },
  { key: 'snoozed', label: 'Snoozed' },
];
const SUBTAB_KEYS = new Set(SUBTABS.map(t => t.key));
const SUBTAB_LS_KEY = 'changed-jobs-contacts:subtab';

export function ChangedJobsContactsView({ prospects = [], onSelectProspect, settings, updateSettings, updateSettingsPath, cdmName }) {
  const { isAdmin } = useAuth() || {};
  const [subtab, setSubtab] = useState(() => {
    try { const v = localStorage.getItem(SUBTAB_LS_KEY); return SUBTAB_KEYS.has(v) ? v : 'other'; } catch { return 'other'; }
  });
  const pickSubtab = (key) => {
    setSubtab(key);
    try { localStorage.setItem(SUBTAB_LS_KEY, key); } catch { /* storage blocked */ }
  };
  const schneider = subtab === 'schneider';
  const snoozedTab = subtab === 'snoozed';
  // Contacts hidden from this page from the Reached Out column (a local
  // flag, see KeyContactsView toggleChangedJobsHidden). Off the list unless
  // "Show hidden" is ticked, which shows ONLY them so they're easy to undo.
  const [showHidden, setShowHidden] = useState(false);
  const localFields = settings?.contactLocalFields;
  const localFor = useCallback((c) => localFields?.[String(c?.id || c?.vid || '')] || null, [localFields]);
  const isHidden = useCallback((c) => !!localFor(c)?._changedJobsHidden, [localFor]);
  // "Now" for the snooze test, refreshed hourly so a snooze that runs out
  // while the page sits open still lets the contact back. A new snooze is
  // always in the future, so it takes effect at once either way.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60 * 60 * 1000);
    return () => clearInterval(t);
  }, []);
  const isSnoozed = useCallback((c) => activeSnoozeMs(localFor(c), nowMs) != null, [localFor, nowMs]);
  // Which subtab a contact belongs on, hidden or not.
  const subtabOf = useCallback(
    (c) => (isSnoozed(c) ? 'snoozed' : isSchneiderContact(c) ? 'schneider' : 'other'),
    [isSnoozed],
  );
  const selector = useCallback(
    (c) => isChangedJobs(c) && subtabOf(c) === subtab && isHidden(c) === showHidden,
    [subtabOf, subtab, isHidden, showHidden],
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
    const out = { other: 0, schneider: 0, snoozed: 0, hidden: 0 };
    for (const c of contacts) {
      if (!isChangedJobs(c)) continue;
      const tab = subtabOf(c);
      if (isHidden(c)) { if (tab === subtab) out.hidden += 1; continue; }
      out[tab] += 1;
    }
    return out;
  }, [contacts, isHidden, subtabOf, subtab]);

  // "Recover from backups": put back Hide / Snooze / Reached Out / New
  // Company flags a save wiped (see utils/changedJobsRecovery). Fills blanks
  // only, shows what it found first, and is applied to the settings as they
  // are when the save lands.
  const [recovery, setRecovery] = useState({ busy: false, note: '' });
  async function recoverFlags() {
    if (recovery.busy) return;
    setRecovery({ busy: true, note: 'Searching backups...' });
    try {
      const { found, sources, read } = await findLostChangedJobsFlags(settings, {
        onProgress: (note) => setRecovery({ busy: true, note }),
      });
      const searched = `Searched ${read.browser} browser backup${read.browser === 1 ? '' : 's'} and ${read.cloud} cloud backup${read.cloud === 1 ? '' : 's'}${read.oldest ? `, back to ${read.oldest}` : ''}.`
        + (read.cloudFailed || read.cloudError ? `\nCloud backups that could not be read: ${read.cloudFailed}${read.cloudError ? ` (${read.cloudError})` : ''}.` : '');
      if (!found.length) {
        window.alert(`Nothing to recover: every hide, snooze, Reached Out and New Company the backups hold is already in place.\n\n${searched}`);
        setRecovery({ busy: false, note: 'Nothing to recover.' });
        return;
      }
      const nameById = new Map(contacts.map(c => [
        String(c?.id || c?.vid || ''),
        [c.firstname, c.lastname].filter(Boolean).join(' ') || c.email || '',
      ]));
      const nameOf = (id) => nameById.get(id) || `contact ${id}`;
      const perFlag = RECOVERABLE_FLAGS
        .map(f => [f.label, found.filter(x => x.flag === f.key).length])
        .filter(([, n]) => n > 0)
        .map(([label, n]) => `${label}: ${n}`);
      const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return iso; } };
      const lines = found.slice(0, 15).map(x => `${nameOf(x.id)}: ${x.flag === 'snoozed' ? `Snoozed to ${fmtDate(x.value)}` : x.flag === 'newCompany' ? `New Company ${x.value}` : x.label}`);
      if (found.length > 15) lines.push(`and ${found.length - 15} more`);
      const people = new Set(found.map(x => x.id)).size;
      const ok = window.confirm(
        `Found ${found.length} Changed Jobs edit${found.length === 1 ? '' : 's'} for ${people} contact${people === 1 ? '' : 's'} in your backups that ${found.length === 1 ? 'is' : 'are'} missing now.\n\n${perFlag.join('\n')}\n\n${lines.join('\n')}\n\nPut them back? Contacts keep anything they have now. If you unhid or un-snoozed someone on purpose since the backup, they will be hidden or snoozed again.\n\n${searched}`,
      );
      if (!ok) { setRecovery({ busy: false, note: '' }); return; }
      const saved = await updateSettings((s) => {
        const { patch } = recoverChangedJobsFlags(s, sources);
        return patch ? { contactLocalFields: patch } : null;
      });
      if (saved === false) {
        setRecovery({ busy: false, note: 'Found them, but the save did not go through. Reload the page and try again.' });
        window.alert('Found the edits, but saving them did not go through. Reload the page and click Recover from backups again.');
        return;
      }
      setRecovery({ busy: false, note: `Recovered ${found.length} edit${found.length === 1 ? '' : 's'} for ${people} contact${people === 1 ? '' : 's'}.` });
    } catch (err) {
      setRecovery({ busy: false, note: `Recovery failed: ${err?.message || err}` });
    }
  }

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
    <button
      type="button"
      onClick={recoverFlags}
      disabled={recovery.busy}
      title={recovery.note || 'Search your backups for hides, snoozes, Reached Out and New Company mappings that were lost, and put them back. Contacts keep anything they have now.'}
      style={{
        padding: '0.25rem 0.6rem', fontSize: '0.7rem', fontWeight: 600, fontFamily: 'inherit',
        border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', color: '#334155',
        cursor: recovery.busy ? 'wait' : 'pointer',
      }}
    >{recovery.busy ? (recovery.note || 'Searching...') : 'Recover from backups'}</button>
    {!recovery.busy && recovery.note && (
      <span style={{ fontSize: '0.7rem', color: '#475569', maxWidth: 260 }}>{recovery.note}</span>
    )}
    {/* The monthly email covers Other contacts, so it sits there. */}
    {isAdmin && subtab === 'other' && <MonthlyEmailButton />}
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
      pageSubtitle={pills}
      emptyTitle={showHidden ? 'Nobody hidden on this subtab' : snoozedTab ? 'Nobody is snoozed' : schneider ? 'No Schneider Electric contacts have changed jobs' : 'No Changed Jobs contacts found'}
      emptyDetail={showHidden
        ? <>Contacts you hide with <strong>Hide</strong> in the Reached Out column are listed here. Untick <strong>Show hidden</strong> to go back.</>
        : snoozedTab
        ? <>Use <strong>Snooze</strong> in the Reached Out column to set someone aside for a few months. They wait here until then, and go back to their subtab when the snooze runs out.</>
        : schneider
        ? <>Nobody with a Schneider Electric company or address is tagged <code>Left</code>. Former coworkers show up here once their <code>Left</code> tag is set.</>
        : <>Nobody outside Schneider Electric currently has the <code>Left</code> tag or a Company of <code>Changed Jobs</code>. Mark a contact's <code>Left</code> tag in the contact modal: the app will automatically set their Company to <code>Changed Jobs</code> so they show up here.</>}
      contactSelector={selector}
    />
  );
}
